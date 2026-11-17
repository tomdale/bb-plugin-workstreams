/**
 * The spend guard: enforces the hard caps in Settings → Usage and reports
 * which warnings and caps are reached (see `evaluateLimits`). A reached cap
 * pauses every Workstreams model call by making `admit` throw
 * `SpendCapError`; nothing is throttled below the cap.
 *
 * Every read evaluates the limits afresh from the ledger, the preferences, and
 * the stored resumes, so whichever call first sees a level change reports it:
 * `onChange` and the log fire once per change, and the `onLift` listeners once
 * each time a pause ends. While paused, a timer looks again when a calendar
 * window resets and every minute for the rolling hour, so a pause ends without
 * a model call having to ask.
 */
import { formatCount, formatMoney } from "../app/usage/format.ts";
import type { Prefs } from "../domain/prefs.ts";
import {
  evaluateLimits,
  LIMIT_KEYS,
  LIMIT_SUBJECT,
  limitsOf,
  windowResetsAt,
  type LimitKey,
  type LimitLevel,
  type LimitState,
  type SpendState,
  type UsageSource,
} from "../domain/usage.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import { UserError } from "./service.ts";
import type { UsageReader } from "./usage.ts";

/** A model call refused because a hard cap is reached. Nothing was spent. */
export class SpendCapError extends UserError {
  constructor(
    message: string,
    readonly state: SpendState,
  ) {
    super(message);
    this.name = "SpendCapError";
  }
}

/** Until when each limit's cap is resumed, in ms; stored in `ws_meta`. */
type Resumes = Partial<Record<LimitKey, number>>;
const RESUMES_KEY = "usage-resumes";

/** Spend leaves the rolling hour continuously, so it has no boundary to wait for. */
const ROLLING_RECHECK_MS = 60_000;
/** The longest delay a timer takes; a month boundary can be further off. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const reached = (limit: LimitState) =>
  limit.cap !== null && limit.used >= limit.cap;

/** "today's spend reached the $30.00 limit" */
function reachedCap(limit: LimitState): string {
  const cap = limit.cap ?? 0;
  return limit.metric === "spend"
    ? `${LIMIT_SUBJECT[limit.key]} reached the ${formatMoney(cap)} limit`
    : `${LIMIT_SUBJECT[limit.key]} reached the limit of ${formatCount(cap)}`;
}

/** Why calls are paused and how to continue, for whoever asked for one. */
export function pauseMessage(state: SpendState): string {
  const capped = state.limits.filter((limit) => limit.level === "capped");
  const first = capped[0];
  if (!first) return "Workstreams is paused.";
  const others = capped.length - 1;
  const more =
    others === 0
      ? ""
      : others === 1
        ? ", and 1 other limit is reached"
        : `, and ${others} other limits are reached`;
  return `Workstreams is paused: ${reachedCap(first)}${more}. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.`;
}

export class SpendGuard {
  /** The level the last evaluation found; a restart begins from `ok`. */
  private level: LimitLevel = "ok";
  private resumes: Resumes | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lifted = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly deps: {
      /** Holds resumes, so a restart does not end one. */
      db: Database;
      ledger: UsageReader;
      /** Read on every check, so a change in Settings applies at once. */
      prefs: () => Prefs["usage"];
      now?: () => number;
      /** Fires when the overall level changes (ok, warning, capped). */
      onChange?: (state: SpendState) => void;
      log?: (message: string) => void;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Throws `SpendCapError` while a cap that has not been resumed is reached. */
  admit(_source: UsageSource): void {
    const state = this.evaluate();
    if (state.level === "capped")
      throw new SpendCapError(pauseMessage(state), state);
  }

  /**
   * Re-evaluates after a row is recorded or the limits changed, firing
   * `onChange` on a level change and `onLift` listeners when calls resume.
   */
  observe(): void {
    this.evaluate();
  }

  status(): SpendState {
    return this.evaluate();
  }

  /**
   * Lets calls through past every cap reached now, each until its own window
   * resets (`windowResetsAt`; an hour for the rolling hour). A limit that is
   * under its cap now is not resumed, so it still pauses when reached.
   * Warnings still show.
   */
  resume(): SpendState {
    const now = this.now();
    const resumes = { ...this.currentResumes(now) };
    for (const limit of this.read(now).limits)
      if (reached(limit))
        resumes[limit.key] = windowResetsAt(limit.window, now);
    this.saveResumes(resumes);
    return this.evaluate();
  }

  /**
   * Listens for the moment a pause ends: a resume, a window rolling over, or a
   * limit changed to clear it. Work that a cap deferred restarts from here.
   * Returns a function that removes the listener.
   */
  onLift(listener: () => void): () => void {
    this.lifted.add(listener);
    return () => {
      this.lifted.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lifted.clear();
  }

  private read(now: number): SpendState {
    return evaluateLimits(
      limitsOf(this.deps.prefs()),
      this.deps.ledger.totals(now),
      now,
      this.currentResumes(now),
    );
  }

  /**
   * The current state, after reporting a level change since the last look and
   * setting the timer a pause needs. The level is stored before anything is
   * told, so a listener that asks again sees no second change.
   */
  private evaluate(): SpendState {
    const now = this.now();
    const state = this.read(now);
    const previous = this.level;
    this.level = state.level;
    this.schedule(state, now);
    if (previous === state.level) return state;
    this.deps.log?.(
      state.level === "capped"
        ? pauseMessage(state)
        : previous === "capped"
          ? "Workstreams resumed its model calls."
          : state.level === "warning"
            ? "Workstreams usage reached a warning threshold."
            : "Workstreams usage is back under its warning thresholds.",
    );
    this.tell(() => this.deps.onChange?.(state));
    if (previous === "capped")
      for (const listener of [...this.lifted]) this.tell(listener);
    return state;
  }

  /** A listener's failure is its own: the call being admitted still goes on. */
  private tell(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      this.deps.log?.(`A usage listener failed: ${String(error)}`);
    }
  }

  /** One timer while paused, for the soonest moment a reached cap can clear. */
  private schedule(state: SpendState, now: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed || state.level !== "capped") return;
    const wake = Math.min(
      ...state.limits
        .filter((limit) => limit.level === "capped")
        .map((limit) =>
          limit.window === "hour" ? now + ROLLING_RECHECK_MS : limit.resetsAt,
        ),
    );
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.disposed) this.evaluate();
      },
      Math.min(Math.max(wake - now, 0), MAX_TIMER_MS),
    );
    this.timer.unref?.();
  }

  /** The resumes still running at `now`; ended ones leave the stored record. */
  private currentResumes(now: number): Resumes {
    this.resumes ??= this.storedResumes();
    const current: Resumes = {};
    for (const key of LIMIT_KEYS) {
      const until = this.resumes[key];
      if (until !== undefined && until > now) current[key] = until;
    }
    if (Object.keys(current).length !== Object.keys(this.resumes).length)
      this.saveResumes(current);
    return current;
  }

  private storedResumes(): Resumes {
    const stored: Resumes = {};
    try {
      const raw: unknown = JSON.parse(
        getMeta(this.deps.db, RESUMES_KEY) ?? "{}",
      );
      if (raw && typeof raw === "object")
        for (const key of LIMIT_KEYS) {
          const until = (raw as Record<string, unknown>)[key];
          if (typeof until === "number" && Number.isFinite(until))
            stored[key] = until;
        }
    } catch {
      // A damaged record holds no resume.
    }
    return stored;
  }

  private saveResumes(resumes: Resumes): void {
    this.resumes = resumes;
    setMeta(this.deps.db, RESUMES_KEY, JSON.stringify(resumes));
  }
}
