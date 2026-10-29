/**
 * Thread snoozes (see domain/snooze.ts), shared by every client. Kept as one
 * `ws_meta` value, like the manual order: there are at most a few dozen, and
 * every read wants all of them.
 */
import {
  applySnoozePrefsPatch,
  isSnoozed,
  parseSnoozePrefs,
  type SnoozePrefs,
  type SnoozePrefsPatch,
  type ThreadSnooze,
} from "../domain/snooze.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import { UserError } from "./service.ts";

const KEY = "thread-snoozes";
const PREFS_KEY = "snooze-prefs";

export function loadSnoozePrefs(db: Database): SnoozePrefs {
  try {
    return parseSnoozePrefs(JSON.parse(getMeta(db, PREFS_KEY) ?? "null"));
  } catch {
    return parseSnoozePrefs(null);
  }
}

/**
 * Merges `patch` into the stored preferences. A new default must name one of
 * the presets; a preset list that drops the default moves it to the first.
 * Wake events not named in the patch keep their setting.
 */
export function saveSnoozePrefs(
  db: Database,
  patch: SnoozePrefsPatch,
): SnoozePrefs {
  const stored = loadSnoozePrefs(db);
  const presets = patch.presets ?? stored.presets;
  if (
    patch.default !== undefined &&
    !presets.some((preset) => preset.id === patch.default)
  )
    throw new UserError("That snooze preset no longer exists.");
  const saved = applySnoozePrefsPatch(stored, patch);
  setMeta(db, PREFS_KEY, JSON.stringify(saved));
  return saved;
}

export type StoredSnoozes = Record<string, ThreadSnooze>;

const isSnooze = (value: unknown): value is ThreadSnooze => {
  const v = value as Partial<ThreadSnooze> | null;
  return (
    !!v &&
    (v.until === null || typeof v.until === "number") &&
    (v.events === undefined || typeof v.events === "boolean") &&
    (v.pr === undefined || v.pr === null || typeof v.pr === "string") &&
    typeof v.attentionAt === "number" &&
    typeof v.at === "number"
  );
};

export class ThreadSnoozes {
  constructor(private readonly db: Database) {}

  all(): StoredSnoozes {
    try {
      const parsed = JSON.parse(getMeta(this.db, KEY) ?? "{}") as Record<
        string,
        unknown
      >;
      return Object.fromEntries(
        Object.entries(parsed ?? {}).filter(([, v]) => isSnooze(v)),
      ) as StoredSnoozes;
    } catch {
      return {};
    }
  }

  get(threadId: string): ThreadSnooze | undefined {
    return this.all()[threadId];
  }

  /** Stores these snoozes, each replacing its thread's earlier one. */
  set(snoozes: StoredSnoozes): void {
    this.save({ ...this.all(), ...snoozes });
  }

  /** Records the pull request state a snooze last saw (see `ThreadSnooze.pr`). */
  setPullRequest(threadId: string, pr: string | null): void {
    const all = this.all();
    const snooze = all[threadId];
    if (!snooze || snooze.pr === pr) return;
    this.save({ ...all, [threadId]: { ...snooze, pr } });
  }

  /**
   * Ends these snoozes, each only while it is still the one set at `at`, so
   * a check that started before a thread was snoozed again can't end the
   * newer snooze. Returns the threads woken.
   */
  clearSet(snoozes: readonly { id: string; at: number }[]): string[] {
    const all = this.all();
    return this.clearAll(
      snoozes.filter(({ id, at }) => all[id]?.at === at).map(({ id }) => id),
    );
  }

  /** Ends a thread's snooze; returns whether it had one. */
  clear(threadId: string): boolean {
    return this.clearAll([threadId]).length > 0;
  }

  /** Ends these threads' snoozes; returns the threads that had one. */
  clearAll(threadIds: readonly string[]): string[] {
    const all = this.all();
    const woke = [...new Set(threadIds)].filter((id) => id in all);
    if (!woke.length) return [];
    for (const id of woke) delete all[id];
    this.save(all);
    return woke;
  }

  /**
   * Drops snoozes that ended: past their wake time, or on a thread that is
   * no longer active (archived, hidden, deleted). Wake events end snoozes
   * through `SnoozeWaker` instead. Returns the threads whose wake time came,
   * which the caller marks unread so they stand out when they return.
   */
  sweep(
    threads: readonly { id: string }[],
    now: number,
  ): { ended: string[]; timed: string[] } {
    const all = this.all();
    const live = new Set(threads.map((t) => t.id));
    const ended: string[] = [];
    const timed: string[] = [];
    for (const [threadId, snooze] of Object.entries(all)) {
      const thread = live.has(threadId);
      if (thread && isSnoozed(snooze, now)) continue;
      ended.push(threadId);
      if (thread) timed.push(threadId);
      delete all[threadId];
    }
    if (ended.length) this.save(all);
    return { ended, timed };
  }

  private save(all: StoredSnoozes): void {
    setMeta(this.db, KEY, JSON.stringify(all));
  }
}
