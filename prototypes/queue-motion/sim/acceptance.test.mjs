import { test } from "node:test";
import assert from "node:assert/strict";
import { invariants } from "./suite.mjs";

const kinds = () => ({ jump: 0, band: 0, shade: 0, swap: 0 });
const run = () => {
  const R = { singles: {}, holds: {}, reversal: {} };
  for (const set of ["w1", "w2", "alt"]) {
    R.singles[set] = { up: [{ kinds: kinds() }], down: [{ kinds: kinds() }] };
    R.holds[set] = { up: { kinds: kinds() }, down: { kinds: kinds() } };
    R.reversal[set] = { udu: { kinds: kinds() }, du: { kinds: kinds() } };
  }
  return R;
};
const summary = () => ({
  "problems (corrected rule): taps / holds / reversals": "2 / 3 / 1",
  "first visible change, ms (max)": 16,
  "hold at an end moves, px": 0,
  "release: rests on a card / extra cards after release": "all / 1",
  "unfold after arriving at the end, ms": 0,
  "held max jump, px/frame": 44.1,
  "tap max jump, px/frame": 44.1,
});

test("shipped accepts its selected edge budget and held swaps, but not other defects", () => {
  const R = run();
  const S = summary();
  R.singles.w1.up[0].kinds.jump = 2;
  R.holds.w1.up.kinds.swap = 3;
  R.reversal.w1.udu.kinds.jump = 1;
  assert.deepEqual(invariants("shipped", 60, R, S), []);
  assert.equal(
    S["problems (corrected rule): taps / holds / reversals"],
    "2 / 3 / 1",
  );
  S["tap max jump, px/frame"] = 45.1;
  assert.match(invariants("shipped", 60, R, S).join(" "), /more than 45/);
  S["tap max jump, px/frame"] = 44.1;
  R.singles.w2.down[0].kinds.swap = 1;
  assert.match(
    invariants("shipped", 60, R, S).join(" "),
    /non-jump checker problems/,
  );
  R.singles.w2.down[0].kinds.swap = 0;
  R.holds.w2.down.kinds.band = 1;
  assert.match(
    invariants("shipped", 60, R, S).join(" "),
    /non-jump checker problems/,
  );
});

test("other non-loose presets keep the 40 px checker limit", () => {
  const failures = invariants("natural", 60, run(), summary());
  assert.match(failures.join(" "), /checker problems/);
  assert.match(failures.join(" "), /more than 40/);
});
