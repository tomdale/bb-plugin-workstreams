/**
 * The text of every tooltip on the lab page, and of the "How the drum works" panel, in one place and keyed by
 * control id (`CONTROLS` in controls.ts). `verify.ts` and `npm run smoke` fail when a control has no entry here
 * or an entry has no control.
 *
 * An entry walks four steps: what the control is, what you see and feel when you change it, what it depends on
 * or changes elsewhere, and how to tune it. Every number in the text comes from `Facts` (the sweeps in
 * `sim/sweep.mjs`), from a setting's default, or from a named constant; `t` rejects a typed digit and
 * `f.expect` rejects a claim the sweeps no longer support, so a change to the model fails the build instead of
 * leaving a stale tooltip. Each entry's footer names the commands that print its numbers.
 */
import { FADE_MS, SPEEDS } from "./controls.ts";
import { Facts, t, type RawFacts, type RowView } from "./facts.ts";

declare const __FACTS__: RawFacts;

export type Help = {
  /** One plain line: what the control is. */
  what: string;
  /** What you see and feel, as labelled lines: Raise and Lower for a slider, On and Off for a toggle. */
  effect: [label: string, text: string][];
  /** What it depends on or changes in other settings. */
  needs: string;
  /** Where to start, how far it stays clean, what going too far looks like, and what to adjust next. */
  tune: string;
  /** The commands that print the numbers above. */
  numbers: string[];
};
type Draft = Omit<Help, "numbers">;

/** Tap landing time of a row, as a number, for claims about direction. */
const up = (r: RowView) => r.raw.upLand as number;
const dn = (r: RowView) => r.raw.dnLand as number;
const speed = (r: RowView) => r.raw.landSpeed as number;
const rate = (r: RowView) => (r.raw.heldUp + r.raw.heldDn) / 2;

const ENTRIES: Record<string, (f: Facts) => Draft> = {
  // ---- models ------------------------------------------------------------------------------------
  "model.product": () => ({
    what: "The queue's card stack as it ships: `stackEngine.ts`, imported without changes. It runs the drum with the settings in `QUEUE_CFG`.",
    effect: [
      [
        "Click",
        "Shows the motion the queue ships. ↓ drops the front card clear of the pile and tucks it behind; ↑ runs the same ring backwards. Every card takes the same time, and a held key speeds up after a short hold. The preset and settings rows disappear.",
      ],
    ],
    needs:
      "Speed, clock and reduced motion work in both models. Presets and settings belong to the drum.",
    tune: "Nothing to tune. Hold ↑ and ↓ here, then switch to `Elastic drum` with `natural` and hold the same keys to compare. Pause and Step turn either model into a frame you can read.",
  }),
  "model.drum": () => ({
    what: "The candidate model: each card follows one ring path on its own spring, and ↑ runs the same ring backwards.",
    effect: [
      [
        "Click",
        "↓ drops the front card clear of the pile and tucks it behind. ↑ brings a card up from just below the pile and slows it into the front. The preset and settings rows appear.",
      ],
    ],
    needs:
      "A preset sets a bundle of settings; the rows under the preset buttons adjust it. Speed, clock and reduced motion apply as in `Product now`.",
    tune: "Start with `natural`: hold ↑ and ↓, then try the other presets one at a time before you move a setting. `How the drum works` explains the path.",
  }),

  // ---- presets -----------------------------------------------------------------------------------
  "preset.natural": (f) => {
    const p = f.preset("natural");
    const gate = f.slack(0.1);
    const cap = f.sweep("cap").at(30);
    f.expect(
      p.clean && gate.raw.problems === 0 && cap.clean,
      "natural, gate slack 0.1 and a tap budget of 30 are clean",
    );
    return {
      what: "The reviewed behaviour: every setting at its default, no fold, the edge budget on.",
      effect: [
        [
          "Feels",
          "A held key moves at the pace the cards allow. A tall card takes longer to clear than a short one, so the pace drops at tall cards and jumps at short ones.",
        ],
        [
          "Measured",
          t`Held ↑ / ↓ ${p.pace} cards/s, intervals ${p.range} ms, worst step-to-step change ${p.step}×, ${p.clean ? "no checker problems" : p.problems}. A tap ↑ lands in ${p.tapUp} ms and a tap ↓ settles in ${p.tapDn} ms.`,
        ],
        [
          "Good for",
          "The baseline for every other preset, and for single taps.",
        ],
      ],
      needs: t`Sets nothing: clicking it clears every slider change and restores each default. Settings that need a tempo or a held state stay hidden.`,
      tune: t`Start here. For an even pace choose \`even\`. To go faster without folding, raise \`gate slack\` to ${gate.value} (${gate.rate} cards/s, clean) or \`edge budget, tap\` to ${cap.value} (${cap.pace}, ${cap.verdict}).`,
    };
  },
  "preset.even": (f) => {
    const p = f.preset("even");
    const nat = f.preset("natural");
    const fast = f.sweep("ts", "even").at(0.85);
    f.expect(
      p.clean && p.raw.step < nat.raw.step,
      "even is clean and steadier than natural",
    );
    f.expect(
      rate(fast) > (p.raw.heldUp + p.raw.heldDn) / 2,
      "a smaller tempo scale is faster",
    );
    return {
      what: "A tempo plans the interval between presses from the card heights ahead, so the pace changes gently.",
      effect: [
        [
          "Feels",
          t`A steady rhythm that eases off before a tall card and recovers after it, at ${p.pace} cards/s against \`natural\`'s ${nat.pace}: short cards no longer run ahead.`,
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms, worst step-to-step change ${p.step}× (${nat.step}× in \`natural\`), ${p.clean ? "no checker problems" : p.problems}.`,
        ],
        [
          "Good for",
          "Holding a key through a mixed queue without the stutter at tall cards.",
        ],
      ],
      needs: t`Sets \`tempo\` to lookahead with window ${f.def("tw")} and scale ${f.def("ts")}; held speed-up and fold stay off. Clicking it clears slider changes.`,
      tune: t`Lower \`tempo scale\` to speed it up: ${fast.value} gives ${fast.pace} cards/s, but tall cards then outlast the plan and intervals reach ${fast.ivMax} ms (${fast.step}×). \`even + held speed\` shortens the trips so the shorter plan holds.`,
    };
  },
  "preset.even + held speed": (f) => {
    const p = f.preset("even + held speed");
    const even = f.preset("even");
    const scale = f.sweep("ts", "even + held speed");
    const base = scale.start,
      low = scale.at(0.7);
    f.expect(
      p.clean && p.raw.heldUp > even.raw.heldUp && !low.clean,
      "even + held speed is clean, faster than even, and fails at a smaller scale",
    );
    return {
      what: "The same planner at a shorter interval, which stiffer springs and a higher edge budget make possible once a key has been held.",
      effect: [
        [
          "Feels",
          t`After the hold delay the trips quicken, which lets the shorter plan hold: ${p.pace} cards/s against ${even.pace} in \`even\`.`,
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms, worst step-to-step change ${p.step}×, largest edge move ${p.jump} px/frame, ${p.clean ? "no checker problems" : p.problems}.`,
        ],
        [
          "Good for",
          "An even rhythm a little faster than `even`, without folding.",
        ],
      ],
      needs: t`Sets \`tempo\` to lookahead (window ${f.def("tw")}, scale ${base.value}) and \`held speed-up\` on: after the hold delay the spring goes from ${f.def("w0")} to ${f.def("w1")} Hz and the edge budget from ${f.def("cap")} to ${f.def("cap1")} px/frame.`,
      tune: t`Lower \`tempo scale\` for more pace and watch the checker: ${low.value} reports ${low.verdict}. With a tempo on, \`spring Hz, held\` and \`edge budget, held\` leave the pace alone, so tune the plan first.`,
    };
  },
  "preset.fold": (f) => {
    const p = f.preset("fold");
    const nat = f.preset("natural");
    f.expect(
      p.clean && p.raw.heldUp > 1.5 * nat.raw.heldUp,
      "fold is clean and much faster than natural",
    );
    const onScreen = Math.round(2000 / (p.raw.heldUp + p.raw.heldDn) / 10) * 10;
    return {
      what: t`Every card folds toward its header line while a key is held, so trips are short and the pace reaches ${p.pace} cards/s.`,
      effect: [
        [
          "Feels",
          t`After the hold delay the pile compresses into strips and each card is on screen for about ${onScreen} ms. \`DESIGN.md\` argues that is long enough to recognise a header line and too short to read a body. The card you land on unfolds when you release.`,
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms, worst step-to-step change ${p.step}×, largest edge move ${p.jump} px/frame, ${p.clean ? "no checker problems" : p.problems}.`,
        ],
        ["Good for", "Scanning a long queue for one card."],
      ],
      needs: t`Sets \`fold while held\`, which includes the held speed-up. \`tempo\` stays at none. The hold delay, held spring, held budget and folded height sliders appear.`,
      tune: t`Move the pace with \`hold delay\` first: the four values swept are all clean here. Then \`folded height\`, then \`spring Hz, held\`. For an even pace while folded, set \`tempo\` to constant.`,
    };
  },

  // ---- speed, clock, reduced motion ---------------------------------------------------------------
  speed: () => ({
    what: t`How fast the page's clock runs, for both models: ${SPEEDS.map((s) => s.label).join(", ")}.`,
    effect: [
      [
        "Slower",
        "Trips take proportionally longer, so you can watch a card pass the turn or the draw order change. Key repeat stays real.",
      ],
      ["Full speed", "The speed to judge feel at."],
    ],
    needs: t`Hold delay, tempo and the held state run on the page's clock, so at ${SPEEDS[0]!.label} they last ${1 / Number(SPEEDS[0]!.id)} times as long on screen. The held-key numbers in these tooltips are for ${SPEEDS.at(-1)!.label}.`,
    tune: t`Use the slow speeds to study a motion and ${SPEEDS.at(-1)!.label} to judge it. For one frame at a time use Pause and Step.`,
  }),
  "clock.pause": () => ({
    what: "Stops the page's clock so a motion freezes mid-trip.",
    effect: [
      [
        "Click",
        "The cards stop where they are and the button reads `Paused`; click it again to resume. Key presses still register and the heading changes, but no card moves until the clock runs or steps.",
      ],
    ],
    needs:
      "Works in both models. The drum's hold timer and tempo run on the page's clock, so a held key does not advance them while it is paused.",
    tune: "Press ↓, click Pause during the trip, then click Step to walk the rest of it one frame at a time.",
  }),
  "clock.step": (f) => {
    const frame = (1000 / Number(f.hz)).toFixed(1);
    const p = f.preset("natural");
    const frames = Math.round(p.raw.tapDn / Number(frame));
    return {
      what: "Advances the page's clock by one frame and pauses it.",
      effect: [
        [
          "Click",
          t`Each click moves every card ${frame} ms along its trip and leaves the clock paused. Click \`Paused\` to resume.`,
        ],
      ],
      needs: "Works in both models and with every preset.",
      tune: t`Press ↓ once, then click Step to count the frames from the press to the landing: on \`natural\` a tap ↓ settles in ${p.tapDn} ms, about ${frames} frames.`,
    };
  },
  reduced: () => ({
    what: "Replaces card motion with a cut and a fade, as the page does when the system asks for reduced motion.",
    effect: [
      [
        "On",
        t`No card moves. The heading changes at once and the new front card fades in over ${FADE_MS} ms. A held key moves one card: its repeat is ignored, so press again for the next.`,
      ],
      ["Off", "Cards move as the active model draws them."],
    ],
    needs:
      "The page also turns it on when the system setting `prefers-reduced-motion` is set. It applies to both models and overrides every preset and setting, which have no effect while it is on.",
    tune: "Use it to check the fallback: press ↓ and ↑ and look for a calm cut with nothing sliding. Turn it off to compare with the motion.",
  }),
  held: (f) => ({
    what: "A readout of the held state, from zero (tap behaviour) to one (the full speed-up or fold), shown while either is on.",
    effect: [
      [
        "Reads",
        t`Zero through a tap and through the hold delay, ${f.rise.level} about ${f.rise.seconds} s after the delay ends, and falling back when you release the key or the hold reaches the end of the queue.`,
      ],
      [
        "Drives",
        "The spring and the edge budget slide from their tap values to their held values as it rises; fold shrinks the cards with it.",
      ],
    ],
    needs:
      "`hold delay` sets when it starts to rise; the rate is fixed. It is hidden unless `held speed-up` or `fold while held` is on.",
    tune: "Watch it during a hold. If it is still near zero once your key repeat settles into a rhythm, lower the hold delay.",
  }),
  about: () => ({
    what: "A short account of the ring the drum is built on, and which settings act on which part of it.",
    effect: [["Click", "Opens the panel below it. Nothing on the page moves."]],
    needs:
      "The groups in the settings bar map to parts of the model: Taps to how one card travels, Pace to when the next press may start, Held keys to what changes once a key has been held.",
    tune: "Read it once before you move a setting, and again when two settings seem to fight. Its last paragraph defines the four problems the frame checker counts and what `clean` means here. Every tooltip reads in four steps: what the control is, what raising or lowering it does, what it works with, and how to tune it.",
  }),

  // ---- taps ---------------------------------------------------------------------------------------
  "setting.w0": (f) => {
    const s = f.sweep("w0");
    const slow = s.at(2),
      base = s.at(3),
      snappy = s.at(4.5),
      hard = s.at(6);
    f.expect(
      up(slow) > up(base) && up(base) > up(snappy) && up(snappy) > up(hard),
      "a stiffer tap spring lands ↑ sooner",
    );
    f.expect(
      speed(slow) < speed(base) &&
        speed(base) < speed(snappy) &&
        speed(snappy) < speed(hard),
      "a stiffer tap spring lands harder",
    );
    f.expect(
      rate(slow) < rate(base) && rate(base) < rate(snappy),
      "a stiffer tap spring speeds up a hold",
    );
    f.expect(
      [slow, base, snappy, hard].every((r) => r.clean),
      "every tap spring value is clean",
    );
    return {
      what: "How stiff each card's spring is for a tap, and for a held key until its held state begins.",
      effect: [
        [
          "Raise",
          t`Cards reach their slots sooner and stop harder. A tap ↑ lands in ${base.upLand} ms at ${base.value} Hz and ${snappy.upLand} ms at ${snappy.value}, and the speed left in the last five frames rises from ${base.landSpeed} to ${snappy.landSpeed} px/frame. Held ↑ / ↓ goes from ${base.pace} to ${snappy.pace} cards/s.`,
        ],
        [
          "Lower",
          t`Cards drift in. At ${slow.value} Hz a tap ↑ takes ${slow.upLand} ms and a tap ↓ ${slow.dnLand} ms (${base.dnLand} at ${base.value}); landing speed falls to ${slow.landSpeed} px/frame and held ↑ / ↓ slows to ${slow.pace} cards/s.`,
        ],
      ],
      needs: t`Every preset uses it for taps. With \`held speed-up\` or \`fold while held\` on, a hold ramps from this spring to \`spring Hz, held\` after the hold delay. The edge budget limits how far an edge may move in a frame.`,
      tune: t`Start at ${base.value} and press ↑ once after each small change: ↑ is the slowest trip, so lag or a hard landing shows there first. The four values swept, ${slow.value} to ${hard.value} Hz, all pass the frame checker, so the limit is feel: past ${snappy.value} the landing speed climbs (${hard.landSpeed} px/frame at ${hard.value}) and the largest edge move in a hold reaches ${hard.jump} px/frame against a budget of ${f.def("cap")}.`,
    };
  },
  "setting.cap": (f) => {
    const s = f.sweep("cap");
    const lo = s.at(16),
      base = s.at(24),
      mid = s.at(30),
      high = s.at(36),
      edge = s.at(39),
      over = s.at(40),
      end = s.at(44);
    f.expect(
      rate(lo) < rate(base) &&
        rate(base) < rate(mid) &&
        rate(mid) < rate(high) &&
        rate(high) < rate(edge),
      "a higher tap budget speeds up a hold",
    );
    f.expect(
      [lo, base, mid, high, edge].every((r) => r.clean) &&
        !over.clean &&
        !end.clean,
      "the tap budget is clean through its last value below the jump limit and fails at and above it",
    );
    f.expect(
      dn(lo) === dn(base) && dn(base) === dn(over),
      "the tap budget leaves tap ↓ alone",
    );
    return {
      what: "The most any card edge may move in one frame, in px per frame, for taps and for a held key until its held state begins.",
      effect: [
        [
          "Raise",
          t`The fastest part of every trip gets faster. A tap ↑ lands in ${base.upLand} ms at ${base.value} and ${edge.upLand} ms at ${edge.value}; held ↑ / ↓ goes from ${base.pace} cards/s to ${mid.pace} at ${mid.value} and ${edge.pace} at ${edge.value}. Tap ↓ stays at ${base.dnLand} ms: its trips stay under the lowest budget.`,
        ],
        [
          "Lower",
          t`Trips flatten into a steady slide: at ${lo.value} a tap ↑ takes ${lo.upLand} ms and held ↑ / ↓ manages ${lo.pace} cards/s.`,
        ],
      ],
      needs: t`The spring decides how hard a card tries to move and the budget only binds where the spring asks for more, so ↓ taps do not change. With \`held speed-up\` or \`fold while held\` on, the budget ramps to \`edge budget, held\`.`,
      tune: t`Start at ${base.value}. For a faster held key without folding, raise it a few px at a time: ${mid.value} gives ${mid.pace} cards/s and ${high.value} gives ${high.pace}, both clean. At ${over.value} the checker reports ${over.verdict} (an edge moved over ${f.limit.jump} px in a frame), and ${end.value} reports ${end.problems}. ${f.def("cap1")} is the held budget the queue ships with, so above it the drum moves cards faster than the product. If that feels rushed, lower it and use \`tempo\`.`,
    };
  },

  // ---- pace ---------------------------------------------------------------------------------------
  "setting.tk": (f) => {
    const nat = f.preset("natural");
    const even = f.preset("even");
    const c = f.sweep("tms", "constant").at(285);
    const fold = f.sweep("tms", "fold with constant").at(150);
    f.expect(
      even.raw.step < nat.raw.step && c.raw.step < nat.raw.step,
      "a tempo evens the pace",
    );
    return {
      what: "How a held key's presses are spaced: as the cards allow (`none`), at a fixed interval (`constant`), or at one planned from the card heights (`lookahead`).",
      effect: [
        [
          "none",
          t`The pace follows each card's height: intervals ${nat.range} ms, so one step can take ${nat.step}× as long as the last. Held ↑ / ↓ ${nat.pace} cards/s.`,
        ],
        [
          "constant",
          t`A steady beat. At the default ${c.value} ms: ${c.pace} cards/s, intervals ${c.range} ms.`,
        ],
        [
          "lookahead",
          t`The interval eases up before a tall card and back after it: ${even.pace} cards/s, intervals ${even.range} ms, worst step-to-step change ${even.step}× (${nat.step}× with no tempo).`,
        ],
      ],
      needs: t`\`lookahead\` shows \`tempo window\` and \`tempo scale\`; \`constant\` shows \`constant interval\`; \`none\` shows \`gate slack\`, which a tempo makes redundant. A tempo only delays a press: the cards' own gate still sets the earliest start.`,
      tune: t`Start with \`lookahead\`. Choose \`constant\` when you know the pace you want. A tempo trades pace for evenness, and fold wins pace back: with fold on, \`constant\` at ${fold.value} ms gives ${fold.pace} cards/s, worst step-to-step change ${fold.step}×.`,
    };
  },
  "setting.tw": (f) => {
    const s = f.sweep("tw");
    const w1 = s.at(1),
      w2 = s.at(2),
      w3 = s.at(3),
      w6 = s.at(6);
    f.expect(
      w1.raw.step > w2.raw.step && w2.raw.step > w3.raw.step,
      "a wider window evens the pace",
    );
    f.expect(rate(w1) > rate(w3), "a wider window is slower");
    f.expect(
      w3.pace === s.at(4).pace && w3.pace === w6.pace && w3.range === w6.range,
      "windows above the slider's maximum measure the same",
    );
    return {
      what: "How many cards ahead and behind the one being covered the lookahead planner considers.",
      effect: [
        [
          "Raise",
          t`The pace eases earlier before a tall card and recovers later after it. Worst step-to-step change falls from ${w1.step}× at ${w1.value} to ${w3.step}× at ${w3.value}; the pace from ${w1.pace} to ${w3.pace} cards/s.`,
        ],
        [
          "Lower",
          t`The interval follows each card's own height more closely: at ${w1.value} intervals run ${w1.range} ms and a tall card gives less warning.`,
        ],
      ],
      needs: t`Only \`tempo\` = lookahead uses it. Windows above ${w3.value} measure the same (${w6.pace} cards/s at ${w6.value}), so the slider stops there. \`tempo scale\` multiplies whatever interval the window picks.`,
      tune: t`Start at ${w2.value}, which both even presets use. Raise it to ${w3.value} if a long hold still stutters at a tall card; lower it to ${w1.value} for more pace (${w1.pace} cards/s) and less easing. For overall speed use \`tempo scale\`.`,
    };
  },
  "setting.ts": (f) => {
    const s = f.sweep("ts", "even");
    const h = f.sweep("ts", "even + held speed");
    const half = s.at(0.5),
      base = s.at(1),
      slow = s.at(1.2),
      slower = s.at(1.4),
      noRamp = s.at(0.85),
      hs = h.at(0.85),
      hsLow = h.at(0.7),
      nat = f.preset("natural");
    f.expect(
      rate(half) > rate(noRamp) &&
        rate(noRamp) > rate(base) &&
        rate(base) > rate(slow) &&
        rate(slow) > rate(slower),
      "a larger tempo scale is slower",
    );
    f.expect(
      hs.clean && !hsLow.clean && hs.raw.step < noRamp.raw.step,
      "held speed-up makes a smaller tempo scale clean and steadier",
    );
    return {
      what: t`A multiplier on the planned interval. At scale ${f.def("ts")} the plan is ${f.estimate.short} ms for a ${f.cards.min} px card and ${f.estimate.tall} ms for a ${f.cards.max} px card.`,
      effect: [
        [
          "Raise",
          t`Longer intervals, a slower and steadier hold: ${slow.value} gives ${slow.pace} cards/s (intervals ${slow.range} ms) and ${slower.value} gives ${slower.pace}.`,
        ],
        [
          "Lower",
          t`Shorter intervals, until a tall card's real trip outlasts the plan. At ${half.value} the pace is ${half.pace} cards/s, close to \`natural\`'s ${nat.pace}, and the worst step-to-step change is back up to ${half.step}× (${nat.step}× in \`natural\`).`,
        ],
      ],
      needs: t`Only \`tempo\` = lookahead uses it. Held speed-up shortens the real trips, so it lets the plan run shorter: \`even + held speed\` plans at ${hs.value} and keeps ${hs.step}×, while the same scale without it reaches intervals of ${noRamp.ivMax} ms (${noRamp.step}×). With the speed-up on, ${hsLow.value} gives ${hsLow.verdict}.`,
      tune: t`Start at ${f.def("ts")}, or ${hs.value} with \`held speed-up\`. Lower it a little at a time until the pace suits you, and stop when the worst step-to-step change starts to climb or the checker reports a problem.`,
    };
  },
  "setting.tms": (f) => {
    const c = f.sweep("tms", "constant");
    const h = f.sweep("tms", "constant with held speed-up");
    const fo = f.sweep("tms", "fold with constant");
    const base = c.at(285),
      slow = c.at(400),
      mid = c.at(250),
      fast = c.at(200),
      hs225 = h.at(225),
      hs200 = h.at(200),
      fold150 = fo.at(150);
    f.expect(
      rate(base) > rate(slow) &&
        rate(mid) > rate(base) &&
        rate(fast) > rate(mid),
      "a shorter constant interval is faster",
    );
    f.expect(
      hs225.clean && !hs200.clean && fold150.clean,
      "held speed-up holds 225 ms cleanly and not 200",
    );
    return {
      what: "The fixed time between presses when `tempo` is `constant`, in ms. Cards per second is one second divided by it.",
      effect: [
        [
          "Raise",
          t`A slower, steadier beat: ${base.value} ms gives ${base.pace} cards/s and ${slow.value} ms gives ${slow.pace}.`,
        ],
        [
          "Lower",
          t`A faster beat, until the trips cannot keep up. At ${mid.value} ms intervals run ${mid.range} ms and at ${fast.value} ms ${fast.range} ms: a tall card still takes about ${fast.ivMax} ms to clear, so the beat is constant only above that.`,
        ],
      ],
      needs: t`Only \`tempo\` = constant uses it. Held speed-up shortens trips, so the beat can run faster: with it on, ${hs225.value} ms holds ${hs225.range} ms at ${hs225.pace} cards/s, ${hs225.verdict}, while ${hs200.value} ms gives ${hs200.verdict}. Fold goes further: ${fold150.value} ms gives ${fold150.pace} cards/s.`,
      tune: t`Start at the pace you want. When the interval range's upper end is above this setting, the trips are the limit, not the beat: raise the interval, or turn on \`held speed-up\` or \`fold while held\`. With held speed-up alone, ${hs225.value} ms is the shortest value swept that is clean.`,
    };
  },
  "setting.slack": (f) => {
    const s0 = f.slack(0),
      s1 = f.slack(0.1),
      s2 = f.slack(0.15),
      s3 = f.slack(0.3),
      s5 = f.slack(0.5);
    const e = f.sweep("slack", "even");
    const e0 = e.at(0),
      e3 = e.at(0.3);
    const fo = f.sweep("slack", "fold");
    const f0 = fo.at(0),
      f1 = fo.at(0.1),
      f2 = fo.at(0.2),
      f3 = fo.at(0.3);
    f.expect(
      s1.raw.problems === 0 && s2.raw.problems > 0,
      "gate slack is clean through its lower value and fails at the next",
    );
    f.expect(
      s5.neverSettled,
      "a held ↓ never settles at the largest slack measured",
    );
    f.expect(
      Math.abs(rate(e0) - rate(e3)) < 0.1,
      "gate slack does not change an even pace",
    );
    f.expect(rate(f2) > rate(f0), "gate slack speeds up a fold");
    return {
      what: "How early the next press may start: how far the card before it may still be short of its flip, the moment it passes behind the pile.",
      effect: [
        [
          "Raise",
          t`The next card starts sooner: ${s0.rate} cards/s at ${s0.value}, ${s1.rate} at ${s1.value}, ${s3.rate} at ${s3.value}. Cards begin to overlap: at ${s2.value} the checker finds ${s2.verdict} (two cards change draw order while they overlap), at ${s3.value} it finds ${s3.verdict}.`,
        ],
        [
          "Lower",
          t`At ${s0.value} each press waits until the card before it has passed its flip: the reviewed behaviour.`,
        ],
      ],
      needs: t`It matters only with \`tempo\` = none. Under a tempo the planned interval outlasts the gate, so held ↑ / ↓ stays ${e0.pace} cards/s (${e3.pace} at ${e3.value}) and the slider is hidden. With fold on, slack lifts ${f0.pace} to ${f2.pace} cards/s at ${f2.value}, with ${f1.verdict} at ${f1.value} and ${f3.verdict} at ${f3.value}.`,
      tune: t`Start at ${s0.value}. ${s1.value} is the largest value on the slider with a clean sweep on \`natural\` (${s1.rate} cards/s). The slider stops at ${s3.value} because at ${s5.value} a held ↓ never settles (${s5.rate} cards/s, ${s5.problems} problems). For more pace than ${s1.value} allows, raise \`edge budget, tap\` or turn on fold.`,
    };
  },

  // ---- held keys ----------------------------------------------------------------------------------
  "setting.ramp": (f) => {
    const nat = f.preset("natural");
    const ehs = f.preset("even + held speed");
    const s = f.sweep("w1", "held speed-up alone");
    const alone = s.start,
      a35 = s.at(3.5);
    f.expect(
      rate(alone) > nat.raw.heldUp && !alone.clean && a35.clean && ehs.clean,
      "held speed-up alone is faster than natural and not clean at its defaults",
    );
    return {
      what: "While a key is held, stiffen the springs and raise the edge budget, so cards move faster once the hold delay has passed.",
      effect: [
        [
          "On",
          t`After the hold delay the spring goes from ${f.def("w0")} to ${f.def("w1")} Hz and the edge budget from ${f.def("cap")} to ${f.def("cap1")} px/frame, ${f.rise.level} of the way in about ${f.rise.seconds} s. On \`natural\` that lifts held ↑ / ↓ from ${nat.pace} to ${alone.pace} cards/s. Taps do not change.`,
        ],
        ["Off", "Springs and budget keep their tap values for the whole hold."],
      ],
      needs: t`Shows \`hold delay\`, \`spring Hz, held\` and \`edge budget, held\`; a setting that hides keeps its value. Fold includes this effect, so the toggle hides while fold is on. On its own it leaves ${alone.verdict} and a worst step-to-step change of ${alone.step}× (${nat.step}× in \`natural\`); a tempo spaces the presses and clears the problems, as in \`even + held speed\`.`,
      tune: t`Start from \`even + held speed\`; switching this on alone leaves problems. Alone, a \`spring Hz, held\` of ${a35.value} is clean (${a35.pace} cards/s) and the default ${alone.value} gives ${alone.verdict}. Then use \`hold delay\` to choose when the speed-up begins.`,
    };
  },
  "setting.fold": (f) => {
    const p = f.preset("fold");
    const nat = f.preset("natural");
    const c = f.sweep("tms", "fold with constant").at(150);
    const w = f.sweep("w1", "fold").at(5);
    const over = f.sweep("w1", "fold").at(6);
    f.expect(
      p.clean && w.clean && !over.clean && c.clean,
      "fold is clean at its defaults and at the values quoted",
    );
    return {
      what: "While a key is held, shrink every card toward its header line, so a trip no longer depends on how tall the card is.",
      effect: [
        [
          "On",
          t`After the hold delay every card shrinks to a ${f.def("h0")} px strip, ${f.rise.level} of the way in about ${f.rise.seconds} s. The \`fold\` preset reaches ${p.pace} cards/s with intervals of ${p.range} ms. The card you land on unfolds when you release.`,
        ],
        [
          "Off",
          t`Cards keep their full height and the pace follows it (${nat.pace} cards/s in \`natural\`).`,
        ],
      ],
      needs: t`Includes the held speed-up, so \`held speed-up\` hides while fold is on. Shows \`hold delay\`, \`spring Hz, held\`, \`edge budget, held\` and \`folded height\`. A tap shorter than the hold delay does not fold, and a hold that reaches the end of the queue unfolds on arrival.`,
      tune: t`Start from the \`fold\` preset (${p.clean ? "clean" : p.problems}). Move the pace with \`hold delay\`, then \`folded height\`, then \`spring Hz, held\`: ${w.value} Hz is clean (${w.pace} cards/s) and ${over.value} Hz gives ${over.verdict}. For an even pace while folded, set \`tempo\` to constant: ${c.value} ms gives ${c.pace} cards/s.`,
    };
  },
  "setting.delay": (f) => {
    const fo = f.sweep("delay", "fold");
    const f0 = fo.at(0),
      f250 = fo.at(250),
      f600 = fo.at(600),
      f800 = fo.at(800);
    const e = f.sweep("delay", "even + held speed");
    const e0 = e.at(0),
      e800 = e.at(800);
    const a = f.sweep("delay", "held speed-up alone");
    const a600 = a.at(600);
    f.expect(
      rate(f0) > rate(f250) &&
        rate(f250) > rate(f600) &&
        rate(f600) > rate(f800),
      "a longer hold delay is slower on fold",
    );
    f.expect(
      [f0, f250, f600, f800].every((r) => r.clean),
      "every hold delay value is clean on fold",
    );
    f.expect(
      !a600.clean,
      "a long hold delay adds problems to held speed-up alone",
    );
    f.expect(
      Math.abs(rate(e0) - rate(e800)) < 0.1,
      "hold delay does not move an even pace",
    );
    const tap = f.tap(150);
    const t0 = tap.peak(0),
      t100 = tap.peak(100),
      t250 = tap.peak(250);
    f.expect(
      t0.raw > 0.3 && t100.raw > 0 && t250.raw === 0,
      "a short delay lets a tap start the held state and the default does not",
    );
    return {
      what: "How long a key must be held before the held state begins, in ms.",
      effect: [
        [
          "Raise",
          t`The first cards of a hold run at tap pace for longer, then the pace steps up. On \`fold\`, ${f600.value} ms gives ${f600.pace} cards/s against ${f250.pace} at ${f250.value}, and the worst step-to-step change grows from ${f250.step}× to ${f600.step}×.`,
        ],
        [
          "Lower",
          t`The held state starts with the first press: on \`fold\`, ${f0.value} ms gives ${f0.pace} cards/s. A tap starts it too: a ${tap.ms} ms tap reaches a held state of ${t0.peak} at a delay of ${t0.delay} ms, ${t100.peak} at ${t100.delay} ms and ${t250.peak} at ${t250.delay} ms.`,
        ],
      ],
      needs: t`Needs \`held speed-up\` or \`fold while held\`. Under a tempo the plan sets the pace and the delay changes nothing measurable: \`even + held speed\` holds ${e0.pace} cards/s at ${e0.value} ms and ${e800.pace} at ${e800.value} ms. The held state reaches ${f.rise.level} about ${f.rise.seconds} s after the delay.`,
      tune: t`Start at ${f.def("delay")}. Lower it until a normal tap begins to fold or speed up, then back off. On \`fold\` all four values swept (${f0.value} to ${f800.value} ms) are clean, so it is the safe knob for pace. With held speed-up alone a long delay adds problems: ${a600.verdict} at ${a600.value} ms.`,
    };
  },
  "setting.w1": (f) => {
    const fo = f.sweep("w1", "fold");
    const f3 = fo.at(3),
      f45 = fo.at(4.5),
      f5 = fo.at(5),
      f6 = fo.at(6);
    const a = f.sweep("w1", "held speed-up alone");
    const a3 = a.at(3),
      a35 = a.at(3.5),
      a7 = a.at(7);
    const e = f.sweep("w1", "even + held speed");
    const e3 = e.at(3),
      e7 = e.at(7);
    f.expect(
      rate(f3) < rate(f45) && rate(f45) < rate(f5) && rate(f5) < rate(f6),
      "a stiffer held spring speeds up a fold",
    );
    f.expect(
      f5.clean && !f6.clean && a35.clean && !a7.clean,
      "held spring values are clean up to the ones quoted",
    );
    f.expect(
      Math.abs(rate(e3) - rate(e7)) < 0.1,
      "the held spring does not move an even pace",
    );
    return {
      what: "The spring stiffness a held key ramps up to.",
      effect: [
        [
          "Raise",
          t`Cards snap faster once the held state is in. On \`fold\`, ${f3.value} Hz gives ${f3.pace} cards/s, ${f45.value} gives ${f45.pace} and ${f6.value} gives ${f6.pace}. On held speed-up alone, ${a35.value} gives ${a35.pace} and ${a7.value} gives ${a7.pace}.`,
        ],
        [
          "Lower",
          t`The held state moves more like a tap: at ${a3.value} Hz, the tap spring's default, the speed-up comes from the edge budget alone (${a3.pace} cards/s on held speed-up alone).`,
        ],
      ],
      needs: t`Needs \`held speed-up\` or \`fold while held\`. \`edge budget, held\` caps what a stiffer spring can do. Under a tempo it leaves the pace alone, since the plan sets the interval: \`even + held speed\` stays at ${e3.pace} cards/s from ${e3.value} to ${e7.value} Hz.`,
      tune: t`Start at ${f.def("w1")}. On \`fold\`, ${f5.value} Hz is clean (${f5.pace} cards/s) and ${f6.value} Hz gives ${f6.verdict}. On held speed-up alone, ${a35.value} Hz is clean and ${a7.value} Hz gives ${a7.verdict}. If a raise adds swaps, add a tempo before you lower the spring.`,
    };
  },
  "setting.cap1": (f) => {
    const fo = f.sweep("cap1", "fold");
    const f24 = fo.at(24),
      f30 = fo.at(30),
      f39 = fo.at(39),
      f40 = fo.at(40);
    const a = f.sweep("cap1", "held speed-up alone");
    const a24 = a.at(24),
      a30 = a.at(30),
      a39 = a.at(39);
    const e = f.sweep("cap1", "even + held speed");
    const e24 = e.at(24),
      e30 = e.at(30),
      e39 = e.at(39),
      e40 = e.at(40);
    f.expect(
      rate(f24) < rate(f30) && rate(f30) < rate(f39),
      "a higher held budget speeds up a fold",
    );
    f.expect(
      f39.clean && e39.clean && !f40.clean && !e40.clean && !e24.clean,
      "held budget values are clean through the last one below the jump limit",
    );
    f.expect(
      !a24.clean && !a30.clean && !a39.clean,
      "held speed-up alone is not clean at any held budget",
    );
    f.expect(
      Math.abs(rate(e30) - rate(e39)) < 0.1,
      "the held budget does not move an even pace",
    );
    return {
      what: "The edge budget a held key ramps up to, in px per frame.",
      effect: [
        [
          "Raise",
          t`Held trips get faster. On \`fold\`, ${f24.value} gives ${f24.pace} cards/s, ${f30.value} gives ${f30.pace} and ${f39.value} gives ${f39.pace}. On held speed-up alone the same three give ${a24.pace}, ${a30.pace} and ${a39.pace}.`,
        ],
        [
          "Lower",
          t`Below the tap budget (${f.def("cap")}) a hold moves slower than a tap would and cards start to collide: \`even + held speed\` at ${e24.value} gives ${e24.verdict}.`,
        ],
      ],
      needs: t`Needs \`held speed-up\` or \`fold while held\`. The held spring decides how hard a card tries to move and the budget limits it. Under a tempo the pace stays put: \`even + held speed\` holds ${e30.pace} cards/s at ${e30.value} and at ${e39.value}.`,
      tune: t`Start at ${f.def("cap1")}, the shipped engine's peak edge speed. ${f39.value} is the highest clean value on \`fold\` and \`even + held speed\`. At ${f40.value} the checker reports jumps (an edge moved over ${f.limit.jump} px in a frame): ${f40.problems} on \`fold\`, ${e40.problems} on \`even + held speed\`. Held speed-up alone is not clean at any value on the slider.`,
    };
  },
  "setting.h0": (f) => {
    const s = f.sweep("h0");
    const h50 = s.at(50),
      h60 = s.at(60),
      h73 = s.at(73),
      h110 = s.at(110),
      h130 = s.at(130),
      h160 = s.at(160);
    f.expect(
      rate(h60) > rate(h73) &&
        rate(h73) > rate(h110) &&
        rate(h110) > rate(h130),
      "a taller fold is slower",
    );
    f.expect(
      h60.clean && h73.clean && h130.clean && !h50.clean && !h160.clean,
      "folded heights from the lower to the upper quoted value are clean",
    );
    return {
      what: "The height every card draws at while folded, in px. A card shorter than this grows to it.",
      effect: [
        [
          "Raise",
          t`More of each card stays visible and trips get longer: ${h73.value} gives ${h73.pace} cards/s, ${h110.value} gives ${h110.pace} and ${h130.value} gives ${h130.pace}. The shortest sample card is ${f.cards.min} px, so above ${f.def("h0")} short cards grow.`,
        ],
        [
          "Lower",
          t`A thinner strip and a faster hold: ${h60.value} gives ${h60.pace} cards/s. Below ${h60.value} the fade flickers: ${h50.value} gives ${h50.verdict} (a card's fade changes by more than ${f.limit.shade} in a frame).`,
        ],
      ],
      needs: t`Needs \`fold while held\`. A taller fold keeps more text but slows the hold, and past ${h130.value} cards swap draw order: ${h160.value} gives ${h160.verdict}.`,
      tune: t`Start at ${f.def("h0")}, one line of status and goal. Pick the height by what you want to read while scanning, and note the sweep is clean at ${h60.value}, ${h73.value}, ${h110.value} and ${h130.value} and fails at ${h50.value} and ${h160.value}. To change the pace without changing the look, use \`hold delay\`.`,
    };
  },
};

/** The commands behind a tooltip's numbers are collected as the entry reads them. */
function build(): Record<string, Help> {
  const out: Record<string, Help> = {};
  for (const [id, entry] of Object.entries(ENTRIES)) {
    const f = new Facts(__FACTS__);
    out[id] = { ...entry(f), numbers: f.sources() };
  }
  return out;
}

/** One entry per control id. */
export const HELP: Record<string, Help> = build();

// ---- the "How the drum works" panel ---------------------------------------------------------------

export type About = {
  paragraphs: string[];
  /** What each group of settings changes: [group, text]. */
  map: [group: string, text: string][];
  /** The commands that print the numbers above. */
  numbers: string[];
};

function buildAbout(): About {
  const f = new Facts(__FACTS__);
  return {
    paragraphs: [
      "Every card has one coordinate on a closed ring path: a pile slot (the front, two cards peeking above it, one hidden behind), the drop in front of the pile down to the `turn` (clear below the card it uncovers), and the tuck behind the pile. Each coordinate follows its own critically damped spring toward a target that depends only on which card is in front. A leaving card's target is two steps away, so it passes the turn still moving and slows into the tuck, and a returning card runs the ring backwards, which is what ↑ shows.",
      "The only change of draw order is at the turn, and a card crosses it only when it is clear of the cards it swaps with, so no card passes through another. A press is taken once every card in transit has passed its flip, so the pace is whatever the trips allow.",
      t`The frame checker counts four problems. A jump: an edge moves more than ${f.limit.jump} px in a frame. An edge flash: a card's lower edge changes by more than ${f.limit.band} px with nothing covering the change. A fade flicker: a card's fade changes by more than ${f.limit.shade} in a frame. A swap: two cards change draw order while they overlap. A sweep is clean when it finds none, over three sets of card heights. An edge budget of ${f.def("cap")} px/frame, ${f.def("cap1")} while held, caps every edge. Source: \`src/app/page/queue/drum.ts\`; goals and limits: \`DESIGN.md\`.`,
    ],
    map: [
      [
        "Taps",
        "`spring Hz, tap` and `edge budget, tap` set how fast one card travels.",
      ],
      ["Pace", "`tempo` and `gate slack` set when the next press may start."],
      [
        "Held keys",
        "`held speed-up` and `fold while held` change both once a key has been held past `hold delay`.",
      ],
    ],
    numbers: f.sources(),
  };
}
export const ABOUT: About = buildAbout();

/** The caption under the stack: what the active preset (or, for the product, the model) is. */
export const captionFor = (mode: string, preset: string): string =>
  mode === "drum"
    ? HELP[`preset.${preset}`]!.what
    : HELP["model.product"]!.what;
