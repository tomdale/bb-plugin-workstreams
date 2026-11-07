/**
 * The lab page: the shipped queue engine ("product") and the elastic drum side by side, driven by the same
 * keys, cards, and stepped clock. `window.__sim` is the hook the capture scripts drive.
 */
import { StackEngine } from "../../../src/app/page/queue/stackEngine.ts";
// @ts-ignore: plain JS model, shared with the headless sims
import { Drum, PRESETS, LEAD } from "./drum.mjs";
import { ITEMS } from "./items.js";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const TAU = 2 * Math.PI;
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

type Mode = "product" | "drum";
const MODES: [Mode, string, string][] = [
  [
    "product",
    "Product now",
    "The shipped stack engine (src/app/page/queue/stackEngine.ts), imported as it is.",
  ],
  [
    "drum",
    "Elastic drum",
    "Every card has one coordinate on a closed ring path with its own critically damped spring; ↑ is the same ring run backwards. Pick a preset or move the settings.",
  ],
];
const PRESET_NAMES: string[] = Object.keys(PRESETS);
const PRESET_NOTES: Record<string, string> = {
  natural:
    "The pace follows card heights: tall cards slow it, short cards speed it up.",
  even: "Presses are spaced by a tempo planned from the heights ahead, so the pace changes gently.",
  "even + held speed":
    "Even tempo, plus stiffer springs and a higher edge budget while a key is held.",
  "constant + held speed":
    "One constant interval between presses, plus the held speed-up.",
  fold: "While a key is held every card folds toward its header line, so trips are short and the pace rises to 10+ cards/s.",
};

const opt: Record<string, string> = {
  v: "drum",
  preset: "natural",
  speed: "1",
  ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))),
};
if (!MODES.some((m) => m[0] === opt.v)) opt.v = "drum";
if (!PRESETS[opt.preset]) opt.preset = "natural";

// ---- DOM -------------------------------------------------------------------------
const stage = $("#stage");
stage.style.height = LEAD + "px";
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

// ---- the two simulations behind one interface --------------------------------------
type View = {
  key: string;
  painted: boolean;
  layer: number;
  scale: number;
  y: number;
  vis: number;
  shade: number;
};
interface Sim {
  cur: number;
  press(dir: 1 | -1): boolean;
  step(ms: number): void;
  views(): View[];
  busy(): boolean;
  jump(n: number): void;
  setHeights(heights: number[]): void;
  keyDown?(dir: 1 | -1): void;
  keyUp?(): void;
  lam?(): number;
  setCfg?(c: Record<string, unknown>): void;
}
let onMove: (cur: number, dir: 1 | -1) => void = () => {};

/** Settings the sliders edit, as overrides on the chosen preset. `fold`/`ramp` are "1"/"0"; `tk` is the tempo kind. */
function drumCfg() {
  const base = Drum.config(PRESETS[opt.preset]);
  const num = (k: string, d: number) =>
    opt[k] !== undefined && opt[k] !== "" && !Number.isNaN(Number(opt[k]))
      ? Number(opt[k])
      : d;
  const flag = (k: string, d: boolean) =>
    opt[k] === "1" ? true : opt[k] === "0" ? false : d;
  return Drum.config({
    ...base,
    omega0: TAU * num("w0", base.omega0 / TAU),
    omega1: TAU * num("w1", base.omega1 / TAU),
    vcap: 60 * num("cap", base.vcap / 60),
    vcap1: 60 * num("cap1", base.vcap1 / 60),
    holdDelay: num("delay", base.holdDelay),
    dip0: num("dip", base.dip0),
    queue: num("queue", base.queue),
    gateSlack: num("slack", base.gateSlack),
    fold: flag("fold", base.fold),
    ramp: flag("ramp", base.ramp),
    H0: num("h0", base.H0),
    foldOmega: TAU * num("wfold", base.foldOmega / TAU),
    tempo: {
      kind: opt.tk ?? base.tempo.kind,
      window: num("tw", base.tempo.window),
      scale: num("ts", base.tempo.scale),
      ms: num("tms", base.tempo.ms),
    },
  });
}

function drumSim(cur: number): Sim {
  const d = new Drum(heights, drumCfg());
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
      d.views().map((v: any) => ({ ...v, vis: (v.bottom - v.top) / v.scale })),
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
    setCfg: (c) => {
      Object.assign(d.cfg, c);
    },
  };
}

function productSim(cur: number): Sim {
  const keys = ALL.map((_, i) => "k" + i);
  const e = new StackEngine();
  e.setHeights(new Map(keys.map((k, i) => [k, heights[i]!])));
  let at = cur;
  const win = () => keys.slice(at, at + 4);
  e.sync(win(), undefined, true);
  return {
    get cur() {
      return at;
    },
    press(dir) {
      if ((dir > 0 && at >= N - 1) || (dir < 0 && at <= 0)) return false;
      const d = dir > 0 ? "forward" : "back";
      if (!e.accept(d)) return false;
      at += dir;
      e.sync(win(), d);
      onMove(at, dir);
      return true;
    },
    step: (ms) => e.step(ms / 1000),
    views: () => e.frame().cards,
    busy: () => e.frame().busy,
    jump(n) {
      at = n;
      e.sync(win(), undefined, true);
    },
    setHeights: (h) => e.setHeights(new Map(keys.map((k, i) => [k, h[i]!]))),
  };
}

let sim: Sim;
let paused = false,
  raf = 0,
  last = 0,
  simClock = 0;
const reduced = () =>
  opt.reduced === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const speed = () => Number(opt.speed) || 1;

function paint() {
  // The product engine holds only the pile and the cards still leaving it; every other card stays hidden.
  const held = new Set<number>();
  for (const v of sim.views()) {
    const i = Number(v.key.slice(1));
    held.add(i);
    const e = els[i]!;
    const st = e.el.style;
    st.visibility = !v.painted ? "hidden" : "";
    st.zIndex = String(v.layer);
    st.transform = `scale(${v.scale.toFixed(5)}) translateY(${v.y.toFixed(2)}px)`;
    const vis = Math.max(0, v.vis).toFixed(2) + "px";
    e.shadow.style.height = e.frame.style.height = e.shade.style.height = vis;
    const natural = heights[i]!;
    // Folded or tucked behind a shorter card: the content keeps its layout and is clipped at the drawn height.
    e.content.style.clipPath =
      v.vis < natural - 0.5
        ? `inset(0 0 ${(natural - v.vis).toFixed(2)}px 0 round 11.5px)`
        : "";
    e.shade.style.opacity = v.shade.toFixed(3);
    e.shadow.style.opacity = (1 - v.shade).toFixed(3);
  }
  els.forEach((e, i) => {
    if (!held.has(i)) e.el.style.visibility = "hidden";
  });
  const lam = document.querySelector("#lam");
  if (lam)
    lam.textContent =
      sim.lam && (drumCfg().fold || drumCfg().ramp)
        ? `held ${sim.lam().toFixed(2)}`
        : "";
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
    // No motion: the new front fades in over 160 ms.
    const n = sim.cur + dir;
    if (n < 0 || n >= N) return;
    sim.jump(n);
    showHead(n, true);
    els[n]!.el.animate?.([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
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
  sim = mode === "product" ? productSim(cur) : drumSim(cur);
  showHead(cur, false);
  paint();
  wake();
  bar();
}

// ---- controls ----------------------------------------------------------------------
/** Sliders over the drum's settings: key, label, min, max, step, and the value in the resolved config. */
const SLIDERS: [string, string, number, number, number, (c: any) => number][] =
  [
    ["w0", "spring Hz, tap", 1, 6, 0.1, (c) => c.omega0 / TAU],
    ["w1", "spring Hz, held", 1, 8, 0.1, (c) => c.omega1 / TAU],
    ["cap", "edge budget, tap px/frame", 8, 50, 1, (c) => c.vcap / 60],
    ["cap1", "edge budget, held px/frame", 8, 50, 1, (c) => c.vcap1 / 60],
    ["delay", "hold delay ms", 0, 800, 10, (c) => c.holdDelay],
    ["dip", "tap dip px", 0, 60, 2, (c) => c.dip0],
    ["slack", "gate slack", 0, 0.5, 0.05, (c) => c.gateSlack],
    ["queue", "queued presses", 0, 2, 1, (c) => c.queue],
    ["h0", "folded height px", 40, 200, 1, (c) => c.H0],
    ["wfold", "fold Hz", 0.3, 4, 0.1, (c) => c.foldOmega / TAU],
    ["tw", "tempo window", 1, 6, 1, (c) => c.tempo.window],
    ["ts", "tempo scale", 0.4, 1.4, 0.05, (c) => c.tempo.scale],
    ["tms", "constant interval ms", 100, 400, 5, (c) => c.tempo.ms],
  ];
const round = (v: number) => Math.round(v * 1000) / 1000;

function bar() {
  const group = (label: string, body: string) =>
    `<div class="grp"><span>${label}</span>${body}</div>`;
  const btn = (on: boolean, act: string, text: string, title = "") =>
    `<button class="${on ? "on" : ""}" data-act="${act}" title="${title}">${text}</button>`;
  $("#bar").innerHTML =
    group(
      "Model",
      MODES.map(([k, l, d]) => btn(opt.v === k, "v:" + k, l, d)).join(""),
    ) +
    (opt.v === "drum"
      ? group(
          "Preset",
          PRESET_NAMES.map((p) =>
            btn(opt.preset === p, "p:" + p, p, PRESET_NOTES[p] ?? ""),
          ).join(""),
        )
      : "") +
    group(
      "Speed",
      [
        ["0.25", "¼×"],
        ["0.5", "½×"],
        ["1", "1×"],
      ]
        .map(([v, l]) => btn(opt.speed === v, "s:" + v, l!))
        .join(""),
    ) +
    group(
      "Clock",
      btn(paused, "pause", paused ? "Paused" : "Pause") +
        `<button data-act="step">Step ⅟₆₀ s</button>`,
    ) +
    group("", btn(opt.reduced === "1", "reduced", "Reduced motion")) +
    `<span id="lam" class="lam"></span>`;
  sbar();
  const m = MODES.find((m) => m[0] === opt.v)!;
  const note =
    opt.v === "drum"
      ? `${m[2]} <b>${opt.preset}.</b> ${PRESET_NOTES[opt.preset] ?? ""}`
      : m[2];
  $("#note").innerHTML =
    `<b>${m[1]}.</b> ${note} <span class="hint">Hold ↑ or ↓ (or J/K), with the OS key repeat.</span>`;
  location.hash = new URLSearchParams(opt).toString();
}

function sbar() {
  const el = $("#sbar");
  if (opt.v !== "drum") {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  const c = drumCfg();
  const slider = ([k, l, min, max, step, get]: (typeof SLIDERS)[number]) =>
    `<label>${l} <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${round(get(c))}"><output>${round(get(c))}</output></label>`;
  const toggle = (k: string, l: string, on: boolean) =>
    `<label><input type="checkbox" data-k="${k}" ${on ? "checked" : ""}> ${l}</label>`;
  el.innerHTML =
    toggle("fold", "fold while held", c.fold) +
    toggle("ramp", "held speed-up", c.ramp) +
    `<label>tempo <select data-k="tk">${["none", "constant", "lookahead"].map((t) => `<option ${c.tempo.kind === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>` +
    SLIDERS.map(slider).join("");
}
const SETTING_KEYS = new Set(SLIDERS.map((s) => s[0]));
$("#sbar").addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const k = t.dataset.k;
  if (!k) return;
  if (t instanceof HTMLInputElement && t.type === "checkbox")
    opt[k] = t.checked ? "1" : "0";
  else {
    opt[k] = t.value;
    const out = t.nextElementSibling as HTMLElement | null;
    if (out?.tagName === "OUTPUT") out.textContent = t.value;
  }
  sim.setCfg?.(drumCfg());
  location.hash = new URLSearchParams(opt).toString();
});
$("#bar").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  const [k, v] = (b.dataset.act ?? "").split(":");
  if (k === "v") build(v as Mode);
  if (k === "p") {
    for (const key of [...SETTING_KEYS, "fold", "ramp", "tk"]) delete opt[key];
    opt.preset = v!;
    build("drum");
  }
  if (k === "s") {
    opt.speed = v!;
    bar();
  }
  if (k === "pause") {
    paused = !paused;
    if (paused) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
    bar();
  }
  if (k === "step") {
    paused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    advance(1000 / 60);
    bar();
  }
  if (k === "reduced") {
    opt.reduced = opt.reduced === "1" ? "0" : "1";
    sim.jump(sim.cur);
    paint();
    bar();
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
  if (reduced()) {
    if (!e.repeat) press(d);
    return;
  }
  if (opt.v === "drum") {
    if (!e.repeat || held !== d) {
      held = d;
      sim.keyDown!(d);
    } else sim.press(d);
    paint();
    wake();
    return;
  }
  press(d);
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
  const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const was = opt.v;
  Object.assign(opt, h, { v: was });
  if (h.v && h.v !== was && MODES.some((m) => m[0] === h.v)) build(h.v as Mode);
  else sim.setCfg?.(drumCfg());
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
    bar();
  },
  resume() {
    paused = false;
    wake();
    bar();
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
