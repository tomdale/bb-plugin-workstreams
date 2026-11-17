/**
 * How the scroll position becomes the handoff's progress, 0 (the large heading)
 * to 1 (the minimized one), kept pure so the motion can be tested with a clock
 * the test controls.
 *
 * - `scroll` follows the scroll position over `runway` px. With `follow:
 *   "eased"` the position the heading reads chases the real one through a
 *   spring instead.
 * - `latch` springs progress to 1 once the scroll passes `latchAt` px and back
 *   to 0 once it returns past the release point.
 * - `hybrid` follows the scroll up to the latch point (`HYBRID_FRACTION` of the
 *   handoff by then), then springs from wherever progress and its speed were to
 *   1. Below the release point it springs back to the scroll-driven value.
 *
 * Springs are critically damped, so a handoff never overshoots.
 */

export type HandoffConfig = {
  drive: "scroll" | "latch" | "hybrid";
  /** Smoothing for `scroll`: progress is a function of scroll, or chases it. */
  follow: "direct" | "eased";
  /** Scroll distance the `scroll` drive travels, in px. */
  runway: number;
  /** Scroll distance at which `latch` and `hybrid` commit the handoff, in px. */
  latchAt: number;
  /** Time the springs take to reach 98% of their goal, in ms. */
  settle: number;
};

/** Share of the handoff the scroll carries a hybrid by the time it latches. */
export const HYBRID_FRACTION = 0.35;
/**
 * A latch releases this far below the point where it caught. The gap is dead
 * band against scroll jitter, so the handoff reverses where it started.
 */
export const LATCH_GAP = 4;
/** Natural frequency of the eased follow's spring, in radians per second. */
const CHASE_FREQUENCY = 9;
/** A critically damped spring reaches 98% of its goal after this many 1/w0 seconds. */
const SETTLE_98 = 5.83;
/** The smallest speed a hybrid takes into its spring when it latches, per second. */
const LATCH_PUSH = 1;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export class Handoff {
  /** Progress of the timed drives. */
  p = 0;
  /** Its speed, in progress per second. */
  v = 0;
  private latched = false;
  private settling = false;
  private target = 0;
  /** Progress at the last tick, to estimate the scroll's speed. */
  private last = 0;
  /** The eased scroll position, and its speed. */
  private se = 0;
  private sv = 0;
  private s = 0;
  /** The scroll position at the last tick: a hybrid reads its scroll speed from the change. */
  private seen = 0;

  constructor(private cfg: HandoffConfig) {}

  configure(cfg: HandoffConfig): void {
    this.cfg = cfg;
  }

  private hybridScroll(s: number): number {
    return HYBRID_FRACTION * clamp(s / this.cfg.latchAt);
  }

  /** Start from rest at scroll position `s`. */
  reset(s: number): void {
    const { drive, latchAt } = this.cfg;
    this.latched = s >= latchAt;
    this.settling = false;
    this.p = this.latched ? 1 : drive === "hybrid" ? this.hybridScroll(s) : 0;
    this.last = this.p;
    this.v = 0;
    this.target = this.p;
    this.se = s;
    this.sv = 0;
    this.s = s;
    this.seen = s;
  }

  /** The scroll position moved to `s`, in px from the newest message. */
  scroll(s: number): void {
    const { drive, latchAt, follow } = this.cfg;
    this.s = s;
    if (drive === "latch") {
      if (s >= latchAt) this.target = 1;
      else if (s <= latchAt - LATCH_GAP) this.target = 0;
    } else if (drive === "hybrid") {
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
      // Until the latch point, progress is the scroll position, drawn the
      // moment it moves.
      if (!this.latched && !this.settling) this.p = this.hybridScroll(s);
    } else if (follow !== "eased") {
      this.se = s;
      this.sv = 0;
    }
  }

  /** Handoff progress at the current scroll position. */
  get progress(): number {
    return this.cfg.drive === "scroll"
      ? clamp(this.se / this.cfg.runway)
      : this.p;
  }

  /** The scroll position the `scroll` drive reads: the real one, or the eased one. */
  get position(): number {
    return this.cfg.drive === "scroll" ? this.se : this.s;
  }

  /** Whether a spring is still moving, so the caller must keep ticking. */
  get moving(): boolean {
    const { drive, follow } = this.cfg;
    if (drive === "scroll") {
      return (
        follow === "eased" &&
        (Math.abs(this.s - this.se) >= 0.05 || Math.abs(this.sv) >= 0.05)
      );
    }
    if (drive === "latch") {
      return Math.abs(this.target - this.p) >= 1e-4 || Math.abs(this.v) >= 1e-3;
    }
    if (this.latched) {
      return Math.abs(1 - this.p) >= 1e-4 || Math.abs(this.v) >= 1e-3;
    }
    if (this.settling) return true;
    // Following the scroll, progress is drawn directly. The caller keeps
    // ticking while the scroll moves and its speed dies away, so the spring
    // that takes over at the latch starts at the speed the reader scrolled at.
    return this.s !== this.seen || Math.abs(this.v) >= 0.05;
  }

  /** Advance the springs by `ms`. */
  tick(ms: number): void {
    const { drive, follow, settle } = this.cfg;
    const chase = drive === "scroll" && follow === "eased";
    if (drive === "scroll" && !chase) return;
    if (drive === "hybrid" && !this.latched && !this.settling) {
      // Following the scroll: track it, and keep its speed for the handoff to
      // the spring.
      const next = this.hybridScroll(this.s);
      const raw = (next - this.last) / (ms / 1000);
      this.v = this.v * 0.5 + raw * 0.5;
      this.p = this.last = next;
      this.seen = this.s;
      return;
    }
    const w0 = chase ? CHASE_FREQUENCY : SETTLE_98 / (settle / 1000);
    let left = ms / 1000;
    while (left > 0) {
      const h = Math.min(left, 1 / 480);
      if (chase) {
        const a = w0 * w0 * (this.s - this.se) - 2 * w0 * this.sv;
        this.sv += a * h;
        this.se += this.sv * h;
      } else {
        const goal =
          drive === "hybrid"
            ? this.latched
              ? 1
              : this.hybridScroll(this.s)
            : this.target;
        const a = w0 * w0 * (goal - this.p) - 2 * w0 * this.v;
        this.v += a * h;
        this.p += this.v * h;
      }
      left -= h;
    }
    if (chase) {
      if (Math.abs(this.s - this.se) < 0.05 && Math.abs(this.sv) < 0.05) {
        this.se = this.s;
        this.sv = 0;
      }
    } else if (drive === "hybrid") {
      if (this.latched) {
        if (Math.abs(1 - this.p) < 1e-4 && Math.abs(this.v) < 1e-3) {
          this.p = 1;
          this.v = 0;
        }
      } else if (
        Math.abs(this.hybridScroll(this.s) - this.p) < 0.003 &&
        Math.abs(this.v) < 0.05
      ) {
        this.settling = false;
        this.p = this.hybridScroll(this.s);
        this.v = 0;
      }
      this.last = this.p;
    } else if (
      Math.abs(this.target - this.p) < 1e-4 &&
      Math.abs(this.v) < 1e-3
    ) {
      this.p = this.target;
      this.v = 0;
    }
  }
}
