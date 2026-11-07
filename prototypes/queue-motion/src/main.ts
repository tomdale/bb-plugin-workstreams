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
    views: () =>
      m.views().map((v) => ({
        ...v,
        vis:
          v.group === 0 && v.bottom >= v.natBottom - 1e-6
            ? v.h
            : (v.bottom - v.top) / v.scale,
      })),
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
    views: () => e.frame().cards,
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
const reduced = () =>
  opt.reduced === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const speed = () => Number(opt.speed) || 1;

/** The held readout is on while the model has a held state to report: the drum's speed-up or fold, the cascade's ramp. */
const showsHeld = () =>
  !!sim.lam &&
  (opt.v === "drum" ? cfg.fold || cfg.ramp : opt.v === "cascade" && ccfg.ramp);

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
    group("", button("reduced", "reduced", labelOf("reduced"))) +
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
