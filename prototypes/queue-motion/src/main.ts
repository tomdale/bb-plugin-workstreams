/**
 * The lab page: the shipped queue engine ("product"), the elastic drum and the cascade, driven by the same
 * keys, cards, and stepped clock. `window.__sim` is the hook the capture scripts drive.
 */
import { StackEngine } from "../../../src/app/page/queue/stackEngine.ts";
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import { Drum, LEAD } from "../../../src/app/page/queue/drum.ts";
import { Cascade } from "./cascade.ts";
import {
  BEZIER_DX,
  CASCADE_PRESET_NAMES,
  CASCADE_SETTINGS,
  CONTROLS,
  FADE_MS,
  GROUPS,
  MODES,
  PRESET_NAMES,
  SETTINGS,
  SETTING_KEYS,
  SPEEDS,
  cascadeCfg,
  drumCfg,
  maxOf,
  modelCfg,
  parseOpt,
  presetsOf,
  type CascadeCfg,
  type Cfg,
  type Mode,
  type Opt,
  type Setting,
} from "./controls.ts";
import { ABOUT, ABOUT_CASCADE, HELP, captionFor } from "./help.ts";
import { inline, installTooltips } from "./tooltip.ts";
// @ts-ignore: plain JS data
import { ITEMS } from "./items.js";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
const COPIES = 2;
const BASE = Array.from({ length: ITEMS.length * COPIES }, (_, i) => ({
  ...ITEMS[i % ITEMS.length],
  n: i + 1,
}));
let ALL = BASE.slice();
let N = ALL.length;

const faceHTML = (it: any) => {
  const rows = [
    it.done.length
      ? `<div class="row"><h3>Done</h3><ul>${it.done.map((d: string) => `<li><b>✓</b><span>${d}</span></li>`).join("")}</ul></div>`
      : "",
    it.review.length
      ? `<div class="row"><h3>Review</h3><ul>${it.review.map((d: string, n: number) => `<li><b>${n + 1}.</b><span>${d}</span></li>`).join("")}</ul></div>`
      : "",
  ].join("");
  return `<p class="st">${it.l}<span>${it.a} · #${it.n}</span></p><p class="goal">${it.g}</p>${rows ? `<div class="rows">${rows}</div>` : ""}`;
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
  if (!offered.includes(o.preset!)) o.preset = offered[0] ?? "natural";
  if (!SPEEDS.some((s) => s.id === o.speed)) o.speed = "1";
  return o;
};
const opt: Opt = sanitize({
  v: "drum",
  preset: "natural",
  speed: "1",
  ...parseOpt(location.hash),
});
/** The drum and cascade configurations the state asks for; recomputed whenever `opt` changes. */
let cfg: Cfg = drumCfg(opt);
let ccfg: CascadeCfg = cascadeCfg(opt);
const refreshCfg = () => {
  cfg = drumCfg(opt);
  ccfg = cascadeCfg(opt);
};
const writeHash = () => (location.hash = new URLSearchParams(opt).toString());

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

// ---- cubic Bezier path for incoming and outgoing cards ----------------------------
const STAGE_X = 340;
const BEZIER_TUCK_DX = 48;
const S0 = 1000 / 1170;
const C1_Y = 0.2;
const C2_Y = 0.8;

type Pt = { x: number; y: number };
type Cubic = [Pt, Pt, Pt, Pt];
type Role = "pile" | "out" | "in";
type BezierPaths = {
  out: Cubic;
  in: Cubic;
  tuck?: Cubic;
  pile: number[];
  endLabel: "turn" | "park";
};

function makeArc(y0: number, y3: number, dx: number): Cubic {
  const dy = y3 - y0;
  return [
    { x: STAGE_X, y: y0 },
    { x: STAGE_X + dx, y: y0 + C1_Y * dy },
    { x: STAGE_X + dx, y: y0 + C2_Y * dy },
    { x: STAGE_X, y: y3 },
  ];
}

/** Solves Y(s) = y0 + u * (y3 - y0) on a cubic Bezier with vertical control fractions 0.2 and 0.8. */
function solveArcS(u: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  let s = clamped;
  for (let k = 0; k < 4; k++) {
    const f = (0.6 + (1.2 - 0.8 * s) * s) * s - clamped;
    const df = 0.6 + 2.4 * s * (1 - s);
    s = Math.min(1, Math.max(0, s - f / df));
  }
  return s;
}

/** Horizontal offset from STAGE_X on `makeArc(y0, y3, dx)` at the point where Y(s) = y. */
function arcOffsetX(y: number, y0: number, y3: number, dx: number): number {
  const span = y3 - y0;
  if (Math.abs(span) < 1e-4) return 0;
  const s = solveArcS((y - y0) / span);
  return 3 * s * (1 - s) * dx;
}

function evalCubic([p0, p1, p2, p3]: Cubic, s: number): Pt {
  const m = 1 - s;
  const b0 = m * m * m;
  const b1 = 3 * m * m * s;
  const b2 = 3 * m * s * s;
  const b3 = s * s * s;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

function evalTangent([p0, p1, p2, p3]: Cubic, s: number): Pt {
  const m = 1 - s;
  const dx =
    3 * m * m * (p1.x - p0.x) +
    6 * m * s * (p2.x - p1.x) +
    3 * s * s * (p3.x - p2.x);
  const dy =
    3 * m * m * (p1.y - p0.y) +
    6 * m * s * (p2.y - p1.y) +
    3 * s * s * (p3.y - p2.y);
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

const cubicPath = ([p0, p1, p2, p3]: Cubic) =>
  `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}, ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`;

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

function drumCardMotion(
  d: Drum,
  i: number,
  top: number,
  signs: Map<string, number>,
  key: string,
): { x: number; role: Role } {
  const c = d.c[i]!;
  const want = d.target(i) < 0 ? 1 : -1;
  if (c >= -1e-4) {
    signs.set(key, want);
    return { x: 0, role: "pile" };
  }
  const role: Role = want > 0 ? "out" : "in";
  const turn = d.turnTop(i);
  if (c > -1) {
    const prev = signs.get(key);
    const sign =
      prev === undefined || c > -0.02 || c < -0.98
        ? want
        : prev + (want - prev) * 0.22;
    signs.set(key, sign);
    return { x: arcOffsetX(top, LEAD, turn, sign * BEZIER_DX), role };
  }
  signs.set(key, want);
  if (c <= -2 + 1e-3) return { x: 0, role };
  return {
    x: arcOffsetX(top, turn, drumTuckTop(d, i), -BEZIER_TUCK_DX),
    role,
  };
}

function drumBezierPaths(d: Drum): BezierPaths {
  const safeFront = Math.min(Math.max(0, d.front), Math.max(0, d.N - 1));
  const raw = d.views();
  const outMover = raw.find(
    (v) => v.painted && v.c < -1e-3 && v.c > -1 && d.target(v.i) < 0,
  );
  const inMover = raw.find(
    (v) => v.painted && v.c < -1e-3 && d.target(v.i) >= 0,
  );
  const tuckMover = raw.find((v) => v.painted && v.c < -1e-3);
  const outTurn = outMover
    ? d.turnTop(outMover.i)
    : d.N > 0
      ? d.turnTop(safeFront)
      : LEAD + 200;
  const inTurn = inMover
    ? d.turnTop(inMover.i)
    : d.front > 0
      ? d.turnTop(d.front - 1)
      : d.N > 0
        ? LEAD + d.hg(0) + 16 + d.dip()
        : outTurn;
  const tuckY = tuckMover
    ? drumTuckTop(d, tuckMover.i)
    : d.N > 0
      ? drumTuckTop(d, safeFront)
      : LEAD + 4;
  return {
    out: makeArc(LEAD, outTurn, BEZIER_DX),
    in: makeArc(inTurn, LEAD, -BEZIER_DX),
    tuck: makeArc(outTurn, tuckY, -BEZIER_TUCK_DX),
    pile: slotTops((q) => d.slot(q)),
    endLabel: "turn",
  };
}

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
  paths(): BezierPaths;
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
  const signs = new Map<string, number>();
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
        const { x, role } = drumCardMotion(d, v.i, v.top, signs, v.key);
        return {
          ...v,
          x,
          role,
          vis: (v.bottom - v.top) / v.scale,
        };
      }),
    paths: () => drumBezierPaths(d),
    busy: () => d.isBusy(),
    jump: (n) => {
      d.jump(n);
      signs.clear();
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
  const signs = new Map<string, number>();
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
      const parkTop = LEAD + m.cfg.park;
      return m.views().map((v) => {
        const want = m.target(v.i) < 0 ? 1 : -1;
        let x = 0;
        let role: Role = "pile";
        if (v.c < -1e-4 && v.c > -1 + 1e-4) {
          role = want > 0 ? "out" : "in";
          const prev = signs.get(v.key);
          const sign =
            prev === undefined || v.c > -0.02 || v.c < -0.98
              ? want
              : prev + (want - prev) * 0.22;
          signs.set(v.key, sign);
          x = arcOffsetX(v.top, LEAD, parkTop, sign * BEZIER_DX);
        } else {
          signs.set(v.key, want);
        }
        return {
          ...v,
          x,
          role,
          vis:
            v.group === 0 && v.bottom >= v.natBottom - 1e-6
              ? v.h
              : (v.bottom - v.top) / v.scale,
        };
      });
    },
    paths: () => {
      const parkTop = LEAD + m.cfg.park;
      return {
        out: makeArc(LEAD, parkTop, BEZIER_DX),
        in: makeArc(parkTop, LEAD, -BEZIER_DX),
        pile: slotTops((q) => m.slot(q)),
        endLabel: "park",
      };
    },
    busy: () => m.isBusy(),
    jump: (n) => {
      m.jump(n);
      signs.clear();
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
  const signs = new Map<string, number>();
  let at = cur;
  const win = () => keys.slice(at, at + 4);
  e.sync(win(), undefined, true, at > 0);
  const drumOf = () => (e as any).drum as Drum;
  const sim: Sim = {
    get cur() {
      return at;
    },
    press(dir) {
      if ((dir > 0 && at >= N - 1) || (dir < 0 && at <= 0)) return false;
      const d = dir > 0 ? "forward" : "back";
      if (!e.accept(d)) return false;
      at += dir;
      e.sync(win(), d, false, at > 0);
      onMove(at, dir);
      return true;
    },
    keyDown(dir) {
      e.hold(dir > 0 ? "forward" : "back");
      sim.press(dir);
    },
    keyUp: () => e.release(),
    step: (ms) => e.step(ms / 1000),
    views: () => {
      const d = drumOf();
      return e.frame().cards.map((v, i) => {
        const top = LEAD + v.scale * v.y;
        const { x, role } = drumCardMotion(d, i, top, signs, v.key);
        return { ...v, x, top, role };
      });
    },
    paths: () => drumBezierPaths(drumOf()),
    busy: () => e.frame().busy,
    jump(n) {
      at = n;
      signs.clear();
      e.sync(win(), undefined, true, at > 0);
    },
    setHeights: (h) => e.setHeights(new Map(keys.map((k, i) => [k, h[i]!]))),
  };
  return sim;
}

let sim: Sim;
let paused = false,
  raf = 0,
  last = 0,
  simClock = 0;
const reduced = () =>
  opt.reduced === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const speed = () => Number(opt.speed) || 1;

/** The held readout is on while the model has a held state to report: the drum's speed-up or fold, the cascade's ramp. */
const showsHeld = () =>
  !!sim.lam &&
  (opt.v === "drum"
    ? cfg.fold || cfg.ramp || cfg.loose
    : opt.v === "cascade" && ccfg.ramp);

function chevron(arc: Cubic, s: number, cls: string): string {
  const pt = evalCubic(arc, s);
  const t = evalTangent(arc, s);
  const arm = 5.5;
  const spread = 4.2;
  const bx = pt.x - t.x * arm;
  const by = pt.y - t.y * arm;
  const lx = bx - t.y * spread;
  const ly = by + t.x * spread;
  const rx = bx + t.y * spread;
  const ry = by - t.x * spread;
  return `<path class="bz-arrow ${cls}" d="M ${lx.toFixed(1)} ${ly.toFixed(1)} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)}"/>`;
}

function paintBezier(views: View[]) {
  const svg = $("#bezier");
  const show = opt.path === "1";
  svg.toggleAttribute("hidden", !show);
  if (!show) return;
  const p = sim.paths();
  const [o0, o1, o2, o3] = p.out;
  const [i0, i1, i2, i3] = p.in;
  const outMid = evalCubic(p.out, 0.5);
  const inMid = evalCubic(p.in, 0.5);
  const parts: string[] = [
    // Control-point handles and knots
    `<line class="bz-handle" x1="${o0.x}" y1="${o0.y.toFixed(1)}" x2="${o1.x.toFixed(1)}" y2="${o1.y.toFixed(1)}"/>`,
    `<line class="bz-handle" x1="${o3.x}" y1="${o3.y.toFixed(1)}" x2="${o2.x.toFixed(1)}" y2="${o2.y.toFixed(1)}"/>`,
    `<line class="bz-handle" x1="${i0.x}" y1="${i0.y.toFixed(1)}" x2="${i1.x.toFixed(1)}" y2="${i1.y.toFixed(1)}"/>`,
    `<line class="bz-handle" x1="${i3.x}" y1="${i3.y.toFixed(1)}" x2="${i2.x.toFixed(1)}" y2="${i2.y.toFixed(1)}"/>`,
    `<circle class="bz-ctrl bz-ctrl-out" cx="${o1.x.toFixed(1)}" cy="${o1.y.toFixed(1)}" r="3"/>`,
    `<circle class="bz-ctrl bz-ctrl-out" cx="${o2.x.toFixed(1)}" cy="${o2.y.toFixed(1)}" r="3"/>`,
    `<circle class="bz-ctrl bz-ctrl-in" cx="${i1.x.toFixed(1)}" cy="${i1.y.toFixed(1)}" r="3"/>`,
    `<circle class="bz-ctrl bz-ctrl-in" cx="${i2.x.toFixed(1)}" cy="${i2.y.toFixed(1)}" r="3"/>`,
  ];
  // Pile spine above the front card
  if (p.pile.length >= 3) {
    parts.push(
      `<line class="bz-pile" x1="${STAGE_X}" y1="${p.pile[2]!.toFixed(1)}" x2="${STAGE_X}" y2="${p.pile[0]!.toFixed(1)}"/>`,
      `<circle class="bz-slot" cx="${STAGE_X}" cy="${p.pile[1]!.toFixed(1)}" r="2.5"/>`,
      `<circle class="bz-slot" cx="${STAGE_X}" cy="${p.pile[2]!.toFixed(1)}" r="2.5"/>`,
    );
  }
  // Drum behind-pile tuck curve
  if (p.tuck) {
    const t3 = p.tuck[3];
    const labelY = Math.max(LEAD + 14, t3.y + 3.5);
    parts.push(
      `<path class="bz-tuck" data-curve="tuck" d="${cubicPath(p.tuck)}"/>`,
      `<circle class="bz-anchor-tuck" cx="${t3.x}" cy="${t3.y.toFixed(1)}" r="3.5"/>`,
      `<text class="bz-label bz-label-tuck" x="${t3.x + 10}" y="${labelY.toFixed(1)}" text-anchor="start">tuck</text>`,
    );
  }
  // Outgoing and incoming cubic Bezier curves
  parts.push(
    `<path class="bz-out" data-curve="out" d="${cubicPath(p.out)}"/>`,
    `<path class="bz-in" data-curve="in" d="${cubicPath(p.in)}"/>`,
    chevron(p.out, 0.5, "bz-arrow-out"),
    chevron(p.in, 0.5, "bz-arrow-in"),
    `<text class="bz-label bz-label-out" x="${(outMid.x + 10).toFixed(1)}" y="${(outMid.y + 4).toFixed(1)}" text-anchor="start">out ↓</text>`,
    `<text class="bz-label bz-label-in" x="${(inMid.x - 10).toFixed(1)}" y="${(inMid.y + 4).toFixed(1)}" text-anchor="end">↑ in</text>`,
  );
  // Anchors
  parts.push(
    `<circle class="bz-anchor" cx="${STAGE_X}" cy="${LEAD}" r="4.2"/>`,
    `<text class="bz-label bz-label-node" x="${STAGE_X + 10}" y="${LEAD - 6}" text-anchor="start">front</text>`,
    `<circle class="bz-anchor" cx="${STAGE_X}" cy="${o3.y.toFixed(1)}" r="4.2"/>`,
    `<text class="bz-label bz-label-node" x="${STAGE_X + 10}" y="${(o3.y + 4).toFixed(1)}" text-anchor="start">${p.endLabel}</text>`,
  );
  if (Math.abs(i0.y - o3.y) > 2) {
    parts.push(
      `<circle class="bz-anchor" cx="${STAGE_X}" cy="${i0.y.toFixed(1)}" r="3.6"/>`,
      `<text class="bz-label bz-label-node" x="${STAGE_X - 10}" y="${(i0.y + 4).toFixed(1)}" text-anchor="end">${p.endLabel} ↑</text>`,
    );
  }
  // Live markers for painted cards
  const isRed = reduced();
  for (const v of views) {
    if (!v.painted) continue;
    const cx = STAGE_X + (isRed ? 0 : v.x);
    parts.push(
      `<circle class="bz-dot bz-dot-${v.role}" data-dot="${v.key}" cx="${cx.toFixed(1)}" cy="${v.top.toFixed(1)}" r="${v.role === "pile" ? "3.8" : "5"}"/>`,
    );
  }
  svg.innerHTML = parts.join("");
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
    st.transform =
      Math.abs(dx) > 0.01
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
  const text = showsHeld() ? `held ${sim.lam!().toFixed(2)}` : "";
  const readout = $("#lam");
  if (readout.textContent !== text) readout.textContent = text;
}

function showHead(n: number, animate: boolean) {
  const it = ALL[n]!;
  $("#pos").textContent = `${n + 1} of ${N}`;
  const h = $("#head");
  h.innerHTML = `<div><div class="path">${it.p}</div><h1>${it.t}</h1></div>`;
  if (animate && !reduced())
    h.firstElementChild!.animate([{ opacity: 0.2 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
}

function advance(ms: number) {
  let r = ms;
  while (r > 1e-9) {
    const d = Math.min(1000 / 60, r);
    sim.step(d);
    r -= d;
  }
  simClock += ms;
  paint();
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
    // No motion: the new front fades in over FADE_MS.
    const n = sim.cur + dir;
    if (n < 0 || n >= N) return;
    sim.jump(n);
    showHead(n, true);
    els[n]!.el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_MS,
      easing: "ease-out",
    });
    paint();
    return;
  }
  sim.press(dir);
  paint();
  wake();
}
onMove = (c) => showHead(c, true);

function build(mode: Mode, cur = sim ? sim.cur : 0) {
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
  syncAll();
}

// ---- controls ----------------------------------------------------------------------
// The bars are drawn once from the lists in controls.ts and updated in place, so a control that is hovered or
// focused is never replaced under the pointer. Every control carries `data-help`, the id of its tooltip.
const round = (v: number) => Math.round(v * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const labelOf = (id: string) => CONTROLS.find((c) => c.id === id)!.label;
const group = (label: string, body: string, attrs = "") =>
  `<div class="grp" ${attrs}>${label ? `<span>${esc(label)}</span>` : ""}${body}</div>`;
const button = (help: string, act: string, text: string, mode = "") =>
  `<button data-help="${help}" data-act="${act}"${mode ? ` data-mode="${mode}"` : ""}>${esc(text)}</button>`;

function renderBar() {
  $("#bar").innerHTML =
    group(
      "Model",
      MODES.map((m) => button(`model.${m.id}`, `v:${m.id}`, m.label)).join(""),
    ) +
    group(
      "Preset",
      PRESET_NAMES.map((p) => button(`preset.${p}`, `p:${p}`, p, "drum")).join(
        "",
      ) +
        CASCADE_PRESET_NAMES.map((p) =>
          button(`preset.${p}`, `p:${p}`, p, "cascade"),
        ).join(""),
      'id="presets"',
    ) +
    group(
      "Speed",
      SPEEDS.map((s) => button("speed", `s:${s.id}`, s.label)).join(""),
    ) +
    group(
      "Clock",
      button("clock.pause", "pause", labelOf("clock.pause")) +
        button("clock.step", "step", labelOf("clock.step")),
    ) +
    group(
      "",
      button("reduced", "reduced", labelOf("reduced")) +
        button("path", "path", labelOf("path")),
    ) +
    `<span id="lam" class="lam" data-help="held" tabindex="0" hidden></span>`;
}

function syncBar() {
  for (const b of $$("#bar button")) {
    const [k, v] = (b.dataset.act ?? "").split(":");
    const on =
      k === "v"
        ? opt.v === v
        : k === "p"
          ? opt.preset === v
          : k === "s"
            ? opt.speed === v
            : k === "pause"
              ? paused
              : k === "reduced"
                ? opt.reduced === "1"
                : k === "path"
                  ? opt.path === "1"
                  : false;
    b.classList.toggle("on", on);
    if (k !== "step") b.setAttribute("aria-pressed", String(on));
  }
  // Each model shows its own preset buttons; the product has none.
  $("#presets").hidden = opt.v === "product";
  for (const b of $$("#presets button")) b.hidden = b.dataset.mode !== opt.v;
  $('#bar [data-act="pause"]').textContent = paused
    ? "Paused"
    : labelOf("clock.pause");
  $("#lam").hidden = !showsHeld();
}

const settingHtml = (s: Setting<any, unknown>) => {
  const host = `data-help="setting.${s.key}" data-key="${s.key}"`;
  // A limit that depends on another setting is set when the settings are synced.
  if (s.kind === "range")
    return `<label ${host}>${esc(s.label)} <input type="range" data-k="${s.key}" min="${s.min}"${typeof s.max === "number" ? ` max="${s.max}"` : ""} step="${s.step}"><output></output></label>`;
  if (s.kind === "toggle")
    return `<label ${host}><input type="checkbox" data-k="${s.key}"> ${esc(s.label)}</label>`;
  return `<label ${host}>${esc(s.label)} <select data-k="${s.key}">${s.options.map((o) => `<option>${o}</option>`).join("")}</select></label>`;
};

/** The settings bar holds both models' settings; a model's are hidden while another model runs. */
function renderSettings() {
  const all: readonly Setting<any, unknown>[] = [
    ...SETTINGS,
    ...CASCADE_SETTINGS,
  ];
  $("#sbar").innerHTML = GROUPS.map((g) =>
    group(
      g.label,
      all
        .filter((s) => s.group === g.id)
        .map(settingHtml)
        .join(""),
      `data-group="${g.id}"`,
    ),
  ).join("");
}

/** Shows one model's settings that change something under its configuration `c`, with their current values. */
function syncList<C>(
  list: readonly Setting<C, unknown>[],
  c: C,
  active: boolean,
) {
  const sbar = $("#sbar");
  for (const s of list) {
    const host = sbar.querySelector<HTMLElement>(`[data-key="${s.key}"]`)!;
    host.hidden = !active || !s.shown(c);
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(
      "[data-k]",
    )!;
    if (s.kind === "toggle") (input as HTMLInputElement).checked = s.read(c);
    else if (s.kind === "select") input.value = s.read(c);
    else {
      (input as HTMLInputElement).max = String(maxOf(s, c));
      const v = round(s.read(c));
      if (Number(input.value) !== v) input.value = String(v);
      host.querySelector("output")!.textContent = String(v);
    }
  }
}

/** Shows the settings of the running model that change something under its configuration. */
function syncSettings() {
  const sbar = $("#sbar");
  sbar.hidden = opt.v === "product";
  if (sbar.hidden) return;
  syncList(SETTINGS, cfg, opt.v === "drum");
  syncList(CASCADE_SETTINGS, ccfg, opt.v === "cascade");
  for (const g of $$("#sbar .grp"))
    g.hidden = $$(`#sbar [data-group="${g.dataset.group}"] label`).every(
      (l) => l.hidden,
    );
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

/** The caption under the stack: the active model and preset, in the words of their tooltips. */
function syncNote() {
  const name = MODES.find((m) => m.id === opt.v)!.label;
  const lead = document.createElement("b");
  lead.textContent = `${name}${opt.v !== "product" ? ` · ${opt.preset}` : ""}.`;
  const text = document.createElement("span");
  inline(text, captionFor(opt.v!, opt.preset!));
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent =
    "Hold ↑ or ↓ (or J/K), with the OS key repeat. Hover a control, or Tab to it, for its help.";
  $("#note").replaceChildren(lead, " ", text, hint);
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

/** The panel at the bottom left explains the model that runs: the cascade's, or the drum's (also for the product). */
function syncAbout() {
  const cascade = opt.v === "cascade";
  const id = cascade ? "about.cascade" : "about";
  const summary = $("details.model summary");
  summary.dataset.help = id;
  summary.textContent = labelOf(id);
  $("#about").hidden = cascade;
  $("#about-cascade").hidden = !cascade;
}

renderBar();
renderSettings();
renderAbout($("#about"), ABOUT);
renderAbout($("#about-cascade"), ABOUT_CASCADE);
const tips = installTooltips();

function syncAll() {
  syncBar();
  syncSettings();
  syncStage();
  syncAbout();
  syncNote();
  writeHash();
  tips.sync();
}

$("#sbar").addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const k = t.dataset.k;
  if (!k) return;
  opt[k] =
    t instanceof HTMLInputElement && t.type === "checkbox"
      ? t.checked
        ? "1"
        : "0"
      : t.value;
  refreshCfg();
  sim.setCfg?.();
  syncAll();
});
$("#bar").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  const [k, v] = (b.dataset.act ?? "").split(":");
  if (k === "v") build(v as Mode);
  if (k === "p") {
    for (const key of SETTING_KEYS) delete opt[key];
    opt.preset = v!;
    build(b.dataset.mode as Mode);
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
    opt.reduced = opt.reduced === "1" ? "0" : "1";
    sim.jump(sim.cur);
    paint();
    syncAll();
  }
  if (k === "path") {
    opt.path = opt.path === "1" ? "0" : "1";
    paint();
    syncAll();
  }
  (b as HTMLElement).blur();
});

// ---- keys -------------------------------------------------------------------------------
const keyDir = (k: string): 1 | -1 | 0 =>
  k === "ArrowDown" || k === "j" ? 1 : k === "ArrowUp" || k === "k" ? -1 : 0;
/** Every keydown, OS repeats included, is a press; the first also starts the drum's hold, and key-up ends it. */
let held: 1 | -1 | 0 = 0;
addEventListener("keydown", (e) => {
  const d = keyDir(e.key);
  if (!d) return;
  e.preventDefault();
  tips.dismiss();
  if (reduced()) {
    if (!e.repeat) press(d);
    return;
  }
  if (!e.repeat || held !== d) {
    held = d;
    sim.keyDown!(d);
  } else sim.press(d);
  paint();
  wake();
});
addEventListener("keyup", (e) => {
  if (keyDir(e.key)) {
    held = 0;
    sim.keyUp?.();
    paint();
    wake();
  }
});
addEventListener("hashchange", () => {
  // The hash is the whole state, so Back and Forward restore it: keys the new hash lacks return to their defaults.
  const next = sanitize({
    v: "drum",
    preset: "natural",
    speed: "1",
    ...parseOpt(location.hash),
  });
  const rebuild = next.v !== opt.v;
  for (const k of Object.keys(opt)) delete opt[k];
  Object.assign(opt, next);
  refreshCfg();
  if (rebuild) build(opt.v as Mode);
  else {
    sim.setCfg?.();
    paint();
    syncBar();
    syncSettings();
    syncStage();
    syncAbout();
    syncNote();
    tips.sync();
  }
});
const fitBars = () => {
  $(".page").style.inset = $("#bars").offsetHeight + "px 0 0";
};
new ResizeObserver(fitBars).observe($("#bars"));

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
    sim.keyDown ? sim.keyDown(d) : sim.press(d);
    paint();
  },
  repeat: (d: 1 | -1) => {
    sim.press(d);
    paint();
  },
  release: () => {
    sim.keyUp?.();
    paint();
  },
  setOrder: (ord: number[] | null) => {
    ALL = ord ? ord.map((i) => BASE[i]!) : BASE.slice();
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
