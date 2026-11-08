/**
 * The lab page: the shipped queue engine ("product"), the elastic drum and the cascade, driven by the same
 * keys, cards, and stepped clock. `window.__sim` is the hook the capture scripts drive.
 */
import { StackEngine } from "../../../src/app/page/queue/stackEngine.ts";
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import {
  DEFAULT_CFG,
  Drum,
  LEAD,
  QUEUE_CFG,
} from "../../../src/app/page/queue/drum.ts";
import { Cascade } from "./cascade.ts";
import {
  CASCADE_PRESET_NAMES,
  CASCADE_SETTINGS,
  CONTROLS,
  DECKS,
  DECK_SIZE,
  FOLDED,
  MODULES,
  MODES,
  PATH_KEYS,
  PATH_SETTINGS,
  PRESET_NAMES,
  SETTINGS,
  SETTING_KEYS,
  SPEEDS,
  VIEW_KEYS,
  VIEW_SETTINGS,
  cascadeCfg,
  drumCfg,
  digitsOf,
  maxOf,
  measuredPace,
  modelCfg,
  parseOpt,
  pathCfg,
  presetsOf,
  viewCfg,
  type CascadeCfg,
  type Cfg,
  type Mode,
  type ModuleId,
  type NoteContext,
  type Opt,
  type PathCfg,
  type Setting,
  type ViewCfg,
} from "./controls.ts";
import {
  ringCubics,
  ringKnots,
  ringPeaks,
  ringCrossing,
  ringPoint,
  ringSpan,
  ringSway,
  type Cubic,
  type Ring,
  type Sway,
} from "./ring.ts";
import { queueCfgSource, settingsMarkdown, type CopyRow } from "./copy.ts";
import { Meter, type CheckView } from "./meter.ts";
import {
  deletePreset,
  savePreset,
  savedPresets,
  type SavedPreset,
} from "./saved.ts";
import { ABOUT, ABOUT_CASCADE, HELP, captionFor } from "./help.ts";
import { inline, installTooltips } from "./tooltip.ts";
// @ts-ignore: plain JS data
import { ITEMS } from "./items.js";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
/** `DECK_SIZE` cards from the sample items `ids` (indexes into `ITEMS`), repeated in order and numbered. */
const deckOf = (ids: readonly number[]) =>
  Array.from({ length: DECK_SIZE }, (_, i) => ({
    ...ITEMS[ids[i % ids.length]!],
    n: i + 1,
  }));
const itemsOf = (deck: string) =>
  (DECKS.find((d) => d.id === deck) ?? DECKS[0]!).items;

const faceHTML = (it: any) => {
  const rows = [
    it.done.length
      ? `<div class="row"><h3>Done</h3><ul>${it.done.map((d: string) => `<li><b>✓</b><span>${d}</span></li>`).join("")}</ul></div>`
      : "",
    it.review.length
      ? `<div class="row"><h3>Review</h3><ul>${it.review.map((d: string, n: number) => `<li><b>${n + 1}.</b><span>${d}</span></li>`).join("")}</ul></div>`
      : "",
  ].join("");
  return `<p class="st">${it.l}<span>${it.a} · #${it.n}</span></p><p class="goal">${it.g}</p>${rows ? `<div class="rows">${rows}</div>` : ""}`; // slop-ok: 2 the queue card's own face, drawn as the product draws it
};

/**
 * The page's state, as the URL hash holds it, with a value that names nothing replaced by its default. A preset
 * belongs to one model: the drum's and the cascade's names differ, so a name the model lacks gives its first
 * preset. The product has no presets and keeps any name either model has.
 */
const sanitize = (o: Opt): Opt => {
  if (!MODES.some((m) => m.id === o.v)) o.v = "drum";
  const offered =
    o.v === "product"
      ? presetsOf("drum").concat(presetsOf("cascade"))
      : presetsOf(o.v!);
  if (!offered.includes(o.preset!)) o.preset = offered[0]!;
  if (!SPEEDS.some((s) => s.id === o.speed)) o.speed = "1";
  if (!DECKS.some((d) => d.id === o.cards)) o.cards = DECKS[0]!.id;
  return o;
};
const opt: Opt = sanitize({
  v: "drum",
  speed: "1",
  ...parseOpt(location.hash),
});
/** The cards on the stage: the deck `opt.cards` names, or the order the capture scripts set. */
let ALL = deckOf(itemsOf(opt.cards!));
let N = ALL.length;
/** Reduced motion is in force when the button or the system setting asks for it. */
const systemReduced = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => opt.reduced === "1" || systemReduced.matches;
/** The drum, cascade, path and page configurations the state asks for; recomputed whenever `opt` changes. */
let cfg: Cfg = drumCfg(opt);
let ccfg: CascadeCfg = cascadeCfg(opt);
let pcfg: PathCfg = pathCfg(opt, reduced());
let vcfg: ViewCfg = viewCfg(opt, reduced());
const refreshCfg = () => {
  cfg = drumCfg(opt);
  ccfg = cascadeCfg(opt);
  pcfg = pathCfg(opt, reduced());
  vcfg = viewCfg(opt, reduced());
};
/** The path's sideways shape for `ring.ts`, read fresh each frame so a slider applies mid-flight. */
const sway = (): Sway => ({
  front: pcfg.sway,
  behind: pcfg.swayBehind,
  peak: pcfg.peak,
  peakBehind: pcfg.peakBehind,
  cross: pcfg.cross,
});
const reportPreviewHash = () => {
  if (window.parent === window || location.origin === "null") return;
  window.parent.postMessage(
    { type: "bb:html-preview-hash", hash: location.hash },
    location.origin,
  );
};
const writeHash = () => {
  location.hash = new URLSearchParams(opt).toString();
  reportPreviewHash();
};

// ---- DOM -------------------------------------------------------------------------
const stage = $("#stage");
stage.style.height = LEAD + "px";
const clip = $("#clip");
type El = {
  el: HTMLElement;
  shadow: HTMLElement;
  frame: HTMLElement;
  content: HTMLElement;
  shade: HTMLElement;
};
let els: El[] = [];
let heights: number[] = [];
const measure = () => {
  heights = els.map((e) => e.content.offsetHeight);
};
/**
 * Measures the cards again and hands any change to the running simulation. The cards are measured when the
 * page loads, which is before layout when the page opens hidden (a background tab, a closed pane) and before
 * a late font changes their wrapping; a simulation built from those heights draws nothing, or the wrong stack.
 */
function remeasure() {
  const next = els.map((e) => e.content.offsetHeight);
  if (next.length === heights.length && next.every((h, i) => h === heights[i]))
    return;
  heights = next;
  if (!sim) return;
  sim.setHeights(heights);
  // The product engine takes new heights into its poses on its next step, so step one frame and redraw.
  advance(1000 / 60);
  wake();
}
const sizes = new ResizeObserver(remeasure);
function buildDom() {
  stage.querySelectorAll(".card").forEach((n) => n.remove());
  sizes.disconnect();
  els = ALL.map((it) => {
    const el = document.createElement("div");
    el.className = `card c-${it.s}`;
    el.style.top = LEAD + "px";
    el.innerHTML = `<div class="shadow"></div><div class="frame"></div><div class="content">${faceHTML(it)}</div><div class="shade"></div>`;
    stage.append(el);
    return {
      el,
      shadow: el.children[0] as HTMLElement,
      frame: el.children[1] as HTMLElement,
      content: el.children[2] as HTMLElement,
      shade: el.children[3] as HTMLElement,
    };
  });
  measure();
  for (const e of els) sizes.observe(e.content);
}
buildDom();
document.fonts?.ready.then(remeasure);

// ---- the ring path moving cards follow (see ring.ts) ------------------------------
const STAGE_X = 340;
const S0 = 1000 / 1170;

type Role = "pile" | "out" | "in";

const drumTuckTop = (d: Drum, i: number) => {
  const hn = i + 1 < d.N ? d.hd(i + 1) : d.hd(i);
  const yTuck = Math.max(4 / S0, (hn - d.cfg.hidePx) / S0 - d.hd(i));
  return LEAD + S0 * yTuck;
};

const slotTops = (slot: (q: number) => { y: number; z: number }) =>
  [0, 1, 2].map((q) => {
    const p = slot(q);
    return LEAD + (1000 / (1000 - p.z)) * p.y;
  });

/** Card `i`'s ring: its own turn (clear below the card it uncovers) and tuck. */
const drumRing = (d: Drum, i: number): Ring => ({
  kind: "drum",
  front: LEAD,
  turn: d.turnTop(i),
  tuck: drumTuckTop(d, i),
  sway: sway(),
});

/** Which way a card off the pile is heading: out (↓, toward the tuck) or in (↑, back to the pile). */
const roleOf = (c: number, target: number): Role =>
  c >= -1e-4 ? "pile" : target < 0 ? "out" : "in";

function drumCardMotion(d: Drum, i: number): { x: number; role: Role } {
  const c = d.c[i]!;
  return { x: ringSway(drumRing(d, i), -c), role: roleOf(c, d.target(i)) };
}

/**
 * The card whose ring the overlay draws: the moving card nearest the front, or, at rest, the front card, whose
 * ring is the one the next ↓ takes.
 */
function drumRingCard(d: Drum): number {
  let best = -1;
  for (let i = 0; i < d.N; i++) {
    const c = d.c[i]!;
    if (c < -1e-4 && c > -2 + 1e-3 && (best < 0 || c > d.c[best]!)) best = i;
  }
  return best >= 0 ? best : Math.min(Math.max(0, d.front), d.N - 1);
}

type Overlay = { ring: Ring; pile: number[] };

const drumOverlay = (d: Drum): Overlay => ({
  ring: drumRing(d, drumRingCard(d)),
  pile: slotTops((q) => d.slot(q)),
});

// ---- the two simulations behind one interface --------------------------------------
type View = {
  key: string;
  painted: boolean;
  layer: number;
  scale: number;
  x: number;
  y: number;
  top: number;
  vis: number;
  shade: number;
  content?: number;
  role: Role;
};
interface Sim {
  cur: number;
  press(dir: 1 | -1): boolean;
  step(ms: number): void;
  views(): View[];
  /** The model's own views, as the frame checker reads them: the frames the Measured module records. */
  frame(): CheckView[];
  /** The key of the card the model has in front: where a press has been taken, not only accepted. */
  frontKey(): string;
  overlay(): Overlay;
  busy(): boolean;
  jump(n: number): void;
  setHeights(heights: number[]): void;
  keyDown?(dir: 1 | -1): void;
  keyUp?(): void;
  lam?(): number;
  /** Hands the page's current configuration to the model. */
  setCfg?(): void;
}
let onMove: (cur: number, dir: 1 | -1) => void = () => {};

function drumSim(cur: number): Sim {
  refreshCfg();
  const d = new Drum(heights, cfg);
  d.jump(cur);
  let last = cur;
  const check = () => {
    if (d.front !== last) {
      const dir = d.front > last ? 1 : -1;
      last = d.front;
      onMove(d.front, dir);
    }
  };
  return {
    get cur() {
      return d.front;
    },
    press: (dir) => {
      const r = d.press(dir);
      check();
      return r;
    },
    step: (ms) => {
      d.step(ms);
      check();
    },
    views: () =>
      d.views().map((v: any) => {
        const { x, role } = drumCardMotion(d, v.i);
        return {
          ...v,
          x,
          role,
          vis: (v.bottom - v.top) / v.scale,
        };
      }),
    frame: () => d.views(),
    frontKey: () => `k${d.front}`,
    overlay: () => drumOverlay(d),
    busy: () => d.isBusy(),
    jump: (n) => {
      d.jump(n);
      last = n;
    },
    setHeights: (h) => d.setHeights(h),
    keyDown: (dir) => {
      d.keyDown(dir);
      check();
    },
    keyUp: () => d.keyUp(),
    lam: () => d.lam,
    setCfg: () => {
      Object.assign(d.cfg, cfg);
    },
  };
}

/**
 * The cascade. The model reports a channel card that reaches the clip line cut there, and a card drawn to that
 * height would show rounded corners and a border on the line. The page draws such a card at its own height
 * unless a card in front shortens it, and the clipping container cuts it at the line.
 */
function cascadeSim(cur: number): Sim {
  refreshCfg();
  const m = new Cascade(heights, modelCfg(ccfg));
  m.jump(cur);
  const channelRing = (): Ring => ({
    kind: "channel",
    front: LEAD,
    park: LEAD + m.cfg.park,
    sway: sway(),
  });
  let last = cur;
  const check = () => {
    if (m.front !== last) {
      const dir = m.front > last ? 1 : -1;
      last = m.front;
      onMove(m.front, dir);
    }
  };
  return {
    get cur() {
      return m.front;
    },
    press: (dir) => {
      const r = m.press(dir);
      check();
      return r;
    },
    step: (ms) => {
      m.step(ms);
      check();
    },
    views: () => {
      const ring = channelRing();
      return m.views().map((v) => ({
        ...v,
        x: ringSway(ring, -v.c),
        role: roleOf(v.c, m.target(v.i)),
        vis:
          v.group === 0 && v.bottom >= v.natBottom - 1e-6
            ? v.h
            : (v.bottom - v.top) / v.scale,
      }));
    },
    frame: () => m.views(),
    frontKey: () => `k${m.front}`,
    overlay: () => ({
      ring: channelRing(),
      pile: slotTops((q) => m.slot(q)),
    }),
    busy: () => m.isBusy(),
    jump: (n) => {
      m.jump(n);
      last = n;
    },
    setHeights: (h) => m.setHeights(h),
    keyDown: (dir) => {
      m.keyDown(dir);
      check();
    },
    keyUp: () => m.keyUp(),
    lam: () => m.lam,
    setCfg: () => {
      Object.assign(m.cfg, modelCfg(ccfg));
    },
  };
}

function productSim(cur: number): Sim {
  const keys = ALL.map((_, i) => "k" + i);
  const e = new StackEngine();
  e.setHeights(new Map(keys.map((k, i) => [k, heights[i]!])));
  let at = cur;
  const win = () => keys.slice(at, at + 4);
  const before = () => keys.slice(Math.max(0, at - 2), at);
  e.sync(win(), undefined, true, at > 0, before());
  const drumOf = () => (e as any).drum as Drum;
  let last = cur;
  const check = () => {
    const front = Number(e.frame().front?.slice(1));
    if (front !== last) {
      const dir = front > last ? 1 : -1;
      last = front;
      onMove(front, dir);
    }
  };
  const sim: Sim = {
    get cur() {
      return Number(e.frame().front?.slice(1));
    },
    press(dir) {
      if ((dir > 0 && at >= N - 1) || (dir < 0 && at <= 0)) return false;
      const d = dir > 0 ? "forward" : "back";
      if (!e.accept(d)) return false;
      at += dir;
      e.sync(win(), d, false, at > 0, before());
      check();
      return true;
    },
    keyDown(dir) {
      e.hold(dir > 0 ? "forward" : "back");
      sim.press(dir);
    },
    keyUp: () => e.release(),
    step: (ms) => {
      e.step(ms / 1000);
      check();
    },
    views: () => {
      const d = drumOf();
      return e.frame().cards.map((v, i) => {
        const top = LEAD + v.scale * v.y;
        const { x, role } = drumCardMotion(d, i);
        return { ...v, x, top, role };
      });
    },
    // The engine reports a drawn and a natural height for each card; the checker reads edges on the stage.
    frame: () =>
      e.frame().cards.map((v) => {
        const top = LEAD + v.scale * v.y;
        return {
          key: v.key,
          painted: v.painted,
          layer: v.layer,
          scale: v.scale,
          top,
          bottom: top + v.scale * v.vis,
          natBottom: top + v.scale * v.h,
          shade: v.shade,
        };
      }),
    // The page moves `at` when the engine accepts a press; the engine's drum may take it a few frames later.
    frontKey: () => (e as any).keyOf[drumOf().front] ?? "",
    overlay: () => drumOverlay(drumOf()),
    busy: () => e.frame().busy,
    jump(n) {
      at = n;
      e.sync(win(), undefined, true, at > 0, before());
      last = n;
    },
    setHeights: (h) => e.setHeights(new Map(keys.map((k, i) => [k, h[i]!]))),
  };
  return sim;
}

let sim: Sim;
const meter = new Meter();
let paused = false,
  raf = 0,
  last = 0,
  simClock = 0;
const speed = () => Number(opt.speed) || 1;

/**
 * The held readout is on while the model has a held state to report: the drum's speed-up or fold, the cascade's
 * ramp. Under reduced motion a held key moves one card and never starts the hold, so there is nothing to report.
 */
const showsHeld = () =>
  !!sim.lam &&
  !reduced() &&
  (opt.v === "drum"
    ? cfg.fold || cfg.ramp || cfg.loose
    : opt.v === "cascade" && ccfg.ramp);

const f1 = (n: number) => n.toFixed(1);

/** An arrowhead on the ring at `u`, pointing the way a card moving in `dir` travels (+1 out, −1 in). */
function chevron(ring: Ring, u: number, dir: 1 | -1, cls: string): string {
  const p = ringPoint(ring, u);
  const len = Math.hypot(p.dx, p.dy) || 1;
  const tx = (dir * p.dx) / len;
  const ty = (dir * p.dy) / len;
  const px = STAGE_X + p.x;
  const arm = 5.5;
  const spread = 4.2;
  const bx = px - tx * arm;
  const by = p.y - ty * arm;
  return `<path class="bz-arrow ${cls}" d="M ${f1(bx - ty * spread)} ${f1(by + tx * spread)} L ${f1(px)} ${f1(p.y)} L ${f1(bx + ty * spread)} ${f1(by - tx * spread)}"/>`;
}

const cubicD = (cs: Cubic[]) =>
  cs
    .map(
      ([p0, p1, p2, p3], k) =>
        `${k === 0 ? `M ${f1(p0.x)} ${f1(p0.y)} ` : ""}C ${f1(p1.x)} ${f1(p1.y)}, ${f1(p2.x)} ${f1(p2.y)}, ${f1(p3.x)} ${f1(p3.y)}`,
    )
    .join(" ");

/** A label's x and anchor just outside the curve at offset `x`: on the side the curve bows to, right when straight. */
function beside(x: number, straight: 1 | -1 = 1): string {
  const side = x > 0 ? 1 : x < 0 ? -1 : straight;
  return `x="${f1(STAGE_X + x + 10 * side)}" text-anchor="${side > 0 ? "start" : "end"}"`;
}

function paintBezier(views: View[]) {
  const svg = $("#bezier");
  const show = opt.path === "1";
  svg.toggleAttribute("hidden", !show);
  if (!show) return;
  const { ring, pile } = sim.overlay();
  const cubics = ringCubics(ring, STAGE_X, vcfg.inner);
  const knots = ringKnots(ring, vcfg.inner);
  // The drum's ring splits at the turn (always a knot) into the drop in front of the pile and the rise behind it.
  const half = ring.kind === "drum" ? knots.indexOf(1) : cubics.length;
  const front = cubics.slice(0, half);
  const behind = cubics.slice(half);
  const crossing = ringCrossing(ring);
  const parts: string[] = [];
  // Control-point handles at the knots the sliders move: each leg's widest point, and the turn. The other
  // knots only keep the fit close, so their handles show only when `handles at every knot` asks for them.
  const named = vcfg.allKnots
    ? knots
    : [...ringPeaks(ring), ...(crossing === null ? [] : [1, crossing])];
  for (const u of vcfg.handles ? named : []) {
    const k = knots.indexOf(u);
    if (k <= 0 || k >= knots.length - 1) continue;
    const at = cubics[k]![0];
    for (const c of [cubics[k - 1]![2], cubics[k]![1]])
      parts.push(
        `<line class="bz-handle" x1="${f1(at.x)}" y1="${f1(at.y)}" x2="${f1(c.x)}" y2="${f1(c.y)}"/>`,
        `<circle class="bz-ctrl" cx="${f1(c.x)}" cy="${f1(c.y)}" r="2.6"/>`,
      );
  }
  // Pile spine above the front card
  if (vcfg.spine && pile.length >= 3) {
    parts.push(
      `<line class="bz-pile" x1="${STAGE_X}" y1="${f1(pile[2]!)}" x2="${STAGE_X}" y2="${f1(pile[0]!)}"/>`,
      `<circle class="bz-slot" cx="${STAGE_X}" cy="${f1(pile[1]!)}" r="2.5"/>`,
      `<circle class="bz-slot" cx="${STAGE_X}" cy="${f1(pile[2]!)}" r="2.5"/>`,
    );
  }
  if (behind.length) {
    parts.push(
      `<path class="bz-tuck" data-curve="behind" d="${cubicD(behind)}"/>`,
    );
  }
  parts.push(`<path class="bz-out" data-curve="front" d="${cubicD(front)}"/>`);
  // Which way each leg is travelled: ↓ runs the ring forwards, ↑ backwards.
  if (vcfg.arrows)
    parts.push(
      chevron(ring, 0.32, 1, "bz-arrow-out"),
      chevron(ring, 0.68, -1, "bz-arrow-in"),
    );
  const [frontPeak, behindPeak] = ringPeaks(ring);
  const lobe = ringPoint(ring, frontPeak!);
  const label = (text: string) => (vcfg.labels ? text : "");
  parts.push(
    label(
      `<text class="bz-label bz-label-out" ${beside(lobe.x)} y="${f1(lobe.y - 2)}">out ↓</text>`,
    ),
    label(
      `<text class="bz-label bz-label-in" ${beside(lobe.x)} y="${f1(lobe.y + 11)}">↑ in</text>`,
    ),
  );
  // Anchors: the front, the turn or the clip line, and the tuck
  const end = ringPoint(ring, 1);
  parts.push(
    `<circle class="bz-anchor" cx="${STAGE_X}" cy="${LEAD}" r="4.2"/>`,
    label(
      `<text class="bz-label bz-label-node" x="${STAGE_X + 10}" y="${LEAD - 6}" text-anchor="start">front</text>`,
    ),
    `<circle class="bz-anchor" cx="${f1(STAGE_X + end.x)}" cy="${f1(end.y)}" r="4.2"/>`,
    label(
      `<text class="bz-label bz-label-node" x="${STAGE_X + 10}" y="${f1(end.y + 15)}" text-anchor="start">${ring.kind === "drum" ? "turn" : "park"}</text>`,
    ),
  );
  if (ring.kind === "drum") {
    const t = ringPoint(ring, ringSpan(ring));
    parts.push(
      `<circle class="bz-anchor-tuck" cx="${f1(STAGE_X + t.x)}" cy="${f1(t.y)}" r="3.5"/>`,
      label(
        `<text class="bz-label bz-label-tuck" x="${STAGE_X - 10}" y="${f1(Math.max(LEAD + 14, t.y + 3.5))}" text-anchor="end">tuck</text>`,
      ),
    );
    const back = ringPoint(ring, behindPeak!);
    parts.push(
      label(
        `<text class="bz-label bz-label-tuck" ${beside(back.x, back.x === 0 ? -1 : 1)} y="${f1(back.y + 4)}">behind</text>`,
      ),
    );
  }
  // Each leg's widest point, and where the drum's path crosses the column when that is not the turn
  for (const u of [
    ...ringPeaks(ring),
    ...(crossing !== null && Math.abs(crossing - 1) > 1e-9 ? [crossing] : []),
  ]) {
    const k = ringPoint(ring, u);
    parts.push(
      `<circle class="bz-knot" cx="${f1(STAGE_X + k.x)}" cy="${f1(k.y)}" r="2.4"/>`,
    );
  }
  // Live markers for painted cards
  const isRed = reduced();
  for (const v of views) {
    if (!v.painted || !vcfg.dots) continue;
    const cx = STAGE_X + (isRed ? 0 : v.x);
    parts.push(
      `<circle class="bz-dot bz-dot-${v.role}" data-dot="${v.key}" cx="${f1(cx)}" cy="${f1(v.top)}" r="${v.role === "pile" ? "3.8" : "5"}"/>`,
    );
  }
  svg.innerHTML = parts.join("");
}

/**
 * How far a card at sideways offset `dx` turns, in degrees (CSS: positive is clockwise): `bank` at the widest
 * sway either leg reaches, in proportion below it, with the bottom edge swinging out from the column for a
 * positive `bank` and in toward it for a negative one.
 */
function bankOf(dx: number): number {
  const widest = Math.max(
    Math.abs(pcfg.sway),
    pcfg.loop ? Math.abs(pcfg.swayBehind) : 0,
  );
  if (pcfg.bank === 0 || widest < 1e-6 || Math.abs(dx) < 0.01) return 0;
  return (-pcfg.bank * dx) / widest;
}

function paint() {
  // The product engine holds only the pile and the cards still leaving it; every other card stays hidden.
  const held = new Set<number>();
  const views = sim.views();
  const isRed = reduced();
  for (const v of views) {
    const i = Number(v.key.slice(1));
    held.add(i);
    const e = els[i]!;
    const st = e.el.style;
    st.visibility = !v.painted ? "hidden" : "";
    st.zIndex = String(v.layer);
    const dx = isRed ? 0 : v.x;
    const tilt = bankOf(dx);
    // A tilted card turns about its own top centre: `scale(s) translateY(y)` is the same as `translateY(s·y)
    // scale(s)`, so the rotation goes between them.
    st.transform =
      tilt !== 0
        ? `translateX(${dx.toFixed(2)}px) translateY(${(v.scale * v.y).toFixed(2)}px) rotate(${tilt.toFixed(3)}deg) scale(${v.scale.toFixed(5)})`
        : Math.abs(dx) > 0.01
          ? `translateX(${dx.toFixed(2)}px) scale(${v.scale.toFixed(5)}) translateY(${v.y.toFixed(2)}px)`
          : `scale(${v.scale.toFixed(5)}) translateY(${v.y.toFixed(2)}px)`;
    const vis = Math.max(0, v.vis).toFixed(2) + "px";
    e.shadow.style.height = e.frame.style.height = e.shade.style.height = vis;
    const natural = heights[i]!;
    // Folded or tucked behind a shorter card: the content keeps its layout and is clipped at the drawn height.
    e.content.style.clipPath =
      v.vis < natural - 0.5
        ? `inset(0 0 ${(natural - v.vis).toFixed(2)}px 0 round 11.5px)`
        : "";
    e.shade.style.opacity = v.shade.toFixed(3);
    const content = v.content ?? 1;
    e.content.style.opacity = content < 1 ? content.toFixed(3) : "";
    e.shadow.style.opacity = (1 - v.shade).toFixed(3);
  }
  els.forEach((e, i) => {
    if (!held.has(i)) e.el.style.visibility = "hidden";
  });
  paintBezier(views);
  syncMeasured();
}

const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
/** The Measured module's lines, rewritten only where the text changed. */
function syncMeasured() {
  if (showsHeld()) {
    const lam = sim.lam!();
    const text = lam.toFixed(2);
    const out = $("#lam output");
    if (out.textContent !== text) {
      out.textContent = text;
      $("#lam .meter i").style.width = `${(lam * 100).toFixed(1)}%`;
    }
  }
  setText($("#m-pace"), meter.paceText());
  setText($("#m-last-label"), `last ${meter.otherDir() > 0 ? "↓" : "↑"}`);
  setText($("#m-last"), meter.lastText());
  setText($("#m-tap"), meter.tapText());
  setText($("#m-checker"), meter.checkerText(opt.v === "cascade"));
  setText($("#m-pace-cards"), measuredPace(noteContext()));
  syncNotes();
}

function showHead(n: number, animate: boolean) {
  const it = ALL[n]!;
  $("#pos").textContent = `${n + 1} of ${N}`;
  const h = $("#head");
  h.innerHTML = `<div><div class="path">${it.p}</div><h1>${it.t}</h1></div>`;
  if (animate && !reduced() && vcfg.headMs > 0)
    h.firstElementChild!.animate([{ opacity: 0.2 }, { opacity: 1 }], {
      duration: vcfg.headMs,
      easing: "ease-out",
    });
}

// ---- simulated holds ----------------------------------------------------------------------------------

/**
 * A simulated key hold: `hold.down` or `hold.up` starts one at the near end of the queue and runs it as a held
 * key does, a press at once and then repeats after `repeatDelay` every `repeatMs`, on the page's clock (so
 * speed, Pause and Step apply), and releases it when the front reaches the far end. A real key, a model switch
 * or a click on the running button stops it.
 */
let run: { dir: 1 | -1; t: number; next: number; end: number } | null = null;

function startRun(dir: 1 | -1) {
  stopRun();
  held = 0;
  const start = dir > 0 ? 0 : N - 1;
  sim.jump(start);
  showHead(start, false);
  run = { dir, t: 0, next: vcfg.repeatDelay, end: N - 1 - start };
  metered(dir);
  sim.keyDown ? sim.keyDown(dir) : sim.press(dir);
  paint();
  wake();
  syncButtons();
}
function stopRun() {
  if (!run) return;
  run = null;
  sim.keyUp?.();
  syncButtons();
}
/** Moves the simulated hold `d` ms along: the repeats it owes, and its release at the far end. */
function runStep(d: number) {
  if (!run) return;
  run.t += d;
  while (run && run.t >= run.next) {
    if (sim.cur === run.end) break;
    sim.press(run.dir);
    run.next += vcfg.repeatMs;
  }
  if (run && sim.cur === run.end) stopRun();
}

function advance(ms: number) {
  let r = ms;
  while (r > 1e-9) {
    const d = Math.min(1000 / 60, r);
    runStep(d);
    trackFront();
    sim.step(d);
    simClock += d;
    r -= d;
    trackFront();
    if (meter.active) {
      meter.sample(simClock, () => sim.frame());
      if (!run && !held && !sim.busy()) meter.end();
    }
  }
  paint();
}
/** A press or a key going down in direction `dir` is about to reach the model: it may start a measured run. */
const metered = (dir: 1 | -1) => {
  trackFront();
  meter.press(simClock, dir, sim.frame());
};
/** The model's front card when last looked at; a change is a card taken, which the Measured module times. */
let lastFront = "";
function trackFront() {
  const key = sim.frontKey();
  if (key === lastFront) return;
  const dir = Number(key.slice(1)) > Number(lastFront.slice(1)) ? 1 : -1;
  lastFront = key;
  meter.moved(simClock, dir, key);
}
function tickFrame(now: number) {
  raf = 0;
  const dt = last ? Math.min(50, now - last) : 1000 / 60;
  last = now;
  advance(dt * speed());
  if (!paused) raf = requestAnimationFrame(tickFrame);
}
function wake() {
  if (!raf && !paused) {
    last = 0;
    raf = requestAnimationFrame(tickFrame);
  }
}

function press(dir: 1 | -1) {
  if (reduced()) {
    // No motion: the new front fades in over `reduced fade ms`.
    const n = sim.cur + dir;
    if (n < 0 || n >= N) return;
    sim.jump(n);
    showHead(n, true);
    if (vcfg.fadeMs > 0)
      els[n]!.el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
        duration: vcfg.fadeMs,
        easing: "ease-out",
      });
    paint();
    return;
  }
  metered(dir);
  sim.press(dir);
  paint();
  wake();
}
onMove = (c) => {
  showHead(c, true);
  trackFront();
};

function build(mode: Mode, cur = sim ? sim.cur : 0) {
  run = null;
  meter.clear();
  opt.v = mode;
  sanitize(opt);
  refreshCfg();
  sim =
    mode === "product"
      ? productSim(cur)
      : mode === "cascade"
        ? cascadeSim(cur)
        : drumSim(cur);
  showHead(cur, false);
  paint();
  wake();
  renderSaved();
  syncAll();
}

// ---- the inspector ------------------------------------------------------------------------------
// The inspector is drawn once from the lists in controls.ts and updated in place, so a control that is hovered
// or focused is never replaced under the pointer. Every control carries `data-help`, the id of its tooltip.
// Each module is a <details>; a module with nothing to show under the current configuration is hidden whole.
/** A slider's value as the inspector shows it: to as many decimals as its step has. */
const shown = (s: { step: number }, v: number) => {
  const k = 10 ** digitsOf(s.step);
  return Math.round(v * k) / k;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const labelOf = (id: string) => CONTROLS.find((c) => c.id === id)!.label;
const button = (help: string, act: string, text: string, mode = "") =>
  `<button type="button" data-help="${help}" data-act="${act}"${mode ? ` data-mode="${mode}"` : ""}>${esc(text)}</button>`;
/** A toggle button drawn as a switch: the label, then a track whose knob shows `aria-pressed`. */
const switchButton = (help: string, act: string) =>
  `<button type="button" class="switch" data-help="${help}" data-act="${act}"><span>${esc(labelOf(help))}</span><i aria-hidden="true"></i></button>`;
const row = (label: string, body: string, attrs = "") =>
  `<div class="ins-row" ${attrs}><span class="row-label">${esc(label)}</span>${body}</div>`;

/**
 * Every setting the inspector draws, once per key: a setting both models share is one row, drawn from the drum's
 * entry and synced from the running model's (its range, options and value).
 */
const ALL_SETTINGS: readonly Setting<any, unknown>[] = (() => {
  const out: Setting<any, unknown>[] = [...SETTINGS];
  // A cascade setting the drum lacks goes after the cascade setting before it, so each model reads in its order.
  CASCADE_SETTINGS.forEach((s, i) => {
    if (out.some((x) => x.key === s.key)) return;
    const prev = CASCADE_SETTINGS[i - 1];
    const at = prev ? out.findIndex((x) => x.key === prev.key) : -1;
    out.splice(at < 0 ? out.length : at + 1, 0, s);
  });
  return [...out, ...PATH_SETTINGS, ...VIEW_SETTINGS];
})();

/** The button that puts one setting back to its preset's or default value; it shows while the value differs. */
const resetButton = (s: Setting<any, unknown>) =>
  `<button type="button" class="reset" data-help="reset" data-act="reset:${s.key}" aria-label="Reset ${esc(s.label)}" hidden>reset</button>`;
const optionLabel = (
  s: Extract<Setting<any, unknown>, { kind: "select" }>,
  o: string,
) => esc(s.labels?.[o] ?? o);

/**
 * One setting: its name, its value (a slider's value is a text field, so a value can be typed), the reset
 * button, the control, and a note line. A choice drawn as radio buttons lists every option any model offers;
 * the sync hides those the running model lacks. A limit that depends on another setting is set when the
 * settings are synced.
 */
const settingHtml = (s: Setting<any, unknown>) => {
  const host = `data-help="setting.${s.key}" data-key="${s.key}"`;
  const id = `set-${s.key}`;
  const note = `<p class="set-note" hidden></p>`;
  if (s.kind === "range")
    return `<div class="set set-range" ${host}><label class="set-name" for="${id}">${esc(s.label)}</label><span class="set-value"><input type="text" class="num" data-v="${s.key}" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${esc(s.label)}, value">${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ""}</span>${resetButton(s)}<input type="range" id="${id}" data-k="${s.key}" min="${s.min}"${typeof s.max === "number" ? ` max="${s.max}"` : ""} step="${s.step}">${note}</div>`;
  if (s.kind === "toggle")
    return `<div class="set set-toggle" ${host}><label><input type="checkbox" data-k="${s.key}"><span class="set-name">${esc(s.label)}</span></label>${resetButton(s)}</div>`;
  if (s.radio) {
    const options = ALL_SETTINGS.filter((x) => x.key === s.key)
      .concat(CASCADE_SETTINGS.filter((x) => x.key === s.key))
      .flatMap((x) => (x.kind === "select" ? x.options : []))
      .filter((o, i, all) => all.indexOf(o) === i);
    return `<fieldset class="set set-radio" ${host}><legend class="set-name">${esc(s.label)}</legend>${resetButton(s)}${options.map((o) => `<label data-option="${o}"><input type="radio" name="${id}" value="${o}" data-k="${s.key}">${optionLabel(s, o)}</label>`).join("")}</fieldset>`;
  }
  return `<div class="set set-select" ${host}><label class="set-name" for="${id}">${esc(s.label)}</label><select id="${id}" data-k="${s.key}">${s.options.map((o) => `<option value="${o}">${optionLabel(s, o)}</option>`).join("")}</select>${resetButton(s)}${note}</div>`;
};
const settingsOf = (group: ModuleId, more = false) =>
  ALL_SETTINGS.filter((s) => s.group === group && !!s.more === more)
    .map(settingHtml)
    .join("");
/** A module's `more` line: a fold inside the module for the settings looked at once. */
const moreOf = (group: ModuleId) =>
  `<details class="more" data-fold="${group}.more"${startsOpen(`${group}.more`) ? " open" : ""}><summary><span class="more-text"></span></summary><div class="more-body">${settingsOf(group, true)}</div></details>`;

/** One line of the Measured module: a label and the text `syncMeasured` writes. */
const measuredLine = (id: string, label: string) =>
  `<div class="readout measure" data-help="measured.${id}" tabindex="0"><span class="row-label" id="m-${id}-label">${esc(label)}</span><span class="m-text" id="m-${id}"></span></div>`;

/** The body of each module: its buttons, then its settings. */
const BODIES: Record<ModuleId, () => string> = {
  run: () =>
    `<div class="seg seg-3" role="group" aria-label="Model">${MODES.map((m) => button(`model.${m.id}`, `v:${m.id}`, m.label)).join("")}</div>` +
    `<div class="field" id="presets"><span class="row-label">Preset</span><div class="chips">${PRESET_NAMES.map(
      (p) => button(`preset.${p}`, `p:${p}`, p, "drum"),
    ).join("")}${CASCADE_PRESET_NAMES.map((p) =>
      button(`preset.${p}`, `p:${p}`, p, "cascade"),
    ).join("")}</div></div>` +
    `<div class="field" id="saved" hidden><span class="row-label">Saved</span><div class="chips" id="saved-chips"></div></div>` +
    `<p class="caption" id="state"></p>` +
    `<div class="actions" id="actions">${button("preset.revert", "revert", labelOf("preset.revert"))}${button("preset.save", "save", labelOf("preset.save"))}${button("copy.cfg", "copycfg", labelOf("copy.cfg"))}</div>` +
    `<div class="save-row" id="save-row" hidden><input type="text" id="preset-name" maxlength="40" placeholder="Name" aria-label="Saved preset name" autocomplete="off" spellcheck="false"></div>` +
    `<p class="save-note" id="save-note" role="status"></p>`,
  drive: () =>
    row(
      "Speed",
      `<div class="seg" role="group" aria-label="Speed">${SPEEDS.map((s) => button("speed", `s:${s.id}`, s.label)).join("")}</div>`,
    ) +
    row(
      "Clock",
      `<div class="pair">${button("clock.pause", "pause", labelOf("clock.pause"))}${button("clock.step", "step", labelOf("clock.step"))}</div>`,
    ) +
    row(
      "Hold",
      `<div class="pair">${button("hold.down", "run:1", "↓ from top")}${button("hold.up", "run:-1", "↑ from bottom")}</div>`,
      'id="hold-row"',
    ) +
    row(
      "Cards",
      `<div class="seg seg-3" role="group" aria-label="Cards">${DECKS.map((d) => button("cards", `c:${d.id}`, d.label)).join("")}</div>`,
    ) +
    switchButton("reduced", "reduced"),
  measured: () =>
    `<div id="lam" class="readout" data-help="held" tabindex="0" hidden><span class="row-label">held</span><span class="meter"><i></i></span><output>0.00</output></div>` +
    measuredLine("pace", "pace") +
    measuredLine("last", "last ↑") +
    measuredLine("tap", "tap") +
    measuredLine("checker", "checker"),
  taps: () => settingsOf("taps"),
  // While the presses follow the cards nothing sets the drum's pace, so a readout takes the slider's place.
  held: () =>
    settingsOf("held").replace(
      '<div class="set set-range" data-help="setting.pace"',
      `<div class="readout measure" id="pace-cards" data-help="pace.cards" tabindex="0" hidden><span class="row-label">pace</span><span class="m-text" id="m-pace-cards"></span></div><div class="set set-range" data-help="setting.pace"`,
    ),
  route: () => settingsOf("route") + moreOf("route"),
  finish: () => settingsOf("finish"),
  page: () => settingsOf("page"),
  overlay: () => switchButton("path", "path") + settingsOf("overlay"),
  about: () =>
    `<div class="panel" id="about"></div><div class="panel" id="about-cascade" hidden></div>`,
};

/**
 * Which modules, and `more` lines inside them, the reader has collapsed or opened, kept across visits; the hash
 * holds only the motion's state.
 */
const FOLDS_KEY = "queue-motion-lab.modules";
const folds: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
/** A module starts open unless it is one of `FOLDED`; a `more` line starts folded. */
const startsOpen = (id: string) =>
  folds[id] ??
  (!(FOLDED as readonly string[]).includes(id) && !id.endsWith(".more"));

function renderInspector() {
  $("#modules").innerHTML = MODULES.map((m) => {
    // The About module's heading is its control: it names the panel the running model shows.
    const summary =
      m.id === "about"
        ? `<summary data-help="about">${esc(labelOf("about"))}</summary>`
        : `<summary>${esc(m.label)}<span class="mod-count"></span></summary>`;
    return `<details class="mod" data-module="${m.id}"${startsOpen(m.id) ? " open" : ""}>${summary}<div class="mod-body">${BODIES[m.id]()}</div></details>`;
  }).join("");
}

// ---- saved presets (saved.ts) ------------------------------------------------------------------------

/** The saved presets the Run module shows now, in chip order: a chip's `data-act` names its index here. */
let shownSaved: SavedPreset[] = [];

/** The hash keys a preset button replaces: every model setting, and with a saved preset the path's and the page's. */
const PRESET_OWNED = [...SETTING_KEYS, ...PATH_KEYS, ...VIEW_KEYS];

/** The state `o` would give with `saved` applied over it. */
const withSaved = (o: Opt, saved: SavedPreset): Opt => {
  const out: Opt = { ...o };
  for (const k of PRESET_OWNED) delete out[k];
  return Object.assign(out, saved.opt);
};

/** Every configuration the motion and the page read, for comparing two states by effect rather than spelling. */
const effect = (o: Opt) => {
  const r = o.reduced === "1" || systemReduced.matches;
  return JSON.stringify([
    drumCfg(o),
    cascadeCfg(o),
    pathCfg(o, r),
    viewCfg(o, r),
  ]);
};

/** Whether the state is what `saved` gives: every setting it records, and no other override, has the same effect. */
const appliedIs = (saved: SavedPreset | undefined) =>
  !!saved && effect(opt) === effect(withSaved(opt, saved));

/** Redraws the saved preset chips for the running model; the product has none. */
function renderSaved() {
  shownSaved = savedPresets(opt.v!);
  $("#saved").hidden = shownSaved.length === 0;
  $("#saved-chips").innerHTML = shownSaved
    .map(
      (p, i) =>
        `<span class="saved-chip">${button("preset.saved", `u:${i}`, p.name)}<button type="button" class="del" data-help="preset.delete" data-act="ud:${i}" aria-label="Delete ${esc(p.name).replace(/"/g, "&quot;")}">×</button></span>`,
    )
    .join("");
}

let noteReset = 0;
function saveNote(text: string, ok: boolean) {
  const note = $("#save-note");
  note.textContent = text;
  note.classList.toggle("bad", !ok);
  clearTimeout(noteReset);
  noteReset = window.setTimeout(() => (note.textContent = ""), 2400);
}

/** Whether the name field for `Save as preset…` is open. */
let naming = false;
function openSave(open: boolean) {
  naming = open;
  const field = $("#preset-name") as HTMLInputElement;
  if (!open) field.value = "";
  syncButtons();
  if (open) field.focus();
}

/**
 * Saves the state under the name in the field, or `my preset N` when it is empty. A built-in preset's name is
 * refused, so a saved chip never reads like a built-in one; a saved preset's name replaces that preset.
 */
function saveCurrent() {
  const mode = opt.v;
  if (mode !== "drum" && mode !== "cascade") return;
  const field = $("#preset-name") as HTMLInputElement;
  const name =
    field.value.trim() || `my preset ${savedPresets(mode).length + 1}`;
  if (presetsOf(mode).includes(name)) {
    saveNote(`“${name}” is a built-in preset; choose another name.`, false);
    return;
  }
  const replaced = savedPresets(mode).some((p) => p.name === name);
  if (!savePreset(mode, name, opt)) {
    const preview =
      window.parent !== window && location.pathname.startsWith("/api/v1/");
    saveNote(
      preview
        ? "Open in external browser to save presets."
        : "This browser would not store the preset.",
      false,
    );
    return;
  }
  renderSaved();
  openSave(false);
  saveNote(replaced ? `Replaced “${name}”.` : `Saved “${name}”.`, true);
}

/** The state with only the model and preset (and the motion and overlay switches the defaults depend on). */
const bareOpt = (): Opt => ({
  v: opt.v!,
  preset: opt.preset!,
  ...(opt.path ? { path: opt.path } : {}),
  ...(opt.reduced ? { reduced: opt.reduced } : {}),
});

/** The drum's configuration as the product runs it: `shipped`, which the product engine imports as `QUEUE_CFG`. */
const SHIPPED: Cfg = drumCfg({ preset: "shipped" });
/** The settings the product shows, read only: the drum's Taps and Held keys, at their shipped values. */
const PRODUCT_SETTINGS = SETTINGS.filter(
  (s) => s.group === "taps" || s.group === "held",
);

/**
 * The running model's settings beside their values now and with nothing overridden (the preset's). The product
 * has no settings of its own; it lists the drum's Taps and Held keys at their shipped values.
 */
function modelLists(): [readonly Setting<any, unknown>[], unknown, unknown][] {
  const bare = bareOpt();
  return opt.v === "drum"
    ? [[SETTINGS, cfg, drumCfg(bare)]]
    : opt.v === "cascade"
      ? [[CASCADE_SETTINGS, ccfg, cascadeCfg(bare)]]
      : [[PRODUCT_SETTINGS, SHIPPED, SHIPPED]];
}

/** The labels of the running model's settings whose value differs from the preset's. */
function modelChanges(): string[] {
  const out: string[] = [];
  for (const [list, now, base] of modelLists())
    for (const s of list)
      if (valueText(s, now) !== valueText(s, base)) out.push(s.label);
  return out;
}

/** Whether the running model's configuration is its preset's with nothing changed. */
const atPreset = () => modelChanges().length === 0;

function syncButtons() {
  const exact = atPreset();
  for (const b of $$("#inspector button[data-act]")) {
    const [k, v] = (b.dataset.act ?? "").split(":");
    const on =
      k === "v"
        ? opt.v === v
        : k === "p"
          ? opt.preset === v && exact
          : k === "s"
            ? opt.speed === v
            : k === "c"
              ? opt.cards === v
              : k === "pause"
                ? paused
                : k === "reduced"
                  ? opt.reduced === "1"
                  : k === "path"
                    ? opt.path === "1"
                    : k === "u"
                      ? appliedIs(shownSaved[Number(v)])
                      : k === "run"
                        ? run?.dir === Number(v)
                        : false;
    b.classList.toggle("on", on);
    // A preset the state starts from but has changed is outlined: it is what `Revert` goes back to.
    const based = k === "p" && opt.preset === v && !exact;
    b.classList.toggle("based", based);
    b.classList.toggle("outside", k === "p" && OUTSIDE_CHECKER.includes(v!));
    if (
      !["step", "copy", "copycfg", "save", "revert", "ud", "reset"].includes(k!)
    )
      b.setAttribute("aria-pressed", based ? "mixed" : String(on));
  }
  const model = opt.v === "drum" || opt.v === "cascade";
  // Each model shows its own preset buttons; the product has none.
  $("#presets").hidden = !model;
  const revert = $('#inspector [data-act="revert"]');
  revert.hidden = !model || exact;
  revert.textContent = `Revert to ${opt.preset}`;
  $('#inspector [data-act="save"]').hidden = !model;
  $('#inspector [data-act="save"]').textContent = naming
    ? "Save"
    : labelOf("preset.save");
  $("#save-row").hidden = !model || !naming;
  // `QUEUE_CFG` is a drum configuration.
  $('#inspector [data-act="copycfg"]').hidden = opt.v !== "drum";
  // Under reduced motion a held key moves one card, so there is no hold to simulate.
  $("#hold-row").hidden = reduced();
  $('#inspector [data-act="run:1"]').textContent =
    run?.dir === 1 ? "Stop" : "↓ from top";
  $('#inspector [data-act="run:-1"]').textContent =
    run?.dir === -1 ? "Stop" : "↑ from bottom";
  for (const b of $$("#presets button")) b.hidden = b.dataset.mode !== opt.v;
  $('#inspector [data-act="pause"]').textContent = paused
    ? "Paused"
    : labelOf("clock.pause");
  $("#lam").hidden = !showsHeld();
}

/** What a setting's note may quote from the page now. */
const noteContext = (): NoteContext => ({
  hold: meter.hold,
  tap: meter.tap,
  shortest: heights.length ? Math.min(...heights.filter((h) => h > 0)) : 0,
});
/** The settings whose notes show now, with the configuration they read; `syncNotes` rewrites them each frame. */
let notes: { host: HTMLElement; s: Setting<any, unknown>; c: unknown }[] = [];
function syncNotes() {
  const n = noteContext();
  for (const { host, s, c } of notes) {
    const text = s.note?.(c, n) ?? "";
    const el = host.querySelector<HTMLElement>(".set-note")!;
    setText(el, text);
    el.hidden = !text;
  }
}

/**
 * Shows one list's settings that change something under configuration `c`, with their current values; a value
 * that differs from `base` (the preset's, or the default) is marked changed and offers its reset. `readonly`
 * shows the values without letting them change, as the product does.
 */
function syncList<C>(
  list: readonly Setting<C, unknown>[],
  c: C,
  base: C,
  active: (s: Setting<C, unknown>) => boolean,
  readonly = false,
) {
  const root = $("#inspector");
  for (const s of list) {
    const host = root.querySelector<HTMLElement>(`[data-key="${s.key}"]`)!;
    host.hidden = !active(s) || !s.shown(c);
    if (host.hidden) continue;
    const changed = !readonly && valueText(s, c) !== valueText(s, base);
    host.classList.toggle("changed", changed);
    host.classList.toggle("readonly", readonly);
    host.querySelector<HTMLElement>(".reset")!.hidden = !changed;
    for (const el of host.querySelectorAll<HTMLInputElement>("input, select"))
      el.disabled = readonly;
    const note = host.querySelector<HTMLElement>(".set-note");
    if (s.note && note) notes.push({ host, s, c });
    else if (note) {
      // A setting with no note of its own shows the sweeps' verdict from its tooltip, if it has one.
      const verdict = HELP[`setting.${s.key}`]?.verdict ?? "";
      setText(note, verdict);
      note.hidden = !verdict;
    }
    if (s.kind === "toggle") {
      host.querySelector<HTMLInputElement>("[data-k]")!.checked = s.read(c);
    } else if (s.kind === "select") {
      const v = s.read(c);
      if (s.radio)
        for (const r of host.querySelectorAll<HTMLInputElement>("[data-k]")) {
          r.checked = r.value === v;
          r.closest<HTMLElement>("label")!.hidden = !s.options.includes(
            r.value,
          );
        }
      else host.querySelector<HTMLSelectElement>("[data-k]")!.value = v;
    } else {
      const input = host.querySelector<HTMLInputElement>("[data-k]")!;
      const max = maxOf(s, c);
      input.min = String(s.min);
      input.max = String(max);
      const v = shown(s, s.read(c));
      if (Number(input.value) !== v) input.value = String(v);
      const typed = host.querySelector<HTMLInputElement>(".num")!;
      if (document.activeElement !== typed) typed.value = String(v);
      // The track fills to the value, so a column of sliders reads at a glance.
      host.style.setProperty(
        "--fill",
        `${(((v - s.min) / (max - s.min || 1)) * 100).toFixed(1)}%`,
      );
    }
  }
}

/** The modules that hold settings, and so hide when none of them shows. */
const SETTING_MODULES = ["taps", "held", "route", "finish", "page"] as const;
/** Every model setting key, the drum's and the cascade's. */
const MODEL_KEYS = new Set(SETTING_KEYS);

/**
 * Shows the running model's settings, the path's while it shows on screen, and the page's own, each only while
 * it changes something; then hides every settings module left with nothing to show, and writes on each folded
 * heading and `more` line how many of its shown settings are changed. A key both models share is one row,
 * synced from the running model's entry. The product shows the drum's Taps and Held keys at their shipped
 * values, read only. Under reduced motion no card moves, so the settings that shape motion change nothing and
 * hide, and so does the Measured module; the cascade's stage settings still cut and fade the stage, so they
 * stay.
 */
function syncSettings() {
  const moving = !reduced();
  const bare = bareOpt();
  notes = [];
  const root = $("#inspector");
  for (const key of MODEL_KEYS)
    root.querySelector<HTMLElement>(`[data-key="${key}"]`)!.hidden = true;
  const live = (s: Setting<any, unknown>) => moving || !!s.still;
  if (opt.v === "drum") syncList(SETTINGS, cfg, drumCfg(bare), live);
  else if (opt.v === "cascade")
    syncList(CASCADE_SETTINGS, ccfg, cascadeCfg(bare), live);
  else syncList(PRODUCT_SETTINGS, SHIPPED, SHIPPED, () => moving, true);
  syncList(PATH_SETTINGS, pcfg, pathCfg(bare, reduced()), () => true);
  syncList(VIEW_SETTINGS, vcfg, viewCfg(bare, reduced()), () => true);
  // The drum's pace has no slider while the presses follow the cards: the readout shows what was measured.
  $("#pace-cards").hidden = !(
    moving &&
    (opt.v === "drum" || opt.v === "product") &&
    (opt.v === "product" ? SHIPPED : cfg).tempo.kind === "none"
  );
  for (const id of SETTING_MODULES) {
    const mod = $(`[data-module="${id}"]`);
    mod.hidden = $$(`[data-module="${id}"] [data-key]`).every((l) => l.hidden);
  }
  $('[data-module="measured"]').hidden = !moving;
  const changedIn = (el: Element) =>
    [...el.querySelectorAll<HTMLElement>("[data-key].changed")].filter(
      (h) => !h.hidden,
    ).length;
  for (const mod of $$("[data-module]")) {
    const n = changedIn(mod);
    const count = mod.querySelector<HTMLElement>(":scope > summary .mod-count");
    if (count) setText(count, n ? `${n} changed` : "");
  }
  for (const more of $$("details.more")) {
    const shownHere = [
      ...more.querySelectorAll<HTMLElement>(".more-body [data-key]"),
    ].filter((h) => !h.hidden);
    more.hidden = shownHere.length === 0;
    const names = shownHere.map(
      (h) => ALL_SETTINGS.find((s) => s.key === h.dataset.key)!.label,
    );
    const n = changedIn(more);
    setText(
      more.querySelector<HTMLElement>(".more-text")!,
      `${names.length} more: ${names.join(", ")}${n ? `. ${n} changed` : ""}`,
    );
  }
  syncNotes();
}

// ---- Copy settings ------------------------------------------------------------------------------------

/** A setting's value as the inspector shows it, with its unit. */
function valueText(s: Setting<any, unknown>, c: unknown): string {
  if (s.kind === "toggle") return s.read(c) ? "on" : "off";
  if (s.kind === "select") return s.labels?.[s.read(c)] ?? s.read(c);
  const v = String(shown(s, s.read(c)));
  // A word unit takes a space (`24 px`); a symbol does not (`4°`, `1.4×`, `8/s`).
  return !s.unit
    ? v
    : /^[a-z]/i.test(s.unit)
      ? `${v} ${s.unit}`
      : `${v}${s.unit}`;
}

/**
 * The Markdown for the current state: every setting the inspector shows now, beside its value with nothing
 * overridden (the preset's for a model's settings, the default for the path's and the page's).
 */
function currentSettingsMarkdown(): string {
  const bare = bareOpt();
  const isReduced = reduced();
  const lists: [readonly Setting<any, unknown>[], unknown, unknown][] = [
    ...modelLists(),
    [PATH_SETTINGS, pcfg, pathCfg(bare, isReduced)],
    [VIEW_SETTINGS, vcfg, viewCfg(bare, isReduced)],
  ];
  const root = $("#inspector");
  const rows: CopyRow[] = [];
  for (const m of MODULES) {
    const mod = root.querySelector<HTMLElement>(`[data-module="${m.id}"]`);
    if (!mod || mod.hidden) continue;
    for (const [list, now, base] of lists)
      for (const s of list) {
        if (s.group !== m.id) continue;
        const host = mod.querySelector<HTMLElement>(`[data-key="${s.key}"]`);
        if (!host || host.hidden) continue;
        rows.push({
          module: m.label,
          label: s.label,
          key: s.key,
          value: valueText(s, now),
          base: valueText(s, base),
        });
      }
  }
  // Route holds model settings, which a preset sets, and the path's, which have defaults.
  const baseNames: Record<string, string> = {
    Taps: "Preset",
    "Held keys": "Preset",
    Finish: "Preset",
    Route: "Preset or default",
  };
  return settingsMarkdown({
    model: MODES.find((m) => m.id === opt.v)!.label,
    preset: opt.v === "product" ? null : opt.preset!,
    speed: SPEEDS.find((x) => x.id === opt.speed)?.label ?? `${opt.speed}×`,
    cards: DECKS.find((d) => d.id === opt.cards)!.label,
    reduced: isReduced,
    overlay: opt.path === "1",
    hash: location.hash,
    rows,
    baseName: (m) => baseNames[m] ?? "Default",
  });
}

/** Puts `text` on the clipboard: the async API where the page may use it, else a selected text area. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Copies `text` and says on the button `b` for a moment whether it worked; `help` is the button's control id. */
async function copyFrom(b: HTMLElement, help: string, text: string) {
  const ok = await copyText(text);
  b.textContent = ok ? "Copied" : "Copy failed";
  b.classList.toggle("done", ok);
  window.setTimeout(() => {
    b.textContent = labelOf(help);
    b.classList.remove("done");
  }, 1600);
}

/** The cascade cuts its stage at the clip line, `park` px below the front pose, and fades the last `fade` px. */
function syncStage() {
  const on = opt.v === "cascade";
  clip.classList.toggle("on", on);
  clip.style.height = on ? `${LEAD + ccfg.park}px` : "";
  const mask =
    on && ccfg.fade > 0
      ? `linear-gradient(to bottom, #000 calc(100% - ${ccfg.fade}px), transparent)`
      : "";
  clip.style.maskImage = clip.style.webkitMaskImage = mask;
}

/** Presets whose motion the frame checker's rules do not describe, so its count is a cost rather than a verdict. */
const OUTSIDE_CHECKER = ["shipped", "loose"];

/**
 * The state line under the presets: the preset the state is based on and what has changed from it, or, at
 * the preset itself, its caption. The product's line says what it runs.
 */
function syncState() {
  const line = $("#state");
  if (opt.v === "product") {
    line.replaceChildren();
    inline(line, captionFor("product", ""));
    return;
  }
  const name = document.createElement("b");
  name.textContent = opt.preset!;
  const changes = modelChanges();
  const text = document.createElement("span");
  if (!changes.length) {
    line.replaceChildren(name, ", nothing changed. ");
    inline(text, captionFor(opt.v!, opt.preset!));
  } else {
    // Labels may hold a comma, so a list of them is joined with semicolons.
    const sep = changes.some((c) => c.includes(",")) ? "; " : ", ";
    line.replaceChildren(
      "Based on ",
      name,
      `, with ${changes.length} change${changes.length === 1 ? "" : "s"}: ${changes.join(sep)}.`,
    );
  }
  if (OUTSIDE_CHECKER.includes(opt.preset!))
    text.append(
      opt.preset === "shipped"
        ? ` The frame checker reports edges over 40 px/frame and loose held swaps; shipped accepts edges up to 45 px/frame.`
        : ` Outside the frame checker's rules: it counts each pass over a card as a swap.`,
    );
  line.append(text);
}

function renderAbout(panel: HTMLElement, about: typeof ABOUT) {
  for (const text of about.paragraphs) {
    const p = document.createElement("p");
    inline(p, text);
    panel.append(p);
  }
  const list = document.createElement("ul");
  for (const [name, text] of about.map) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = `${name}. `;
    li.append(b);
    inline(li, text);
    list.append(li);
  }
  panel.append(list);
  if (about.numbers.length) {
    const src = document.createElement("p");
    src.className = "src";
    inline(src, `Numbers from ${about.numbers.join("; ")}.`);
    panel.append(src);
  }
}

/** The About module explains the model that runs: the cascade's, or the drum's (also for the product). */
function syncAbout() {
  const cascade = opt.v === "cascade";
  const id = cascade ? "about.cascade" : "about";
  const summary = $('[data-module="about"] summary');
  summary.dataset.help = id;
  summary.textContent = labelOf(id);
  $("#about").hidden = cascade;
  $("#about-cascade").hidden = !cascade;
}

/**
 * The stack is drawn at the product's width, 680 px. When the stage beside the inspector is narrower, the
 * column scales down to fit, so the whole card stays in view; the models measure the cards' layout size,
 * which a transform does not change.
 */
const COLUMN = 680;
const STAGE_PAD = 40;
function fitStage() {
  const room = $("#stage-area").clientWidth - STAGE_PAD;
  const s = Math.min(1, room / COLUMN);
  $("#col").style.transform = s < 1 ? `scale(${s.toFixed(4)})` : "";
}
new ResizeObserver(fitStage).observe($("#stage-area"));

renderInspector();
renderAbout($("#about"), ABOUT);
renderAbout($("#about-cascade"), ABOUT_CASCADE);
const tips = installTooltips($("#inspector"));

/** Brings every part of the page in line with `opt`, without writing the hash. */
function syncView() {
  syncButtons();
  syncSettings();
  syncStage();
  syncAbout();
  syncState();
  tips.sync();
}
function syncAll() {
  syncView();
  writeHash();
}

/**
 * Sets one setting's hash value (or, with `raw` undefined, removes it so the preset's or default value applies)
 * and hands the result to the running model. A model setting's change makes the Measured numbers stale, so
 * they are cleared.
 */
function setOpt(k: string, raw: string | undefined) {
  if (raw === undefined) delete opt[k];
  else opt[k] = raw;
  refreshCfg();
  sim.setCfg?.();
  if (SETTING_KEYS.includes(k)) meter.clear();
  // The path and the overlay are read as the cards are drawn, so a paused page redraws to show the change.
  paint();
  syncAll();
}

const inspector = $("#inspector");
inspector.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const k = t.dataset.k;
  if (!k) return;
  setOpt(
    k,
    t instanceof HTMLInputElement && t.type === "checkbox"
      ? t.checked
        ? "1"
        : "0"
      : t.value,
  );
});
/** A value typed beside a slider applies when it is committed (Enter or leaving the field), clamped to the range. */
inspector.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  const k = t.dataset.v;
  if (!k) return;
  const v = Number(t.value.trim().replace(",", "."));
  if (t.value.trim() === "" || !Number.isFinite(v)) {
    syncView();
    return;
  }
  // The hash clamps a value to its range, as it does for a link.
  setOpt(k, String(v));
});
inspector.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
  if (!b) return;
  const [k, v] = (b.dataset.act ?? "").split(":");
  if (k === "v") build(v as Mode);
  if (k === "p") {
    for (const key of SETTING_KEYS) delete opt[key];
    opt.preset = v!;
    build(b.dataset.mode as Mode);
  }
  if (k === "save") naming ? saveCurrent() : openSave(true);
  if (k === "revert") {
    for (const key of SETTING_KEYS) delete opt[key];
    meter.clear();
    refreshCfg();
    sim.setCfg?.();
    syncAll();
  }
  if (k === "reset") setOpt(v!, undefined);
  if (k === "copycfg")
    copyFrom(b, "copy.cfg", queueCfgSource(cfg, QUEUE_CFG, DEFAULT_CFG));
  if (k === "c" && v !== opt.cards) {
    opt.cards = v!;
    ALL = deckOf(itemsOf(v!));
    N = ALL.length;
    buildDom();
    build(opt.v as Mode, 0);
  }
  if (k === "run") {
    const dir = Number(v) as 1 | -1;
    if (run?.dir === dir) stopRun();
    else startRun(dir);
  }
  if (k === "u") {
    const saved = shownSaved[Number(v)];
    if (saved) {
      for (const key of PRESET_OWNED) delete opt[key];
      Object.assign(opt, saved.opt);
      build(opt.v as Mode);
    }
  }
  if (k === "ud") {
    const saved = shownSaved[Number(v)];
    if (saved && (opt.v === "drum" || opt.v === "cascade")) {
      if (deletePreset(opt.v, saved.name)) {
        renderSaved();
        syncButtons();
        saveNote(`Deleted “${saved.name}”.`, true);
      } else saveNote("This browser would not delete the preset.", false);
    }
  }
  if (k === "s") {
    opt.speed = v!;
    syncAll();
  }
  if (k === "pause") {
    paused = !paused;
    if (paused) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
    syncAll();
  }
  if (k === "step") {
    paused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    advance(1000 / 60);
    syncAll();
  }
  if (k === "reduced") {
    stopRun();
    opt.reduced = opt.reduced === "1" ? "0" : "1";
    refreshCfg();
    sim.jump(sim.cur);
    paint();
    syncAll();
  }
  if (k === "copy") copyFrom(b, "copy", currentSettingsMarkdown());
  if (k === "path") {
    opt.path = opt.path === "1" ? "0" : "1";
    refreshCfg();
    paint();
    syncAll();
  }
  b.blur();
});
/** Records which modules are open. */
function saveFolds() {
  for (const mod of $$("[data-module]") as HTMLDetailsElement[])
    folds[mod.dataset.module!] = mod.open;
  for (const more of $$("[data-fold]") as HTMLDetailsElement[])
    folds[more.dataset.fold!] = more.open;
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
  } catch {}
}
// `toggle` does not bubble, so the inspector listens in the capture phase for every module's. It fires a task
// after the change, so leaving the page saves too, in case a module was folded just before.
inspector.addEventListener(
  "toggle",
  () => {
    saveFolds();
    tips.sync();
  },
  true,
);
addEventListener("pagehide", saveFolds);
// Another tab of the lab may save or delete a preset.
addEventListener("storage", () => {
  renderSaved();
  syncButtons();
});
// The system's reduced-motion setting can change while the page is open.
systemReduced.addEventListener("change", () => {
  refreshCfg();
  sim.jump(sim.cur);
  paint();
  syncView();
});

// ---- keys -------------------------------------------------------------------------------
const keyDir = (k: string): 1 | -1 | 0 =>
  k === "ArrowDown" || k === "j" ? 1 : k === "ArrowUp" || k === "k" ? -1 : 0;
/** Every keydown, OS repeats included, is a press; the first also starts the drum's hold, and key-up ends it. */
let held: 1 | -1 | 0 = 0;
/** Keys typed into a text field (the saved preset's name) are text, not presses. */
const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLInputElement && e.target.type === "text";
addEventListener("keydown", (e) => {
  if (typing(e)) {
    const field = e.target as HTMLInputElement;
    if (field.id === "preset-name") {
      if (e.key === "Enter") saveCurrent();
      if (e.key === "Escape") openSave(false);
    } else if (e.key === "Enter") field.blur();
    return;
  }
  const d = keyDir(e.key);
  if (!d) return;
  e.preventDefault();
  // A real key takes over from a simulated hold.
  stopRun();
  tips.dismiss();
  if (reduced()) {
    if (!e.repeat) press(d);
    return;
  }
  metered(d);
  if (!e.repeat || held !== d) {
    held = d;
    sim.keyDown!(d);
  } else sim.press(d);
  paint();
  wake();
});
addEventListener("keyup", (e) => {
  if (!typing(e) && keyDir(e.key)) {
    held = 0;
    sim.keyUp?.();
    paint();
    wake();
  }
});
addEventListener("hashchange", () => {
  reportPreviewHash();
  // The hash is the whole state, so Back and Forward restore it: keys the new hash lacks return to their defaults.
  const next = sanitize({
    v: "drum",
    speed: "1",
    ...parseOpt(location.hash),
  });
  const before = effect(opt);
  const deck = next.cards !== opt.cards;
  const rebuild = deck || next.v !== opt.v;
  for (const k of Object.keys(opt)) delete opt[k];
  Object.assign(opt, next);
  refreshCfg();
  if (deck) {
    ALL = deckOf(itemsOf(opt.cards!));
    N = ALL.length;
    buildDom();
  }
  if (rebuild) build(opt.v as Mode, deck ? 0 : sim.cur);
  else {
    if (effect(opt) !== before) meter.clear();
    sim.setCfg?.();
    paint();
    syncView();
  }
});

// ---- hooks for the capture scripts: a stepped clock and per-frame samples --------------------
(window as any).__sim = {
  pause() {
    paused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    syncAll();
  },
  resume() {
    paused = false;
    wake();
    syncAll();
  },
  advance,
  press,
  build: (m: Mode, cur: number, o?: Record<string, string>) => {
    Object.assign(opt, o ?? {});
    build(m, cur);
  },
  jump: (n: number) => {
    sim.jump(n);
    showHead(n, false);
    paint();
  },
  cur: () => sim.cur,
  hold: (d: 1 | -1) => {
    metered(d);
    sim.keyDown ? sim.keyDown(d) : sim.press(d);
    paint();
  },
  repeat: (d: 1 | -1) => {
    metered(d);
    sim.press(d);
    paint();
  },
  release: () => {
    sim.keyUp?.();
    paint();
  },
  /** Replaces the cards with the sample items `ord` (indexes into `ITEMS`), or with the Cards deck again. */
  setOrder: (ord: number[] | null) => {
    ALL = ord
      ? ord.map((i, n) => ({ ...ITEMS[i]!, n: n + 1 }))
      : deckOf(itemsOf(opt.cards!));
    N = ALL.length;
    buildDom();
    build(opt.v as Mode, 0);
  },
  views: () => sim.views(),
  busy: () => sim.busy(),
  clock: () => simClock,
  heights: () => heights,
};

build(opt.v as Mode, 0);

// What the smoke check compares: every control the page can draw (id, label, kind, meta) and every tooltip entry id.
(window as any).__help = {
  controls: CONTROLS,
  entries: Object.keys(HELP),
};
