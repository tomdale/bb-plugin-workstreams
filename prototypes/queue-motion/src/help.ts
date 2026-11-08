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
import {
  PATH_SETTINGS,
  PILE_CLEARANCE,
  SPEEDS,
  TALLEST_CARD,
  TAU,
  fadeCap,
} from "./controls.ts";
import { Facts, t, type RawFacts, type RowView } from "./facts.ts";

declare const __FACTS__: RawFacts;

const PEAK = PATH_SETTINGS.find((s) => s.key === "peak")!;
const PATH_PEAK_MIN = PEAK.kind === "range" ? PEAK.min : "";
const PATH_PEAK_MAX = PEAK.kind === "range" ? PEAK.max : "";
const rangeOf = (key: string) => {
  const s = PATH_SETTINGS.find((x) => x.key === key)!;
  return s.kind === "range" ? { min: s.min, max: s.max as number } : null;
};
const CROSS = rangeOf("cross")!;
const BANK = rangeOf("bank")!;

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
/** The cascade's held spring and held edge budget at their defaults, as the inspector shows them. */
const HELD = (f: Facts) => ({ hz: f.def("cw1"), budget: f.def("ccap1") });

const ENTRIES: Record<string, (f: Facts) => Draft> = {
  // ---- models ------------------------------------------------------------------------------------
  "model.product": () => ({
    what: "The queue's card stack as it ships: `stackEngine.ts`, imported without changes. It runs the drum with the settings in `QUEUE_CFG`.",
    effect: [
      [
        "Click",
        "Shows the motion the queue ships. ↓ drops the front card clear of the pile and tucks it behind; ↑ runs the same ring backwards. Every card takes the same time, and a held key speeds up after a short hold. The preset buttons and the model's modules disappear; Playback, Path and `Bezier path` stay.",
      ],
    ],
    needs:
      "Speed, clock and reduced motion work in every model. Presets and settings belong to the drum and the cascade.",
    tune: "Nothing to tune. Hold ↑ and ↓ here, then switch to `Elastic drum` with `natural`, or to `Cascade`, and hold the same keys to compare. Pause and Step turn any model into a frame you can read.",
  }),
  "model.drum": () => ({
    what: "The candidate model: each card follows one ring path on its own spring, and ↑ runs the same ring backwards.",
    effect: [
      [
        "Click",
        "↓ drops the front card clear of the pile and tucks it behind. ↑ brings a card up from just below the pile and slows it into the front. The drum's preset buttons and its modules, Taps, Pace and Held keys, appear in the inspector.",
      ],
    ],
    needs:
      "A preset sets a bundle of settings; the modules below it in the inspector adjust it. Speed, clock and reduced motion apply as in `Product now`.",
    tune: "Start with `natural`: hold ↑ and ↓, then try the other presets one at a time before you move a setting. `How the drum works` explains the path.",
  }),

  "model.cascade": (f) => {
    const c = f.preset("default");
    const nat = f.preset("natural");
    f.expect(
      c.clean &&
        c.raw.heldUp > 1.5 * nat.raw.heldUp &&
        c.raw.spread < 0.05 &&
        nat.raw.spread > 0.05,
      "the cascade's default is clean, much faster than natural, and holds one pace on every height set",
    );
    return {
      what: "The third model: a card that leaves slides down an exit channel in front of the pile and parks below the clip line, so a held key sends a train of cards down the screen and the pace does not follow card heights.",
      effect: [
        [
          "Click",
          "↓ slides the front card down in front of the pile and out through the clip line. ↑ brings a card back up from the clip line and slows it into the front. No card tucks behind the pile or changes draw order. The cascade's presets and its modules, Taps, Pace and Stage, appear in the inspector, and the stage is cut at the clip line.",
        ],
      ],
      needs: t`Speed, clock and reduced motion work as in the other models. The page cuts the stage at the clip line, \`park\` px (${f.def("park")} by default) below the front pose, so the stack takes that much page below the front card. The drum's presets and settings hide.`,
      tune: t`Hold ↓ and ↑ here, then switch to \`Elastic drum\` with \`natural\` and hold the same keys. The cascade holds ${c.onePace} cards/s on every card height (${c.spread} apart across the three sample sets) with a worst step-to-step change of ${c.step}×. \`natural\` holds ${nat.pace} cards/s, ${nat.spread} apart, with ${nat.step}× from one step to the next.`,
    };
  },

  // ---- presets -----------------------------------------------------------------------------------
  "preset.natural": (f) => {
    const p = f.preset("natural");
    const cap = f.sweep("cap").at(30);
    f.expect(p.clean && cap.clean, "natural and a tap budget of 30 are clean");
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
      tune: t`Start here. For an even pace choose \`even\`. To go faster without folding, raise \`edge budget, tap\` to ${cap.value} (${cap.pace}, ${cap.verdict}).`,
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

  "preset.loose": (f) => {
    const p = f.preset("loose");
    const nat = f.preset("natural");
    const fold = f.preset("fold");
    const s = f.sweep("tms", "loose");
    const fast = s.at(60),
      slow = s.at(150);
    f.expect(
      rate(p) > 1.4 * nat.raw.heldUp &&
        rate(fast) > rate(p) &&
        rate(p) > rate(slow),
      "loose is much faster than natural, and a shorter interval is faster",
    );
    return {
      what: t`Cards stay whole, but a held key clears a virtual height that shrinks like a fold, so the pace reaches ${p.pace} cards/s with a constant ${f.def("tms")} ms beat.`,
      effect: [
        [
          "Feels",
          "After the hold delay a leaving card drops only as far as it would clear a folded card, so it passes over the card it uncovers instead of around it, washing out as it goes. Every card is still drawn at full height.",
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms, worst step-to-step change ${p.step}×, largest edge move ${p.jump} px/frame, ${p.clean ? "no checker problems" : p.problems}. \`fold\` reaches ${fold.pace} cards/s on the same sets.`,
        ],
        [
          "Good for",
          "Holding a key at a fast, even pace while every card stays readable.",
        ],
      ],
      needs: t`Sets \`loosen clearing while held\`, which includes the held speed-up, and \`tempo\` to constant at ${f.def("tms")} ms. The checker counts the draw-order swaps and edge flashes that passing over a card causes, so this preset is not clean.`,
      tune: t`Move the beat with \`constant interval\`: ${fast.value} ms gives ${fast.pace} cards/s and ${slow.value} ms gives ${slow.pace}. \`held height\` sets how far a leaving card drops: lower is faster and passes over more of the card behind.`,
    };
  },
  "preset.default": (f) => {
    const p = f.preset("default");
    const nat = f.preset("natural");
    const off = f.preset("no held ramp");
    const s = f.sweep("sp1", "default");
    const tight = s.at(100),
      wide = s.at(216);
    f.expect(
      p.clean &&
        p.raw.heldUp > off.raw.heldUp &&
        rate(tight) > p.raw.heldUp &&
        p.raw.heldUp > rate(wide),
      "default is clean, faster than the preset without the ramp, and a tighter spacing is faster",
    );
    return {
      what: t`Every cascade setting at its default: after the hold delay a held key tightens the train, from cards ${f.def("sp0")} px apart to ${f.def("sp1")} px apart.`,
      effect: [
        [
          "Feels",
          t`A held key starts as a loose train and tightens as the held state rises. The pace is the same on every card height: ${p.spread} apart across the three sample sets, against ${nat.spread} on \`natural\`.`,
        ],
        [
          "Measured",
          t`Held pace ${p.onePace} cards/s up and down, intervals ${p.range} ms, worst step-to-step change ${p.step}×, ${p.clean ? "no checker problems" : p.problems}. A tap ↑ lands in ${p.tapUp} ms and a tap ↓ settles in ${p.tapDn} ms.`,
        ],
        [
          "Good for",
          "Holding a key through a mixed queue at a fast, even pace without folding.",
        ],
      ],
      needs: t`Sets nothing: clicking it clears every slider change and restores each default. The ramp is on, so \`spacing at rest\` and \`hold delay\` show.`,
      tune: t`Start here. \`spacing held\` sets the held pace: ${tight.value} px gives ${tight.onePace} cards/s and ${wide.value} px gives ${wide.onePace}. \`no held ramp\` runs the same train at a constant ${off.onePace}.`,
    };
  },
  "preset.no held ramp": (f) => {
    const p = f.preset("no held ramp");
    const d = f.preset("default");
    const s = f.sweep("sp1", "no held ramp");
    const tight = s.at(125),
      base = s.at(150),
      wide = s.at(216);
    f.expect(
      p.clean &&
        p.raw.heldUp < d.raw.heldUp &&
        rate(tight) > rate(base) &&
        rate(base) > rate(wide),
      "no held ramp is clean, slower than default, and a tighter spacing is faster",
    );
    return {
      what: "The same train with nothing speeding up while a key is held: it runs at the held spacing on the tap spring and the tap budget from the first repeat.",
      effect: [
        [
          "Feels",
          t`The first card and the last leave at the same spacing, so the pace is the same all the way: ${p.onePace} cards/s against ${d.onePace} for \`default\`, which tightens while the key stays down.`,
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms (${d.range} in \`default\`), worst step-to-step change ${p.step}×, largest edge move ${p.jump} px/frame (${d.jump}), ${p.clean ? "no checker problems" : p.problems}.`,
        ],
        [
          "Good for",
          "Judging whether the speed-up earns its place: hold a key under both presets and compare.",
        ],
      ],
      needs: t`Turns the ramp off, so a held key changes nothing and \`spacing at rest\` and \`hold delay\` hide. \`spacing held\` and the tap settings still apply. Clicking it clears slider changes.`,
      tune: t`Move the pace with \`spacing held\`: ${tight.value} px gives ${tight.onePace} cards/s, ${base.value} gives ${base.onePace} and ${wide.value} gives ${wide.onePace}.`,
    };
  },

  // ---- speed, clock, reduced motion ---------------------------------------------------------------
  speed: () => ({
    what: t`How fast the page's clock runs, for every model: ${SPEEDS.map((s) => s.label).join(", ")}.`,
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
      "Works in every model. The held state and the drum's tempo run on the page's clock, so a held key does not advance them while it is paused.",
    tune: "Press ↓, click Pause during the trip, then click Step to walk the rest of it one frame at a time.",
  }),
  "preset.save": () => ({
    what: "Saves every setting as it is now as a preset of the running model, under the name in the field beside it, in this browser's storage.",
    effect: [
      [
        "Click",
        "A chip with the name appears in the Saved row under the built-in presets, and a line under the field says it was saved. An empty name saves as `my preset` and a number; a saved preset's name replaces that preset; a built-in preset's name is refused. Enter in the field saves too.",
      ],
    ],
    needs:
      "Each model keeps its own saved presets, and the product has none. A saved preset records the built-in preset it starts from and every model, Path and Overlay or playback setting you have changed; speed, reduced motion and `Bezier path` stay as they are when you apply it. It lives in this browser's `localStorage`, so another browser or a cleared storage does not have it; `Copy settings` or the URL hash carries the same settings anywhere.",
    tune: "Save a configuration before you try something risky, then click its chip to come back to it. Save variants under names that say what they change.",
  }),
  "preset.saved": () => ({
    what: "A preset you saved with `Save preset`, kept in this browser.",
    effect: [
      [
        "Click",
        "Restores the settings it saved: the built-in preset it started from, marked too, and every setting it changed, model, Path and page alike. Any change since is replaced. The chip is marked while the settings match it.",
      ],
    ],
    needs:
      "Applying it rewrites the URL hash, which then carries its settings but not its name. Speed, reduced motion and `Bezier path` stay as they are. The × beside it deletes it.",
    tune: "Change a slider after applying it and the mark goes away; click the chip again to go back, or save under the same name to keep the change.",
  }),
  "preset.delete": () => ({
    what: "Deletes the saved preset beside it from this browser.",
    effect: [
      [
        "Click",
        "The chip goes away at once and a line under the name field says it was deleted. The settings on screen stay as they are.",
      ],
    ],
    needs:
      "There is no undo: save the settings again to bring it back. The built-in presets cannot be deleted.",
    tune: "Prune presets you no longer compare against, so the Saved row stays short.",
  }),
  "hold.down": (f) => ({
    what: "Simulates holding ↓ from the first card to the last: it moves the stack to the top first, then holds the key until the front reaches the end.",
    effect: [
      [
        "Click",
        t`The stack jumps to the first card and a held ↓ starts at once: one press, then a repeat every \`hold repeat interval ms\` (${f.def("kri")} ms) after \`hold repeat delay ms\` (${f.def("krd")} ms), as the OS repeats a held key. The key is released when the last card is in front. While it runs the button reads Stop; click it to release early.`,
      ],
    ],
    needs:
      "It runs on the page's clock, so Speed, Pause and Step apply to it, and the model's hold settings (held speed-up, fold, loose clearing, hold delay) react as they do to a real key. A real ↑ or ↓, a model button or Reduced motion stops it. Hidden under reduced motion, where a held key moves one card.",
    tune: "Use it to compare presets on the same run from end to end: click it, watch at `¼×`, then change one setting and run it again.",
  }),
  "hold.up": (f) => ({
    what: "Simulates holding ↑ from the last card to the first: it moves the stack to the bottom first, then holds the key until the first card is back in front.",
    effect: [
      [
        "Click",
        t`The stack jumps to the last card and a held ↑ starts at once, repeating every ${f.def("kri")} ms after ${f.def("krd")} ms with the Hold settings as they are, and is released when the first card is in front. While it runs the button reads Stop.`,
      ],
    ],
    needs:
      "The same as `↓ from top`, the other way: every card comes back from behind the pile, so it shows the incoming fade, the covered card's fade and the rise through the turn.",
    tune: "Run it after `↓ from top` to check that returning cards look as good as leaving ones.",
  }),
  "setting.krd": (f) => ({
    what: "How long a simulated hold waits after its first press before it starts repeating, as the OS's key repeat delay.",
    effect: [
      [
        "Raise",
        "A longer pause after the first card leaves before the run speeds up, like a slow repeat delay in the system's keyboard settings.",
      ],
      [
        "Lower",
        "The repeats start sooner, so the second card follows the first almost at once.",
      ],
    ],
    needs: t`Only the simulated holds read it; a real key repeats at the system's own rate. The model's \`hold delay ms\` is separate: it counts from the key going down before the held speed-up or fold starts. Default ${f.def("krd")} ms.`,
    tune: "Match it to the system setting you want to test: macOS's default delay is short, a long one shows how a tap followed by a hold feels.",
  }),
  "setting.kri": (f) => ({
    what: "How often a simulated hold repeats its press, in ms, as the OS's key repeat rate.",
    effect: [
      [
        "Raise",
        "Fewer presses arrive per second. Once the interval is longer than a trip, the pace follows the repeats instead of the model.",
      ],
      [
        "Lower",
        "Presses arrive faster than the model takes them, so the pace is the model's own and the extra presses wait or are dropped.",
      ],
    ],
    needs: t`Only the simulated holds read it. The drum takes at most one waiting press, so a fast repeat never queues a backlog. Default ${f.def("kri")} ms, about the rate of a fast system key repeat.`,
    tune: "Leave it fast to see the model's own pace; slow it to see how the stack copes with a slow keyboard.",
  }),
  copy: () => ({
    what: "Copies the current settings to the clipboard as Markdown, to paste into a note, an issue or a chat.",
    effect: [
      [
        "Click",
        "The button reads `Copied` for a moment. The text lists the model, preset, speed, reduced motion, `Bezier path` and the URL hash, then a line naming every setting that differs from its preset or default, then one table per inspector module of every setting it shows, with the changed values in bold beside the preset's or default value.",
      ],
    ],
    needs:
      "It copies only what the inspector shows: a setting that changes nothing under the current model and configuration is hidden, so it is left out. The hash line restores the whole state when pasted after the page's address.",
    tune: "Set up the motion you want to share, then click it and paste. Compare two copies to see what changed between them.",
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
      needs: "Works in every model and with every preset.",
      tune: t`Press ↓ once, then click Step to count the frames from the press to the landing: on \`natural\` a tap ↓ settles in ${p.tapDn} ms, about ${frames} frames.`,
    };
  },
  reduced: (f) => ({
    what: "Replaces card motion with a cut and a fade, as the page does when the system asks for reduced motion.",
    effect: [
      [
        "On",
        t`No card moves. The heading changes at once and the new front card fades in over \`reduced fade ms\` (${f.def("rfade")} ms by default). A held key moves one card: its repeat is ignored, so press again for the next.`,
      ],
      ["Off", "Cards move as the active model draws them."],
    ],
    needs:
      "The page also turns it on when the system setting `prefers-reduced-motion` is set. It applies to every model and overrides every preset and setting, which have no effect while it is on. While it is on, the inspector hides what it overrides: Playback shows `reduced fade ms` in place of `heading fade ms` and drops the held readout, the model's Taps, Pace and Held keys modules hide (the cascade's Stage stays, since it still cuts the stage), and the Path module hides unless `Bezier path` is on.",
    tune: "Use it to check the fallback: press ↓ and ↑ and look for a calm cut with nothing sliding. Turn it off to compare with the motion.",
  }),
  path: (f) => ({
    what: "Draws the path each moving card's top edge follows on the stage, as cubic Bezier segments with their control handles, anchors and a live marker for each card.",
    effect: [
      [
        "On",
        t`Shows the drum's ring as one rounded loop: down in front of the pile, across the column at the \`turn\`, and up behind the pile to the \`tuck\`, with a ring at each leg's widest point. With the default Path settings it bows ${f.def("sway")} px to the right in front and ${Math.abs(Number(f.def("swayb")))} px to the left behind. ↓ runs it forwards and ↑ backwards. The cascade shows one bow down the exit channel to \`park\`. The pile spine and a dot for each painted card are drawn too; the module's toggles turn each part off.`,
      ],
      ["Off", "Hides the overlay; cards still follow the same path."],
    ],
    needs:
      "Works in every model. While it is on, the `Bezier path` module shows what the overlay draws: control handles, knots, direction arrows, labels, the pile spine and card markers. The Path module's settings shape the curve whether or not it is drawn. The vertical motion is each model's own, so springs, budgets and the frame checker are unchanged. The loop drawn is the one for the moving card nearest the front, or the front card at rest. Reduced motion removes the sway, but the overlay still draws the path a card would follow.",
    tune: "Turn it on with `¼×` speed, or click Pause and Step during a press, then move the Path sliders and watch each card's marker ride the loop.",
  }),
  held: (f) => ({
    what: "A readout of the held state, from zero (tap behaviour) to one (the full speed-up, fold or ramp), shown while one of them is on.",
    effect: [
      [
        "Reads",
        t`Zero through a tap and through the hold delay, ${f.rise.level} about ${f.rise.seconds} s after the delay ends, and falling back when you release the key or the hold reaches the end of the queue.`,
      ],
      [
        "Drives",
        "The spring and the edge budget slide from their tap values to their held values as it rises. The drum's fold shrinks the cards with it, and the cascade's ramp tightens the spacing between cards.",
      ],
    ],
    needs:
      "`hold delay` sets when it starts to rise; the rate is fixed. It is hidden unless `held speed-up` or `fold while held` is on in the drum, or the cascade's ramp is on (`no held ramp` turns it off).",
    tune: "Watch it during a hold. If it is still near zero once your key repeat settles into a rhythm, lower the hold delay.",
  }),
  about: () => ({
    what: "A short account of the ring the drum is built on, and which settings act on which part of it.",
    effect: [
      [
        "Click",
        "Opens the panel below it, at the foot of the inspector. Nothing on the page moves.",
      ],
    ],
    needs:
      "The inspector's modules map to parts of the model: Taps to how one card travels, Pace to when the next press may start, Held keys to what changes once a key has been held. The product runs the drum too, with the settings it ships.",
    tune: "Read it once before you move a setting, and again when two settings seem to fight. Its last paragraph defines the four problems the frame checker counts and what `clean` means here. Every tooltip reads in four steps: what the control is, what raising or lowering it does, what it works with, and how to tune it.",
  }),
  "about.cascade": () => ({
    what: "A short account of the exit channel the cascade is built on, and which settings act on which part of it.",
    effect: [
      [
        "Click",
        "Opens the panel below it, at the foot of the inspector. Nothing on the page moves.",
      ],
    ],
    needs:
      "The inspector's modules map to parts of the model: Taps to how one card travels, Pace to how far apart cards leave and when the pace builds, Stage to where cards park and how they leave the page.",
    tune: "Read it once before you move a setting, and again when two settings seem to fight. Its last paragraph defines the four problems the frame checker counts and what `clean` means here.",
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
      slow.clean && base.clean && !snappy.clean && !hard.clean,
      "the two lower tap spring values are clean and the two higher fail",
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
      tune: t`Start at ${base.value} and press ↑ once after each small change: ↑ is the slowest trip, so lag or a hard landing shows there first. ${slow.value} and ${base.value} Hz pass the frame checker; ${snappy.value} gives ${snappy.verdict} and ${hard.value} gives ${hard.verdict}. Past ${snappy.value} the landing speed also climbs (${hard.landSpeed} px/frame at ${hard.value}) and the largest edge move in a hold reaches ${hard.jump} px/frame against a budget of ${f.def("cap")}.`,
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
  "setting.fadein": (f) => {
    const s = f.sweep("fadein");
    const off = s.at(0),
      slow = s.at(4),
      base = s.at(8),
      over = s.at(9),
      top = s.at(12);
    f.expect(
      [off, slow, base].every((r) => r.clean) && !over.clean && !top.clean,
      "the incoming fade-in is clean through its default and fails above it",
    );
    f.expect(
      up(off) === up(base) && dn(off) === dn(base),
      "the incoming fade-in does not change the landing times",
    );
    return {
      what: "How fast a card coming back (a ↑) regains its colour, in shade per second, counted from the moment it starts to move. 0 lets it regain its colour along its path instead.",
      effect: [
        [
          "Raise",
          t`The returning card is opaque sooner: at ${base.value} per second a card that starts washed out is whole in about a tenth of a second, and at ${slow.value} it takes about a sixth.`,
        ],
        [
          "Lower",
          t`The card stays hazy for longer, until it has moved. At ${off.value} it regains its colour only as it travels, so it is hazy until it is nearly in front.`,
        ],
      ],
      needs: t`It acts only on a card coming back, and takes its wash with it. No position or timing changes: a tap ↑ lands in ${base.upLand} ms at every value. The fade is limited to ${f.limit.shade} in a frame by the checker: ${base.value} per second is ${base.verdict} and ${over.value} gives ${over.verdict}.`,
      tune: t`Start at ${base.value}. Above it the checker reports a fade flicker, ${top.value} gives ${top.problems}; below it the returning card looks hazier for longer.`,
    };
  },
  "setting.cover": (f) => {
    const s = f.sweep("cover");
    const off = s.at(0),
      half = s.at(0.7),
      full = s.at(1);
    f.expect(
      [off, half, full].every((r) => r.clean),
      "the covered card fade is clean at none, 0.7 and full",
    );
    f.expect(
      Math.abs(rate(off) - rate(full)) < 0.1 &&
        dn(off) === dn(full) &&
        up(off) === up(full),
      "the covered card fade does not change the pace or the landing times",
    );
    return {
      what: "How far the content of the card a rising card is about to cover fades, from 0 (it stays) to 1 (gone). It acts on ↑ only. The card's frame and background are not faded, and the card shrinks to the height it has under the front card.",
      effect: [
        [
          "Raise",
          "The old front card's text is gone as soon as the card coming back leaves its tuck, so it does not show through the edge of the rising card. Its frame and background keep the colour they have in the pile, so nothing brightens when the rising card lands.",
        ],
        [
          "Lower",
          t`The text stays until the rising card is on it. At ${off.value} the content does not fade early; the card still shrinks to its pile height.`,
        ],
      ],
      needs: t`The content fades as the rising card leaves the tuck and comes back once it has landed, when the card is a strip behind it. A card moving into the front on a ↓ never loses its content. The drawn bottom edge shrinks at a limited rate, so it never jumps. No position or timing changes: a tap ↑ lands in ${full.upLand} ms and held ↑ / ↓ runs at ${full.pace} cards/s at every value, ${full.verdict} at ${full.value}.`,
      tune: t`Start at ${full.value}. Lower it to ${half.value} to keep a trace of the text while the card is covered.`,
    };
  },
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
      needs: t`\`lookahead\` shows \`tempo window\` and \`tempo scale\`; \`constant\` shows \`constant interval\`. A tempo only delays a press: the cards' own gate still sets the earliest start.`,
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
      fold150 = fo.at(150),
      fold80 = fo.at(80);
    f.expect(
      rate(base) > rate(slow) &&
        rate(mid) > rate(base) &&
        rate(fast) > rate(mid),
      "a shorter constant interval is faster",
    );
    f.expect(
      fold150.clean && fold80.clean && rate(hs200) > rate(hs225),
      "fold holds 150 and 80 ms cleanly, and a shorter beat with held speed-up is faster",
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
      needs: t`Only \`tempo\` = constant uses it. Held speed-up shortens trips, so the beat can run faster: with it on, ${hs225.value} ms holds ${hs225.range} ms at ${hs225.pace} cards/s, ${hs225.verdict}, while ${hs200.value} ms gives ${hs200.verdict}. Fold goes further: ${fold150.value} ms gives ${fold150.pace} cards/s and ${fold80.value} ms gives ${fold80.pace}, ${fold80.verdict}, with intervals ${fold80.range} ms.`,
      tune: t`Start at the pace you want. When the interval range's upper end is above this setting, the trips are the limit, not the beat: raise the interval, or turn on \`held speed-up\` or \`fold while held\`. With held speed-up alone the checker finds ${hs225.verdict} at ${hs225.value} ms and ${hs200.verdict} at ${hs200.value}: a swap or two moves between values, so judge by feel.`,
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
  "setting.loose": (f) => {
    const p = f.preset("loose");
    const nat = f.preset("natural");
    const s = f.sweep("tms", "loose");
    const slow = s.at(150),
      fast = s.at(60);
    f.expect(
      rate(p) > nat.raw.heldUp && rate(fast) > rate(slow),
      "loose clearing is faster than natural, and a shorter interval is faster",
    );
    return {
      what: "While a key is held, clear a virtual height that shrinks toward the held height, so a leaving card no longer has to drop below the full height of the card it uncovers. Cards are still drawn whole.",
      effect: [
        [
          "On",
          t`After the hold delay a leaving card drops only as far as a card of ${f.def("h0")} px would need, ${f.rise.level} of the way in about ${f.rise.seconds} s. It passes over the card it uncovers, washing out, and goes behind it. With a constant beat the \`loose\` preset reaches ${p.pace} cards/s (${nat.pace} in \`natural\`).`,
        ],
        [
          "Off",
          "A leaving card clears the full height of the card it uncovers.",
        ],
      ],
      needs: t`Includes the held speed-up, so \`held speed-up\` hides while it is on. Shows \`hold delay\`, \`spring Hz, held\`, \`edge budget, held\` and \`held height\`. Fold already shrinks the heights, so this toggle hides while fold is on. Draw-order swaps and edge flashes are expected: ${p.clean ? "none" : p.problems} here.`,
      tune: t`Start from the \`loose\` preset. Use \`tempo\` constant to set the beat (${fast.value} ms gives ${fast.pace} cards/s, ${slow.value} ms gives ${slow.pace}), \`held height\` for how far cards drop, and \`hold delay\` for when it begins.`,
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
      f39.clean && e30.clean && !e39.clean && !f40.clean && !e40.clean,
      "a fold is clean through the last held budget below the jump limit, and even + held speed through 30",
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
      h50.clean && h60.clean && h73.clean && h130.clean && !h160.clean,
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
          t`A thinner strip and a faster hold: ${h60.value} gives ${h60.pace} cards/s. ${h50.value} gives ${h50.pace} and is ${h50.verdict}, but a strip that thin leaves little to recognise.`,
        ],
      ],
      needs: t`Needs \`fold while held\` or \`loosen clearing while held\`. A taller fold keeps more text but slows the hold, and past ${h130.value} cards swap draw order: ${h160.value} gives ${h160.verdict}.`,
      tune: t`Start at ${f.def("h0")}, one line of status and goal. Pick the height by what you want to read while scanning, and note the sweep is clean from ${h50.value} to ${h130.value} and fails at ${h160.value}. To change the pace without changing the look, use \`hold delay\`.`,
    };
  },

  // ---- the cascade's settings ----------------------------------------------------------------------
  "setting.cw0": (f) => {
    const s = f.sweep("cw0");
    const slow = s.at(2),
      base = s.at(3),
      snappy = s.at(4.5),
      hard = s.at(6);
    f.expect(
      up(slow) > up(base) && up(base) > up(snappy) && up(snappy) > up(hard),
      "a stiffer tap spring lands ↑ sooner",
    );
    f.expect(
      dn(slow) > dn(base) && dn(base) > dn(snappy) && dn(snappy) > dn(hard),
      "a stiffer tap spring settles ↓ sooner",
    );
    f.expect(
      speed(slow) < speed(base) &&
        speed(base) < speed(snappy) &&
        speed(snappy) < speed(hard),
      "a stiffer tap spring lands harder",
    );
    f.expect(
      [slow, base, snappy, hard].every((r) => r.clean && r.pace === base.pace),
      "every tap spring value is clean and holds the same pace",
    );
    return {
      what: "How stiff each card's spring is, in Hz: how fast a card speeds up and slows along its trip. It sets a tap, and a held key until the ramp starts.",
      effect: [
        [
          "Raise",
          t`Cards reach their places sooner and stop harder. A tap ↑ lands in ${base.upLand} ms at ${base.value} Hz and ${snappy.upLand} ms at ${snappy.value}; a tap ↓ settles in ${base.dnLand} ms and ${snappy.dnLand} ms. The speed left in the last five frames rises from ${base.landSpeed} to ${snappy.landSpeed} px/frame, and to ${hard.landSpeed} at ${hard.value} Hz.`,
        ],
        [
          "Lower",
          t`Cards drift in. At ${slow.value} Hz a tap ↑ takes ${slow.upLand} ms and a tap ↓ ${slow.dnLand} ms, and the landing speed falls to ${slow.landSpeed} px/frame.`,
        ],
      ],
      needs: t`The held pace stays at ${base.onePace} cards/s for every value swept, because the spacing and the edge budget set it. With the ramp on, a held key's spring rises from this value to ${HELD(f).hz} Hz after \`hold delay\`. \`edge budget, tap\` limits how far an edge moves in a frame.`,
      tune: t`Start at ${base.value}. Press ↑ after each change: it is the slowest trip, so a lag or a hard landing shows there first. All four values swept, ${slow.value} to ${hard.value} Hz, pass the frame checker, so the limit is how the landing feels: the cards stop at ${snappy.landSpeed} px/frame at ${snappy.value} Hz and ${hard.landSpeed} at ${hard.value} Hz.`,
    };
  },
  "setting.ccap": (f) => {
    const s = f.sweep("ccap");
    const lo = s.at(16),
      base = s.at(24),
      mid = s.at(30),
      high = s.at(36),
      over = s.at(40);
    f.expect(
      rate(lo) < rate(base) &&
        rate(base) < rate(mid) &&
        rate(mid) < rate(high) &&
        rate(high) < rate(over),
      "a higher tap budget speeds up a hold",
    );
    f.expect(
      up(lo) > up(base) && up(base) > up(mid) && up(mid) > up(over),
      "a higher tap budget lands ↑ sooner",
    );
    f.expect(
      [lo, base, mid, high].every((r) => r.clean) && !over.clean,
      "the tap budget is clean through its last value below the jump limit and fails at the limit",
    );
    f.expect(
      dn(lo) === dn(base) && dn(base) === dn(over),
      "the tap budget leaves tap ↓ alone",
    );
    return {
      what: "The most any card edge may move in one frame, in px per frame, for a tap and for a held key until the ramp starts. The pace gate uses it too: it waits the spacing divided by this speed between cards.",
      effect: [
        [
          "Raise",
          t`The fastest part of every trip gets faster. A tap ↑ lands in ${base.upLand} ms at ${base.value} and ${over.upLand} ms at ${over.value}. Held pace rises from ${base.onePace} to ${mid.onePace} cards/s at ${mid.value} and ${over.onePace} at ${over.value}. Tap ↓ stays at ${base.dnLand} ms.`,
        ],
        [
          "Lower",
          t`Trips flatten into a steady slide: at ${lo.value} a tap ↑ takes ${lo.upLand} ms, and held pace falls to ${lo.onePace} cards/s with intervals of ${lo.range} ms.`,
        ],
      ],
      needs: t`Once the ramp starts, a held key's budget rises to ${HELD(f).budget} px/frame, set by \`edge budget, held\`, so this setting moves the held pace only a little. The spring decides how hard a card tries to move and the budget limits it where the spring asks for more, so tap ↓ does not change.`,
      tune: t`Start at ${base.value}. ${high.value} is clean (${high.onePace} cards/s). At ${over.value} the checker reports ${over.verdict}: a tap moves an edge as far as the budget, and that is over ${f.limit.jump} px in a frame. For a faster held key, lower \`spacing held\` instead.`,
    };
  },
  "setting.sp0": (f) => {
    const s = f.sweep("sp0");
    const tight = s.at(150),
      base = s.at(216),
      wide = s.at(300);
    f.expect(
      rate(tight) > rate(base) && rate(base) > rate(wide),
      "a wider spacing at rest is slower",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every spacing at rest value is clean",
    );
    f.expect(
      rate(tight) - rate(wide) < 1.5,
      "spacing at rest moves the pace of a hold by less than a card per second",
    );
    return {
      what: "How far apart cards leave the front when a hold begins, in px. The pace gate waits the spacing divided by the edge budget's speed between presses.",
      effect: [
        [
          "Raise",
          t`The first cards of a hold leave farther apart and later. At ${wide.value} px the hold runs at ${wide.onePace} cards/s with intervals of ${wide.range} ms, against ${base.onePace} and ${base.range} at ${base.value}.`,
        ],
        [
          "Lower",
          t`The hold starts closer to full pace. At ${tight.value} px, the default of \`spacing held\`, the hold runs at ${tight.onePace} cards/s, and the median card shows ${tight.visible} px of itself at its best against ${base.visible} at ${base.value}.`,
        ],
      ],
      needs: t`Shows only while the ramp is on; \`no held ramp\` hides it. The ramp moves the spacing from this value to \`spacing held\` as the held state rises after \`hold delay\`.`,
      tune: t`Start at ${base.value}. This setting shapes the start of a hold more than its pace: from ${tight.value} to ${wide.value} px the pace of a hold moves from ${tight.onePace} to ${wide.onePace} cards/s, and every value is clean. Raise it to make the speed-up easier to see; set the pace with \`spacing held\`.`,
    };
  },
  "setting.sp1": (f) => {
    const s = f.sweep("sp1", "default");
    const tight = s.at(100),
      mid = s.at(125),
      base = s.at(150),
      loose = s.at(183),
      wide = s.at(216);
    const o = f.sweep("sp1", "no held ramp");
    const oBase = o.at(150),
      oTight = o.at(100);
    f.expect(
      rate(tight) > rate(mid) &&
        rate(mid) > rate(base) &&
        rate(base) > rate(loose) &&
        rate(loose) > rate(wide),
      "a wider held spacing is slower",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every held spacing is clean",
    );
    f.expect(
      tight.raw.visible < mid.raw.visible &&
        mid.raw.visible < base.raw.visible &&
        wide.raw.channel < tight.raw.channel,
      "a tighter held spacing shows less of each card and puts more cards in front of the pile",
    );
    f.expect(
      tight.raw.step > base.raw.step && rate(oTight) > rate(oBase),
      "a tighter held spacing is less steady, with the ramp and without it",
    );
    f.expect(
      tight.raw.heldJump <= Number(f.limit.jump) &&
        tight.raw.heldJump > Number(f.limit.jump) - 1 &&
        mid.raw.heldJump < tight.raw.heldJump - 1,
      "the tightest held spacing moves an edge to within a pixel of the jump limit, and the next one stays further below it",
    );
    return {
      what: t`How far apart cards leave the front once the held state is fully up, in px. The held pace is the held edge budget's speed (${HELD(f).budget} px/frame by default, \`edge budget, held\`) divided by it, so this is the held pace control.`,
      effect: [
        [
          "Raise",
          t`A looser train and a slower hold: ${loose.value} px gives ${loose.onePace} cards/s and ${wide.value} gives ${wide.onePace}. Fewer cards are in front of the pile at once (${wide.channel} against ${base.channel}) and the median card shows ${wide.visible} px of itself at its best.`,
        ],
        [
          "Lower",
          t`A tighter train and a faster hold: ${mid.value} px gives ${mid.onePace} cards/s and ${tight.value} gives ${tight.onePace}. The cards overlap more: the median card shows ${mid.visible} px at ${mid.value} and ${tight.visible} at ${tight.value}, and ${tight.channel} cards are in front of the pile at once. At ${tight.value} the largest edge move, ${tight.jump} px/frame, is within a pixel of the checker's jump limit (${f.limit.jump}).`,
        ],
      ],
      needs: t`Pace is spacing ÷ budget, and the ramp moves both: with it on, the pace builds from \`spacing at rest\` to this value after \`hold delay\`. With \`no held ramp\` this is the spacing from the first repeat: ${oBase.onePace} cards/s at ${oBase.value} px and ${oTight.onePace} at ${oTight.value}. Taps do not change.`,
      tune: t`Start at ${base.value}. Every value swept is clean on the checker, so the limits are how much of each card you can still read and how even the pace stays: the worst step-to-step change is ${mid.step}× at ${mid.value} px and ${tight.step}× at ${tight.value}. Lower the spacing until the cards you pass stop being recognisable, then back off.`,
    };
  },
  "setting.cdelay": (f) => {
    const s = f.sweep("cdelay");
    const now = s.at(0),
      base = s.at(250),
      late = s.at(600);
    f.expect(
      rate(now) > rate(base) && rate(base) > rate(late),
      "a longer hold delay is slower",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every hold delay value is clean",
    );
    return {
      what: "How long a key must be held before the held state starts to rise, in ms.",
      effect: [
        [
          "Raise",
          t`The first cards of a hold leave at the resting spacing for longer, then the pace steps up. At ${late.value} ms the hold runs at ${late.onePace} cards/s with intervals of ${late.range} ms, against ${base.onePace} and ${base.range} at ${base.value}.`,
        ],
        [
          "Lower",
          t`The ramp starts with the first press: ${now.value} ms gives ${now.onePace} cards/s with intervals of ${now.range} ms.`,
        ],
      ],
      needs: t`Shows only while the ramp is on. The delay holds back all three ramped values together: the spacing, the spring and the edge budget. The held state reaches ${f.rise.level} about ${f.rise.seconds} s after the delay.`,
      tune: t`Start at ${base.value}. Lower it for a quicker start and raise it to keep short holds slow. All three values swept, ${now.value} to ${late.value} ms, are clean, so it is a safe way to move the pace between ${now.onePace} and ${late.onePace} cards/s.`,
    };
  },
  "setting.park": (f) => {
    const s = f.sweep("park");
    const short = s.at(360),
      near = s.at(400),
      base = s.at(480),
      long = s.at(560);
    const rule = f.shown;
    f.expect(
      up(short) < up(near) && up(near) < up(base) && up(base) < up(long),
      "a longer park lands ↑ later",
    );
    f.expect(
      short.raw.framesMin < base.raw.framesMin &&
        near.raw.framesMin < base.raw.framesMin &&
        short.raw.channel < base.raw.channel,
      "a shorter park shows each card for fewer frames and holds fewer cards in front of the pile",
    );
    f.expect(
      [short, near, base, long].every((r) => r.clean && r.pace === base.pace),
      "every park value is clean and holds the same pace",
    );
    const needed = Number(rule.frames);
    f.expect(
      base.raw.framesMin >= needed &&
        long.raw.framesMin >= needed &&
        short.raw.framesMin < needed &&
        near.raw.framesMin < needed,
      "park at its default and above shows every card for the frames the rule needs, and the two shorter values do not",
    );
    return {
      what: "How far below the front pose the clip line sits, in px: where a leaving card goes out of sight and parks. The page cuts the stage there.",
      effect: [
        [
          "Raise",
          t`Cards travel farther before they park, so a tap ↑ takes longer: ${base.upLand} ms at ${base.value} and ${long.upLand} ms at ${long.value}, and the stage takes more of the page.`,
        ],
        [
          "Lower",
          t`A tap ↑ lands sooner (${short.upLand} ms at ${short.value}), but each card is on screen for fewer frames. The fewest frames any card shows ${rule.px} px of itself, or all of it when shorter, is ${short.frames} at ${short.value} against ${base.frames} at ${base.value}, and the train is shorter: at most ${short.channel} cards are in front of the pile at once against ${base.channel}.`,
        ],
      ],
      needs: t`The held pace stays at ${base.onePace} cards/s for every value swept. \`edge fade px\` can reach at most \`park\` minus ${TALLEST_CARD + PILE_CLEARANCE} px, so lowering park lowers its range. The slider stops at ${short.value} px because the tallest card (${TALLEST_CARD} px) and its shadow must stay above the clip line.`,
      tune: t`Start at ${base.value}. A card counts as shown when it has ${rule.px} px uncovered for ${rule.frames} frames: ${base.value} and ${long.value} meet that and ${short.value} and ${near.value} do not. Every value is clean on the checker. On a page with content below the stack, park is the room the stack takes below the front card.`,
    };
  },
  "setting.fade": (f) => {
    const park = f.def("park");
    const cap = String(fadeCap(Number(park)));
    return {
      what: "How many px at the bottom of the stage fade out, so a card dissolves into the page as it leaves. With no fade, a card is cut sharply at the clip line.",
      effect: [
        [
          "Raise",
          t`The fade starts higher above the clip line, so a card thins out sooner as it falls. It stops short of the pile: it starts at least ${PILE_CLEARANCE} px below the tallest card (${TALLEST_CARD} px), so the slider stops at ${cap} px with \`park\` at ${park}.`,
        ],
        [
          "Lower",
          "The cut gets sharper. With no fade the part of a card below the clip line is cut off in one line.",
        ],
      ],
      needs: t`A look setting: the sweeps measure positions and timing, and a mask on the stage changes neither. It fades the last px above the clip line, so \`park\` places it and limits it to \`park\` minus ${TALLEST_CARD + PILE_CLEARANCE} px. \`leave shade\` also washes a card on its way down.`,
      tune: "Hold ↓ and watch the lowest card: with no fade it slides under a hard edge, with a fade it thins out over the last stretch. Raise the fade until the edge stops being a line; the pile stays unfaded at every value.",
    };
  },
  "setting.shade": (f) => {
    const s = f.sweep("shade");
    const lo = s.at(0),
      base = s.at(0.25),
      hi = s.at(0.5);
    f.expect(
      base.clean &&
        [lo, hi].every(
          (r) =>
            r.clean &&
            r.pace === base.pace &&
            r.upLand === base.upLand &&
            r.dnLand === base.dnLand &&
            r.range === base.range &&
            r.jump === base.jump &&
            r.channel === base.channel &&
            r.visible === base.visible,
        ),
      "leave shade changes no measured number",
    );
    return {
      what: "How far a card is washed toward the page colour as it leaves: nothing at the front, this much at the clip line.",
      effect: [
        [
          "Raise",
          t`Leaving cards recede as they fall. At ${hi.value} a card has gone further toward the page colour at the clip line than at the default ${base.value}.`,
        ],
        [
          "Lower",
          t`Cards keep their colour for the whole trip. At ${lo.value} there is no wash.`,
        ],
      ],
      needs: t`A look setting: the hold runs at ${base.onePace} cards/s, a tap ↑ lands in ${base.upLand} ms and the checker reports ${base.verdict} at ${lo.value}, ${base.value} and ${hi.value} alike. \`edge fade px\` also hides a card's lower edge, so the two overlap in effect.`,
      tune: t`Start at ${base.value}. Hold ↓ and compare the lowest cards at ${lo.value}, ${base.value} and ${hi.value}: raise it to push leaving cards back, lower it to keep them readable until they park.`,
    };
  },
  // ---- the path, which every model shares ------------------------------------------------------------
  "setting.sway": (f) => ({
    what: "How far, in px, a moving card swings sideways at its widest point on the way down in front of the pile (the cascade: down its exit channel). Positive is to the right, negative to the left.",
    effect: [
      [
        "Raise",
        t`A wider bow. In the drum the card keeps more sideways speed through the \`turn\`, so the reversal reads as a rounded loop; far past the default ${f.def("sway")} px it reads as a swing rather than a drop.`,
      ],
      [
        "Lower",
        "A straighter drop. At zero the card runs straight down the column, and in the drum it stops at the turn to reverse, as the models draw it with no path. Below zero it bows to the left.",
      ],
    ],
    needs:
      "A look setting: it moves cards sideways only, so the frame checker's numbers, the springs and the edge budgets are the same at every value. The sway is a function of where the card is on its ring, so it reverses with a card that changes direction mid-flight. `widest point` places the bow, `sway behind px` shapes the drum's other leg, and `Bezier path` draws it. The Path module shows while cards sway or the overlay draws the path; under reduced motion with `Bezier path` off it hides.",
    tune: t`Start at ${f.def("sway")} px with \`Bezier path\` on and \`¼×\` speed. Raise it until the turn stops looking like a bounce, and lower it if the card seems to slide off the column.`,
  }),
  "setting.swayb": (f) => ({
    what: "How far, in px, a card swings sideways at its widest point on the drum's leg behind the pile, from the turn up to the tuck. Positive is to the right, negative to the left.",
    effect: [
      [
        "Raise",
        t`Toward the right. From the default ${f.def("swayb")} px it narrows the loop, and past zero both legs bow the same way, so the path is a hook rather than a loop.`,
      ],
      [
        "Lower",
        "Toward the left. The opposite sign to `sway in front px` makes a closed loop around the turn; a larger value widens it.",
      ],
    ],
    needs:
      "Shown for the drum and the product; the cascade has no leg behind the pile. Most of this leg is hidden behind the pile, so it shows as the card leaves the turn and as a returning card (↑) drops toward it. The width eases between the two legs' widest points, so different values add no corner at the turn.",
    tune: "Set it to the negative of `sway in front px` for a round loop, then press ↑ at `¼×` to watch the card come out from behind the pile.",
  }),
  "setting.peak": (f) => ({
    what: "Where along the leg in front of the pile the card reaches its widest sway, as a fraction of the leg from the front.",
    effect: [
      [
        "Raise",
        t`The widest point moves toward the turn: the card falls nearly straight at first and swings out late, so the turn is tighter. At the most, ${PATH_PEAK_MAX}, the card is still turning wide as it reaches it.`,
      ],
      [
        "Lower",
        t`The widest point moves toward the front: the card swings out as soon as it leaves and drifts back to the column before the turn. At the least, ${PATH_PEAK_MIN}, the drop from the front starts at an angle.`,
      ],
    ],
    needs: t`A look setting with the same numbers at every value, like \`sway in front px\`. \`widest point behind\` places the other leg's widest point, and \`column crossing\` sets where this leg ends. Hidden while neither leg sways. Default ${f.def("peak")}.`,
    tune: "Leave it at the default for an even bow. Raise it if the card seems to swing out too early, lower it for a softer start.",
  }),

  "setting.peakb": (f) => ({
    what: "Where along the drum's leg behind the pile the card reaches its widest sway, as a fraction of the leg from the tuck.",
    effect: [
      [
        "Raise",
        "The widest point moves toward the turn: a card leaving the turn swings out at once and comes back to the column well before the tuck, and a returning card (↑) swings out only near the turn.",
      ],
      [
        "Lower",
        "The widest point moves toward the tuck: a card leaves the turn close to the column and is still out to the side as it slides behind the pile.",
      ],
    ],
    needs: t`Shown for the drum and the product while either leg sways. Most of this leg is behind the pile, so it shows as the card leaves the turn and as a returning card drops toward it. The slope where the legs meet stays continuous at any value. Default ${f.def("peakb")}.`,
    tune: "Press ↓ and ↑ at `¼×` with `Bezier path` on and watch the dashed leg; move it with `column crossing` to lean the whole loop.",
  }),
  "setting.cross": (f) => ({
    what: "Where the drum's path crosses back over the column, in ring units from the turn: zero crosses at the turn itself.",
    effect: [
      [
        "Raise",
        t`The crossing moves past the turn, into the leg behind the pile: the card is still out on the front leg's side as it reaches the turn and crosses over on the way up. At ${CROSS.max} the loop leans toward the front leg's side.`,
      ],
      [
        "Lower",
        t`The crossing moves before the turn: the card is already on the behind leg's side as it reaches the turn. At ${CROSS.min} the loop leans the other way.`,
      ],
    ],
    needs: t`Shown for the drum and the product while either leg sways. A look setting: the turn, the tuck and every vertical edge stay where the model puts them, and the widest points stay at their fraction of each leg as the legs grow or shrink. Default ${f.def("cross")}.`,
    tune: "Leave it at zero for a loop that turns about the turn. Move it a little either way at `¼×` with `Bezier path` on if the bottom of the loop looks too symmetric.",
  }),
  "setting.bank": (f) => ({
    what: "How far a swaying card turns, in degrees, at the widest sway: it turns about its top centre in proportion to how far it is from the column.",
    effect: [
      [
        "Raise",
        t`Above zero the card's bottom edge swings out from the column, like a card hanging from its top edge; at ${BANK.max}° the turn is plain to see.`,
      ],
      [
        "Lower",
        t`Below zero the bottom edge swings in toward the column, so the card leans into the curve; at ${BANK.min}° it leans the most. At zero no card turns.`,
      ],
    ],
    needs: t`Turns only cards that are moving, so reduced motion hides it, and it hides while neither leg sways. The top edge, which the frame checker measures, does not move; the turned card's lower corners do, and a card clipped to the one in front of it is clipped square. \`Bezier path\` draws no bank. Default ${f.def("bank")}.`,
    tune: "Try a few degrees either way at `¼×`: a small positive bank reads as a swing, a small negative one as leaning into the turn. Past a few degrees the clipped edges start to show.",
  }),

  // ---- the drum's tuck, wash and planner estimate ----------------------------------------------------
  "setting.tuck": (f) => {
    const s = f.sweep("tuck");
    const lo = s.at(1),
      base = s.at(1.4),
      mid = s.at(1.8),
      hi = s.at(2.5);
    f.expect(
      [lo, base, mid, hi].every(
        (r) => r.clean && r.upLand === base.upLand && r.dnLand === base.dnLand,
      ),
      "the tuck spring is clean and moves no tap number",
    );
    return {
      what: "How much stiffer than the main spring a card's spring is on the tuck, the last stretch behind the pile from the turn to its hidden slot.",
      effect: [
        [
          "Raise",
          t`A leaving card rises behind the pile and settles into its slot sooner. Most of the tuck is hidden, so the numbers barely move: at ${hi.value}× a tap ↓ still settles in ${hi.dnLand} ms and a hold runs at ${hi.pace} cards/s, against ${base.pace} at the default ${base.value}×.`,
        ],
        [
          "Lower",
          t`At ${lo.value}× the tuck runs on the main spring, so a card lingers longer behind the pile. The worst step-to-step change moves from ${base.step}× to ${lo.step}× and the checker still reports ${lo.verdict}.`,
        ],
      ],
      needs: t`Drum only. It acts only behind the pile, after the turn, so \`sway behind px\` and the \`tuck\` anchor of \`Bezier path\` show where. The main spring is \`spring Hz, tap\`, or \`spring Hz, held\` once the held state rises; this multiplies it.`,
      tune: t`Leave it at ${base.value}× unless a card visibly hangs behind the pile: watch the purple behind leg with \`Bezier path\` on at \`¼×\`. Every value swept, ${lo.value}× to ${hi.value}×, is clean.`,
    };
  },
  "setting.hide": (f) => {
    const s = f.sweep("hide");
    const lo = s.at(0),
      base = s.at(3),
      hi = s.at(12);
    f.expect(
      [lo, base, s.at(6), hi].every((r) => r.clean),
      "every tuck depth swept is clean",
    );
    f.expect(up(hi) >= up(base), "a deeper tuck lands ↑ no sooner");
    return {
      what: "How far inside the pile's lower edge a tucked card's bottom ends, in px: where the tuck stops behind the pile.",
      effect: [
        [
          "Raise",
          t`The tuck ends higher behind the pile, so a returning card starts further up and has further to drop: at ${hi.value} px a tap ↑ lands in ${hi.upLand} ms, against ${base.upLand} ms at the default ${base.value} px.`,
        ],
        [
          "Lower",
          t`The tuck ends lower: at ${lo.value} px a tucked card's bottom sits level with the lower edge of the card in front, with no margin to hide it, and the landing speed is ${lo.landSpeed} px/frame against ${base.landSpeed}.`,
        ],
      ],
      needs: t`Drum only. A card too tall to hide this way washes out instead (\`tall-card wash rise ms\`), and the same depth decides which cards count as too tall. The \`tuck\` anchor of \`Bezier path\` marks the end of the tuck.`,
      tune: t`Leave it at ${base.value} px. Raise it if a tucked card's lower edge shows under the front card; every value swept, ${lo.value} to ${hi.value} px, is clean.`,
    };
  },
  "setting.wrise": (f) => {
    const s = f.sweep("wrise");
    const fast = s.at(10),
      quick = s.at(40),
      base = s.at(120),
      slow = s.at(400);
    f.expect(
      !fast.clean && quick.clean && base.clean && slow.clean,
      "the wash rise is clean from 40 ms up and flickers at 10 ms",
    );
    return {
      what: "How quickly a card too tall to hide behind the pile washes out toward the page colour as it tucks, as a time constant in ms.",
      effect: [
        [
          "Raise",
          t`The wash follows the card's path more lazily, so a tall card stays visible longer as it rises behind the pile. ${slow.value} ms is clean.`,
        ],
        [
          "Lower",
          t`The tall card fades out almost as soon as its path asks: ${quick.value} ms is clean, and at ${fast.value} ms the checker reports ${fast.verdict}.`,
        ],
      ],
      needs: t`Drum only, and only for a card taller than the room the tuck leaves (\`tuck depth px\`); the tallest sample cards, ${f.cards.max} px, are. \`tall-card wash clear ms\` sets the way back, when a returning card regains its colour. Pace and landing times are the same at every value swept.`,
      tune: t`Start at ${base.value} ms. Hold ↓ through the tallest cards at \`¼×\` and watch them fade behind the pile; stay at ${quick.value} ms or above.`,
    };
  },
  "setting.wclear": (f) => {
    const s = f.sweep("wclear");
    const fast = s.at(10),
      base = s.at(40),
      mid = s.at(120),
      slow = s.at(400);
    f.expect(
      !fast.clean && base.clean && mid.clean && !slow.clean,
      "the wash clear is clean between 40 and 120 ms and flickers outside",
    );
    return {
      what: "How quickly a washed-out tall card regains its colour when its path stops asking for the wash, as a time constant in ms.",
      effect: [
        [
          "Raise",
          t`A returning tall card stays pale for longer. ${mid.value} ms is clean; at ${slow.value} ms the wash lags so far that it has to catch up in a jump: ${slow.verdict}.`,
        ],
        [
          "Lower",
          t`The colour comes back almost at once: at ${fast.value} ms the checker reports ${fast.verdict}.`,
        ],
      ],
      needs: t`Drum only, for cards too tall to hide behind the pile. \`incoming fade-in per s\` restores a card coming back with ↑ on its own clock, so this shows mostly on a card that reverses mid-tuck. Pace and landing times are the same at every value swept.`,
      tune: t`Keep it between ${base.value} and ${mid.value} ms, the clean range swept.`,
    };
  },
  "setting.ta": (f) => {
    const s = f.sweep("ta");
    const lo = s.at(0),
      base = s.at(60),
      hi = s.at(120),
      top = s.at(200);
    f.expect(
      rate(lo) > rate(base) &&
        rate(base) > rate(hi) &&
        rate(hi) > rate(top) &&
        lo.raw.step > base.raw.step &&
        base.raw.step > hi.raw.step,
      "a larger base estimate is slower and steadier",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every base estimate is clean",
    );
    return {
      what: "The part of the planner's estimated clear time that every card takes whatever its height, in ms: the `a` in `scale × (a + b · height)`.",
      effect: [
        [
          "Raise",
          t`Every interval grows by the same amount, so short cards slow most and the pace evens out. At ${hi.value} ms a hold runs at ${hi.pace} cards/s with intervals of ${hi.range} ms and a worst step-to-step change of ${hi.step}×.`,
        ],
        [
          "Lower",
          t`Short cards go through faster and the pace follows heights more: at ${lo.value} ms the hold runs at ${lo.pace} cards/s, intervals ${lo.range} ms, ${lo.step}× from one step to the next.`,
        ],
      ],
      needs: t`Shows only with tempo \`lookahead\`. \`estimate ms per px\` is the height term and \`tempo scale\` multiplies both. The flip gate still applies, so an estimate shorter than a real trip changes nothing. Default ${base.value} ms gives ${base.pace} cards/s on \`even\`.`,
      tune: t`Move \`tempo scale\` first. Raise this for steadier pacing among short cards; every value swept, ${lo.value} to ${top.value} ms, is clean.`,
    };
  },
  "setting.tb": (f) => {
    const s = f.sweep("tb");
    const lo = s.at(0),
      small = s.at(0.3),
      base = s.at(0.62),
      hi = s.at(1),
      top = s.at(1.5);
    f.expect(
      rate(small) > rate(base) &&
        rate(base) > rate(hi) &&
        rate(hi) > rate(top) &&
        small.raw.step > base.raw.step &&
        base.raw.step > hi.raw.step,
      "a larger per-px estimate is slower and steadier",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every per-px estimate is clean",
    );
    return {
      what: "How much longer the planner expects a trip to take per px of card height, in ms per px: the `b` in `scale × (a + b · height)`.",
      effect: [
        [
          "Raise",
          t`Tall cards get more time and the planner eases toward them sooner, so the pace drops and evens out: at ${hi.value} ms/px a hold runs at ${hi.pace} cards/s with intervals of ${hi.range} ms and ${hi.step}× from one step to the next.`,
        ],
        [
          "Lower",
          t`The plan stops reading heights. At ${lo.value} the flip gate alone sets the pace, ${lo.pace} cards/s with ${lo.range} ms intervals and ${lo.step}× from one step to the next, as with tempo \`none\`.`,
        ],
      ],
      needs: t`Shows only with tempo \`lookahead\`. \`estimate base ms\` is the constant term and \`tempo scale\` multiplies both. Default ${base.value} ms/px gives ${base.pace} cards/s on \`even\`.`,
      tune: t`Raise it until the slowest tall card in a hold no longer bunches up behind the gate. Every value swept, ${lo.value} to ${top.value} ms/px, is clean.`,
    };
  },

  // ---- the cascade's held spring and budget ----------------------------------------------------------
  "setting.cw1": (f) => {
    const s = f.sweep("cw1");
    const lo = s.at(3),
      base = s.at(4.5),
      mid = s.at(6),
      hi = s.at(8);
    f.expect(
      lo.clean && base.clean && mid.clean && !hi.clean,
      "the held spring is clean to 6 Hz and fails at 8",
    );
    f.expect(
      [lo, mid, hi].every((r) => r.onePace === base.onePace),
      "the held spring leaves the held pace alone",
    );
    return {
      what: "How stiff each card's spring becomes once the held state is fully up, in Hz.",
      effect: [
        [
          "Raise",
          t`Cards in a held train speed up and stop harder. The pace stays at ${base.onePace} cards/s, but the largest edge move grows from ${base.jump} px/frame to ${mid.jump} at ${mid.value} Hz; at ${hi.value} Hz the checker reports ${hi.verdict}.`,
        ],
        [
          "Lower",
          t`Cards in a held train drift more between places: at ${lo.value} Hz the largest edge move is ${lo.jump} px/frame and the hold is still clean.`,
        ],
      ],
      needs: t`Shows only while the ramp is on. The spring rises from \`spring Hz, tap\` to this value as the held state rises after \`hold delay\`. The spacing and the held edge budget set the pace, so this changes how cards travel, not how many pass.`,
      tune: t`Start at ${base.value} Hz and stay at ${mid.value} or below; past that the budget clamps the spring every frame and edges jump.`,
    };
  },
  "setting.ccap1": (f) => {
    const s = f.sweep("ccap1");
    const lo = s.at(24),
      base = s.at(30),
      mid = s.at(36),
      top = s.at(44);
    f.expect(
      rate(lo) < rate(base) && rate(base) < rate(mid) && rate(mid) < rate(top),
      "a higher held budget is faster",
    );
    f.expect(
      lo.clean && base.clean && !mid.clean,
      "the held budget is clean to 30 and fails at 36",
    );
    return {
      what: "The most any card edge may move in one frame once the held state is fully up, in px per frame. The held pace is this speed divided by `spacing held`.",
      effect: [
        [
          "Raise",
          t`A held train runs faster: ${mid.onePace} cards/s at ${mid.value} against ${base.onePace} at ${base.value}. Past the default the checker finds jumps: ${mid.verdict} at ${mid.value} and ${top.verdict} at ${top.value}.`,
        ],
        [
          "Lower",
          t`A held train runs slower and calmer: ${lo.onePace} cards/s at ${lo.value}, with intervals of ${lo.range} ms, clean.`,
        ],
      ],
      needs: t`Shows only while the ramp is on. The budget rises from \`edge budget, tap\` to this value with the held state. \`spacing held\` is the other half of the held pace.`,
      tune: t`Keep it at ${base.value} or below and move the pace with \`spacing held\`, which stays clean over a wider range.`,
    };
  },

  // ---- playback fades --------------------------------------------------------------------------------
  "setting.rfade": (f) => ({
    what: "How long the new front card fades in under reduced motion, in ms.",
    effect: [
      [
        "Raise",
        t`A softer cut: the card comes in over a longer fade. Far past the default ${f.def("rfade")} ms the page feels slow to answer a key.`,
      ],
      ["Lower", "A harder cut. At zero the new card appears at once."],
    ],
    needs:
      "Shows only while reduced motion is in force, from the button or the system setting. The heading always changes at once under reduced motion. It belongs to the page, so a preset button keeps it.",
    tune: "Press ↓ and ↑ a few times: pick the shortest fade that still reads as a change of card rather than a flash.",
  }),
  "setting.hfade": (f) => ({
    what: "How long the heading above the stack fades in when the front card changes, in ms.",
    effect: [
      [
        "Raise",
        t`The new title eases in more slowly, from the default ${f.def("hfade")} ms upward; on a held key it may still be fading when the next card arrives.`,
      ],
      ["Lower", "The title settles sooner. At zero it swaps at once."],
    ],
    needs:
      "Every model uses it while cards move; under reduced motion the heading changes at once and this hides. It belongs to the page, so a preset button keeps it.",
    tune: "Hold ↓: the heading should keep up with the cards without blinking. Shorten it if it lags behind a fast hold.",
  }),

  // ---- what the Bezier path overlay draws ------------------------------------------------------------
  "setting.handles": () => ({
    what: "Draws the Bezier control handles on the overlay: a dashed line from a knot to each of its control points.",
    effect: [
      [
        "On",
        "Handles at the knots the Path settings move: each leg's widest point, and the drum's turn. Move `widest point` or `sway in front px` to watch them swing.",
      ],
      ["Off", "Only the curve, its knots and anchors; the overlay is quieter."],
    ],
    needs:
      "Shows while `Bezier path` is on. `handles at every knot` adds the handles at the knots that only keep the fit close.",
    tune: "Leave it on while you shape the path, and turn it off to judge the curve itself.",
  }),
  "setting.knots": () => ({
    what: "Draws control handles at every knot of the overlay, not only at the widest points and the turn.",
    effect: [
      [
        "On",
        "Every segment's handles show, so you can see how the cubic segments meet and how `knots per stretch` divides the path.",
      ],
      ["Off", "Handles only at the knots the Path settings move."],
    ],
    needs:
      "Shows while `Bezier path` and `control handles` are both on. It draws only; cards move the same.",
    tune: "Turn it on with `knots per stretch` lowered to see a coarse fit's handles stretch, then turn it off again.",
  }),
  "setting.inner": (f) => ({
    what: "How many knots the overlay puts inside each stretch of the path, between the front, each leg's widest point, the turn and the tuck.",
    effect: [
      [
        "Raise",
        t`More, shorter cubic segments. The default ${f.def("inner")} keeps the curve within a pixel of the path the cards follow at any Path setting; more adds nothing visible.`,
      ],
      [
        "Lower",
        "Fewer, longer segments. At zero each stretch is one cubic, and the curve can stray from the card markers, most at a wide sway.",
      ],
    ],
    needs:
      "Shows while `Bezier path` is on. It changes only the drawing: cards follow the exact path at every value. `handles at every knot` shows where the knots fall.",
    tune: "Set it to zero with a large `sway in front px` and watch the markers leave the curve, then return it to the default.",
  }),
  "setting.arrows": () => ({
    what: "Draws an arrowhead on each leg of the overlay: the way ↓ runs the path, and the way ↑ runs it back.",
    effect: [
      ["On", "An orange arrow down the front leg and a blue one back up it."],
      ["Off", "The curve has no direction marks."],
    ],
    needs: "Shows while `Bezier path` is on. It draws only.",
    tune: "Turn it off for a cleaner screenshot once the direction is clear.",
  }),
  "setting.labels": () => ({
    what: "Writes the overlay's names beside the path: `front`, `turn` or `park`, `tuck`, `behind`, and `out ↓` and `↑ in`.",
    effect: [
      ["On", "Each anchor and leg is named, in the words the tooltips use."],
      ["Off", "Anchors and legs stay drawn, without text."],
    ],
    needs: "Shows while `Bezier path` is on. It draws only.",
    tune: "Leave it on while learning the path; turn it off when the labels cover a card you are watching.",
  }),
  "setting.spine": () => ({
    what: "Draws the pile's spine on the overlay: a line through the pile slots above the front card, with a dot at each.",
    effect: [
      ["On", "Shows where the two cards peeking above the front sit."],
      ["Off", "Only the moving card's path is drawn."],
    ],
    needs: "Shows while `Bezier path` is on. It draws only.",
    tune: "Turn it on to check that a returning card lands on the front slot, below the spine.",
  }),
  "setting.dots": () => ({
    what: "Draws a live marker at the top centre of every painted card: dark on the pile, orange leaving, blue coming back.",
    effect: [
      [
        "On",
        "The markers ride the curve, so you can see each card's place on the path frame by frame.",
      ],
      ["Off", "The curve stays still; only the cards move."],
    ],
    needs:
      "Shows while `Bezier path` is on. Under reduced motion the markers stay on the column, as the cards do.",
    tune: "Pair it with Pause and Step to read a card's position on the path one frame at a time.",
  }),
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

/** The panel's closing paragraph: what the frame checker counts, then `extra`, the source file and `DESIGN.md`. */
function checkerParagraph(f: Facts, source: string, extra: string): string {
  return t`The frame checker counts four problems. A jump: an edge moves more than ${f.limit.jump} px in a frame. An edge flash: a card's lower edge changes by more than ${f.limit.band} px with nothing covering the change. A fade flicker: a card's fade changes by more than ${f.limit.shade} in a frame. A swap: two cards change draw order while they overlap. A sweep is clean when it finds none, over three sets of card heights. ${extra} Source: ${source}; goals and limits: \`DESIGN.md\`.`;
}

function buildAbout(): About {
  const f = new Facts(__FACTS__);
  return {
    paragraphs: [
      "Every card has one coordinate on a closed ring path: a pile slot (the front, two cards peeking above it, one hidden behind), the drop in front of the pile down to the `turn` (clear below the card it uncovers), and the tuck behind the pile. Each coordinate follows its own critically damped spring toward a target that depends only on which card is in front. A leaving card's target is two steps away, so it passes the turn still moving and slows into the tuck, and a returning card runs the ring backwards, which is what ↑ shows.",
      "The only change of draw order is at the turn, and a card crosses it only when it is clear of the cards it swaps with, so no card passes through another. A press is taken once every card in transit has passed its flip, so the pace is whatever the trips allow.",
      checkerParagraph(
        f,
        "`src/app/page/queue/drum.ts`",
        t`An edge budget of ${f.def("cap")} px/frame, ${f.def("cap1")} while held, caps every edge.`,
      ),
    ],
    map: [
      [
        "Taps",
        "`spring Hz, tap` and `edge budget, tap` set how fast one card travels.",
      ],
      ["Pace", "`tempo` sets when the next press may start."],
      [
        "Held keys",
        "`held speed-up` and `fold while held` change both once a key has been held past `hold delay`.",
      ],
    ],
    numbers: f.sources(),
  };
}
export const ABOUT: About = buildAbout();

function buildAboutCascade(): About {
  const f = new Facts(__FACTS__);
  return {
    paragraphs: [
      t`Every card has one coordinate. At zero or above it is a pile slot, as in the drum: the front, two cards peeking above it, one hidden behind. Below zero it is in the exit channel, in front of the pile at full size, and its top sits lower on the stage as the coordinate falls: at minus one it is \`park\` px (${f.def("park")} by default) below the front pose, parked out of sight below the clip line. Each coordinate follows its own critically damped spring toward a target that depends only on which card is in front.`,
      "A leaving card's spring aims past the clip line, so it slows out of sight, and a returning card runs the channel the other way, which is what ↑ shows. Nothing tucks behind the pile, turns or changes draw order, so no card passes through another. Each card is drawn no taller than the card in front of it, so the stack never shows more than the cards it covers.",
      t`A press in the direction of the last waits until the edge budget's speed has covered \`spacing\` px since the last press, the same time for ↑ and ↓ and for every card height. A held key raises the held state after \`hold delay\`; with the ramp on, that tightens the spacing from ${f.def("sp0")} to ${f.def("sp1")} px, stiffens the spring from ${f.def("cw0")} to ${HELD(f).hz} Hz and raises the edge budget from ${f.def("ccap")} to ${HELD(f).budget} px/frame. A hold at either end of the queue moves nothing.`,
      checkerParagraph(
        f,
        "`src/cascade.ts`",
        "A card that crosses the clip line is cut there, so it is not a lower edge moving in view.",
      ),
    ],
    map: [
      [
        "Taps",
        "`spring Hz, tap` and `edge budget, tap` set how fast one card travels.",
      ],
      [
        "Pace",
        "`spacing at rest`, `spacing held` and `hold delay` set how far apart cards leave and when the pace builds.",
      ],
      [
        "Stage",
        "`park`, `edge fade px` and `leave shade` set where cards park and how they leave the page.",
      ],
    ],
    numbers: f.sources(),
  };
}
export const ABOUT_CASCADE: About = buildAboutCascade();

/** The caption under the stack: what the active preset (or, for the product, the model) is. */
export const captionFor = (mode: string, preset: string): string =>
  mode === "product"
    ? HELP["model.product"]!.what
    : HELP[`preset.${preset}`]!.what;
