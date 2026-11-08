/**
 * The queue's card stack, with no DOM: `Drum` (the elastic drum, `drum.ts`)
 * run on the pile the page asks for. `motion.ts` is the thin layer that
 * measures cards, steps this on `requestAnimationFrame`, and writes `frame`'s
 * numbers to the page, so the motion can be tested by stepping time.
 *
 * The drum moves a fixed row of cards past one integer, `front`. The queue is
 * not a row: it can be long, and items come and go. So the engine keeps a
 * short row, the cards on the drum, and changes it as the page's wanted pile
 * changes:
 * - The pile the page states (`sync`) is the shown item and the next ones. A
 *   card in it that the drum lacks is put in at rest: a card coming back goes
 *   in behind the pile, where a card that left rests, and runs the drum's
 *   ring from there to the front; a card ahead goes in with the pile.
 * - The page's pile can be ahead of the drum's front. Those moves are *owed*:
 *   each is taken as a press on the drum, which spaces presses by its tempo
 *   and takes one only once every card in transit has passed its flip. The
 *   page learns whether one more is welcome from `accept`: none while a move
 *   waits, so a held key's repeats beyond the first waiting one are dropped,
 *   and a press the other way always.
 * - An item that leaves the queue (acted on, snoozed) is still a card on the
 *   drum when the page stops asking for it. The drum moves it away like a
 *   skipped card, and the engine lets it go once it is hidden behind the pile.
 * - `hold` and `release` are a key held down and let go: the drum speeds up
 *   and stiffens while a key is held (`QUEUE_CFG`).
 *
 * The replies below the card fade out when a move starts and back in once no
 * moving card passes over them. The layout height follows the front card on a
 * spring, so what is below the stack moves with it.
 */
import { Drum, LEAD, QUEUE_CFG, type DrumView } from "./drum.ts";

export { LEAD };
export type Direction = "forward" | "back";

/** The front card plus two peeking out behind it, and one waiting hidden. */
export const STACK_WINDOW = 4;
/** Where the replies start below the front card (their own top margin). */
const BELOW_GAP = 12;
/** Spring rate of the layout height, rad/s. */
const LAYOUT_OMEGA = 2 * Math.PI * 1.45;
/** Replies: the old fade out at once; the new wait (no card passing over them) and fade in. */
const BELOW_OUT = 90;
const BELOW_WAIT = 160;
const BELOW_IN = 180;
/** Ring coordinate of a card resting behind the pile, where a card that has left comes to rest. */
const PARKED = -2;
/** A card this near the parked coordinate, and not wanted, is hidden behind the pile and can go. */
const GONE = 0.02;
/** How near its place a front card must be, in ring units, to take clicks and focus. */
const LIVE = 0.02;
/** How near to rest the layout height must be to count as settled, px. */
const SETTLED_PX = 0.05;

/** What the page needs to draw one card. */
export type CardView = {
  key: string;
  /** False while a card is hidden behind the pile or fully washed out. */
  painted: boolean;
  /** Only the settled front card takes clicks and focus. */
  interactive: boolean;
  /** Draw order (higher is nearer); only the order matters. */
  layer: number;
  scale: number;
  y: number;
  /** The height drawn, in the card's own space, and its natural height. */
  vis: number;
  h: number;
  /** The page colour laid over the card, 0–1; its shadow thins as it rises. */
  shade: number;
  /** The opacity of the card's content, 0–1; its frame and background keep their shade. */
  content: number;
};

export type StackFrame = {
  cards: CardView[];
  /** The stage's height: the room above the front card plus its height. */
  height: number;
  /** Opacities of the old replies fading out (kept as a copy) and of the
   * new ones fading in. */
  replies: { old: number; now: number };
  /** Whether anything is still moving, so the caller can stop its clock. */
  busy: boolean;
};

type Part = {
  state: "idle" | "pending" | "out" | "wait" | "in";
  t0: number;
  op: number;
};

export class StackEngine {
  private drum = new Drum([], QUEUE_CFG);
  /** The key of each card on the drum, in queue order; `drum`'s arrays run parallel to it. */
  private keyOf: string[] = [];
  private want: readonly string[] = [];
  /** Whether the queue has an item before the first one wanted. */
  private previous = false;
  private heights = new Map<string, number>();
  private time = 0;
  /** The key of the drum's front card as last seen, to notice a press being taken. */
  private frontKey: string | undefined;
  private shown: string | undefined;
  private lay = { h: 0, v: 0 };
  private below: Part = { state: "idle", t0: 0, op: 1 };

  constructor(private readonly onRelease: (key: string) => void = () => {}) {}

  /** Cards the engine holds now: the pile, and those still leaving it. */
  keys(): string[] {
    return [...this.keyOf];
  }

  /** The measured natural heights of cards, by key. */
  setHeights(heights: ReadonlyMap<string, number>) {
    for (const [key, h] of heights) {
      this.heights.set(key, h);
      const at = this.keyOf.indexOf(key);
      if (at >= 0) this.drum.h[at] = h;
    }
  }

  /**
   * States the wanted pile: the shown item first, then the next ones.
   * `hint` says which way the change went when the front changed (an item
   * that leaves the queue has no neighbour to tell it from going back), and
   * `previous` whether the queue goes on before the shown item. The engine
   * takes the moves that get there as its clock runs; `instant` takes them
   * all at once, and so does a pile it cannot reach by moving.
   */
  sync(
    want: readonly string[],
    hint?: Direction,
    instant = false,
    previous = this.previous,
  ) {
    this.want = want.slice(0, STACK_WINDOW);
    this.previous = previous;
    this.drum.more.before = previous;
    const first = this.want[0];
    if (instant || first === undefined || this.keyOf.length === 0) {
      this.reset();
      return;
    }
    let at = this.keyOf.indexOf(first);
    if (at < 0) {
      if (hint !== "back") {
        this.reset();
        return;
      }
      at = this.comeBack(first);
    }
    if (!this.arrangeAhead(at)) {
      this.reset();
      return;
    }
    if (first !== this.shown) {
      this.shown = first;
      this.below = { ...this.below, state: "pending" };
    }
    this.pump();
    this.noteTaken();
  }

  /**
   * Whether a press toward `direction` may be taken now: not while a move
   * waits, so a held key flicks cards off one after another instead of
   * queuing a fan of them. A press the other way is always taken.
   */
  accept(direction: Direction): boolean {
    const owed = this.owed();
    return owed === 0 || owed > 0 !== (direction === "forward");
  }

  /** A key toward `direction` goes down; the drum holds while it is down and another card lies ahead. */
  hold(direction: Direction) {
    const dir = direction === "forward" ? 1 : -1;
    this.drum.hold = this.drum.canAdvance(dir) ? { dir, t: 0 } : null;
  }

  /** The held key is let go. */
  release() {
    this.drum.hold = null;
  }

  /** Advances the simulation by `dt` seconds. */
  step(dt: number) {
    this.time += dt * 1000;
    this.pump();
    this.drum.step(dt * 1000);
    this.noteTaken();
    this.letGo();
    // The layout height follows the front card, on a spring.
    const k = LAYOUT_OMEGA * LAYOUT_OMEGA;
    this.lay.v +=
      (k * (this.frontHeight() - this.lay.h) - 2 * LAYOUT_OMEGA * this.lay.v) *
      dt;
    this.lay.h += this.lay.v * dt;
    this.tickParts();
    if (!this.isBusy()) this.settle();
  }

  /** The state to draw now. */
  frame(): StackFrame {
    const idle = this.owed() === 0 && this.below.state !== "pending";
    const cards = this.drum.views().map((v: DrumView): CardView => ({
      key: this.keyOf[v.i]!,
      painted: v.painted,
      interactive: idle && v.i === this.drum.front && Math.abs(v.c) < LIVE,
      layer: v.layer,
      scale: v.scale,
      y: v.y,
      vis: Math.max(0, (v.bottom - v.top) / v.scale),
      h: v.h,
      shade: v.shade,
      content: v.content,
    }));
    const replies = this.below;
    return {
      cards,
      height: (this.want.length || this.keyOf.length ? LEAD : 0) + this.lay.h,
      replies: {
        old:
          replies.state === "pending" || replies.state === "out"
            ? replies.op
            : 0,
        now:
          replies.state === "idle"
            ? 1
            : replies.state === "in"
              ? replies.op
              : 0,
      },
      busy: this.isBusy(),
    };
  }

  // ---- The row of cards ----------------------------------------------------

  private heightOf(key: string) {
    return this.heights.get(key) ?? 0;
  }

  private frontHeight() {
    return this.drum.h[this.drum.front] ?? 0;
  }

  /** Moves the page has asked for that the drum has not taken: positive on, negative back. */
  private owed(): number {
    const at = this.keyOf.indexOf(this.want[0] ?? "");
    return at < 0 ? 0 : at - this.drum.front;
  }

  /** Starts over from the wanted pile, at rest and with no moves owed. */
  private reset() {
    const hold = this.drum.hold;
    const gone = this.keyOf.filter((key) => !this.want.includes(key));
    this.keyOf = [...this.want];
    this.drum = new Drum(
      this.keyOf.map((k) => this.heightOf(k)),
      QUEUE_CFG,
    );
    this.drum.more.before = this.previous;
    this.drum.hold = hold;
    this.frontKey = this.keyOf[0];
    this.shown = this.want[0];
    this.lay = { h: this.frontHeight(), v: 0 };
    this.below = { state: "idle", t0: this.time, op: 1 };
    for (const key of gone) this.onRelease(key);
  }

  /** Puts a card the drum lacks in behind the pile, where it rests when it has left, and returns its index. */
  private comeBack(key: string): number {
    let at = this.drum.front;
    for (const next of this.want.slice(1)) {
      const found = this.keyOf.indexOf(next);
      if (found >= 0) {
        at = found;
        break;
      }
    }
    this.keyOf.splice(at, 0, key);
    this.drum.insert(at, this.heightOf(key), PARKED);
    return at;
  }

  /**
   * Makes the cards after the wanted front the wanted ones, putting in a
   * card that is missing and taking out one that is not wanted. Returns
   * false when that would touch the drum's own front card or what is before
   * it, which only a reset can do.
   */
  private arrangeAhead(first: number): boolean {
    const front = () => this.drum.front;
    for (let j = 1; j < this.want.length; j++) {
      const at = first + j;
      const key = this.want[j]!;
      if (this.keyOf[at] === key) continue;
      if (at <= front()) return false;
      const later = this.keyOf.indexOf(key, at);
      if (later > at) {
        for (let n = later - at; n > 0; n--) this.dropCard(at);
      } else {
        this.keyOf.splice(at, 0, key);
        this.drum.insert(at, this.heightOf(key), at - front());
      }
    }
    for (let at = this.keyOf.length - 1; at >= first + this.want.length; at--)
      if (at > front()) this.dropCard(at);
    return true;
  }

  private dropCard(at: number) {
    const [key] = this.keyOf.splice(at, 1);
    this.drum.remove(at);
    if (key !== undefined) this.onRelease(key);
  }

  /** Lets go of cards that have left: not wanted, and tucked out of sight behind the pile. */
  private letGo() {
    for (let at = this.drum.front - 1; at >= 0; at--) {
      const key = this.keyOf[at]!;
      if (this.want.includes(key)) continue;
      if (this.drum.c[at]! <= PARKED + GONE) this.dropCard(at);
    }
  }

  // ---- Moves ---------------------------------------------------------------

  /** Asks the drum for the next move owed, or drops a waiting one the page has taken back. */
  private pump() {
    const owed = this.owed();
    const drum = this.drum;
    if (
      drum.pending !== 0 &&
      (owed === 0 || Math.sign(owed) !== Math.sign(drum.pending))
    )
      drum.pending = 0;
    if (owed !== 0 && drum.pending === 0) drum.press(owed > 0 ? 1 : -1);
  }

  /** Notices that the drum took a press: the replies fade out from it. */
  private noteTaken() {
    const key = this.keyOf[this.drum.front];
    if (key === this.frontKey) return;
    this.frontKey = key;
    const op = this.below.op;
    this.below = { state: "out", t0: this.time - (1 - op) * BELOW_OUT, op };
  }

  /** Replies: the old fade at once; the new ones follow once no moving card
   * is passing over them. */
  private tickParts() {
    if (this.below.state === "pending" && this.owed() === 0)
      // The change was taken back before any card moved.
      this.below = { state: "idle", t0: this.time, op: 1 };
    const b = this.below;
    const age = this.time - b.t0;
    if (b.state === "out") {
      b.op = Math.max(0, 1 - age / BELOW_OUT);
      if (b.op === 0) b.state = "wait";
    }
    if (b.state === "wait" && age > BELOW_WAIT && !this.overReplies()) {
      b.state = "in";
      b.t0 = this.time;
    }
    if (b.state === "in") {
      b.op = Math.min(1, (this.time - b.t0) / BELOW_IN);
      if (b.op === 1) b.state = "idle";
    }
  }

  /** Whether the replies' top is still under a card that is moving. */
  private overReplies(): boolean {
    const top = LEAD + this.lay.h + BELOW_GAP - 4;
    const drum = this.drum;
    return drum
      .views()
      .some(
        (v) =>
          v.painted &&
          (Math.abs(drum.c[v.i]! - drum.target(v.i)) > 1e-3 ||
            Math.abs(drum.v[v.i]!) > 1e-2) &&
          v.natBottom > top,
      );
  }

  private isBusy(): boolean {
    if (this.owed() !== 0 || this.below.state !== "idle") return true;
    if (
      Math.abs(this.frontHeight() - this.lay.h) > SETTLED_PX ||
      Math.abs(this.lay.v) > 0.5
    )
      return true;
    return this.drum.isBusy();
  }

  /** At rest, the springs' last fractions of a pixel are removed. */
  private settle() {
    this.drum.settle();
    this.lay.h = this.frontHeight();
    this.lay.v = 0;
  }
}
