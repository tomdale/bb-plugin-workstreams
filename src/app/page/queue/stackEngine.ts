/**
 * The queue's card stack as a physical model, with no DOM: a deterministic
 * simulation that `step` advances and `frame` reads back as numbers (each
 * card's pose, size, draw order, and shade). `motion.ts` is the thin layer
 * that measures cards, steps this on `requestAnimationFrame`, and writes the
 * numbers to the page, so the motion can be tested by stepping time.
 *
 * - Every card in the pile is a real card with its own critically damped
 *   spring state (height offset `y`, depth `z`, shading depth `p`, leaving
 *   wash `f`). Each springs toward the pose for its place in the pile, with a
 *   small stagger front to back, so the whole pile moves together.
 * - `z` is real depth. A card is drawn through a perspective projection
 *   (`sc(z) = P / (P - z)`) about the front card's top centre, so deeper cards
 *   are smaller and peek out above the front card. Cards past the visible
 *   slots wait hidden behind it.
 * - A card behind is drawn no taller than the card in front of it, so the pile
 *   always looks the size of the front card. Cards stay opaque: depth shading
 *   and the leaving fade are the page colour laid over a card (`shade`).
 * - Moving on, the front card drops until it is clear below the pile, then
 *   (touching nothing) moves behind it and rises to the back; going back runs
 *   the same path in reverse. Draw order changes only at those clear moments
 *   (`layer`, `flipsWith`, `clearLine`, `clearOf`), so no card ever passes
 *   through another.
 * - A card too tall to fit behind the new front card at its depth recedes only
 *   a little, aims its top at the middle of the front card, and fades away
 *   (slowly, then faster) before the part hanging below the pile would show.
 *   Going back it starts there, faded out, and gains colour as it comes out.
 *
 * The queue is not a loop. The pile holds the shown item and the next few
 * (`WINDOW`); a card that has left toward the back waits there, unpainted,
 * only until it is out of sight, and then is released. The caller states the
 * wanted pile with `sync`; the engine takes the moves that get it there one at
 * a time (`STEP_GAP`, one card leaving at once), a little faster while more
 * wait. `accept` is how a caller keeps held keys from queuing more than two.
 * - A held `↑` plays a held `↓` in reverse. While presses back wait (a burst),
 *   each card coming back follows a set path instead of a spring: the
 *   time-reverse of the trip it takes leaving the front onto the same
 *   neighbours with `↓` held, recorded by running a scratch engine (`trip`).
 *   The card plays that trip backward (`Script`, `playScript`): down out of
 *   the back of the pile, clear below it, then up onto the front, changing
 *   draw order at the mirrored moment. Springs can't be played backward, which
 *   is why the path is replayed, not simulated. Every draw-order change in the
 *   reversed timeline reverses one that was clear going forward, so no card
 *   passes through another; a card that finds it isn't clear waits.
 * - Each card comes up just as the one before it has landed, so cards arrive at
 *   the pace they leave a held `↓` (`paced`), each landing on top of the one
 *   before. Pulled cards stay in the pile while on their way, though the
 *   wanted pile is ahead of them (`prune`, `trim`), and the cards they cover
 *   move back a place only as each lands (`place`).
 * - What can't be reversed. A card rising over a taller card behind it drags
 *   that card's lower edge with it, and no edge moves faster than
 *   `RISE_MAX_SPEED` there, so such a rise is slower than the drop it
 *   reverses. The first card of a burst starts on springs, as a single `↑`
 *   does, and joins its path if it has barely moved when the second press
 *   comes (`joinBurst`).
 * - A single `↑`, the first after a pause, a card still on screen when it is
 *   pulled, and a `↑` while `↓` is held all run on springs. A press the other
 *   way hands a card in flight on its path back to the springs with its pose
 *   and speed (`unscript`), and it turns around as any card does; so does a
 *   card whose path can't come up in front of the pile.
 */
export type Direction = "forward" | "back";

/** The front card plus two peeking out behind it. */
const VIS = 3;
/** Cards kept in the pile: the visible slots plus one waiting hidden. */
export const STACK_WINDOW = VIS + 1;
const WINDOW = STACK_WINDOW;
/** Perspective distance, px. */
const P = 1000;
/** Lift and recession of each place behind the front card. */
const DY = 10;
const DZ = 52;
/** Room above the front card for the cards peeking out; the pile's origin. */
export const LEAD = 34;
/** Clearance between a tucking card and the pile it must clear. */
const GAP = 16;
/** Where the replies start below the front card (their own top margin). */
const BELOW_GAP = 12;
/** Depth of a card leaving the front (shrunk), spring rates, and stagger. */
const ZDROP = 170;
const OMEGA = 2 * Math.PI * 1.45;
const EXIT_OMEGA = 2 * Math.PI * 1.85;
const STAGGER = 45;
/** How far a card leaving the front washes out toward the page colour. */
const LEAVING_FADE = 0.35;
/** Hidden cards sit just below the front card's top edge, fully covered. */
const HIDE_Y = 4;
/** How far past the clear point a moving card aims, so it is still moving
 * when it gets there. */
const OVERSHOOT = 40;
/** A card rising into the front over a taller card behind it moves no faster
 * than this, px/s: that card is drawn no taller than the front one, so its
 * lower edge moves as fast, and an edge that moves more than 16 px a frame in
 * view is a jump (a little under that, for the card's own motion). */
const RISE_MAX_SPEED = 860;
/** A card rising on springs with a card on a path waiting behind it goes
 * this much faster over its last `TAIL_PX` px. */
const TAIL_PX = 40;
const TAIL_RATE = 1.6;
/** A card on springs joins a path if it is within this many px of it (of `y`
 * and depth), among the path's first `JOIN_POSES` poses. */
const JOIN_PX = 10;
const JOIN_POSES = 120;
/** A card on a path counts as landed once it is within this many px of where
 * it ends. */
const SETTLED_PX = 8;
/** A card that can't come up in front of the pile for this long, ms, goes
 * back to its springs: what it must clear is not what its path was made for. */
const WAIT_MS = 150;
/** The longest trip a scratch engine records, ms. */
const TRIP_MAX_MS = 4000;
/** A turnaround's target glides from where it was heading to where it now
 * goes over this long, so the card curves back instead of snapping. */
const TURN_MS = 260;
/** A card too tall to fit behind the front card: extra depth it may take, and
 * where its top aims as a share of the front card's height. */
const TALL_RECEDE = 100;
const TALL_AIM = 0.5;
/** A vanishing card is gone by this share of the way to its aim; its fade
 * follows the power `VANISH_EASE`, takes at least `VANISH_MIN_MS`, relaxes
 * over `VANISH_RELAX` ms, and over `VANISH_RETURN` ms for a card coming back
 * out. */
const VANISH_AT = 0.85;
const VANISH_EASE = 2.5;
const VANISH_RELAX = 120;
const VANISH_RETURN = 180;
const VANISH_MIN_MS = 200;
/** The next move may start this long after the last one. */
const STEP_GAP = 90;
/** While presses wait (a held key), and until the cards that moved then
 * settle, no card's top or bottom edge moves faster than this, px/s: 38 px a frame at 60 Hz, a little under the fastest a
 * single move gets. */
const HELD_MAX_SPEED = 2280;
/** How near a card's pose is to its target (px of `y`, depth) to count as in
 * place. */
const IN_PLACE_PX = 6;
/** Replies: the old fade out at once; the new wait (no card passing over
 * them) and fade in. */
const BELOW_OUT = 90;
const BELOW_WAIT = 160;
const BELOW_IN = 180;
const SUBSTEP = 1 / 240;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sc = (z: number) => P / (P - z);
const ease = (u: number) => u * u * (3 - 2 * u);

type Axis = "y" | "z" | "p" | "f";
const AXES: readonly Axis[] = ["y", "z", "p", "f"];
type Pose = { y: number; z: number; p: number };

type Card = {
  key: string;
  /** The card's natural height, px. */
  h: number;
  /** Its place in the pile (0 is the front) now, and the one it left. */
  pos: number;
  from: number;
  /** Until this time it keeps heading for `from`'s pose (the stagger). */
  hold: number;
  /** `exit`: dropping away from the front. `enter`: coming out of the back.
   * `rest`: springing toward its place. */
  phase: "rest" | "exit" | "enter";
  /** Travelling behind the pile (drawn under it). */
  transit: boolean;
  /** Draw tier of a card in front of the pile, which keeps the place it took. */
  top: number;
  /** An exiting card that has dropped over the card it uncovers recedes. */
  shrink: boolean;
  y: number;
  z: number;
  p: number;
  f: number;
  v: Record<Axis, number>;
  /** The height drawn: no taller than what is in front of it. */
  vis: number;
  /** Extra fade of a card too tall to fit behind the front card (0–1). */
  g: number;
  /** Faded out entirely: not painted. */
  gone: boolean;
  /** The lowest its top has been since it began vanishing. */
  low: number;
  /** Moved while presses waited (a held key); its speed stays capped until
   * it settles, so it doesn't speed up once the key is let go. */
  held: boolean;
  turn: { from: Pose; t0: number } | null;
  /** The set path it follows coming back during a burst, instead of springs. */
  script: Script | null;
  /** Its place in the pile as the springs last aimed for it (see `place`). */
  eff: number;
  /** Turned back behind the pile while still coming out of it: it stays
   * behind the cards that were pulled out before it. */
  returned: boolean;
  /** Pulled back while still in sight from leaving: it stays in front of the
   * cards still leaving behind the pile, which it was the last of. */
  seen: boolean;
  /** Left toward the back (or out of the window): waits out of sight to be
   * released, and is always at least as deep as the hidden slot. */
  parked: boolean;
};

/** A card's pose at one instant of a trip. */
type Sample = { y: number; z: number; p: number; f: number; g: number };

/** A card leaving the front with `↓` held, one pose per `SUBSTEP`: from rest in
 * front to out of sight behind the pile. */
type Trip = {
  poses: Sample[];
  /** The first pose after the card turned behind the pile. */
  turn: number;
};

/** A trip played backward: `poses[0]` is out of sight at the back. */
type Script = {
  poses: Sample[];
  /** The first pose that is on the way up into the front, where the card
   * changes draw order. */
  rise: number;
  /** How far along the path the card is, in poses (fractional). */
  u: number;
  /** From each pose, how long the rest of the path takes if the card rises
   * over a taller card throughout, ms. */
  left: number[];
  /** The card has risen onto the front, so the cards it covers move back. */
  landed: boolean;
  /** How long it has waited, ms, to come up in front of the pile. */
  waited: number;
};

/** What the page needs to draw one card. */
export type CardView = {
  key: string;
  /** False while a covered card waits at the back, or a vanished one. */
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
};

/** Where a card's edges fall, in stage px; the engine's own geometry, which
 * the page doesn't draw from and tests read through `StackEngine.edges`. */
export type CardEdges = {
  top: number;
  /** The drawn bottom edge. */
  bottom: number;
  /** The bottom edge of the whole card, clipped or not. */
  natBottom: number;
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
  state: "idle" | "pending" | "run" | "out" | "wait" | "in";
  t0: number;
  op: number;
};

export class StackEngine {
  private cards = new Map<string, Card>();
  /** The wanted pile's cards, front first; those still in it. */
  private order: Card[] = [];
  /** Cards out of the pile, oldest first, waiting out of sight for release. */
  private parked: Card[] = [];
  private want: readonly string[] = [];
  /** The items in queue order as the engine has seen them across the wanted
   * piles, so which way a change went is known even for a card the pile no
   * longer holds. */
  private line: string[] = [];
  private hint: Direction | undefined;
  private shown: string | undefined;
  /** Moves the caller's changes have asked for and the engine has not taken:
   * positive on, negative back. */
  private owed = 0;
  private heights = new Map<string, number>();
  private time = 0;
  private lastStep = -1e9;
  /** Which way the last press went, and whether presses back are coming while
   * cards are still on their way (a held key), so the cards follow set
   * paths. The engine's clock stops when it is idle, so a pause can't be
   * told by time. */
  private lastPress: Direction | undefined;
  private burst = false;
  /** Trips already recorded, by the cards and heights they were for. */
  private trips = new Map<string, Trip | null>();
  /** A scratch engine that records one trip: presses wait throughout. */
  private recording = false;
  private lay = { h: 0, v: 0 };
  private below: Part = { state: "idle", t0: 0, op: 1 };

  constructor(private readonly onRelease: (key: string) => void = () => {}) {}

  /** Cards the engine holds now: the pile, and those still leaving it. */
  keys(): string[] {
    return [...this.cards.keys()];
  }

  /** The measured natural heights of cards, by key. */
  setHeights(heights: ReadonlyMap<string, number>) {
    for (const [key, h] of heights) {
      this.heights.set(key, h);
      const card = this.cards.get(key);
      if (card) card.h = h;
    }
  }

  /** The height of the card that is, or will be, the front. */
  frontHeight(): number {
    return this.heights.get(this.want[0] ?? "") ?? 0;
  }

  /**
   * States the wanted pile: the shown item first, then the next ones. A `hint`
   * says which way the change went when the front changed (an item that
   * leaves the queue has no neighbour to tell it from going back). The engine
   * takes the moves that get there as its clock runs; `instant` takes them all
   * at once, and so does a pile it cannot reach by moving.
   */
  sync(want: readonly string[], hint?: Direction, instant = false) {
    const repeated =
      hint === "back" && this.lastPress === "back" && this.isBusy();
    this.want = want.slice(0, WINDOW);
    this.noteLine();
    if (hint) this.hint = hint;
    const front = this.order[0];
    const next = this.want[0];
    const known = (key: string | undefined) =>
      key !== undefined && this.cards.has(key);
    // A front the pile doesn't hold, with no direction, is a jump (the feed
    // changed under it), and the pile is rebuilt. Not while moves are owed: a
    // held back key's next card comes in only when its move is taken, and the
    // page syncs again on every render in between.
    if (
      instant ||
      this.cards.size === 0 ||
      (!hint && !this.owed && next !== front?.key && !known(next))
    ) {
      this.reset();
      return;
    }
    if (next !== this.shown) {
      this.shown = next;
      if (hint) {
        this.burst = repeated;
        this.lastPress = hint;
        if (repeated) this.joinBurst();
      }
      this.owed +=
        hint === "back" ? -1 : hint === "forward" ? 1 : this.nextDir();
      this.below = { ...this.below, state: "pending" };
    }
    this.admit();
    this.prune();
    this.fill();
    this.repose(null);
    this.pump();
  }

  /** Merges the wanted pile into the known order of items: the items before
   * it and those past it that it doesn't repeat keep their places. */
  private noteLine() {
    const first = this.want[0];
    if (first === undefined) return;
    const at = this.line.indexOf(first);
    if (at < 0) {
      this.line = [...this.want];
      return;
    }
    const wanted = new Set(this.want);
    this.line = [
      ...this.line
        .slice(Math.max(0, at - 64), at)
        .filter((k) => !wanted.has(k)),
      ...this.want,
      ...this.line
        .slice(at)
        .filter((k) => !wanted.has(k))
        .slice(0, 64),
    ];
  }

  /**
   * Whether a press toward `direction` may be taken now: at most two wait,
   * so a held key flicks cards off one after another instead of queuing a
   * fan of them. A press the other way is always taken.
   */
  accept(direction: Direction): boolean {
    const n = this.outstanding();
    if (n === 0 || (direction === "forward" ? n < 0 : n > 0)) return true;
    return Math.abs(n) < 2;
  }

  /** Advances the simulation by `dt` seconds, in substeps of 1/240 s. */
  step(dt: number) {
    let rest = dt;
    while (rest > 1e-9) {
      const d = Math.min(SUBSTEP, rest);
      this.tick(d);
      rest -= d;
    }
    this.measureVis();
    if (!this.isBusy()) this.settleExactly();
  }

  /** Where each card's edges fall now, by key. */
  edges(): Map<string, CardEdges> {
    this.measureVis();
    return new Map(
      [...this.cards.values()].map((c) => {
        const free = c.phase !== "rest" || c.transit;
        return [
          c.key,
          {
            top: this.natTop(c),
            bottom:
              free || c.vis >= c.h
                ? this.natBottom(c)
                : LEAD + sc(c.z) * (c.y + c.vis),
            natBottom: this.natBottom(c),
          },
        ];
      }),
    );
  }

  /** The state to draw now. */
  frame(): StackFrame {
    this.measureVis();
    const cards = [...this.cards.values()].map((c): CardView => {
      return {
        key: c.key,
        painted: this.painted(c) && (c.h === 0 || c.vis >= 2),
        interactive:
          c === this.order[0] && c.phase === "rest" && !c.transit && c.g < 0.5,
        layer: this.layer(c),
        scale: sc(c.z),
        y: c.y,
        vis: c.vis,
        h: c.h,
        shade: this.shadeOf(c),
      };
    });
    const replies = this.below;
    return {
      cards,
      height: (this.want.length || this.order.length ? LEAD : 0) + this.lay.h,
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

  // ---- The pile ------------------------------------------------------------

  private pile(): Card[] {
    return [...this.order, ...this.parked];
  }

  private create(key: string): Card {
    const card: Card = {
      key,
      h: this.heights.get(key) ?? 0,
      pos: this.cards.size,
      from: this.cards.size,
      hold: 0,
      phase: "rest",
      transit: false,
      top: 0,
      shrink: false,
      y: 0,
      z: 0,
      p: 0,
      f: 0,
      v: { y: 0, z: 0, p: 0, f: 0 },
      vis: 0,
      g: 0,
      gone: false,
      low: 0,
      held: false,
      turn: null,
      script: null,
      eff: this.cards.size,
      returned: false,
      seen: false,
      parked: false,
    };
    Object.assign(card, this.restPose(card, VIS));
    this.cards.set(key, card);
    return card;
  }

  /** Takes a card back out of the parked ones, or makes a hidden new one. */
  private revive(key: string): Card {
    const at = this.parked.findIndex((c) => c.key === key);
    if (at < 0) return this.create(key);
    const [card] = this.parked.splice(at, 1);
    card!.parked = false;
    return card!;
  }

  private park(card: Card, first = false) {
    card.parked = true;
    if (first) this.parked.unshift(card);
    else this.parked.push(card);
  }

  /** Makes every card's place in the pile its place now, staggering those
   * that changed (the card `except` follows its own path). */
  private repose(except: Card | null) {
    this.pile().forEach((c, pos) => {
      if (c !== except && c.pos !== pos) {
        c.from = c.eff;
        c.hold = this.time + pos * STAGGER;
      }
      c.pos = pos;
    });
    this.markPlaces();
  }

  /** A card's place in the pile to aim for: its index, less one for each card
   * in front of it still on its way up into the front, which has not yet
   * landed to push it back. */
  private place(c: Card): number {
    let ahead = 0;
    for (const k of this.order)
      if (k.pos < c.pos && k.script && !k.script.landed) ahead++;
    return c.pos - ahead;
  }

  private markPlaces() {
    for (const c of this.pile()) c.eff = this.place(c);
  }

  /** Hands a card on a set path back to the springs where it is, moving at
   * the speed it has. */
  private unscript(c: Card) {
    c.script = null;
  }

  /** Cards the caller no longer wants sit out of the pile, behind the front.
   * A card on a path or still rising into the front, and the cards behind it,
   * stay: the wanted pile runs ahead of what is on screen while cards are
   * still on their way, and a card that doesn't cover the pile yet can't hide
   * the cards parked under it. */
  private prune() {
    const wanted = new Set(this.want);
    const flying = this.order.findIndex((c) => c.script || c.top);
    for (const c of [...this.order.slice(1)]) {
      const at = this.order.indexOf(c);
      if (wanted.has(c.key) || (flying >= 0 && at >= flying)) continue;
      if (this.sinksThroughOthers(c)) continue;
      this.order.splice(at, 1);
      this.park(c, true);
    }
  }

  /** Whether putting a card out of the pile would swap its draw order with a
   * card it overlaps on screen: it goes behind every card still in the pile.
   * Until it is out of sight, or hidden by the front card, it stays in. */
  private sinksThroughOthers(c: Card): boolean {
    if (!this.painted(c) || this.coveredByFront(c)) return false;
    const behind = 10 + (100 - this.pile().length) * 2;
    const [t, b] = this.span(c);
    return [...this.cards.values()].some((k) => {
      if (k === c || !this.painted(k)) return false;
      if (this.layer(c) > this.layer(k) === behind > this.layer(k))
        return false;
      const [kt, kb] = this.span(k);
      return Math.min(b, kb) - Math.max(t, kt) > 1;
    });
  }

  /** Parks the cards past the window once they are out of sight: with cards
   * still on their way, the ones behind them are still on screen. */
  private trim() {
    while (this.order.length > WINDOW) {
      const tail = this.order.at(-1)!;
      if (tail.script || this.place(tail) < VIS) break;
      this.order.pop();
      this.park(tail, true);
    }
  }

  /** Seats a wanted card the pile doesn't hold where it falls between the
   * front and the last wanted card the pile does hold, so none inside the
   * pile is left without a pose. Cards before the front come in through
   * `move`, and those past the last through `fill`. */
  private admit() {
    const front = this.want.indexOf(this.order[0]?.key ?? "");
    if (front < 0) return;
    let last = front;
    for (const c of this.order) last = Math.max(last, this.want.indexOf(c.key));
    this.want.forEach((key, at) => {
      if (at <= front || at > last || this.order.some((c) => c.key === key))
        return;
      // A card still sinking out of sight waits until the front card hides
      // it, so taking its place in the draw order can't be seen.
      const waiting = this.parked.find((c) => c.key === key);
      if (waiting && this.painted(waiting) && !this.coveredByFront(waiting))
        return;
      const card = this.revive(key);
      // One still dropping away from the front just stays where it is.
      if (card.phase === "exit") card.phase = "rest";
      this.order.splice(Math.min(at - front, this.order.length), 0, card);
    });
  }

  /** Whether a wanted card the engine parked is still to be seated again. */
  private unseated(): boolean {
    return this.want.some(
      (k) =>
        !this.order.some((c) => c.key === k) &&
        this.parked.some((c) => c.key === k),
    );
  }

  /** Brings the cards that follow the last wanted one into the pile. */
  private fill() {
    let last = -1;
    for (const c of this.order) last = Math.max(last, this.want.indexOf(c.key));
    while (this.order.length < WINDOW && last + 1 < this.want.length) {
      const key = this.want[++last]!;
      if (this.order.some((c) => c.key === key)) continue;
      this.order.push(this.revive(key));
    }
  }

  /** Releases a card that has gone out of sight at the back. */
  private release() {
    for (const c of [...this.parked]) {
      if (
        c.phase === "rest" &&
        !c.transit &&
        !c.top &&
        (this.waitingHidden(c) || c.gone)
      ) {
        this.parked.splice(this.parked.indexOf(c), 1);
        this.cards.delete(c.key);
        this.onRelease(c.key);
      }
    }
  }

  /** Puts the pile exactly as wanted, every card settled in its place. */
  private reset() {
    const old = new Map(this.cards);
    this.cards = new Map();
    this.order = [];
    this.parked = [];
    for (const key of this.want.slice(0, WINDOW)) {
      const card = old.get(key) ?? this.create(key);
      this.cards.set(key, card);
      this.order.push(card);
    }
    for (const [key] of old) if (!this.cards.has(key)) this.onRelease(key);
    this.order.forEach((c, pos) => {
      Object.assign(c, {
        pos,
        from: pos,
        hold: 0,
        phase: "rest",
        transit: false,
        top: 0,
        shrink: false,
        f: 0,
        g: 0,
        gone: false,
        low: 0,
        held: false,
        turn: null,
        script: null,
        eff: pos,
        returned: false,
        seen: false,
        parked: false,
        h: this.heights.get(c.key) ?? c.h,
        v: { y: 0, z: 0, p: 0, f: 0 },
      });
      Object.assign(c, this.restPose(c, pos));
    });
    this.hint = undefined;
    this.owed = 0;
    this.line = [...this.want];
    this.shown = this.want[0];
    this.lastStep = -1e9;
    this.lastPress = undefined;
    this.burst = false;
    this.lay = { h: this.order[0]?.h ?? 0, v: 0 };
    this.below = { state: "idle", t0: this.time, op: 1 };
    this.measureVis();
  }

  // ---- Moves ---------------------------------------------------------------

  /** Which way the next move goes: 1 for on, -1 for back, 0 when the front is
   * the wanted one. */
  private nextDir(): 1 | -1 | 0 {
    const front = this.order[0];
    const next = this.want[0];
    if (!front) return next ? -1 : 0;
    if (front.key === next) return 0;
    if (!next) return 1;
    if (this.order.some((c) => c.key === next)) return 1;
    // The queue order says which side of the front the wanted item is on.
    const [f, n] = [this.line.indexOf(front.key), this.line.indexOf(next)];
    if (f >= 0 && n >= 0 && f !== n) return n > f ? 1 : -1;
    return !this.want.includes(front.key) && this.hint === "forward" ? 1 : -1;
  }

  /** Moves still to take: positive on, negative back. */
  private outstanding(): number {
    const dir = this.nextDir();
    if (!dir) return 0;
    return this.owed * dir > 0 ? this.owed : dir;
  }

  /**
   * Presses are taken one at a time. The next card in the same direction
   * starts once the previous one is clear of the pile (it has passed behind
   * it, or come out in front of it), and a move waits while the card about to
   * become visible at the back (on), or about to go out of sight (back), is
   * still moving.
   */
  private pump() {
    for (;;) {
      const dir = this.nextDir();
      if (!dir) break;
      // A burst of presses back plays set paths a `↓` interval apart.
      const paced = dir < 0 && this.burst;
      if (paced ? !this.paced() : this.time - this.lastStep < STEP_GAP) break;
      if (!paced) {
        const flying = dir > 0 ? "exit" : "enter";
        if ([...this.cards.values()].some((c) => c.phase === flying)) break;
      }
      const edge = this.order[dir > 0 ? VIS : VIS - 1];
      if (edge && (dir > 0 ? edge.transit : edge.top && !paced)) break;
      this.lastStep = this.time;
      this.move(dir);
    }
  }

  private move(dir: 1 | -1) {
    if (dir > 0) {
      const leaving = this.order.shift()!;
      this.unscript(leaving);
      this.park(leaving);
      if (leaving.phase === "enter" || leaving.transit) {
        // Still behind: it just returns.
        if (leaving.phase === "enter") leaving.returned = true;
        leaving.phase = "rest";
        leaving.transit = true;
      } else {
        if (!leaving.top) leaving.top = this.behindTops();
        leaving.phase = "exit";
        leaving.returned = false;
        leaving.transit = false;
        leaving.shrink = false;
      }
      this.fill();
      this.repose(leaving);
    } else {
      // The card just before the front, so every card makes its trip.
      const index = this.comingBack();
      const back = this.revive(this.want[index]!);
      this.order.unshift(back);
      this.admit();
      if (back.phase === "exit") {
        // Still in front: it comes straight back.
        back.phase = "rest";
      } else {
        const unseen = !this.painted(back);
        back.gone = false;
        back.seen = !unseen && !back.returned;
        if (unseen) back.returned = false;
        if (unseen) {
          // It is covered by the front card, so it can be put at a depth where
          // it fits behind it at full height without anything visible
          // changing. One too tall to fit there starts where a vanishing card
          // ends, faded into the page, and comes out the way it went in.
          const frontH = this.pileBottom(back) - LEAD;
          const z = this.fitZ(back, HIDE_Y, frontH);
          if (z < -VIS * DZ - 1) {
            const zt = Math.max(z, -VIS * DZ - TALL_RECEDE);
            Object.assign(back, {
              y: (frontH * TALL_AIM) / sc(zt),
              z: zt,
              f: 1,
              g: 1,
            });
          } else {
            Object.assign(back, { y: HIDE_Y, z: Math.min(-VIS * DZ, z), f: 1 });
          }
          for (const a of AXES) back.v[a] = 0;
        }
        back.phase = "enter";
        back.transit = true;
        back.top = 0;
        const trip = unseen && this.burst ? this.trip(index) : null;
        if (trip)
          this.start(
            back,
            trip,
            this.heights.get(this.want[index + 1] ?? "") ?? 0,
          );
      }
      this.repose(back);
      this.trim();
    }
    this.owed = this.owed * dir > 0 ? this.owed - dir : 0;
    // The hint directed the moves owed; once they are taken it says nothing.
    if (!this.owed) {
      this.hint = undefined;
      this.burst = false;
    }
    const op = this.below.op;
    this.below = { state: "out", t0: this.time - (1 - op) * BELOW_OUT, op };
    this.shown = this.want[0] ?? this.shown;
    this.measureVis();
  }

  // ---- Set paths -----------------------------------------------------------

  /** The pile index of the card the next move back brings out: the one just
   * before the front. */
  private comingBack(): number {
    const at = this.want.indexOf(this.order[0]?.key ?? "");
    return at > 0 ? at - 1 : 0;
  }

  /** When a card on its way up into the front will have landed, ms: for one
   * on a path, once the cards pulled before it have come up and it has done
   * its own rise; for one on springs, by how far it still has to go. */
  private landsAt(c: Card): number {
    const s = c.script;
    if (!s)
      return c.top ? this.time + Math.max(0, this.natTop(c) - LEAD) / 0.4 : 0;
    const i = Math.min(Math.floor(s.u), s.poses.length - 1);
    if (s.landed) return this.time + s.left[i]!;
    const own = this.time + Math.max(0, s.rise - s.u) * SUBSTEP * 1000;
    let before = 0;
    for (const k of this.order)
      if (k.pos > c.pos) before = Math.max(before, this.landsAt(k));
    return Math.max(own, before) + s.left[s.rise]!;
  }

  /** Whether a move back may be taken now in a burst. A held `↓` takes a card
   * every time one has turned behind the pile, so a card here comes up in
   * front of the pile just as the one before it has landed. That fixes when
   * it must start. */
  private paced(): boolean {
    if (this.time - this.lastStep < STEP_GAP) return false;
    const trip = this.trip(this.comingBack());
    if (!trip) return true;
    const rise = trip.poses.length - trip.turn;
    const last = Math.max(
      -1e9,
      ...[...this.cards.values()].map((c) => this.landsAt(c)),
    );
    return this.time + rise * SUBSTEP * 1000 >= last;
  }

  /** The trip the card at `index` in the wanted pile would take leaving the
   * front onto the cards behind it with `↓` held. */
  private trip(index: number): Trip | null {
    const key = this.want
      .slice(index)
      .map((k) => `${k}:${this.heights.get(k) ?? 0}`)
      .join("|");
    if (this.trips.has(key)) return this.trips.get(key)!;
    const trip = this.record(this.want.slice(index));
    if (this.trips.size > 16) this.trips.clear();
    this.trips.set(key, trip);
    return trip;
  }

  /** Records the trip by running a scratch engine, with presses waiting as in
   * a held key, until the card is out of sight behind the pile. */
  private record(pile: readonly string[]): Trip | null {
    const [key, ...rest] = pile;
    if (key === undefined || rest.length === 0) return null;
    const scratch = new StackEngine();
    scratch.heights = new Map(this.heights);
    scratch.recording = true;
    scratch.sync(pile);
    if (pile.length >= WINDOW) {
      // The card that fills the hidden place when this one leaves.
      const filler = "\0filler";
      scratch.heights.set(filler, this.heights.get(rest.at(-1)!) ?? 0);
      rest.push(filler);
    }
    scratch.sync(rest, "forward");
    const card = scratch.cards.get(key);
    if (!card) return null;
    const poses: Sample[] = [pose(card)];
    let turn = -1;
    for (let t = 0; t < TRIP_MAX_MS; t += SUBSTEP * 1000) {
      scratch.tick(SUBSTEP);
      const c = scratch.cards.get(key);
      if (!c) break;
      poses.push(pose(c));
      if (turn < 0 && c.phase !== "exit") turn = poses.length - 1;
    }
    return turn < 1 || turn >= poses.length - 1 ? null : { poses, turn };
  }

  /** Puts a card on the reverse of a trip, to come up in front of a card
   * `behind` tall. A card unseen at the back starts at its start; one already
   * on springs joins the path only if it has barely left the back, at the
   * pose on the path nearest where it is (reported by the return value). */
  private start(c: Card, trip: Trip, behind: number, joining = false): boolean {
    const poses = [...trip.poses].reverse();
    const rise = poses.length - trip.turn;
    const left = Array<number>(poses.length).fill(0);
    const second = this.slot(1);
    const below = LEAD + sc(second.z) * (second.y + behind);
    // The path is as good as done once the card is within `SETTLED_PX` of
    // where it ends: what is left can't be told from rest, and the next card
    // may come up.
    const end = edgesOf(c.h, poses[poses.length - 1]!);
    let done = poses.length - 1;
    while (
      done > 0 &&
      edgesOf(c.h, poses[done - 1]!).every(
        (e, k) => Math.abs(e - end[k]!) <= SETTLED_PX,
      )
    )
      done--;
    for (let i = poses.length - 2; i >= 0; i--) {
      const [t0, b0] = edgesOf(c.h, poses[i]!);
      const [t1, b1] = edgesOf(c.h, poses[i + 1]!);
      const moved = Math.max(Math.abs(t1 - t0), Math.abs(b1 - b0));
      // Over the card it will cover (now at the second place), it is slowed.
      const slow =
        i >= rise && b1 < below
          ? Math.max(1, moved / (RISE_MAX_SPEED * SUBSTEP))
          : 1;
      left[i] = i >= done ? 0 : left[i + 1]! + slow * SUBSTEP * 1000;
    }
    let from = 0;
    if (joining) {
      let best = JOIN_PX;
      for (let i = 0; i < Math.min(rise, JOIN_POSES); i++) {
        const d = Math.hypot(poses[i]!.y - c.y, poses[i]!.z - c.z);
        if (d < best) [best, from] = [d, i];
      }
      if (best >= JOIN_PX) return false;
    }
    c.script = { poses, rise, u: from, left, landed: false, waited: 0 };
    Object.assign(c, poses[from], { gone: false, held: true, turn: null });
    const next = poses[Math.min(from + 1, poses.length - 1)]!;
    for (const a of AXES) c.v[a] = (next[a] - poses[from]![a]) / SUBSTEP;
    return true;
  }

  /** A card pulled by the first press of a burst has barely moved by the time
   * the second comes, and takes the path the later cards take. */
  private joinBurst() {
    const c = this.order[0];
    const index = c ? this.want.indexOf(c.key) : -1;
    if (!c || c.script || c.phase !== "enter" || !c.transit || index < 0)
      return;
    const trip = this.trip(index);
    if (trip)
      this.start(
        c,
        trip,
        this.heights.get(this.want[index + 1] ?? "") ?? 0,
        true,
      );
  }

  /** Whether a card behind `c` is taller than it, so it is drawn only as tall
   * as `c` reaches. */
  private coversTaller(c: Card): boolean {
    return [...this.cards.values()].some(
      (k) =>
        k !== c &&
        k.phase === "rest" &&
        !k.transit &&
        !k.script &&
        this.layer(k) < this.layer(c) &&
        this.natBottom(k) > this.natBottom(c) - 2,
    );
  }

  /**
   * Moves a card along its path by one tick. At the mirrored moment of the
   * trip's turn the card comes up in front of the pile, which it does only
   * once it is clear of the cards it would swap order with and the cards
   * pulled before it have come up; until then it waits at that pose. Rising
   * over a taller card it is slowed to `RISE_MAX_SPEED`. The speed it leaves
   * in `v` is what the springs take over if the path is dropped.
   */
  private playScript(c: Card, s: Script, dt: number) {
    const last = s.poses.length - 1;
    const at = (u: number): Sample => {
      const i = Math.min(Math.floor(u), last);
      const a = s.poses[i]!;
      const b = s.poses[Math.min(i + 1, last)]!;
      const k = u - i;
      return {
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        p: a.p + (b.p - a.p) * k,
        f: a.f + (b.f - a.f) * k,
        g: a.g + (b.g - a.g) * k,
      };
    };
    const from = at(s.u);
    let next = Math.min(s.u + dt / SUBSTEP, last);
    const reaching = !s.landed && next >= s.rise;
    if (reaching) next = s.rise;
    else if (s.landed && this.coversTaller(c)) {
      const [t0, b0] = edgesOf(c.h, from);
      const [t1, b1] = edgesOf(c.h, at(next));
      const moved = Math.max(Math.abs(t1 - t0), Math.abs(b1 - b0));
      if (moved > RISE_MAX_SPEED * dt)
        next = s.u + ((next - s.u) * RISE_MAX_SPEED * dt) / moved;
    }
    s.u = next;
    const now = at(next);
    Object.assign(c, now);
    for (const a of AXES) c.v[a] = (now[a] - from[a]) / dt;
    c.held = true;
    if (reaching) {
      const change = {
        phase: "rest" as const,
        transit: false,
        top: this.aboveTops(),
      };
      const older = this.order.some(
        (k) => k !== c && k.script && !k.script.landed && k.pos > c.pos,
      );
      if (!older && this.clearOf(c, change)) {
        Object.assign(c, change);
        s.landed = true;
      } else if (
        // Waiting for a card that is still coming up is the order of things;
        // nothing coming up means what blocks it will not move.
        this.order.some((k) => k !== c && (k.script || k.top))
          ? (s.waited += dt * 1000) > 4 * WAIT_MS
          : (s.waited += dt * 1000) > WAIT_MS
      )
        this.unscript(c);
    }
    if (s.landed && next >= last) c.script = null;
  }

  // ---- Poses ---------------------------------------------------------------

  private slot(pos: number): Pose {
    const q = Math.min(pos, VIS);
    return { y: -q * DY, z: -q * DZ, p: q };
  }

  /** Cards past the visible slots wait hidden behind the front card: their
   * top sits just below its top edge and they are drawn no taller than it, so
   * they are covered completely. A card in the pile at its end, or leaving
   * it, is always that deep. */
  private restPose(c: Card, pos: number): Pose {
    const depth = c.parked ? Math.max(pos, VIS) : pos;
    return depth < VIS ? this.slot(depth) : { y: HIDE_Y, z: -VIS * DZ, p: VIS };
  }

  /** How deep a card with its top at `y` must be for its full natural height
   * to fit behind a front card `frontH` tall. */
  private fitZ(c: Card, y: number, frontH: number): number {
    const k = clamp((frontH - 6) / Math.max(1, c.h + y), 0.02, 1);
    return P * (1 - 1 / k);
  }

  private transitPose(c: Card, pos: number): Pose {
    const r = this.restPose(c, pos);
    const front = this.front();
    const z = this.fitZ(c, r.y, front.h);
    if (!this.vanishes(c, pos)) return { ...r, z: Math.min(r.z, z) };
    // Too tall to fit: recede only a little and aim the card's top at the
    // middle of the front card; it is gone by the time it gets there.
    const zt = Math.max(z, r.z - TALL_RECEDE);
    return { ...r, z: zt, y: (front.h * TALL_AIM) / sc(zt) };
  }

  /** Whether card `c`, travelling behind the pile to depth `pos`, is too tall
   * to fit behind the front card at that depth and so fades away. */
  private vanishes(c: Card, pos: number): boolean {
    if (!(c.transit && c.phase === "rest")) return false;
    const rest = this.restPose(c, pos);
    return this.fitZ(c, rest.y, this.front().h) < rest.z - 1;
  }

  /** The front card the pile is laid out for: the front-most card at rest. */
  private front(): Card {
    let best: Card | null = null;
    for (const c of this.cards.values())
      if (c.phase === "rest" && !c.transit && !c.gone)
        if (!best || this.layer(c) > this.layer(best)) best = c;
    return best ?? EMPTY_FRONT;
  }

  // ---- Draw order and clearance -------------------------------------------

  /**
   * Draw order. Cards travelling behind the pile are drawn under it; resting
   * cards by depth; cards in front of the pile (one dropping away, or one
   * rising into the front) above it, each keeping the place it took when it
   * got there: a card dropping away goes behind any that dropped before it,
   * and a card coming to the front goes in front of everything. Cards being
   * pulled out from the back come out in the order they were asked for.
   *
   * Cards leaving the queue behind the pile (parked) are drawn under the ones
   * still in it, each in front of those that left before it. So a card tucking
   * under while earlier ones are still on their way down and behind (a held
   * key) passes in front of them and only has to clear the pile, instead of
   * dropping below each of them in turn and landing farther down every time.
   */
  private layer(c: Card): number {
    const M = 100;
    return c.top
      ? c.top
      : c.phase === "enter"
        ? c.returned
          ? 0.5 + c.pos / (2 * M)
          : c.seen
            ? 2.06 + c.pos / (2 * M)
            : 1 + c.pos / M
        : c.transit
          ? c.parked
            ? c.returned
              ? 0.5 + c.pos / (2 * M)
              : 2 + c.pos / (2 * M)
            : 2 + (M - c.pos) / M
          : 10 + (M - c.pos) * 2;
  }

  private tops(): number[] {
    return [...this.cards.values()].filter((o) => o.top).map((o) => o.top);
  }
  private behindTops() {
    return Math.min(1001, ...this.tops()) - 1;
  }
  private aboveTops() {
    return Math.max(1000, ...this.tops()) + 1;
  }

  /** A covered card waiting at the back is not painted. */
  private waitingHidden(k: Card) {
    return (
      k.phase === "rest" && !k.transit && !k.top && k.p > VIS - 0.15 && k.y > 0
    );
  }
  private painted(k: Card) {
    return !k.gone && !this.waitingHidden(k);
  }

  /** The cards whose draw order relative to `c` would flip if `change` were
   * applied to it. A card may only make that change once it is clear of all
   * of them, so no card ever jumps in front of or behind one it overlaps. */
  private flipsWith(c: Card, change: Partial<Card>): Card[] {
    const before = this.layer(c);
    const saved = { phase: c.phase, transit: c.transit, top: c.top };
    Object.assign(c, change);
    const after = this.layer(c);
    Object.assign(c, saved);
    return [...this.cards.values()].filter(
      (k) =>
        k !== c &&
        this.painted(k) &&
        Math.sign(before - this.layer(k)) !== Math.sign(after - this.layer(k)),
    );
  }

  /** How far down card `k` reaches, not counting clipping by cards moving. */
  private reach(k: Card): number {
    if (k.phase !== "rest" || k.transit || k.top) return this.natBottom(k);
    const f = this.front();
    return Math.min(this.natBottom(k), Math.max(LEAD + f.h, this.natBottom(f)));
  }
  private clearLine(
    c: Card,
    change: Partial<Card>,
    reach = (k: Card) => this.reach(k),
  ): number {
    return Math.max(LEAD, ...this.flipsWith(c, change).map(reach)) + GAP;
  }
  /** How far down card `k` will reach once it gets where it is going, for a
   * card rising into the front; any other card's reach now. */
  private settledReach(k: Card): number {
    if (!k.top) return this.reach(k);
    const t = this.restPose(k, this.place(k));
    return Math.min(this.natBottom(k), LEAD + sc(t.z) * (t.y + k.h));
  }
  private span(k: Card): [number, number] {
    return [
      this.natTop(k),
      k.phase !== "rest" || k.transit
        ? this.natBottom(k)
        : LEAD + sc(k.z) * (k.y + k.vis),
    ];
  }
  private clearOf(c: Card, change: Partial<Card>): boolean {
    const [t, b] = this.span(c);
    return this.flipsWith(c, change).every((k) => {
      const [kt, kb] = this.span(k);
      return Math.min(b, kb) - Math.max(t, kt) < -GAP / 2;
    });
  }

  private natTop = (c: Card) => LEAD + sc(c.z) * c.y;
  private natBottom = (c: Card) => LEAD + sc(c.z) * (c.y + c.h);
  private coverBottom = (c: Card, vis: number) => LEAD + sc(c.z) * (c.y + vis);

  /** The lowest point of the resting pile. */
  private pileBottom(except: Card): number {
    let b = LEAD;
    for (const c of this.cards.values())
      if (c !== except && c.phase === "rest" && !c.transit && !c.top)
        b = Math.max(b, LEAD + sc(c.z) * (c.y + c.vis));
    return b;
  }

  /** Front to back, each resting card is drawn no taller than the cards in
   * front of it reach, so its edge stays hidden under them. */
  private measureVis() {
    const drawn = [...this.cards.values()].sort(
      (a, b) => this.layer(b) - this.layer(a),
    );
    let cover = Infinity;
    for (const c of drawn) {
      const free = c.phase !== "rest" || c.transit;
      let vis = c.h;
      if (!free && cover < this.natBottom(c))
        vis = clamp((cover - 1.5 - LEAD) / sc(c.z) - c.y, 0, c.h);
      c.vis = vis;
      if (!(c.transit || c.phase === "enter" || this.waitingHidden(c)))
        cover = Math.min(cover, this.coverBottom(c, vis));
    }
  }

  /** Depth shading and the leaving wash, as the page colour over the card. */
  private shadeOf(c: Card): number {
    const depth = c.p <= VIS - 1 ? 0.24 * c.p : 0.48;
    const leaving = LEAVING_FADE * clamp(c.f, 0, 1);
    return 1 - (1 - depth) * (1 - leaving) * (1 - c.g);
  }

  // ---- Springs -------------------------------------------------------------

  private target(c: Card): Pose {
    if (c.phase === "exit") {
      // Drop straight down over the card being uncovered, then recede once it
      // is, until clear of every card it will pass behind.
      const zt = c.shrink ? -ZDROP : 0;
      return {
        y: (this.clearLine(c, TO_BACK) - LEAD) / sc(zt) + OVERSHOOT,
        z: zt,
        p: 0,
      };
    }
    if (c.phase === "enter") {
      // Slide down out of the back of the pile until clear of every card it
      // will pass in front of. A card still rising into the front (a held
      // key) counts where it is going, not where it is, so each card pulled
      // out aims no lower than the last; it waits there, if it must, for that
      // card to rise clear before coming to the front.
      const clear = this.clearLine(
        c,
        { phase: "rest", transit: false, top: this.aboveTops() },
        (k) => this.settledReach(k),
      );
      return {
        y: (clear - LEAD) / sc(-ZDROP) + OVERSHOOT,
        z: -ZDROP,
        p: 1.2,
      };
    }
    const pos = c.hold > this.time ? c.from : this.place(c);
    return c.transit ? this.transitPose(c, pos) : this.restPose(c, pos);
  }

  /** The full target: its pose (gliding out of a turnaround), and whether it
   * is on its way out. */
  private targetOf(c: Card): Pose & { f: number } {
    let t = this.target(c);
    if (c.turn) {
      const u = (this.time - c.turn.t0) / TURN_MS;
      if (u >= 1) c.turn = null;
      else {
        const k = ease(u);
        const a = c.turn.from;
        t = {
          y: a.y + (t.y - a.y) * k,
          z: a.z + (t.z - a.z) * k,
          p: a.p + (t.p - a.p) * k,
        };
      }
    }
    return { ...t, f: c.phase !== "rest" || c.transit ? 1 : 0 };
  }

  private turnAround(c: Card, change: Partial<Card>) {
    c.turn = { from: this.target(c), t0: this.time };
    Object.assign(c, change);
    c.low = this.natTop(c);
  }

  /**
   * Springs card `c` one substep toward `t`. With `maxSpeed`, a step that
   * would move either of its edges on screen faster than that is shortened,
   * and its velocity with it, so the card keeps its course at a capped speed.
   */
  private integrate(
    c: Card,
    t: Pose & { f: number },
    omega: number,
    dt: number,
    maxSpeed?: number,
  ) {
    const k = omega * omega;
    const d = 2 * omega; // critically damped: no overshoot
    const was = {
      y: c.y,
      z: c.z,
      top: this.natTop(c),
      bottom: this.natBottom(c),
    };
    for (const a of AXES) {
      c.v[a] += (k * (t[a] - c[a]) - d * c.v[a]) * dt;
      c[a] += c.v[a] * dt;
    }
    if (maxSpeed === undefined) return;
    const moved = Math.max(
      Math.abs(this.natTop(c) - was.top),
      Math.abs(this.natBottom(c) - was.bottom),
    );
    const limit = maxSpeed * dt;
    if (moved <= limit) return;
    const s = limit / moved;
    for (const a of ["y", "z"] as const) {
      c[a] = was[a] + (c[a] - was[a]) * s;
      c.v[a] *= s;
    }
  }

  private settled(c: Card, t: Pose): boolean {
    return (["y", "z", "p"] as const).every(
      (a) =>
        Math.abs(t[a] - c[a]) < (a === "p" ? 0.002 : 0.05) &&
        Math.abs(c.v[a]) < (a === "p" ? 0.01 : 0.5),
    );
  }

  /** Whether a card is close enough to its place, and slow enough, that what
   * is left of its travel can't be told from rest. */
  private inPlace(c: Card): boolean {
    const t = this.target(c);
    return (["y", "z"] as const).every(
      (a) => Math.abs(t[a] - c[a]) < IN_PLACE_PX && Math.abs(c.v[a]) < 100,
    );
  }

  /** Whether a card in front of the pile may give up its draw tier now:
   * settled and clear of the cards it would swap order with, or on its way out
   * of sight (at the hidden slot or past it) entirely under a card in front
   * of it, which hides every swap it makes. */
  private canGiveUpTop(c: Card, t: Pose): boolean {
    if (this.inPlace(c) && this.clearOf(c, { top: 0 })) return true;
    return c.pos >= VIS && this.coveredByAbove(c);
  }

  /** Whether a card in front of the pile with a higher draw tier than `c`'s
   * hides all of `c`: drawn at least as large, over its whole outline. */
  private coveredByAbove(c: Card): boolean {
    return [...this.cards.values()].some(
      (k) =>
        k !== c &&
        k.top > c.top &&
        k.phase === "rest" &&
        !k.transit &&
        this.painted(k) &&
        sc(k.z) >= sc(c.z) &&
        this.natTop(k) <= this.natTop(c) - 1 &&
        this.coverBottom(k, k.vis) >= this.coverBottom(c, c.vis) + 1,
    );
  }

  /** Whether card `c` (drawn behind the pile) lies entirely within the front
   * card's outline, so nothing of it can be seen. */
  private coveredByFront(c: Card): boolean {
    const f = this.front();
    if (f === c) return false;
    return (
      sc(c.z) <= sc(f.z) &&
      this.natTop(c) >= this.natTop(f) + 1 &&
      this.natBottom(c) <= this.coverBottom(f, f.vis) - 1
    );
  }

  /**
   * A card that vanishes (see `transitPose`) fades on top of the leaving wash
   * by how far it has risen from its lowest point toward where it aims: slowly
   * at first, then faster, and completely by `VANISH_AT` of the way there.
   * Once gone it is not painted and settles at the back unseen.
   */
  private updateVanish(c: Card, dt: number) {
    if (c.gone) {
      c.g = 1;
      if (
        !c.transit &&
        (this.waitingHidden(c) ||
          c.phase !== "rest" ||
          this.settled(c, this.target(c)))
      )
        c.gone = false;
      return;
    }
    if (this.vanishes(c, c.hold > this.time ? c.from : this.place(c))) {
      c.low = Math.max(c.low, this.natTop(c));
      const t = this.target(c);
      const aimTop = LEAD + sc(t.z) * t.y;
      const u = clamp(
        (c.low - this.natTop(c)) / Math.max(1, c.low - aimTop) / VANISH_AT,
        0,
        1,
      );
      // A card that turns around close to its aim (a short rise) would fade
      // all at once by its progress alone; it never fades faster than
      // `VANISH_MIN_MS` from start to gone.
      c.g = Math.max(
        c.g,
        Math.min(u ** VANISH_EASE, c.g + (dt * 1000) / VANISH_MIN_MS),
      );
      if (c.g > 0.995) {
        c.g = 1;
        c.gone = true;
        c.transit = false;
        c.turn = null;
      }
    } else
      c.g *= Math.exp(
        (-dt * 1000) / (c.phase === "enter" ? VANISH_RETURN : VANISH_RELAX),
      );
  }

  /** Whether the replies' top is still under a card that is moving. */
  private overReplies(): boolean {
    const top = LEAD + this.lay.h + BELOW_GAP - 4;
    return [...this.cards.values()].some(
      (c) =>
        !c.gone &&
        (c.phase !== "rest" || c.transit || c.top) &&
        this.natBottom(c) > top,
    );
  }

  private tick(dt: number) {
    this.time += dt * 1000;
    this.pump();
    const waiting = this.nextDir() !== 0 || this.recording;
    const queued = this.order.some((k) => k.script && !k.script.landed);
    if (this.unseated()) {
      this.admit();
      this.repose(null);
    }
    this.markPlaces();
    this.trim();
    for (const c of this.cards.values()) {
      if (c.script) {
        this.playScript(c, c.script, dt);
        continue;
      }
      const t = this.targetOf(c);
      // A card rising into the front keeps its own pace while presses wait: a
      // taller card behind it is drawn no taller than it, so that card's
      // outline changes as fast as this one rises.
      const rising = c.top > 0 && c.phase === "rest";
      if (waiting) c.held = true;
      else if (c.held && this.settled(c, t)) c.held = false;
      this.integrate(
        c,
        t,
        (c.phase === "rest" ? OMEGA : EXIT_OMEGA) *
          (waiting && !rising ? 1.3 : 1) *
          // The last few px of a rise are slow on springs; a card on its way
          // up behind it can't come up until they are done.
          (rising && queued && Math.abs(t.y - c.y) < TAIL_PX ? TAIL_RATE : 1),
        dt,
        c.held
          ? rising && this.coversTaller(c)
            ? RISE_MAX_SPEED
            : HELD_MAX_SPEED
          : undefined,
      );
      this.updateVanish(c, dt);
      if (c.phase === "exit") {
        const front = this.front();
        if (!c.shrink && this.coverBottom(c, c.h) >= this.natBottom(front) - 1)
          c.shrink = true;
        if (this.natTop(c) >= this.clearLine(c, TO_BACK) - 1) {
          // Fully clear below the pile: move behind it and rise to the back.
          this.turnAround(c, TO_BACK);
          c.shrink = false;
        }
      } else if (c.phase === "enter") {
        const change = {
          phase: "rest" as const,
          transit: false,
          top: this.aboveTops(),
        };
        const first = ![...this.cards.values()].some(
          (o) => o.phase === "enter" && !o.script && o.pos > c.pos,
        );
        if (
          first &&
          c.p < 1.6 &&
          this.natTop(c) >= this.clearLine(c, change) - 1
        ) {
          // Clear below the pile: come to the front and rise into place.
          this.turnAround(c, change);
        }
      } else {
        // Once settled, a card that travelled behind the pile fits behind the
        // card in front, and one that rose to the front is simply the front.
        if (
          c.transit &&
          (this.settled(c, t) || this.coveredByFront(c)) &&
          this.clearOf(c, { transit: false })
        )
          c.transit = false;
        if (c.top && this.canGiveUpTop(c, t)) c.top = 0;
      }
    }
    this.release();
    // The layout height follows the front card, on the same spring.
    const k = OMEGA * OMEGA;
    const d = 2 * OMEGA;
    this.lay.v += (k * (this.front().h - this.lay.h) - d * this.lay.v) * dt;
    this.lay.h += this.lay.v * dt;
    this.tickParts();
  }

  /** Replies: the old fade at once; the new ones follow once no moving card
   * is passing over them. */
  private tickParts() {
    if (this.below.state === "pending" && this.nextDir() === 0)
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

  private isBusy(): boolean {
    if (this.nextDir() !== 0 || this.unseated()) return true;
    if (this.below.state !== "idle") return true;
    const front = this.front();
    if (Math.abs(front.h - this.lay.h) > 0.05 || Math.abs(this.lay.v) > 0.5)
      return true;
    for (const c of this.cards.values()) {
      if (
        c.script ||
        c.phase !== "rest" ||
        c.transit ||
        c.top ||
        c.turn ||
        c.g > 0.001
      )
        return true;
      if (c.hold > this.time) return true;
      const t = this.target(c);
      if (!this.settled(c, t)) return true;
      if (Math.abs(c.f - (c.transit ? 1 : 0)) > 0.002) return true;
    }
    return false;
  }

  /** At rest, the springs' last fractions of a pixel are removed. */
  private settleExactly() {
    for (const c of this.cards.values()) {
      Object.assign(c, this.target(c));
      c.f = 0;
      c.v = { y: 0, z: 0, p: 0, f: 0 };
    }
    this.lay.h = this.front().h;
    this.lay.v = 0;
  }
}

/** The top and bottom edges of a card `h` tall at a pose, in stage px. */
const edgesOf = (h: number, a: Sample) =>
  [LEAD + sc(a.z) * a.y, LEAD + sc(a.z) * (a.y + h)] as const;

const pose = (c: Card): Sample => ({ y: c.y, z: c.z, p: c.p, f: c.f, g: c.g });

const TO_BACK = { phase: "rest", transit: true, top: 0 } as const;

/** Stands in for the front card when the pile has none. */
const EMPTY_FRONT: Card = {
  key: "",
  h: 0,
  pos: 0,
  from: 0,
  hold: 0,
  phase: "rest",
  transit: false,
  top: 0,
  shrink: false,
  y: 0,
  z: 0,
  p: 0,
  f: 0,
  v: { y: 0, z: 0, p: 0, f: 0 },
  vis: 0,
  g: 0,
  gone: false,
  low: 0,
  held: false,
  turn: null,
  script: null,
  eff: 0,
  returned: false,
  seen: false,
  parked: false,
};
