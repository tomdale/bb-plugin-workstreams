import { test } from "node:test";
import assert from "node:assert/strict";
import { Drum, QUEUE_CFG } from "../../../src/app/page/queue/drum.ts";
import { drumCfg, parseOpt, pathCfg, viewCfg } from "../src/controls.ts";

const selected =
  "#v=drum&preset=shipped&speed=1&path=0&sway=24&swayb=-11&peak=0.45&peakb=0.4&cross=-0.05&bank=1&hfade=200&kri=25";

test("the current shipped link reproduces the selected drum, path and playback settings", () => {
  const opt = parseOpt(selected);
  assert.deepEqual(drumCfg(opt), Drum.config(QUEUE_CFG));
  assert.deepEqual(pathCfg(opt), {
    sway: 24,
    swayBehind: -11,
    peak: 0.45,
    peakBehind: 0.4,
    cross: -0.05,
    bank: 1,
    loop: true,
    moving: true,
    overlay: false,
  });
  const view = viewCfg(opt);
  assert.equal(view.headMs, 200);
  assert.equal(view.repeatDelay, 250);
  assert.equal(view.repeatMs, 25);
  assert.equal(view.reduced, false);
  assert.equal(view.allKnots, false);
});
