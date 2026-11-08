/**
 * Real-time recordings (needs ffmpeg): hold ↑ from item 12 to item 1, pause, then hold ↓ back, with the OS's
 * key repeat (first keydown, then one every 33 ms after 250 ms). Frame pacing is that of headless Chrome's
 * screencast, which is below a real display's.
 *
 *   node capture/record.mjs product,drum,drum:fold,cascade
 *
 * The specs are those of `sheets.mjs`: `product`, `drum`, `drum:<preset>`, `cascade` and `cascade:<preset>`.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";
import { CHROME, OUT, PAGE, parseSpec, hashFor } from "./lib.mjs";

for (const spec of (process.argv[2] ?? "product,drum").split(",")) {
  const s = parseSpec(spec);
  const dir = `${OUT}/vid-${s.name}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    // Wide enough for the stack at full size beside the inspector.
    viewport: { width: 1320, height: 760 },
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (e) => {
    frames.push({ t: e.metadata.timestamp, data: e.data });
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
    } catch {}
  });
  await page.goto(PAGE + hashFor(s));
  await page.waitForTimeout(400);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    everyNthFrame: 1,
  });
  await page.evaluate(() => window.__sim.jump(11));
  await page.waitForTimeout(600);
  const cur = () => page.evaluate(() => window.__sim.cur());
  const hold = async (key, until, maxMs) => {
    const t0 = Date.now();
    await page.keyboard.down(key);
    await page.waitForTimeout(250);
    while (Date.now() - t0 < maxMs && !(await until())) {
      await page.keyboard.down(key);
      await page.waitForTimeout(33);
    }
    await page.keyboard.up(key);
    return Date.now() - t0;
  };
  const up = await hold("ArrowUp", async () => (await cur()) <= 0, 12000);
  await page.waitForTimeout(1000);
  const down = await hold("ArrowDown", async () => (await cur()) >= 11, 12000);
  await page.waitForTimeout(1000);
  console.log(s.name, "hold ↑ ms", up, "hold ↓ ms", down, "front", await cur());
  await cdp.send("Page.stopScreencast");
  await ctx.close();
  await browser.close();
  let list = "";
  frames.forEach((f, i) => {
    const file = `${dir}/f${String(i).padStart(5, "0")}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    const dur =
      i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - f.t) : 0.04;
    list += `file '${file}'\nduration ${dur.toFixed(4)}\n`;
  });
  list += `file '${dir}/f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
  fs.writeFileSync(`${dir}/list.txt`, list);
  const secs = frames.at(-1).t - frames[0].t;
  console.log(
    s.name,
    "frames",
    frames.length,
    "fps",
    (frames.length / secs).toFixed(1),
  );
  fs.mkdirSync(`${OUT}/videos`, { recursive: true });
  execSync(
    `ffmpeg -y -loglevel error -f concat -safe 0 -i "${dir}/list.txt" -vf "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${OUT}/videos/${s.name}.mp4"`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`wrote out/videos/${s.name}.mp4`);
}
