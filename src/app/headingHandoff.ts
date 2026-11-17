/**
 * How the scroll position becomes the handoff's progress, 0 (the large heading)
 * to 1 (the minimized one), kept pure so the motion can be tested with a clock
 * the test controls.
 *
 * - `direct` follows the scroll position over `runway` px.
 * - `latch` follows the scroll up to the latch point (`LATCH_FRACTION` of the
 *   handoff by then), then springs from wherever progress and its speed were to
 *   1. Below the release point it springs back to the scroll-driven value.
 *
 * Springs are critically damped, so a handoff never overshoots.
 */

export type HandoffConfig = {
  drive: "direct" | "latch";
  /** Scroll distance a `direct` drive travels, in px. */
  runway: number;
  /** Scroll distance at which a `latch` drive commits the handoff, in px. */
  latchAt: number;
  /** Time a `latch` drive's spring takes to reach 98% of its goal, in ms. */
  settle: number;
};

/** Share of the handoff the scroll carries a latch by the time it commits. */
export const LATCH_FRACTION = 0.35;
/**
 * A latch releases this far below the point where it caught. The gap is dead
 * band against scroll jitter, so the handoff reverses where it started.
 */
export const LATCH_GAP = 4;
/** A critically damped spring reaches 98% of its goal after this many 1/w0 seconds. */
const SETTLE_98 = 5.83;
/** The smallest speed a latch takes into its spring when it commits, per second. */
const LATCH_PUSH = 1;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export class Handoff {
  /** Progress of a latch drive. */
  p = 0;
  /** Its speed, in progress per second. */
  v = 0;
  private latched = false;
  private settling = false;
  /** Progress at the last tick, to estimate the scroll's speed. */
  private last = 0;
  private s = 0;
  /** The scroll position at the last tick: a latch reads the scroll's speed from the change. */
  private seen = 0;

  constructor(private cfg: HandoffConfig) {}

  configure(cfg: HandoffConfig): void {
    this.cfg = cfg;
  }

  private following(s: number): number {
    return LATCH_FRACTION * clamp(s / this.cfg.latchAt);
  }

  /** Start from rest at scroll position `s`. */
  reset(s: number): void {
    this.latched = s >= this.cfg.latchAt;
    this.settling = false;
    this.p = this.latched
      ? 1
      : this.cfg.drive === "latch"
        ? this.following(s)
        : 0;
    this.last = this.p;
    this.v = 0;
    this.s = s;
    this.seen = s;
  }

  /** The scroll position moved to `s`, in px from the newest message. */
  scroll(s: number): void {
    this.s = s;
    if (this.cfg.drive !== "latch") return;
    const { latchAt } = this.cfg;
    if (!this.latched && s >= latchAt) {
      // Crossing the latch point commits the handoff, with at least a small
      // push so a slow scroll still carries it forward.
      this.latched = true;
      this.settling = false;
      this.v = Math.max(this.v, LATCH_PUSH);
    } else if (this.latched && s <= latchAt - LATCH_GAP) {
      this.latched = false;
      this.settling = true;
    }
    // Until the latch point, progress is the scroll position, drawn the moment
    // it moves.
    if (!this.latched && !this.settling) this.p = this.following(s);
  }

  /** Handoff progress at the current scroll position. */
  get progress(): number {
    return this.cfg.drive === "direct"
      ? clamp(this.s / this.cfg.runway)
      : this.p;
  }

  /** Whether a spring is still moving, so the caller must keep ticking. */
  get moving(): boolean {
    if (this.cfg.drive === "direct") return false;
    if (this.latched) {
      return Math.abs(1 - this.p) >= 1e-4 || Math.abs(this.v) >= 1e-3;
    }
    if (this.settling) return true;
    // Following the scroll, progress is drawn directly. The caller keeps
    // ticking while the scroll moves and its speed dies away, so the spring
    // that takes over at the latch starts at the speed the reader scrolled at.
    return this.s !== this.seen || Math.abs(this.v) >= 0.05;
  }

  /** Advance the spring by `ms`. */
  tick(ms: number): void {
    if (this.cfg.drive !== "latch") return;
    if (!this.latched && !this.settling) {
      // Following the scroll: track it, and keep its speed for the handoff to
      // the spring.
      const next = this.following(this.s);
      const raw = (next - this.last) / (ms / 1000);
      this.v = this.v * 0.5 + raw * 0.5;
      this.p = this.last = next;
      this.seen = this.s;
      return;
    }
    const w0 = SETTLE_98 / (this.cfg.settle / 1000);
    const goal = this.latched ? 1 : this.following(this.s);
    let left = ms / 1000;
    while (left > 0) {
      const h = Math.min(left, 1 / 480);
      const a = w0 * w0 * (goal - this.p) - 2 * w0 * this.v;
      this.v += a * h;
      this.p += this.v * h;
      left -= h;
    }
    if (this.latched) {
      if (Math.abs(1 - this.p) < 1e-4 && Math.abs(this.v) < 1e-3) {
        this.p = 1;
        this.v = 0;
      }
    } else if (
      Math.abs(this.following(this.s) - this.p) < 0.003 &&
      Math.abs(this.v) < 0.05
    ) {
      this.settling = false;
      this.p = this.following(this.s);
      this.v = 0;
    }
    this.last = this.p;
  }
}
