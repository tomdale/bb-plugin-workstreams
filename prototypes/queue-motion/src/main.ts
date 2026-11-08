/**
 * The lab page: the shipped queue engine ("product"), the elastic drum and the cascade, driven by the same
 * keys, cards, and stepped clock. `window.__sim` is the hook the capture scripts drive.
 */
import { StackEngine } from "../../../src/app/page/queue/stackEngine.ts";
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import { Drum, LEAD } from "../../../src/app/page/queue/drum.ts";
import { Cascade } from "./cascade.ts";
import {
  CASCADE_PRESET_NAMES,
  CASCADE_SETTINGS,
  CONTROLS,
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
  maxOf,
  modelCfg,
  parseOpt,
  pathCfg,
  presetsOf,
  viewCfg,
  type CascadeCfg,
  type Cfg,
  type Mode,
  type ModuleId,
  type Opt,
  type PathCfg,
  type Setting,
  type ViewCfg,
} from "./controls.ts";
import {
  ringCubics,
  ringKnots,
  ringPeaks,
  ringPoint,
  ringSpan,
  ringSway,
  type Cubic,
  type Ring,
  type Sway,
} from "./ring.ts";
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
});
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
        const { x, role } = drumCardMotion(d, i);
        return { ...v, x, top, role };
      });
    },
    overlay: () => drumOverlay(drumOf()),
    busy: () => e.frame().busy,
    jump(n) {
      at = n;
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
  // The drum's ring splits at the turn into the drop in front of the pile and the rise behind it.
  const half = ring.kind === "drum" ? cubics.length / 2 : cubics.length;
  const front = cubics.slice(0, half);
  const behind = cubics.slice(half);
  const parts: string[] = [];
  // Control-point handles at the knots the sliders move: each leg's widest point, and the turn. The other
  // knots only keep the fit close, so their handles show only when `handles at every knot` asks for them.
  const knots = ringKnots(ring, vcfg.inner);
  const named = vcfg.allKnots
    ? knots
    : [...ringPeaks(ring), ...(ring.kind === "drum" ? [1] : [])];
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
  const lobe = ringPoint(ring, ring.sway.peak);
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
    const back = ringPoint(ring, 2 - ring.sway.peak);
    parts.push(
      label(
        `<text class="bz-label bz-label-tuck" ${beside(back.x, back.x === 0 ? -1 : 1)} y="${f1(back.y + 4)}">behind</text>`,
      ),
    );
  }
  // Each leg's widest point
  for (const u of ringPeaks(ring)) {
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
  if (showsHeld()) {
    const lam = sim.lam!();
    const text = lam.toFixed(2);
    const out = $("#lam output");
    if (out.textContent !== text) {
      out.textContent = text;
      $("#lam .meter i").style.width = `${(lam * 100).toFixed(1)}%`;
    }
  }
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

// ---- the inspector ------------------------------------------------------------------------------
// The inspector is drawn once from the lists in controls.ts and updated in place, so a control that is hovered
// or focused is never replaced under the pointer. Every control carries `data-help`, the id of its tooltip.
// Each module is a <details>; a module with nothing to show under the current configuration is hidden whole.
const round = (v: number) => Math.round(v * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const labelOf = (id: string) => CONTROLS.find((c) => c.id === id)!.label;
const button = (help: string, act: string, text: string, mode = "") =>
  `<button type="button" data-help="${help}" data-act="${act}"${mode ? ` data-mode="${mode}"` : ""}>${esc(text)}</button>`;
/** A toggle button drawn as a switch: the label, then a track whose knob shows `aria-pressed`. */
const switchButton = (help: string, act: string) =>
  `<button type="button" class="switch" data-help="${help}" data-act="${act}"><span>${esc(labelOf(help))}</span><i aria-hidden="true"></i></button>`;
const row = (label: string, body: string, attrs = "") =>
  `<div class="ins-row" ${attrs}><span class="row-label">${esc(label)}</span>${body}</div>`;

const ALL_SETTINGS: readonly Setting<any, unknown>[] = [
  ...SETTINGS,
  ...CASCADE_SETTINGS,
  ...PATH_SETTINGS,
  ...VIEW_SETTINGS,
];

const settingHtml = (s: Setting<any, unknown>) => {
  const host = `data-help="setting.${s.key}" data-key="${s.key}"`;
  // A limit that depends on another setting is set when the settings are synced.
  if (s.kind === "range")
    return `<label class="set set-range" ${host}><span class="set-name">${esc(s.label)}</span><output></output><input type="range" data-k="${s.key}" min="${s.min}"${typeof s.max === "number" ? ` max="${s.max}"` : ""} step="${s.step}"></label>`;
  if (s.kind === "toggle")
    return `<label class="set set-toggle" ${host}><input type="checkbox" data-k="${s.key}"><span class="set-name">${esc(s.label)}</span></label>`;
  return `<label class="set set-select" ${host}><span class="set-name">${esc(s.label)}</span><select data-k="${s.key}">${s.options.map((o) => `<option>${o}</option>`).join("")}</select></label>`;
};
const settingsOf = (group: ModuleId) =>
  ALL_SETTINGS.filter((s) => s.group === group)
    .map(settingHtml)
    .join("");

/** The body of each module: its buttons, then its settings. */
const BODIES: Record<ModuleId, () => string> = {
  model: () =>
    `<div class="seg seg-3" role="group" aria-label="Model">${MODES.map((m) => button(`model.${m.id}`, `v:${m.id}`, m.label)).join("")}</div>` +
    `<div class="field" id="presets"><span class="row-label">Preset</span><div class="chips">${PRESET_NAMES.map(
      (p) => button(`preset.${p}`, `p:${p}`, p, "drum"),
    ).join("")}${CASCADE_PRESET_NAMES.map((p) =>
      button(`preset.${p}`, `p:${p}`, p, "cascade"),
    ).join("")}</div></div>` +
    `<p class="caption" id="note"></p>`,
  playback: () =>
    row(
      "Speed",
      `<div class="seg" role="group" aria-label="Speed">${SPEEDS.map((s) => button("speed", `s:${s.id}`, s.label)).join("")}</div>`,
    ) +
    row(
      "Clock",
      `<div class="pair">${button("clock.pause", "pause", labelOf("clock.pause"))}${button("clock.step", "step", labelOf("clock.step"))}</div>`,
    ) +
    switchButton("reduced", "reduced") +
    settingsOf("playback") +
    `<div id="lam" class="readout" data-help="held" tabindex="0" hidden><span class="row-label">held</span><span class="meter"><i></i></span><output>0.00</output></div>`,
  taps: () => settingsOf("taps"),
  pace: () => settingsOf("pace"),
  held: () => settingsOf("held"),
  stage: () => settingsOf("stage"),
  path: () => settingsOf("path"),
  overlay: () => switchButton("path", "path") + settingsOf("overlay"),
  about: () =>
    `<div class="panel" id="about"></div><div class="panel" id="about-cascade" hidden></div>`,
};

/** Which modules the reader has collapsed or opened, kept across visits; the hash holds only the motion's state. */
const FOLDS_KEY = "queue-motion-lab.modules";
const folds: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}");
  } catch {
    return {};
  }
})();
/** Every module starts open but the About panel, which is long. */
const startsOpen = (id: ModuleId) => folds[id] ?? id !== "about";

function renderInspector() {
  $("#modules").innerHTML = MODULES.map((m) => {
    // The About module's heading is its control: it names the panel the running model shows.
    const summary =
      m.id === "about"
        ? `<summary data-help="about">${esc(labelOf("about"))}</summary>`
        : `<summary>${esc(m.label)}</summary>`;
    return `<details class="mod" data-module="${m.id}"${startsOpen(m.id) ? " open" : ""}>${summary}<div class="mod-body">${BODIES[m.id]()}</div></details>`;
  }).join("");
}

function syncButtons() {
  for (const b of $$("#inspector button[data-act]")) {
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
  $('#inspector [data-act="pause"]').textContent = paused
    ? "Paused"
    : labelOf("clock.pause");
  $("#lam").hidden = !showsHeld();
}

/** Shows one list's settings that change something under configuration `c`, with their current values. */
function syncList<C>(
  list: readonly Setting<C, unknown>[],
  c: C,
  active: boolean,
) {
  const root = $("#inspector");
  for (const s of list) {
    const host = root.querySelector<HTMLElement>(`[data-key="${s.key}"]`)!;
    host.hidden = !active || !s.shown(c);
    const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(
      "[data-k]",
    )!;
    if (s.kind === "toggle") (input as HTMLInputElement).checked = s.read(c);
    else if (s.kind === "select") input.value = s.read(c);
    else {
      const max = maxOf(s, c);
      (input as HTMLInputElement).max = String(max);
      const v = round(s.read(c));
      if (Number(input.value) !== v) input.value = String(v);
      host.querySelector("output")!.textContent = String(v);
      // The track fills to the value, so a column of sliders reads at a glance.
      host.style.setProperty(
        "--fill",
        `${(((v - s.min) / (max - s.min || 1)) * 100).toFixed(1)}%`,
      );
    }
  }
}

/**
 * Shows the running model's settings, the Path settings while the path shows on screen, and the page's own,
 * each only while it changes something; then hides every settings module left with nothing to show. The
 * product has no model settings of its own. Under reduced motion no card moves, so the settings that shape
 * motion change nothing and hide; the cascade's Stage settings still cut and fade the stage, so they stay.
 */
function syncSettings() {
  const moving = !reduced();
  syncList(SETTINGS, cfg, opt.v === "drum" && moving);
  syncList(
    CASCADE_SETTINGS.filter((s) => s.group !== "stage"),
    ccfg,
    opt.v === "cascade" && moving,
  );
  syncList(
    CASCADE_SETTINGS.filter((s) => s.group === "stage"),
    ccfg,
    opt.v === "cascade",
  );
  syncList(PATH_SETTINGS, pcfg, true);
  syncList(VIEW_SETTINGS, vcfg, true);
  for (const id of ["taps", "pace", "held", "stage", "path"] as const) {
    const mod = $(`[data-module="${id}"]`);
    mod.hidden = $$(`[data-module="${id}"] [data-key]`).every((l) => l.hidden);
  }
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

/** The caption under the Model buttons: the active model and preset, in the words of their tooltips. */
function syncNote() {
  const name = MODES.find((m) => m.id === opt.v)!.label;
  const lead = document.createElement("b");
  lead.textContent = `${name}${opt.v !== "product" ? ` · ${opt.preset}` : ""}.`;
  const text = document.createElement("span");
  inline(text, captionFor(opt.v!, opt.preset!));
  $("#note").replaceChildren(lead, " ", text);
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
  syncNote();
  tips.sync();
}
function syncAll() {
  syncView();
  writeHash();
}

const inspector = $("#inspector");
inspector.addEventListener("input", (e) => {
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
  // The path and the overlay are read as the cards are drawn, so a paused page redraws to show the change.
  if (PATH_KEYS.includes(k) || VIEW_KEYS.includes(k)) paint();
  syncAll();
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
    refreshCfg();
    sim.jump(sim.cur);
    paint();
    syncAll();
  }
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
