/**
 * Loads the built page in Chrome and checks what the sims cannot: that cards are drawn when the page loads, also
 * when it loads hidden and is shown later (a background tab, a closed pane), that the controls drive the page,
 * and that every control has a tooltip that opens, reads right, stays on screen, and goes away when it should.
 *
 *   npm run build && npm run smoke
 *   npm run smoke -- help keyboard      # only the named sections (names: SECTIONS, below)
 *
 * The tooltip checks use the page's hooks: `window.__help` lists every control the page can draw and every
 * tooltip entry, and `[data-help]` marks each control on screen. A section that visits every control prints one
 * line when it passes and one line per failure; the exit code is 1 when anything fails. Set
 * `QUEUE_MOTION_PAGE` (capture/lib.mjs) to run against a copy of the build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PAGE,
  ROOT,
  TIP_MARGIN,
  control,
  describedBy,
  edgeGaps,
  hoverTip,
  launch,
  load,
  overlaps,
  park,
  readTip,
  rectOf,
  tipCloses,
  visibleControls,
} from "./lib.mjs";

// ---- assertions -------------------------------------------------------------------------------------------

let passed = 0;
let quiet = false;
const failures = [];
const expect = (ok, what) => {
  if (ok) passed++;
  else failures.push(what);
  if (!ok || !quiet) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
/**
 * Runs a section that makes too many assertions to list one by one: each failure prints as it happens, and a
 * section with none prints one line. `run` may return a short description of what it visited.
 */
async function bulk(title, run) {
  const failed = failures.length;
  const before = passed;
  quiet = true;
  let visited;
  try {
    visited = await run();
  } finally {
    quiet = false;
  }
  if (failures.length === failed)
    console.log(
      `ok   ${title}${visited ? ` (${visited})` : ""}: ${passed - before} checks`,
    );
}

const errors = [];
/** Records a page's script errors and console errors; the returned list holds this page's own. */
const watch = (page, label) => {
  const own = [];
  const note = (text) => {
    own.push(text);
    errors.push(`${label}: ${text}`);
  };
  page.on("pageerror", (e) => note(e.message));
  page.on("console", (m) => m.type() === "error" && note(m.text()));
  return own;
};
const SIZE = { width: 1100, height: 900 };
async function withPage(browser, label, run, viewport = SIZE) {
  const page = await browser.newPage({ viewport });
  const own = watch(page, label);
  try {
    await run(page, own);
  } finally {
    await page.close();
  }
}

// ---- the states the tooltip checks visit ------------------------------------------------------------------

/** Between them these states draw every control the page can: see the coverage check. */
const NATURAL = { name: "natural", hash: "#v=drum&preset=natural" };
const EVEN_HELD = {
  name: "even + held speed",
  hash: "#v=drum&preset=even%20%2B%20held%20speed", // lookahead tempo and the held speed-up
};
const FOLD = {
  name: "fold + constant",
  hash: "#v=drum&preset=fold&tk=constant",
};
const PRODUCT = { name: "product", hash: "#v=product" };
const CASCADE = { name: "cascade", hash: "#v=cascade" };
/** The drum with `Bezier path` on, which shows what the overlay draws. */
const PATH = { name: "path", hash: "#v=drum&preset=natural&path=1" };
/** The drum under reduced motion, which shows the reduced fade. */
const REDUCED = { name: "reduced", hash: "#v=drum&preset=natural&reduced=1" };
const STATES = [NATURAL, EVEN_HELD, FOLD, PRODUCT, CASCADE, PATH, REDUCED];

/** The tooltip rows a control's kind promises, besides the closing `Works with` and `Tune`. */
const KIND_ROWS = {
  slider: ["Raise", "Lower"],
  toggle: ["On", "Off"],
  preset: ["Feels", "Measured", "Good for"],
};
const BROKEN_FIGURE = /undefined|NaN|\[object|\$\{|\{\{/;
/** Sub-pixel slack: the page positions with rounded sizes, so a tooltip can sit up to 0.5 px inside its margin. */
const SLACK = 1;

const firstLine = (e) => String(e.message).split("\n")[0];
/** Why a hover failed: Playwright names the element that intercepts the pointer. */
const reason = (e) =>
  String(e.message)
    .split("\n")
    .find((l) => /intercepts/.test(l))
    ?.trim() ?? firstLine(e);
const box = (b) =>
  `${Math.round(b.left)},${Math.round(b.top)} to ${Math.round(b.right)},${Math.round(b.bottom)}`;

/**
 * Hovers one control and checks the tooltip that opens: its words, its place, and that it closes again.
 * Returns the tooltip, or null when none opened.
 */
async function checkTooltip(page, where, c, spec) {
  const name = `${where}: ${c.name}`;
  const loc = control(page, c.i);
  let tip;
  try {
    tip = await hoverTip(page, loc, { reach: 1500 });
  } catch (e) {
    expect(false, `${name}: the pointer reaches the control (${reason(e)})`);
    return null;
  }
  expect(tip !== null, `${name}: hovering opens its tooltip`);
  if (!tip) return null;
  expect(
    tip.label === spec.label,
    `${name}: tooltip heading reads "${spec.label}" (got "${tip.label}")`,
  );
  expect(tip.what, `${name}: tooltip has its what line`);
  const kindRows = KIND_ROWS[spec.kind] ?? [];
  const lacks = kindRows.filter((r) => !tip.rows.includes(r));
  expect(
    lacks.length === 0,
    `${name}: a ${spec.kind} tooltip has ${kindRows.join(", ") || "its rows"} (rows: ${tip.rows.join(", ")})`,
  );
  expect(
    tip.rows.slice(-2).join("|") === "Works with|Tune",
    `${name}: tooltip rows end with Works with, Tune (rows: ${tip.rows.join(", ")})`,
  );
  expect(
    !BROKEN_FIGURE.test(tip.text),
    `${name}: tooltip text holds no broken figure`,
  );
  const gaps = edgeGaps(tip.box, tip.view);
  expect(
    Math.min(...Object.values(gaps)) >= TIP_MARGIN - SLACK,
    `${name}: tooltip keeps ${TIP_MARGIN} px from every viewport edge (gaps ${JSON.stringify(gaps)})`,
  );
  const at = await rectOf(loc);
  expect(
    !overlaps(tip.box, at),
    `${name}: tooltip stays clear of its control (tooltip ${box(tip.box)}, control ${box(at)})`,
  );
  expect(
    (await describedBy(loc)) === "tip",
    `${name}: aria-describedby points at the open tooltip`,
  );
  await park(page);
  const closed = await tipCloses(page);
  expect(closed, `${name}: tooltip closes when the pointer leaves`);
  if (!closed) await page.keyboard.press("Escape");
  expect(
    (await describedBy(loc)) === null,
    `${name}: aria-describedby is removed when it closes`,
  );
  return tip;
}

// ---- cards drawn, and the controls that drive the page ----------------------------------------------------

/** The cards the page shows: not hidden, and how many of them the engine says are painted. */
const cardsOn = (frame) =>
  frame.evaluate(() => ({
    visible: [...document.querySelectorAll(".card")].filter(
      (c) => getComputedStyle(c).visibility !== "hidden",
    ).length,
    painted: window.__sim.views().filter((v) => v.painted).length,
    tall: window.__sim.heights().filter((h) => h > 0).length,
  }));

async function cardsAreDrawn(browser, scratch) {
  for (const mode of ["drum", "product", "cascade"]) {
    // Loaded visible.
    await withPage(browser, `${mode} visible`, async (page) => {
      await page.goto(`${PAGE}#v=${mode}`);
      await page.waitForTimeout(400);
      const s = await cardsOn(page);
      expect(
        s.painted === 3 && s.visible === 3,
        `${mode}: three cards drawn when the page loads (${JSON.stringify(s)})`,
      );
    });

    // Loaded hidden, then shown.
    await withPage(browser, `${mode} hidden`, async (page) => {
      const wrapper = `${scratch}/hidden-${mode}.html`;
      fs.writeFileSync(
        wrapper,
        `<body style="margin:0"><iframe id=f src="${PAGE}#v=${mode}" style="display:none;width:1100px;height:900px;border:0"></iframe>`,
      );
      await page.goto("file://" + wrapper);
      await page.waitForTimeout(500);
      await page.evaluate(
        () => (document.getElementById("f").style.display = "block"),
      );
      await page.waitForTimeout(600);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      const s = await cardsOn(frame);
      expect(
        s.painted === 3 && s.visible === 3,
        `${mode}: three cards drawn after a hidden page is shown (${JSON.stringify(s)})`,
      );
    });
  }
}

/** The label under a data-key is hidden, as the page hides a setting that changes nothing. */
const settingHidden = (page, key) =>
  page.$eval(`[data-key="${key}"]`, (el) => el.hidden);

async function controlsDriveThePage(browser) {
  await withPage(browser, "controls", async (page) => {
    await page.goto(`${PAGE}#v=drum`);
    await page.waitForTimeout(400);

    // A preset, a held key, a slider, a select, and the model switch.
    await page.click('button[data-act="p:fold"]');
    expect(
      await page.$eval('input[data-k="fold"]', (e) => e.checked),
      "the fold preset turns the fold toggle on",
    );
    expect(
      await settingHidden(page, "ramp"),
      "the fold preset hides the held speed-up toggle, which fold includes",
    );
    expect(
      await page.$eval('button[data-act="p:fold"]', (b) =>
        b.classList.contains("on"),
      ),
      "the fold preset button is marked on",
    );
    await page.keyboard.down("ArrowDown");
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(33);
      await page.keyboard.down("ArrowDown");
    }
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(1000);
    const front = await page.evaluate(() => window.__sim.cur());
    expect(front >= 5, `a held ↓ advances the front (front ${front})`);
    await page.$eval('input[data-k="cap"]', (e) => {
      e.value = "20";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.selectOption('select[data-k="tk"]', "constant");
    const hash = await page.evaluate(() => location.hash);
    expect(
      hash.includes("cap=20") && hash.includes("tk=constant"),
      `settings land in the URL hash (${hash})`,
    );
    await page.click('button[data-act="v:product"]');
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => window.__sim.cur());
    expect(back === front - 1, `product mode answers ↑ (front ${back})`);

    // The other buttons: speed, pause, step and reduced motion.
    await page.click('button[data-act="v:drum"]');
    await page.click('button[data-act="s:0.5"]');
    expect(
      (await page.evaluate(() => location.hash)).includes("speed=0.5") &&
        (await page.$eval('button[data-act="s:0.5"]', (b) =>
          b.classList.contains("on"),
        )),
      "the ½× button sets the speed in the URL hash and is marked on",
    );
    await page.click('button[data-act="pause"]');
    const paused = await page.$eval('button[data-act="pause"]', (b) => ({
      text: b.textContent,
      pressed: b.getAttribute("aria-pressed"),
    }));
    expect(
      paused.text === "Paused" && paused.pressed === "true",
      `Pause reads Paused and is pressed (${JSON.stringify(paused)})`,
    );
    const t0 = await page.evaluate(() => window.__sim.clock());
    await page.click('button[data-act="step"]');
    const t1 = await page.evaluate(() => window.__sim.clock());
    expect(
      Math.abs(t1 - t0 - 1000 / 60) < 0.01,
      `Step advances the clock by one frame (${(t1 - t0).toFixed(2)} ms)`,
    );
    await page.click('button[data-act="reduced"]');
    expect(
      (await page.evaluate(() => location.hash)).includes("reduced=1") &&
        (await page.$eval('button[data-act="reduced"]', (b) =>
          b.getAttribute("aria-pressed"),
        )) === "true",
      "Reduced motion sets reduced=1 in the URL hash and is pressed",
    );
    await page.click('button[data-act="reduced"]');
    await page.click('button[data-act="path"]');
    await page.keyboard.press("ArrowDown");
    await page.click('button[data-act="step"]');
    const bezier = await page.evaluate(() => {
      const svg = document.getElementById("bezier");
      const frontD =
        svg.querySelector('[data-curve="front"]')?.getAttribute("d") ?? "";
      const behindD =
        svg.querySelector('[data-curve="behind"]')?.getAttribute("d") ?? "";
      const mover = window.__sim
        .views()
        .find((v) => v.role === "out" && v.painted);
      return {
        hash: location.hash.includes("path=1"),
        pressed:
          document
            .querySelector('button[data-act="path"]')
            ?.getAttribute("aria-pressed") === "true",
        visible:
          !svg.hasAttribute("hidden") &&
          getComputedStyle(svg).display !== "none" &&
          svg.getBoundingClientRect().width > 0,
        cubic: frontD.includes(" C ") && behindD.includes(" C "),
        movedX: mover ? Math.abs(mover.x) > 0.1 : false,
      };
    });
    expect(
      bezier.hash &&
        bezier.pressed &&
        bezier.visible &&
        bezier.cubic &&
        bezier.movedX,
      `Bezier path toggle draws the ring as cubic Bezier segments and sways outgoing cards along it (${JSON.stringify(bezier)})`,
    );
    await page.click('button[data-act="path"]');

    // The path sliders move cards sideways only: zero sway keeps a leaving card on the column, a negative one
    // swings it left, and its top edge is where it would be at the default.
    const tops = {};
    for (const sway of ["0", "-40", "24"]) {
      await load(page, `#v=drum&preset=natural&sway=${sway}`);
      await page.evaluate(() => {
        window.__sim.pause();
        window.__sim.jump(2);
        window.__sim.press(1);
      });
      for (let f = 0; f < 6; f++)
        await page.evaluate(() => window.__sim.advance(1000 / 60));
      tops[sway] = await page.evaluate(() => {
        const v = window.__sim
          .views()
          .find((v) => v.role === "out" && v.painted);
        return v ? { x: v.x, top: v.top } : null;
      });
    }
    expect(
      tops["0"] &&
        tops["-40"] &&
        tops["24"] &&
        Math.abs(tops["0"].x) < 1e-6 &&
        tops["-40"].x < -1 &&
        tops["24"].x > 1 &&
        tops["0"].top === tops["24"].top &&
        tops["-40"].top === tops["24"].top,
      `sway in front px moves a leaving card sideways and leaves its top edge alone (${JSON.stringify(tops)})`,
    );

    // The bank turns a swaying card about its top centre, and the column crossing moves the path without
    // touching the card's top edge.
    const shapes = {};
    for (const [name, extra] of [
      ["plain", ""],
      ["bank", "&bank=6"],
      ["cross", "&cross=-0.3&peakb=0.3"],
    ]) {
      await load(page, `#v=drum&preset=natural${extra}`);
      await page.evaluate(() => {
        window.__sim.pause();
        window.__sim.jump(2);
        window.__sim.press(1);
      });
      for (let f = 0; f < 10; f++)
        await page.evaluate(() => window.__sim.advance(1000 / 60));
      shapes[name] = await page.evaluate(() => {
        const v = window.__sim
          .views()
          .find((v) => v.role === "out" && v.painted);
        const el = document.querySelectorAll(".card")[Number(v.key.slice(1))];
        return { x: v.x, top: v.top, transform: el.style.transform };
      });
    }
    expect(
      !shapes.plain.transform.includes("rotate") &&
        /rotate\(-[\d.]+deg\)/.test(shapes.bank.transform) &&
        shapes.bank.top === shapes.plain.top &&
        shapes.cross.top === shapes.plain.top &&
        Math.abs(shapes.cross.x - shapes.plain.x) > 0.5,
      `bank deg turns a swaying card and column crossing reshapes the path, neither moving its top edge (${JSON.stringify(shapes)})`,
    );
  });
}

// ---- tooltips: every control has one, it reads right, and it stays on screen -------------------------------

async function helpMatchesControls(browser) {
  await withPage(browser, "help", async (page) => {
    await load(page, NATURAL.hash);
    const { controls, entries } = await page.evaluate(() => window.__help);
    const ids = controls.map((c) => c.id);
    const byId = Object.fromEntries(controls.map((c) => [c.id, c]));

    // (a) The controls and the tooltip entries are the same set.
    const noEntry = ids.filter((id) => !entries.includes(id));
    const noControl = entries.filter((id) => !ids.includes(id));
    const twice = ids.filter((id, n) => ids.indexOf(id) !== n);
    expect(
      !noEntry.length && !noControl.length && !twice.length,
      `controls vs tooltips: ${ids.length} controls and ${entries.length} entries match` +
        (noEntry.length
          ? `; controls with no entry: ${noEntry.join(", ")}`
          : "") +
        (noControl.length
          ? `; entries with no control: ${noControl.join(", ")}`
          : "") +
        (twice.length ? `; ids listed twice: ${twice.join(", ")}` : ""),
    );

    // (b) The real DOM draws every one of them, across the states, and nothing else carries data-help.
    const rendered = new Set();
    for (const state of STATES) {
      await load(page, state.hash);
      for (const c of await visibleControls(page)) rendered.add(c.id);
    }
    const never = ids.filter((id) => !rendered.has(id));
    const unknown = [...rendered].filter((id) => !ids.includes(id));
    expect(
      !never.length && !unknown.length,
      `coverage: ${STATES.length} states draw all ${ids.length} controls` +
        (never.length ? `; never rendered: ${never.join(", ")}` : "") +
        (unknown.length
          ? `; rendered but not in __help.controls: ${unknown.join(", ")}`
          : ""),
    );

    // (c) Hover every visible control in every state.
    let pointerEvents;
    for (const state of STATES) {
      await load(page, state.hash);
      const on = await visibleControls(page);
      await bulk(
        `hover ${SIZE.width}x${SIZE.height} ${state.name}`,
        async () => {
          for (const c of on) {
            const tip = await checkTooltip(page, state.name, c, byId[c.id]);
            pointerEvents ??= tip?.pointerEvents;
          }
          return `${on.length} controls`;
        },
      );
    }
    expect(
      pointerEvents === "none",
      `the tooltip takes no pointer events (pointer-events: ${pointerEvents})`,
    );
  });
}

/**
 * Timing, from timestamps taken in the page so that Chrome and Playwright latency does not count: a hover on a
 * quiet page opens the tooltip after a pause of about 250 ms; one that follows another tooltip, still open or
 * closed in the last 400 ms, opens at once.
 */
async function hoverTiming(browser) {
  await withPage(browser, "timing", async (page) => {
    await load(page, NATURAL.hash);
    await page.evaluate(() => {
      const tip = document.getElementById("tip");
      const t = (window.__times = { over: null, open: null, close: null });
      document.addEventListener(
        "pointerover",
        (e) => {
          if (t.over === null && e.target.closest("[data-help]"))
            t.over = performance.now();
        },
        true,
      );
      new MutationObserver(() => {
        if (tip.hidden) t.close = performance.now();
        else t.open ??= performance.now();
      }).observe(tip, { attributes: true, attributeFilter: ["hidden"] });
    });
    const times = () => page.evaluate(() => window.__times);
    const reset = () =>
      page.evaluate(() =>
        Object.assign(window.__times, { over: null, open: null }),
      );
    const [product, drum, natural] = [
      "model.product",
      "model.drum",
      "preset.natural",
    ].map((id) => page.locator(`[data-help="${id}"]`));

    await hoverTip(page, product);
    let t = await times();
    expect(
      t.open - t.over >= 200 && t.open - t.over < 600,
      `a hover on a quiet page opens the tooltip after about 250 ms (${(t.open - t.over).toFixed(0)} ms)`,
    );

    await reset();
    await hoverTip(page, drum);
    t = await times();
    expect(
      t.open - t.over < 100,
      `moving from one control to the next opens the tooltip at once (${(t.open - t.over).toFixed(0)} ms)`,
    );

    await park(page);
    await tipCloses(page);
    await reset();
    await hoverTip(page, natural);
    t = await times();
    expect(
      t.close !== null && (t.over - t.close > 350 || t.open - t.over < 100),
      `a hover just after a tooltip closed opens it at once (${(t.over - t.close).toFixed(0)} ms after the close, ${(t.open - t.over).toFixed(0)} ms to open)`,
    );
  });
}

// ---- keyboard focus ----------------------------------------------------------------------------------------

async function keyboardShowsTips(browser) {
  await withPage(browser, "keyboard", async (page) => {
    await load(page, FOLD.hash); // fold shows the held readout
    const controls = await page.evaluate(() => window.__help.controls);
    const labelOf = (id) => controls.find((c) => c.id === id).label;
    // The interactive element of one control of each kind.
    const targets = [
      ["model.drum", 'button[data-help="model.drum"]'],
      ["preset.even", 'button[data-help="preset.even"]'],
      ["setting.cap", 'input[data-k="cap"]'],
      ["setting.fold", 'input[data-k="fold"]'],
      ["setting.tk", 'select[data-k="tk"]'],
      ["reduced", 'button[data-help="reduced"]'],
      ["about", 'summary[data-help="about"]'],
      ["held", "#lam"],
    ];
    const state = (sel) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const tip = document.getElementById("tip");
        return {
          focused: document.activeElement === el,
          open: !tip.hidden,
          label: tip.querySelector(".tip-head b")?.textContent ?? null,
          described: el.getAttribute("aria-describedby"),
        };
      }, sel);
    for (const [id, sel] of targets) {
      const name = `keyboard ${id}`;
      // Focus and the state it leaves are read in one turn, which is what "at once" means.
      const at = await page.evaluate((sel) => {
        document.querySelector(sel).focus();
        const tip = document.getElementById("tip");
        return {
          open: !tip.hidden,
          label: tip.querySelector(".tip-head b")?.textContent ?? null,
        };
      }, sel);
      const focus = await state(sel);
      expect(
        focus.focused && at.open && at.label === labelOf(id),
        `${name}: focusing it shows its tooltip at once, headed "${labelOf(id)}" (${JSON.stringify(at)})`,
      );
      expect(
        focus.described === "tip",
        `${name}: aria-describedby points at the tooltip while it shows`,
      );
      await page.keyboard.press("Escape");
      let now = await state(sel);
      expect(
        !now.open && now.described === null && now.focused,
        `${name}: Escape hides the tooltip and keeps the focus`,
      );
      await page.waitForTimeout(450);
      expect(
        !(await state(sel)).open,
        `${name}: it stays hidden while the focus stays on the control`,
      );
      await page.evaluate((sel) => {
        document.querySelector(sel).blur();
        document.querySelector(sel).focus();
      }, sel);
      now = await state(sel);
      expect(
        now.open && now.label === labelOf(id),
        `${name}: it opens again once the focus has left and returned`,
      );
      await page.evaluate((sel) => document.querySelector(sel).blur(), sel);
      expect(await tipCloses(page), `${name}: it closes when the focus leaves`);
    }

    // Tab walks the controls in page order, and each stop shows its tooltip. The Model module's heading comes
    // first: it is focusable, so the keyboard can fold the module, and carries no tooltip.
    await load(page, NATURAL.hash);
    await page.focus('[data-module="model"] > summary');
    const stops = [];
    for (const key of ["Tab", "Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      stops.push((await readTip(page))?.label ?? null);
    }
    expect(
      stops.join("|") === "Product now|Elastic drum|Product now",
      `Tab and Shift+Tab step from the Model heading through the first controls, each with its tooltip (${stops.join(" | ")})`,
    );
  });
}

// ---- dismissal ---------------------------------------------------------------------------------------------

async function dismissal(browser) {
  await withPage(browser, "dismissal", async (page) => {
    await load(page, NATURAL.hash);
    // The 1× button: pressing it changes nothing but the pressed state.
    const speed = page.locator('button[data-act="s:1"]');
    const isHidden = () =>
      page.evaluate(() => document.getElementById("tip").hidden);

    const shown = await hoverTip(page, speed);
    expect(shown !== null, "a tooltip is showing before the mouse press");
    await page.mouse.down();
    expect(
      await isHidden(),
      "pressing the mouse on a control hides its tooltip",
    );
    await page.mouse.up();
    await page.waitForTimeout(450);
    expect(
      await isHidden(),
      "after the click the tooltip stays hidden while the pointer rests on the control",
    );
    await park(page);
    await tipCloses(page);
    const again = await hoverTip(page, speed);
    expect(
      again?.label === "Speed",
      "the tooltip opens again once the pointer has left and re-entered",
    );

    // A card key closes it, whatever the key, and keeps it closed until the pointer leaves.
    for (const key of ["ArrowDown", "ArrowUp", "j", "k"]) {
      await park(page);
      await tipCloses(page);
      const open = await hoverTip(page, speed);
      expect(open !== null, `${key}: a tooltip is showing before the key`);
      await page.keyboard.down(key);
      expect(await isHidden(), `${key} hides an open tooltip`);
      await page.keyboard.up(key);
      await page.waitForTimeout(450);
      expect(
        await isHidden(),
        `${key}: the tooltip stays hidden while the pointer rests on the control`,
      );
    }
  });
}

// ---- edges: tooltips near the viewport's sides, and taller than the room ------------------------------------

/**
 * The visible controls with their boxes and kinds, picked three ways: the one reaching furthest right, the
 * lowest one, and the slider lowest in the inspector.
 */
async function edgePicks(page, byId) {
  const on = await visibleControls(page);
  const boxes = await Promise.all(on.map((c) => rectOf(control(page, c.i))));
  const rows = on.map((c, n) => ({ ...c, at: boxes[n] }));
  const best = (list, key) => list.reduce((a, b) => (key(b) > key(a) ? b : a));
  const sliders = rows.filter((c) => byId[c.id].kind === "slider");
  return [
    ["rightmost", best(rows, (c) => c.at.right)],
    ["lowest", best(rows, (c) => c.at.bottom)],
    [
      "slider on the last row",
      best(sliders, (c) => c.at.top * 10000 + c.at.right),
    ],
  ];
}

async function edges(browser) {
  // The controls at the page's edges, in the two states with the fullest bars.
  for (const size of [SIZE, { width: 640, height: 480 }]) {
    await withPage(
      browser,
      `edges ${size.width}x${size.height}`,
      async (page) => {
        const controls = await load(page, NATURAL.hash).then(() =>
          page.evaluate(() => window.__help.controls),
        );
        const byId = Object.fromEntries(controls.map((c) => [c.id, c]));
        await bulk(`edges ${size.width}x${size.height}`, async () => {
          const done = [];
          for (const state of [EVEN_HELD, FOLD]) {
            await load(page, state.hash);
            for (const [why, c] of await edgePicks(page, byId)) {
              if (done.includes(`${state.name} ${c.name}`)) continue;
              done.push(`${state.name} ${c.name}`);
              await checkTooltip(
                page,
                `${size.width}x${size.height} ${state.name} (${why})`,
                c,
                byId[c.id],
              );
            }
          }
          return `${done.length} controls: ${done.join(", ")}`;
        });
      },
      size,
    );
  }

  // A viewport too short for any tooltip: every control, to find the tallest text.
  const tall = { width: 640, height: 300 };
  await withPage(
    browser,
    "tall tooltips",
    async (page) => {
      const controls = await load(page, NATURAL.hash).then(() =>
        page.evaluate(() => window.__help.controls),
      );
      const byId = Object.fromEntries(controls.map((c) => [c.id, c]));
      let longest = null;
      for (const state of STATES) {
        await load(page, state.hash);
        const on = await visibleControls(page);
        await bulk(`hover 640x300 ${state.name}`, async () => {
          for (const c of on) {
            const tip = await checkTooltip(
              page,
              `640x300 ${state.name}`,
              c,
              byId[c.id],
            );
            if (tip && tip.scrollHeight > (longest?.tip.scrollHeight ?? 0))
              longest = { state, c, tip };
          }
          return `${on.length} controls`;
        });
      }
      expect(longest !== null, "some tooltip opened at 640x300");
      if (!longest) return;
      const { state, c } = longest;
      const name = `${c.name} (${longest.tip.scrollHeight} px of text)`;
      await load(page, state.hash);
      const tip = await hoverTip(page, control(page, c.i));
      expect(
        tip.scrollHeight > tip.clientHeight + 2,
        `640x300: the longest tooltip, ${name}, is taller than its room and scrolls (${tip.scrollHeight} > ${tip.clientHeight})`,
      );
      expect(
        tip.overflowY === "auto",
        `640x300: ${name} scrolls with overflow-y auto (got ${tip.overflowY})`,
      );
      expect(
        Math.min(...Object.values(edgeGaps(tip.box, tip.view))) >=
          TIP_MARGIN - SLACK,
        `640x300: ${name} stays inside the viewport (${box(tip.box)})`,
      );
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(100);
      const top = await page.evaluate(
        () => document.getElementById("tip").scrollTop,
      );
      expect(
        top > 0,
        `640x300: the wheel over the control scrolls the tooltip (scrollTop ${top})`,
      );
    },
    tall,
  );
}

// ---- which settings the inspector shows --------------------------------------------------------------------

/** `shown` in src/controls.ts, per setting key, for a tempo kind and the held speed-up, fold and loose toggles. */
const SHOWN = {
  w0: () => true,
  cap: () => true,
  cover: () => true,
  fadein: () => true,
  tk: () => true,
  fold: () => true,
  loose: (s) => !s.fold,
  tw: (s) => s.tk === "lookahead",
  ts: (s) => s.tk === "lookahead",
  tms: (s) => s.tk === "constant",
  slack: (s) => s.tk === "none",
  tuck: () => true,
  hide: () => true,
  wrise: () => true,
  wclear: () => true,
  ta: (s) => s.tk === "lookahead",
  tb: (s) => s.tk === "lookahead",
  ramp: (s) => !s.fold && !s.loose,
  delay: (s) => s.fold || s.ramp || s.loose,
  w1: (s) => s.fold || s.ramp || s.loose,
  cap1: (s) => s.fold || s.ramp || s.loose,
  h0: (s) => s.fold || s.loose,
};

/** The same for the cascade, whose only condition is the ramp. */
const CASCADE_SHOWN = {
  cw0: () => true,
  ccap: () => true,
  sp0: (s) => s.ramp,
  sp1: () => true,
  cdelay: (s) => s.ramp,
  cw1: (s) => s.ramp,
  ccap1: (s) => s.ramp,
  park: () => true,
  fade: () => true,
  shade: () => true,
};

/**
 * The path's settings, which every model shows while the path shows on screen: while cards sway (reduced motion
 * off) or `Bezier path` draws it. The leg behind the pile and the column crossing are the drum's and the
 * product's, and the bank turns only moving cards, so reduced motion hides it. With the default sway on.
 */
const PATH_SHOWN = {
  sway: () => true,
  swayb: (mode) => mode !== "cascade",
  peak: () => true,
  peakb: (mode) => mode !== "cascade",
  cross: (mode) => mode !== "cascade",
  bank: (mode, reduced) => !reduced,
};
const pathKeys = (mode, { reduced = false, overlay = false } = {}) =>
  reduced && !overlay
    ? []
    : Object.keys(PATH_SHOWN).filter((k) => PATH_SHOWN[k](mode, reduced));

/** The page's own settings: the playback fades, and what `Bezier path` draws while it is on. */
const VIEW_SHOWN = {
  rfade: (s) => s.reduced,
  hfade: (s) => !s.reduced,
  handles: (s) => s.overlay,
  knots: (s) => s.overlay && s.handles,
  inner: (s) => s.overlay,
  arrows: (s) => s.overlay,
  labels: (s) => s.overlay,
  spine: (s) => s.overlay,
  dots: (s) => s.overlay,
};
/** What the overlay draws: shown only while `Bezier path` is on. */
const OVERLAY_KEYS = Object.keys(VIEW_SHOWN).filter(
  (k) => !["rfade", "hfade"].includes(k),
);
const viewKeys = ({ reduced = false, overlay = false, handles = true } = {}) =>
  Object.keys(VIEW_SHOWN).filter((k) =>
    VIEW_SHOWN[k]({ reduced, overlay, handles }),
  );

/** The setting keys the inspector draws now. */
const shownKeys = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#inspector [data-key]")]
      .filter(
        (el) =>
          !el.closest("[hidden]") &&
          !el.closest("details:not([open]) > :not(summary)") &&
          el.getClientRects().length > 0,
      )
      .map((el) => el.dataset.key),
  );
const sameSet = (a, b) =>
  a.length === b.length && a.every((k) => b.includes(k));

async function settingsVisibility(browser) {
  await withPage(browser, "settings", async (page) => {
    const only = async (keys, shown, what) => {
      const now = await shownKeys(page);
      const wrong = keys.filter((k) => now.includes(k) !== shown);
      expect(
        wrong.length === 0,
        `${what}: ${keys.join(", ")} ${shown ? "shown" : "hidden"}${wrong.length ? ` (but ${wrong.join(", ")} ${shown ? "hidden" : "shown"})` : ""}`,
      );
    };

    await load(page, NATURAL.hash);
    await only(["tw", "ts"], false, "natural: tempo window and scale");
    await only(["tms"], false, "natural: constant interval");
    await only(
      ["delay", "w1", "cap1", "h0"],
      false,
      "natural: the held settings and folded height",
    );
    await only(["slack"], true, "natural: gate slack");
    await only(["ramp"], true, "natural: the held speed-up toggle");
    await only(
      ["w0", "cap", "tk", "fold"],
      true,
      "natural: the always-on settings",
    );

    await page.selectOption('select[data-k="tk"]', "lookahead");
    await only(["tw", "ts"], true, "tempo lookahead: tempo window and scale");
    await only(
      ["slack", "tms"],
      false,
      "tempo lookahead: gate slack and constant interval",
    );
    await page.selectOption('select[data-k="tk"]', "constant");
    await only(["tms"], true, "tempo constant: constant interval");
    await only(
      ["tw", "ts", "slack"],
      false,
      "tempo constant: window, scale and gate slack",
    );
    await page.selectOption('select[data-k="tk"]', "none");
    await only(["slack"], true, "tempo none: gate slack again");

    await page.check('input[data-k="fold"]');
    await only(["ramp"], false, "fold on: the held speed-up toggle");
    await only(
      ["delay", "w1", "cap1", "h0"],
      true,
      "fold on: the held settings and folded height",
    );
    await page.uncheck('input[data-k="fold"]');
    await only(["ramp"], true, "fold off: the held speed-up toggle returns");
    await only(
      ["delay", "w1", "cap1", "h0"],
      false,
      "fold off: the held settings and folded height",
    );

    // Every combination of tempo, held speed-up, fold and loose clearing, driven through the controls. Loose
    // clearing hides while fold is on, so the two are never on together.
    const wrong = [];
    let states = 0;
    for (const tk of ["none", "constant", "lookahead"])
      for (const ramp of [false, true])
        for (const [fold, loose] of [
          [false, false],
          [true, false],
          [false, true],
        ]) {
          states++;
          await page.setChecked('input[data-k="fold"]', false);
          await page.setChecked('input[data-k="loose"]', false);
          await page.setChecked('input[data-k="ramp"]', ramp);
          await page.selectOption('select[data-k="tk"]', tk);
          await page.setChecked('input[data-k="fold"]', fold);
          if (loose) await page.setChecked('input[data-k="loose"]', true);
          const want = Object.keys(SHOWN).filter((k) =>
            SHOWN[k]({ tk, ramp, fold, loose }),
          );
          const now = (await shownKeys(page)).filter((k) => k in SHOWN);
          const off = want.filter((k) => !now.includes(k));
          const extra = now.filter((k) => !want.includes(k));
          if (off.length || extra.length)
            wrong.push(
              `tempo ${tk}, ramp ${ramp}, fold ${fold}, loose ${loose}: ${[off.length && `missing ${off}`, extra.length && `extra ${extra}`].filter(Boolean).join(", ")}`,
            );
        }
    expect(
      wrong.length === 0,
      `the inspector shows what src/controls.ts says in all ${states} tempo, ramp, fold and loose states${wrong.length ? `: ${wrong.join("; ")}` : ""}`,
    );

    // A preset button clears every override.
    await load(page, NATURAL.hash);
    const dflt = await page.$eval('input[data-k="cap"]', (e) => e.value);
    await page.$eval('input[data-k="cap"]', (e) => {
      e.value = "20";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.selectOption('select[data-k="tk"]', "constant");
    await page.check('input[data-k="fold"]');
    await page.click('button[data-act="path"]');
    await page.$eval('input[data-k="sway"]', (e) => {
      e.value = "40";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.uncheck('input[data-k="labels"]');
    await page.click('button[data-act="p:natural"]');
    const cleared = await page.evaluate(() => ({
      cap: document.querySelector('input[data-k="cap"]').value,
      tk: document.querySelector('select[data-k="tk"]').value,
      fold: document.querySelector('input[data-k="fold"]').checked,
      sway: document.querySelector('input[data-k="sway"]').value,
      labels: document.querySelector('input[data-k="labels"]').checked,
      keys: [...new URLSearchParams(location.hash.slice(1)).keys()],
    }));
    expect(
      cleared.cap === dflt &&
        cleared.tk === "none" &&
        !cleared.fold &&
        !cleared.keys.some((k) => k in SHOWN) &&
        cleared.sway === "40" &&
        !cleared.labels,
      `a preset button clears every model setting override and keeps the path's and the page's (${JSON.stringify(cleared)})`,
    );

    // The cascade has its own settings: the ramp's hide with the ramp, and each model's hide under the other.
    const CASCADE_KEYS = Object.keys(CASCADE_SHOWN);
    await load(page, CASCADE.hash);
    await only(CASCADE_KEYS, true, "cascade: its settings");
    await only(Object.keys(SHOWN), false, "cascade: the drum's settings");
    await only(
      pathKeys("cascade"),
      true,
      "cascade: the path's settings, while cards sway",
    );
    await only(["swayb"], false, "cascade: no leg behind the pile");
    await only(
      OVERLAY_KEYS,
      false,
      "cascade without Bezier path: what the overlay draws",
    );
    await load(page, `${CASCADE.hash}&reduced=1`);
    await only(
      Object.keys(PATH_SHOWN),
      false,
      "cascade under reduced motion, without Bezier path: the path's settings",
    );
    expect(
      await page.$eval('[data-module="path"]', (m) => m.hidden),
      "under reduced motion without Bezier path the Path module hides whole",
    );
    await load(page, `${CASCADE.hash}&reduced=1&path=1`);
    await only(
      pathKeys("cascade", { reduced: true, overlay: true }),
      true,
      "cascade under reduced motion with Bezier path: the path's settings",
    );
    await load(page, `${NATURAL.hash}&path=1`);
    await only(
      pathKeys("drum", { overlay: true }),
      true,
      "drum with Bezier path: the path's settings",
    );
    await load(page, `${NATURAL.hash}&path=1&sway=0&swayb=0`);
    await only(
      ["peak", "peakb", "cross", "bank"],
      false,
      "no sway on either leg: the settings that shape the sway",
    );
    await only(["sway", "swayb"], true, "no sway: the sway sliders stay");

    // The page's own settings: each fade with its motion setting, and the overlay's parts with the overlay.
    const viewCases = [
      [NATURAL.hash, {}],
      [`${NATURAL.hash}&reduced=1`, { reduced: true }],
      [`${NATURAL.hash}&path=1`, { overlay: true }],
      [`${NATURAL.hash}&path=1&handles=0`, { overlay: true, handles: false }],
      [`${NATURAL.hash}&path=1&reduced=1`, { overlay: true, reduced: true }],
    ];
    const viewWrong = [];
    for (const [hash, state] of viewCases) {
      await load(page, hash);
      const now = (await shownKeys(page)).filter((k) => k in VIEW_SHOWN);
      if (!sameSet(now, viewKeys(state)))
        viewWrong.push(`${hash}: ${now.join(", ")}`);
    }
    expect(
      viewWrong.length === 0,
      `the page's settings show only when they change what is drawn, in ${viewCases.length} states${viewWrong.length ? `: ${viewWrong.join("; ")}` : ""}`,
    );
    await load(page, CASCADE.hash);
    await page.click('button[data-act="p:no held ramp"]');
    await only(
      CASCADE_KEYS.filter((k) => !CASCADE_SHOWN[k]({ ramp: false })),
      false,
      "no held ramp: the settings the ramp shapes",
    );
    await only(
      CASCADE_KEYS.filter((k) => CASCADE_SHOWN[k]({ ramp: false })),
      true,
      "no held ramp: the other cascade settings",
    );
    await load(page, NATURAL.hash);
    await only(CASCADE_KEYS, false, "natural: the cascade's settings");

    // The edge fade stays below the pile: its slider stops at park minus the tallest card and 16 px.
    await load(page, "#v=cascade&park=400&fade=999");
    const stage = await page.evaluate(() => {
      const clip = document.getElementById("clip");
      const fade = document.querySelector('input[data-k="fade"]');
      return {
        lead: parseFloat(document.querySelector(".card").style.top),
        height: clip.getBoundingClientRect().height,
        overflow: getComputedStyle(clip).overflow,
        max: Number(fade.max),
        value: Number(fade.value),
        mask: clip.style.maskImage,
      };
    });
    expect(
      stage.height === stage.lead + 400 &&
        stage.overflow === "hidden" &&
        stage.max === 400 - 346 &&
        stage.value === stage.max &&
        stage.mask.includes(`${stage.max}px`),
      `the cascade's stage is cut at LEAD + park and its fade is capped at park − 346 (${JSON.stringify(stage)})`,
    );

    // Product mode has no model settings: only the path's and the page's.
    await load(page, `${PRODUCT.hash}&path=1`);
    const productKeys = await shownKeys(page);
    const productWant = [
      ...pathKeys("product", { overlay: true }),
      ...viewKeys({ overlay: true }),
    ];
    expect(
      sameSet(productKeys, productWant),
      `product mode with Bezier path shows only the path's and the page's settings (${productKeys.join(", ")})`,
    );
  });
}

// ---- the inspector: its place, its modules, and what each model shows -------------------------------------

/** Which modules the inspector shows, and whether the preset buttons show. */
const modulesShown = (page) =>
  page.evaluate(() => ({
    presets: !document.getElementById("presets").hidden,
    modules: [...document.querySelectorAll("[data-module]")]
      .filter((m) => !m.hidden)
      .map((m) => m.dataset.module),
  }));
const ALWAYS = ["model", "playback", "path", "overlay", "about"];
const MODEL_MODULES = {
  product: [],
  drum: ["taps", "pace", "held"],
  cascade: ["taps", "pace", "stage"],
};

async function inspector(browser) {
  // Anchored to the right edge at full height, with the stage taking the rest of the width and the column
  // scaled down to fit a narrow stage.
  for (const size of [
    SIZE,
    { width: 640, height: 480 },
    { width: 640, height: 300 },
  ])
    await withPage(
      browser,
      `inspector ${size.width}x${size.height}`,
      async (page) => {
        await load(page, NATURAL.hash);
        const at = await page.evaluate(() => {
          const box = (el) => el.getBoundingClientRect().toJSON();
          const ins = document.getElementById("inspector");
          return {
            ins: box(ins),
            stage: box(document.getElementById("stage-area")),
            col: box(document.getElementById("col")),
            scrolls: getComputedStyle(ins).overflowY,
          };
        });
        const name = `${size.width}x${size.height}`;
        expect(
          Math.abs(at.ins.right - size.width) < 1 &&
            at.ins.top === 0 &&
            Math.abs(at.ins.bottom - size.height) < 1 &&
            at.scrolls === "auto",
          `${name}: the inspector is anchored to the right edge, full height, and scrolls on its own (${JSON.stringify(at.ins)})`,
        );
        expect(
          Math.abs(at.stage.right - at.ins.left) < 1 && at.stage.left === 0,
          `${name}: the stage takes the width left of the inspector (stage ${box(at.stage)})`,
        );
        expect(
          at.col.left >= at.stage.left - 0.5 &&
            at.col.right <= at.stage.right + 0.5 &&
            (size.width < 1000 || Math.abs(at.col.width - 680) < 0.5),
          `${name}: the card column fits the stage, at full width when there is room (column ${box(at.col)})`,
        );
      },
      size,
    );

  await withPage(browser, "modules", async (page) => {
    // Each model shows its own modules and hides those with nothing to show under it.
    for (const mode of ["product", "drum", "cascade"]) {
      await load(page, `#v=${mode}`);
      const now = await modulesShown(page);
      const want = [...ALWAYS, ...MODEL_MODULES[mode]];
      expect(
        sameSet(now.modules, want) && now.presets === (mode !== "product"),
        `${mode}: the inspector shows the modules ${want.join(", ")}${mode === "product" ? " and no presets" : " and its presets"} (${JSON.stringify(now)})`,
      );
    }

    // Under reduced motion no card moves: the modules that shape motion hide, and the cascade's Stage stays.
    for (const [mode, want] of [
      ["drum", ["model", "playback", "overlay", "about"]],
      ["cascade", ["model", "playback", "stage", "overlay", "about"]],
    ]) {
      await load(page, `#v=${mode}&reduced=1`);
      const now = await modulesShown(page);
      expect(
        sameSet(now.modules, want),
        `${mode} under reduced motion: the inspector shows only ${want.join(", ")} (${now.modules.join(", ")})`,
      );
    }
    await load(page, `${FOLD.hash}&reduced=1`);
    expect(
      await page.$eval("#lam", (el) => el.hidden),
      "under reduced motion the held readout hides: a held key never starts the hold",
    );

    // A module folds from its heading, and stays folded when the page is opened again.
    await load(page, NATURAL.hash);
    const tapsOn = async () => (await shownKeys(page)).includes("w0");
    expect(await tapsOn(), "Taps starts open: its sliders show");
    await page.click('[data-module="taps"] > summary');
    expect(!(await tapsOn()), "clicking the Taps heading folds it");
    await load(page, NATURAL.hash);
    expect(
      !(await tapsOn()),
      "the folded module stays folded when the page is opened again",
    );
    await page.focus('[data-module="taps"] > summary');
    await page.keyboard.press("Enter");
    expect(await tapsOn(), "Enter on the focused heading opens it again");
    const about = await page.$eval(
      '[data-module="about"]',
      (m) => !m.open && !m.hidden,
    );
    expect(about, "the About module starts folded, showing only its heading");
  });
}

// ---- the URL hash ------------------------------------------------------------------------------------------

async function hashHygiene(browser) {
  await withPage(browser, "hash hygiene", async (page, own) => {
    const keys = () =>
      page.evaluate(() => [
        ...new URLSearchParams(location.hash.slice(1)).keys(),
      ]);

    // A link kept from an older page names a preset and keys that no longer exist.
    await load(page, "#v=drum&preset=no%20such%20preset&zz=10&yy=0&xx=2");
    await page.waitForTimeout(300);
    expect(
      own.length === 0,
      `a hash with an unknown preset and unknown keys loads without page errors${own.length ? `: ${own.join("; ")}` : ""}`,
    );
    expect(
      await page.$eval('button[data-act="p:natural"]', (b) =>
        b.classList.contains("on"),
      ),
      "an unknown preset falls back to natural: the natural button is on",
    );
    const stray = (await keys()).filter((k) => ["zz", "yy", "xx"].includes(k));
    expect(
      stray.length === 0,
      `the hash drops keys the page does not know once it settles (still has ${stray.join(", ") || "none"})`,
    );

    await load(page, "#v=drum&cap=99");
    const cap = await page.$eval('input[data-k="cap"]', (e) => ({
      value: Number(e.value),
      max: Number(e.max),
    }));
    expect(
      cap.value === cap.max && own.length === 0,
      `cap=99 clamps the slider to its maximum without an error (${JSON.stringify(cap)})`,
    );

    // Values that name nothing give the defaults.
    await load(page, "#v=bogus&speed=3&tk=bogus&fold=2&cap=abc&w0=");
    const fallback = await page.evaluate(() => ({
      model: document.querySelector('button[data-act^="v:"].on')?.dataset.act,
      speed: document.querySelector('button[data-act^="s:"].on')?.dataset.act,
      tk: document.querySelector('select[data-k="tk"]').value,
      fold: document.querySelector('input[data-k="fold"]').checked,
      cap: document.querySelector('input[data-k="cap"]').value,
    }));
    const defaults = await load(page, "#v=drum").then(() =>
      page.evaluate(() => ({
        tk: document.querySelector('select[data-k="tk"]').value,
        cap: document.querySelector('input[data-k="cap"]').value,
      })),
    );
    expect(
      fallback.model === "v:drum" &&
        fallback.speed === "s:1" &&
        !fallback.fold &&
        fallback.tk === defaults.tk &&
        fallback.cap === defaults.cap &&
        own.length === 0,
      `values that name nothing fall back to the defaults (${JSON.stringify(fallback)})`,
    );
  });
}

// ---- the README --------------------------------------------------------------------------------------------

/** The text between backticks, which is where README.md names a preset or a setting key. */
const codeSpans = (md) =>
  [...md.matchAll(/`+([^`]+)`+/g)].map((m) => m[1].trim());
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function readmeNamesEverything(browser) {
  let presets;
  let keys;
  await withPage(browser, "readme", async (page) => {
    await load(page, NATURAL.hash);
    presets = await page.$$eval('button[data-act^="p:"]', (bs) =>
      bs.map((b) => b.dataset.act.slice(2)),
    );
    keys = (await page.evaluate(() => window.__help.controls))
      .map((c) => c.id)
      .filter((id) => id.startsWith("setting."))
      .map((id) => id.slice("setting.".length));
  });
  const spans = codeSpans(
    fs.readFileSync(path.join(ROOT, "README.md"), "utf8"),
  );
  // A key is named by a span that is the key, or that holds a hash entry for it (`tk=constant`).
  const asKey = (k) =>
    spans.some(
      (s) => s === k || new RegExp(`(^|[\\s&#?])${escapeRe(k)}=`).test(s),
    );
  const missingPresets = presets.filter((p) => !spans.includes(p));
  const missingKeys = keys.filter((k) => !asKey(k));
  expect(
    missingPresets.length === 0,
    `README.md names every preset in backticks (${presets.length} presets${missingPresets.length ? `; missing: ${missingPresets.join(", ")}` : ""})`,
  );
  expect(
    missingKeys.length === 0,
    `README.md names every setting key in backticks (${keys.length} keys${missingKeys.length ? `; missing: ${missingKeys.join(", ")}` : ""})`,
  );
}

// ---- run ---------------------------------------------------------------------------------------------------

const SECTIONS = {
  cards: cardsAreDrawn,
  controls: controlsDriveThePage,
  help: helpMatchesControls,
  timing: hoverTiming,
  keyboard: keyboardShowsTips,
  dismissal,
  edges,
  settings: settingsVisibility,
  inspector,
  hash: hashHygiene,
  readme: readmeNamesEverything,
};
const only = process.argv.slice(2);
const unknown = only.filter((name) => !(name in SECTIONS));
if (unknown.length) {
  console.error(
    `unknown section ${unknown.join(", ")}; known: ${Object.keys(SECTIONS).join(", ")}`,
  );
  process.exit(2);
}

const started = Date.now();
const browser = await launch();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "queue-motion-"));
for (const [name, run] of Object.entries(SECTIONS))
  if (!only.length || only.includes(name)) await run(browser, scratch);
await browser.close();

expect(
  errors.length === 0,
  `no page errors${errors.length ? ": " + errors.join("; ") : ""}`,
);
const seconds = ((Date.now() - started) / 1000).toFixed(0);
if (failures.length) {
  console.error(
    `\n${failures.length} of ${passed + failures.length} checks failed (${seconds} s)`,
  );
  process.exit(1);
}
console.log(`\n${passed} checks passed (${seconds} s)`);
