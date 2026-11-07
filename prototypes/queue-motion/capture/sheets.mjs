/**
 * Contact sheets on the page's stepped clock: one PNG per model and scenario, a frame every `step` ms with its
 * timestamp.
 *
 *   node capture/sheets.mjs <specs> [<scenarios>]
 *
 * `specs`: comma list of product, drum, drum:<preset>. `scenarios`: comma list of SCEN keys (default: all).
 * Keys are driven like a real hold: a first press, then a repeat every 33 ms after 250 ms, released on arrival.
 */
import fs from "node:fs";
import { open, parseSpec, hashFor, OUT, PAGE } from "./lib.mjs";

const hold = (dir, until) => ({ hold: dir, until });
export const SCEN = {
  "single-up": { start: 4, presses: [{ t: 0, dir: -1 }], step: 50, end: 750 },
  "single-up-tall-front": {
    start: 3,
    presses: [{ t: 0, dir: -1 }],
    step: 50,
    end: 750,
  },
  "single-down-tall-front": {
    start: 3,
    presses: [{ t: 0, dir: 1 }],
    step: 50,
    end: 750,
  },
  "single-down-short-to-tall": {
    start: 2,
    presses: [{ t: 0, dir: 1 }],
    step: 50,
    end: 750,
  },
  "held-up": { start: 11, ...hold(-1, 0), step: 100, end: 2300 },
  "held-down": { start: 0, ...hold(1, 11), step: 100, end: 2300 },
  reversal: {
    start: 5,
    presses: [
      { t: 0, dir: -1 },
      { t: 120, dir: 1 },
      { t: 240, dir: -1 },
    ],
    step: 50,
    end: 950,
  },
  "worst-heights-down": {
    start: 0,
    order: "alt",
    ...hold(1, 11),
    step: 100,
    end: 2300,
  },
  "worst-heights-up": {
    start: 11,
    order: "alt",
    ...hold(-1, 0),
    step: 100,
    end: 2300,
  },
};
// Alternating tall and short cards: items 3 (tallest) and 1 (shortest) of the sample set.
const ORDERS = { alt: Array.from({ length: 24 }, (_, i) => (i % 2 ? 1 : 3)) };

export async function sheets(specs, scens, outDir = OUT + "/sheets", cols = 4) {
  const { browser, ctx, page } = await open();
  fs.mkdirSync(outDir, { recursive: true });
  for (const spec of specs) {
    const s = parseSpec(spec);
    for (const name of scens) {
      const sc = SCEN[name];
      if (!sc)
        throw new Error(
          `unknown scenario ${name}; known: ${Object.keys(SCEN).join(", ")}`,
        );
      await page.goto(PAGE + hashFor(s));
      await page.waitForTimeout(150);
      await page.evaluate(
        ({ mode, start, order, preset }) => {
          const S = window.__sim;
          S.pause();
          S.setOrder(order);
          S.pause();
          S.build(mode, start, preset ? { preset } : {});
          S.pause();
        },
        {
          mode: s.mode,
          start: sc.start,
          order: sc.order ? ORDERS[sc.order] : null,
          preset: s.preset,
        },
      );
      // The controls stay out of the sheets; they keep their space so the stack sits where it does on screen.
      await page.addStyleTag({
        content: "#bars,.note,.model,.foot,.cover{visibility:hidden}",
      });
      const top = await page.evaluate(
        () => document.querySelector("#bars").offsetHeight,
      );
      const shots = [];
      const FRAME = 1000 / 60;
      let t = 0,
        pi = 0,
        nextShot = 0,
        nextRepeat = 250,
        holding = false,
        released = false;
      while (t <= sc.end + 1e-6) {
        if (sc.presses) {
          const due = [];
          while (pi < sc.presses.length && sc.presses[pi].t <= t + 1e-6)
            due.push(sc.presses[pi++].dir);
          if (due.length)
            await page.evaluate((ds) => {
              for (const d of ds) window.__sim.press(d);
            }, due);
        } else if (!released) {
          const cur = await page.evaluate(() => window.__sim.cur());
          if (!holding) {
            holding = true;
            await page.evaluate((d) => window.__sim.hold(d), sc.hold);
          } else if (cur === sc.until) {
            released = true;
            await page.evaluate(() => window.__sim.release());
          } else if (t + 1e-6 >= nextRepeat) {
            nextRepeat += 100 / 3;
            await page.evaluate((d) => window.__sim.repeat(d), sc.hold);
          }
        }
        if (t + 1e-6 >= nextShot) {
          const buf = await page.screenshot({
            clip: { x: 150, y: top + 4, width: 700, height: 520 },
          });
          shots.push({ t: Math.round(t), data: buf.toString("base64") });
          nextShot += sc.step;
        }
        await page.evaluate((ms) => window.__sim.advance(ms), FRAME);
        t += FRAME;
      }
      const w = 700 / 1.75,
        h = 520 / 1.75;
      const html =
        `<body style="margin:0;background:#fff;font:12px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px;width:${cols * (w + 6) + 6}px">` +
        shots
          .map(
            (x) =>
              `<div style="position:relative;border:1px solid #ddd"><img width=${w} height=${h} src="data:image/png;base64,${x.data}"><div style="position:absolute;left:4px;top:3px;background:#111;color:#fff;border-radius:4px;padding:1px 6px;font-weight:600">${x.t} ms</div></div>`,
          )
          .join("") +
        `</div><div style="padding:6px;color:#555">${spec} · ${name} · stepped clock, a frame every ${sc.step} ms</div>`;
      const sheet = await ctx.newPage();
      await sheet.setViewportSize({ width: cols * (w + 6) + 12, height: 800 });
      await sheet.setContent(html);
      await sheet.waitForTimeout(100);
      const file = `${outDir}/${s.name}-${name}.png`;
      await sheet.screenshot({ path: file, fullPage: true });
      await sheet.close();
      console.log(file);
    }
  }
  await browser.close();
}

if (process.argv[1].endsWith("sheets.mjs")) {
  const specs = (process.argv[2] ?? "product,drum").split(",");
  const scens = process.argv[3]
    ? process.argv[3].split(",")
    : Object.keys(SCEN);
  await sheets(specs, scens);
}
