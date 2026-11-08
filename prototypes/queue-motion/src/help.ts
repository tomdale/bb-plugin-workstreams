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
import { QUEUE_CFG } from "../../../src/app/page/queue/drum.ts";
import {
  DECK_SIZE,
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
  /**
   * For a setting looked at once (Finish, the tuck), what the sweeps say it moves, shown under the setting on the
   * page as plain text; a setting that only shapes the look moves no timing number.
   */
  verdict?: string;
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
    what: "The drum at `shipped`, run through the product engine as it ships: `stackEngine.ts` keeps a short row of cards on the drum as the queue's pile changes. Its settings show read only.",
    effect: [
      [
        "Click",
        "Shows the motion the queue ships. ↓ drops the front card clear of the pile and tucks it behind; ↑ runs the same ring backwards. A held key speeds up after a short hold. The preset buttons disappear; Taps and Held keys show the shipped values, read only, and Measured runs on the engine's frames.",
      ],
    ],
    needs:
      "The engine runs the drum with `QUEUE_CFG`, the `shipped` preset, so Measured here should match `Elastic drum` at `shipped`: a difference is the engine's own doing (its short row of cards, or how it takes a press). Speed, clock and reduced motion work in every model.",
    tune: "Nothing to tune. Hold ↑ and ↓ here, then switch to `Elastic drum` at `shipped` and hold the same keys to compare the Measured numbers. Pause and Step turn any model into a frame you can read.",
  }),
  "model.drum": () => ({
    what: "The candidate model: each card follows one ring path on its own spring, and ↑ runs the same ring backwards.",
    effect: [
      [
        "Click",
        "↓ drops the front card clear of the pile and tucks it behind. ↑ brings a card up from just below the pile and slows it into the front. The drum's preset buttons appear, and Taps, Held keys, Route and Finish hold its settings.",
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
          "↓ slides the front card down in front of the pile and out through the clip line. ↑ brings a card back up from the clip line and slows it into the front. No card tucks behind the pile or changes draw order. The cascade's presets appear, Taps, Held keys and Route hold its settings under the same names as the drum's, and the stage is cut at the clip line.",
        ],
      ],
      needs: t`Speed, clock and reduced motion work as in the other models. The page cuts the stage at the clip line, \`park\` px (${f.def("park")} by default) below the front pose, so the stack takes that much page below the front card. The drum's own settings hide; the ones both models share keep their values.`,
      tune: t`Hold ↓ and ↑ here, then switch to \`Elastic drum\` with \`natural\` and hold the same keys. The cascade holds ${c.onePace} cards/s on every card height (${c.spread} apart across the three sample sets) with a worst step-to-step change of ${c.step}×. \`natural\` holds ${nat.pace} cards/s, ${nat.spread} apart, with ${nat.step}× from one step to the next.`,
    };
  },

  // ---- presets -----------------------------------------------------------------------------------
  "preset.shipped": (f) => {
    const q = QUEUE_CFG;
    const p = f.preset("shipped");
    f.expect(p.clean, "what ships passes the checker");
    const hz = (w: number | undefined) => String((w ?? 0) / TAU);
    const ms = q.tempo?.ms ?? 0;
    return {
      what: "The configuration the queue ships with, `QUEUE_CFG` in `drum.ts`: a held key stiffens the springs and raises the top speed after a short hold, and presses keep a steady beat.",
      effect: [
        [
          "Feels",
          t`A tap runs on a ${hz(q.omega0)} Hz spring with a top speed of ${q.vcap} px/s. After ${q.holdDelay} ms held the spring rises to ${hz(q.omega1)} Hz and the top speed to ${q.vcap1} px/s, and a press waits at least ${ms} ms after the last, so a hold runs at most ${(1000 / ms).toFixed(1)} cards/s. A tall card takes longer than the beat, so the pace still dips at it.`,
        ],
        [
          "Measured",
          t`Held ↑ / ↓ ${p.pace} cards/s, intervals ${p.range} ms, worst step-to-step change ${p.step}×, ${p.clean ? "no checker problems" : p.problems}. A tap ↑ lands in ${p.tapUp} ms and a tap ↓ settles in ${p.tapDn} ms. The beat stretches at every tall card: the slowest step is ${p.ivMax} ms against a beat of ${ms} ms.`,
        ],
        [
          "Good for",
          "Comparing a change with what ships, and starting a change to `QUEUE_CFG`.",
        ],
      ],
      needs:
        "Sets `while held` to `speed up` and `pacing` to `steady beat`. `Product now` runs the same configuration through the product engine. Clicking it clears slider changes.",
      tune: "Start here, change one setting, hold a key on each Cards deck, and compare the Measured numbers with `Product now`. `Copy as QUEUE_CFG` copies the result as the literal to paste into `drum.ts`.",
    };
  },
  "preset.natural": (f) => {
    const p = f.preset("natural");
    const cap = f.sweep("cap", "natural").at(1800);
    f.expect(
      p.clean && cap.clean,
      "natural and the quoted top speed are clean",
    );
    return {
      what: "The reviewed behaviour: every setting at its default. A held key does what a tap does, and the presses follow the cards.",
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
      needs: t`Sets nothing: clicking it clears every slider change and restores each default. \`while held\` is \`same as taps\` and \`pacing\` is \`follows cards\`, so the settings those hide stay hidden.`,
      tune: t`Start here. For an even pace choose \`even\`. To go faster without folding, raise \`top speed\` to ${cap.value} px/s (${cap.pace}, ${cap.verdict}).`,
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
      "a smaller plan is faster",
    );
    return {
      what: "Planned pacing: the interval between presses is planned from the card heights ahead, so the pace changes gently.",
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
      needs: t`Sets \`pacing\` to \`planned\`, with a \`plan window\` of ${f.def("tw")} and \`plan\` at ${f.def("ts")}×; \`while held\` stays \`same as taps\`. Clicking it clears slider changes.`,
      tune: t`Lower \`plan\` to speed it up: ${fast.value}× gives ${fast.pace} cards/s, but tall cards then outlast the plan and intervals reach ${fast.ivMax} ms (${fast.step}×). \`even + held speed\` shortens the trips so the shorter plan holds.`,
    };
  },
  "preset.even + held speed": (f) => {
    const p = f.preset("even + held speed");
    const even = f.preset("even");
    const scale = f.sweep("ts", "even + held speed");
    const base = scale.start,
      low = scale.at(0.7);
    f.expect(
      p.clean && p.raw.heldUp > even.raw.heldUp && rate(low) > rate(base),
      "even + held speed is clean, faster than even, and faster still at a smaller plan",
    );
    return {
      what: "The same plan at a shorter interval, which stiffer springs and a higher top speed make possible once a key has been held: planned pacing, and `while held` set to `speed up`.",
      effect: [
        [
          "Feels",
          t`Once the key has been held a moment the trips quicken, which lets the shorter plan hold: ${p.pace} cards/s against ${even.pace} in \`even\`.`,
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
      needs: t`Sets \`pacing\` to \`planned\` (\`plan window\` ${f.def("tw")}, \`plan\` ${base.value}×) and \`while held\` to \`speed up\`: after \`speeds up after\` the spring goes from ${f.def("w0")} to ${f.def("w1")} Hz and the top speed from ${f.def("cap")} to ${f.def("cap1")} px/s.`,
      tune: t`Lower \`plan\` for more pace and watch the checker: ${low.value}× gives ${low.pace} cards/s with ${low.verdict}. Under a plan, \`held spring\` and \`held top speed\` leave the pace alone, so tune the plan first.`,
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
          t`Once the key has been held a moment the pile compresses into strips and each card is on screen for about ${onScreen} ms. \`DESIGN.md\` argues that is long enough to recognise a header line and too short to read a body. The card you land on unfolds when you release.`,
        ],
        [
          "Measured",
          t`Intervals ${p.range} ms, worst step-to-step change ${p.step}×, largest edge move ${p.jump} px/frame, ${p.clean ? "no checker problems" : p.problems}.`,
        ],
        ["Good for", "Scanning a long queue for one card."],
      ],
      needs: t`Sets \`while held\` to \`fold to the header line\`, which includes the speed-up; \`pacing\` stays \`follows cards\`. \`speeds up after\`, \`held spring\`, \`held top speed\` and \`held height\` appear.`,
      tune: t`Move the pace with \`speeds up after\` first: the four values swept are all clean here. Then \`held height\`, then \`held spring\`. For an even pace while folded, set \`pacing\` to \`steady beat\`.`,
    };
  },

  "preset.loose": (f) => {
    const p = f.preset("loose");
    const nat = f.preset("natural");
    const fold = f.preset("fold");
    const s = f.sweep("pace", "loose");
    const fast = s.at(15),
      slow = s.at(6.5);
    f.expect(
      rate(p) > 1.4 * nat.raw.heldUp &&
        rate(fast) > rate(p) &&
        rate(p) > rate(slow),
      "loose is much faster than natural, and a faster beat is faster",
    );
    return {
      what: t`Cards stay whole, but a held key clears a virtual height that shrinks like a fold, so a leaving card passes over the next one and the pace reaches ${p.pace} cards/s on a steady beat.`,
      effect: [
        [
          "Feels",
          "Once the key has been held a moment a leaving card drops only as far as it would clear a folded card, so it passes over the card it uncovers instead of around it, washing out as it goes. Every card is still drawn at full height.",
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
      needs: t`Sets \`while held\` to \`pass over the next card\`, which includes the speed-up, and \`pacing\` to \`steady beat\` at ${s.start.value} cards/s. Passing over a card is a draw-order swap by the frame checker's rules, so the preset is outside them: its chip is dashed, the state line says so, and the checker in Measured counts the swaps and edge flashes as its cost rather than as a verdict.`,
      tune: t`Move the beat with \`pace\`: ${fast.value} cards/s measures ${fast.pace} and ${slow.value} measures ${slow.pace}. \`held height\` sets how far a leaving card drops: lower is faster and passes over more of the card behind.`,
    };
  },
  "preset.default": (f) => {
    const p = f.preset("default");
    const nat = f.preset("natural");
    const off = f.preset("no held ramp");
    const s = f.sweep("pace", "default");
    const tight = s.at(18),
      wide = s.at(8);
    f.expect(
      p.clean &&
        p.raw.heldUp > off.raw.heldUp &&
        rate(tight) > p.raw.heldUp &&
        p.raw.heldUp > rate(wide),
      "default is clean, faster than the preset without the speed-up, and a faster pace is faster",
    );
    return {
      what: t`Every cascade setting at its default: once the key has been held a moment the train speeds up from ${f.def("pace0", "cascade")} to ${f.def("pace", "cascade")} cards/s.`,
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
      needs: t`Sets nothing: clicking it clears every slider change and restores each default. \`while held\` is \`speed up\`, so \`pace before speed-up\`, \`speeds up after\`, \`held spring\` and \`held top speed\` show.`,
      tune: t`Start here. \`pace\` sets the held pace: ${tight.value} cards/s measures ${tight.onePace} and ${wide.value} measures ${wide.onePace}. \`no held ramp\` runs the same train at a constant ${off.onePace}.`,
    };
  },
  "preset.no held ramp": (f) => {
    const p = f.preset("no held ramp");
    const d = f.preset("default");
    const s = f.sweep("pace", "no held ramp");
    const tight = s.at(12),
      base = s.at(9.6),
      wide = s.at(6);
    f.expect(
      p.clean &&
        p.raw.heldUp < d.raw.heldUp &&
        rate(tight) > rate(base) &&
        rate(base) > rate(wide),
      "no held ramp is clean, slower than default, and a faster pace is faster",
    );
    return {
      what: "The same train with `while held` at `same as taps`: it runs at `pace` on the tap spring and the top speed from the first repeat.",
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
      needs: t`Sets \`while held\` to \`same as taps\`, so a held key changes nothing and the settings of the speed-up hide. \`pace\` and the tap settings still apply. Clicking it clears slider changes.`,
      tune: t`Move the pace with \`pace\`: ${tight.value} cards/s measures ${tight.onePace}, ${base.value} measures ${base.onePace} and ${wide.value} measures ${wide.onePace}.`,
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
    needs: t`\`speeds up after\`, the pacing and the held state run on the page's clock, so at ${SPEEDS[0]!.label} they last ${1 / Number(SPEEDS[0]!.id)} times as long on screen. The held-key numbers in these tooltips are for ${SPEEDS.at(-1)!.label}.`,
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
      "Works in every model. The held state and the drum's pacing run on the page's clock, so a held key does not advance them while it is paused.",
    tune: "Press ↓, click Pause during the trip, then click Step to walk the rest of it one frame at a time.",
  }),
  "preset.save": () => ({
    what: "Saves every setting as it is now as a preset of the running model, under a name you type, in this browser's storage.",
    effect: [
      [
        "Click",
        "The first click opens a name field under the buttons and the button reads Save. Enter or Save stores the preset, Escape closes the field. A chip with the name appears in the Saved row under the built-in presets, and a line says it was saved. An empty name saves as `my preset` and a number; a saved preset's name replaces that preset; a built-in preset's name is refused.",
      ],
    ],
    needs:
      "Each model keeps its own saved presets, and the product has none. A saved preset records the built-in preset it starts from and every model, path and page setting you have changed; speed, cards, reduced motion and `Bezier path` stay as they are when you apply it. It lives in this browser's `localStorage`, so another browser or a cleared storage does not have it; `Copy settings` or the URL hash carries the same settings anywhere.",
    tune: "Save a configuration before you try something risky, then click its chip to come back to it. Save variants under names that say what they change.",
  }),
  "preset.saved": () => ({
    what: "A preset you saved with `Save as preset…`, kept in this browser.",
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
  "preset.revert": () => ({
    what: "Puts every model setting back to the preset the state is based on.",
    effect: [
      [
        "Click",
        "The preset's chip fills again, the state line reads nothing changed, and the Measured numbers clear. The path's and the page's settings stay as they are, and so does the card in front.",
      ],
    ],
    needs:
      "Shown while a model setting differs from the preset; its label names the preset. A setting's own `reset` does the same for that setting alone.",
    tune: "Use it to compare a change with its preset: note the Measured numbers, revert, and run the same hold again.",
  }),
  "copy.cfg": () => ({
    what: "Copies the drum's configuration as the `QUEUE_CFG` literal in `drum.ts`, in that file's idiom: spring rates as `TAU * Hz` and top speeds (`vcap`, `vcap1`) as px per frame times sixty.",
    effect: [
      [
        "Click",
        "The button reads `Copied` for a moment. The literal lists every field `QUEUE_CFG` sets now, in its order, then any other field that differs from the drum's defaults; the tempo lists its kind and the fields that kind reads.",
      ],
    ],
    needs:
      "Drum only. It copies the whole configuration, hidden settings included, so a setting that changes nothing under the current configuration still lands in the literal when it differs from the default.",
    tune: "Paste it over `QUEUE_CFG` in `src/app/page/queue/drum.ts`, rebuild the lab, and hold the same keys in `Product now` to check the engine gives the same numbers.",
  }),
  reset: () => ({
    what: "Puts one setting back to its preset's value, or a path or page setting back to its default.",
    effect: [
      [
        "Click",
        "The value returns and stops being bold, and a folded module's count of changes drops by one.",
      ],
    ],
    needs:
      "Shown beside a setting while its value differs from the preset's or the default. Resetting a model setting clears the Measured numbers, which described the changed state.",
    tune: "Reset changes one at a time to find which of them made the difference.",
  }),
  cards: (f) => {
    // The sims' set names hold digits, so they come in as values.
    const mixed = "w2";
    return {
      what: "Which cards the stack holds: the lab's own sample cards, or one of two decks built to match the sims' hardest height sets.",
      effect: [
        [
          "lab",
          "The page's six sample cards, repeated: the deck every other tooltip's page behaviour is described on.",
        ],
        [
          "mixed 330",
          t`Real cards close to the sims' \`${mixed}\` set (${f.set(mixed)} px), with the tallest card, ${f.cards.max} px, in the middle.`,
        ],
        [
          "330 and 73",
          t`The tallest and the shortest card in turn, as the sims' \`alt\` set (${f.set("alt")} px): every step changes height by the most the cards can, so an uneven pace shows at once.`,
        ],
      ],
      needs: t`Every deck has ${DECK_SIZE} cards. Choosing one starts at the first card and clears the Measured numbers. The page measures each card as it draws it, so a deck's heights are its cards' own, close to the sims' set and not equal to it.`,
      tune: "Hold a key on the alternating deck to see the hardest case for an even pace: a beat or a plan that holds there holds on the others.",
    };
  },
  "measured.pace": () => ({
    what: "The pace of the latest hold, measured on the page: cards per second, the shortest and longest step between cards, and the worst change from one step to the next.",
    effect: [
      [
        "Reads",
        "The mean over every step of the hold in its direction, from the first card that moved to the last, including any taken after the key came up. A step is the time between two changes of the front card on the page's clock, so a hold at ¼× reads as at full speed.",
      ],
      [
        "Compares with",
        "The simulation's held pace, interval range and worst step-to-step change, which the tooltips quote. The simulation is the lab's headless runs of each model (`npm run sweep`): one setting changed at a time, holds and taps over three sets of card heights, on a stepped clock with a fixed key repeat. A difference is the page's own key repeat or frame clock.",
      ],
    ],
    needs:
      "A run starts with a press while nothing moves and ends at rest with no key down; two cards or more make it a hold, one makes it a tap. The numbers clear when a model setting, the preset, the model or the deck changes. Hidden under reduced motion.",
    tune: "Use `↓ from top` for a hold over the whole deck, change one setting, and run it again.",
  }),
  "measured.last": () => ({
    what: "The pace of the last hold the other way from the latest, so ↑ and ↓ read side by side.",
    effect: [
      [
        "Reads",
        "Cards per second and how many cards the hold moved, as the pace line measures them.",
      ],
    ],
    needs:
      "Its label names the direction it reports. It clears with the pace line.",
    tune: "Run `↓ from top` and then `↑ from bottom`: an even model holds the two at about the same pace.",
  }),
  "measured.tap": () => ({
    what: "How long the last single press each way took to land, measured on the page, and how fast the card was still moving as it landed.",
    effect: [
      [
        "Reads",
        "↑ lands and ↓ settles: from the press until the new front card's top and natural bottom stay within two px of where they end and move less than one px in a frame (`landFrame` in `sim/lib.mjs`). Landing: the most that card moved in one frame over its last five, the faster of the two directions.",
      ],
    ],
    needs:
      "A run of one card is a tap, so press and release before the key repeats. It clears with the pace line. The simulation's tap numbers are medians over many starting cards; this is one tap.",
    tune: "Tap ↑ a few times after a change to the tap spring or budget: ↑ is the slowest trip, so a lag or a hard landing shows there first.",
  }),
  "measured.checker": (f) => ({
    what: "The frame checker of `sim/check.mjs`, run on the page's frames since the last press from rest.",
    effect: [
      [
        "Reads",
        t`The problems found, by kind: a jump (an edge moving more than ${f.limit.jump} px in a frame), an edge flash (a lower edge changing by more than ${f.limit.band} px with nothing covering it), a fade flicker (a fade changing by more than ${f.limit.shade} in a frame), a swap (two overlapping cards changing draw order). Then the card and time of the last problem, the largest edge move, and for the cascade the most cards in front of the pile at once.`,
      ],
    ],
    needs:
      "It reads the model's own frames, recorded about once each sixtieth of a second of page clock, so its per-frame limits mean what they mean in the sims at any display rate or speed. Presets outside the checker's rules, `loose`, still show their count.",
    tune: "Run the hold that worries you on the alternating Cards deck. A problem here that the simulation does not report is the page's key repeat or frame clock at work; step through it with Pause and Step.",
  }),
  "hold.down": (f) => ({
    what: "Simulates holding ↓ from the first card to the last: it moves the stack to the top first, then holds the key until the front reaches the end.",
    effect: [
      [
        "Click",
        t`The stack jumps to the first card and a held ↓ starts at once: one press, then a repeat every \`hold repeat interval\` (${f.def("kri")} ms) after \`hold repeat delay\` (${f.def("krd")} ms), as the OS repeats a held key. The key is released when the last card is in front. While it runs the button reads Stop; click it to release early.`,
      ],
    ],
    needs:
      "It runs on the page's clock, so Speed, Pause and Step apply to it, and the Held keys settings react as they do to a real key. A real ↑ or ↓, a model button or Reduced motion stops it. Hidden under reduced motion, where a held key moves one card.",
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
    needs: t`Only the simulated holds read it; a real key repeats at the system's own rate. The model's \`speeds up after\` is separate: it counts from the key going down before a held key speeds up, folds or passes over. Default ${f.def("krd")} ms.`,
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
        t`No card moves. The heading changes at once and the new front card fades in over \`reduced fade\` (${f.def("rfade")} ms by default). A held key moves one card: its repeat is ignored, so press again for the next.`,
      ],
      ["Off", "Cards move as the active model draws them."],
    ],
    needs:
      "The page also turns it on when the system setting `prefers-reduced-motion` is set. It applies to every model and overrides every preset and setting, which have no effect while it is on. While it is on, the inspector hides what it overrides: Page shows `reduced fade` in place of `heading fade` and the key repeat, Measured, Taps, Held keys and Finish hide, and Route keeps only the cascade's `park`, `edge fade` and `leave shade`, which still cut and fade the stage, and the path's settings while `Bezier path` is on.",
    tune: "Use it to check the fallback: press ↓ and ↑ and look for a calm cut with nothing sliding. Turn it off to compare with the motion.",
  }),
  path: (f) => ({
    what: "Draws the path each moving card's top edge follows on the stage, as cubic Bezier segments with their control handles, anchors and a live marker for each card.",
    effect: [
      [
        "On",
        t`Shows the drum's ring as one rounded loop: down in front of the pile, across the column at the \`turn\`, and up behind the pile to the \`tuck\`, with a ring at each leg's widest point. With the default Route settings it bows ${f.def("sway")} px to the right in front and ${Math.abs(Number(f.def("swayb")))} px to the left behind. ↓ runs it forwards and ↑ backwards. The cascade shows one bow down the exit channel to \`park\`. The pile spine and a dot for each painted card are drawn too; the module's toggles turn each part off.`,
      ],
      ["Off", "Hides the overlay; cards still follow the same path."],
    ],
    needs:
      "Works in every model. While it is on, the Overlay module shows what the overlay draws: control handles, knots, direction arrows, labels, the pile spine and card markers. The path's settings in Route shape the curve whether or not it is drawn. The vertical motion is each model's own, so springs, budgets and the frame checker are unchanged. The loop drawn is the one for the moving card nearest the front, or the front card at rest. Reduced motion removes the sway, but the overlay still draws the path a card would follow.",
    tune: "Turn it on with `¼×` speed, or click Pause and Step during a press, then move \`sway\` and the Route sliders under \`more\` and watch each card's marker ride the loop.",
  }),
  held: (f) => ({
    what: "A readout of the held state, from zero (tap behaviour) to one (the full speed-up, fold or pass), shown while `while held` is anything but `same as taps`.",
    effect: [
      [
        "Reads",
        t`Zero through a tap and through \`speeds up after\`, ${f.rise.level} about ${f.rise.seconds} s after it ends, and falling back when you release the key or the hold reaches the end of the queue.`,
      ],
      [
        "Drives",
        "The spring and the top speed slide from their tap values to their held values as it rises. The drum's fold shrinks the cards with it, and the cascade's train moves from `pace before speed-up` to `pace`.",
      ],
    ],
    needs:
      "The first line of the Measured module. `speeds up after` sets when it starts to rise; the rate is fixed. It is hidden while `while held` is `same as taps`, as in `natural` and `no held ramp`.",
    tune: "Watch it during a hold. If it is still near zero once your key repeat settles into a rhythm, lower `speeds up after`.",
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
      "The inspector's modules map to parts of the model: Taps to how one card travels, Held keys to what a held key changes and how its presses are paced, Route to where a leaving card goes, Finish to the fades, the tuck and the plan's estimate. The product runs the drum too, with the settings it ships.",
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
      "The inspector's modules map to parts of the model: Taps to how one card travels, Held keys to how fast the train runs and when it speeds up, Route to where cards park and how they leave the page.",
    tune: "Read it once before you move a setting, and again when two settings seem to fight. Its last paragraph defines the four problems the frame checker counts and what `clean` means here.",
  }),

  // ---- taps ---------------------------------------------------------------------------------------
  "setting.w0": (f) => {
    const s = f.sweep("w0", "natural");
    const slow = s.at(2),
      base = s.at(3),
      snappy = s.at(4.5),
      hard = s.at(6);
    const c = f.sweep("w0", "default");
    const cBase = c.at(3),
      cSnappy = c.at(4.5),
      cHard = c.at(6);
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
      "a stiffer tap spring speeds up a drum hold",
    );
    f.expect(
      slow.clean && base.clean && !snappy.clean && !hard.clean,
      "the two lower tap spring values are clean on the drum and the two higher fail",
    );
    f.expect(
      up(cBase) > up(cSnappy) &&
        c.sweep.rows.every((r) => r.problems === 0) &&
        [cSnappy, cHard].every((r) => r.onePace === cBase.onePace),
      "every tap spring is clean on the cascade, lands ↑ sooner when stiffer, and holds the same pace",
    );
    return {
      what: "How stiff each card's spring is for a tap, and for a held key until it speeds up: how fast a card gets going and how it slows into place. Both models share it.",
      effect: [
        [
          "Raise",
          t`Cards reach their places sooner and stop harder. On the drum a tap ↑ lands in ${base.upLand} ms at ${base.value} Hz and ${snappy.upLand} ms at ${snappy.value}, the speed left in the last five frames rises from ${base.landSpeed} to ${snappy.landSpeed} px/frame, and held ↑ / ↓ goes from ${base.pace} to ${snappy.pace} cards/s. On the cascade a tap ↑ lands in ${cBase.upLand} ms and ${cSnappy.upLand} ms, and the held pace stays at ${cBase.onePace} cards/s.`,
        ],
        [
          "Lower",
          t`Cards drift in. At ${slow.value} Hz a drum tap ↑ takes ${slow.upLand} ms and a tap ↓ ${slow.dnLand} ms (${base.dnLand} at ${base.value}); the landing speed falls to ${slow.landSpeed} px/frame and held ↑ / ↓ slows to ${slow.pace} cards/s.`,
        ],
      ],
      needs: t`Every preset uses it for taps. With \`while held\` set to anything but \`same as taps\`, a hold ramps from it to \`held spring\` after \`speeds up after\`. \`top speed\` limits how far an edge may move. The line under the slider shows the last tap the page measured each way.`,
      tune: t`Start at ${base.value} and press ↑ once after each small change: ↑ is the slowest trip, so a lag or a hard landing shows there first. On the drum ${slow.value} and ${base.value} Hz pass the frame checker, ${snappy.value} gives ${snappy.verdict} and ${hard.value} gives ${hard.verdict}, and the largest edge move in a hold reaches ${hard.jump} px/frame. On the cascade every value swept is clean, so the limit is how the landing feels: ${cHard.landSpeed} px/frame at ${cHard.value} Hz.`,
    };
  },
  "setting.cap": (f) => {
    const s = f.sweep("cap", "natural");
    const lo = s.at(960),
      base = s.at(1440),
      mid = s.at(1800),
      high = s.at(2160),
      edge = s.at(2340),
      over = s.at(2400),
      end = s.at(2640);
    const c = f.sweep("cap", "default");
    const cBase = c.at(1440),
      cMid = c.at(2160),
      cOver = c.at(2400);
    f.expect(
      rate(lo) < rate(base) &&
        rate(base) < rate(mid) &&
        rate(mid) < rate(high) &&
        rate(high) < rate(edge),
      "a higher top speed speeds up a drum hold",
    );
    f.expect(
      [lo, base, mid, high, edge].every((r) => r.clean) &&
        !over.clean &&
        !end.clean &&
        !cOver.clean &&
        cMid.clean,
      "the top speed is clean through its last value below the jump limit and fails at and above it, on both models",
    );
    f.expect(
      dn(lo) === dn(base) && dn(base) === dn(over),
      "the top speed leaves tap ↓ alone",
    );
    f.expect(
      rate(cMid) > rate(cBase),
      "a higher top speed lifts the cascade's held pace",
    );
    const hz = Number(f.hz);
    const pf = (r: RowView) => String(Math.round((r.raw.value / hz) * 10) / 10);
    return {
      what: t`The most any card edge may move in a second, in px, for a tap and for a held key until it speeds up. The frame checker's limits are per frame, so the line under the slider gives the value in px per frame at ${hz} and ${hz * 2} Hz.`,
      effect: [
        [
          "Raise",
          t`The fastest part of every trip gets faster. On the drum a tap ↑ lands in ${base.upLand} ms at ${base.value} px/s and ${edge.upLand} ms at ${edge.value}; held ↑ / ↓ goes from ${base.pace} cards/s to ${mid.pace} at ${mid.value} and ${edge.pace} at ${edge.value}. Tap ↓ stays at ${base.dnLand} ms: its trips stay under the lowest value. On the cascade the held pace rises from ${cBase.onePace} to ${cMid.onePace} cards/s at ${cMid.value}.`,
        ],
        [
          "Lower",
          t`Trips flatten into a steady slide: at ${lo.value} px/s a drum tap ↑ takes ${lo.upLand} ms and held ↑ / ↓ manages ${lo.pace} cards/s.`,
        ],
      ],
      needs: t`The spring decides how hard a card tries to move, and the top speed binds only where the spring asks for more, so tap ↓ does not change. Once a held key speeds up, it ramps to \`held top speed\`. The same px/s is half as far per frame at ${hz * 2} Hz as at ${hz}, so a value the checker passes at ${hz} Hz passes on a faster display too.`,
      tune: t`Start at ${base.value}. For a faster hold without folding, raise it a step at a time: ${mid.value} gives ${mid.pace} cards/s and ${high.value} gives ${high.pace} on the drum, both clean. At ${over.value} (${pf(over)} px/frame at ${hz} Hz) the checker reports ${over.verdict} on the drum and ${cOver.verdict} on the cascade, and ${end.value} reports ${end.problems}. The shipped tap top speed is ${QUEUE_CFG.vcap} px/s.`,
    };
  },

  // ---- held keys ----------------------------------------------------------------------------------
  "setting.held": (f) => {
    const nat = f.preset("natural");
    const alone = f.sweep("w1", "speed up").start;
    const fold = f.preset("fold");
    const loose = f.preset("loose");
    const cd = f.preset("default");
    const off = f.preset("no held ramp");
    f.expect(
      rate(alone) > nat.raw.heldUp &&
        alone.raw.step > nat.raw.step &&
        fold.clean &&
        !loose.clean &&
        cd.raw.heldUp > off.raw.heldUp,
      "speeding up is faster than natural but less even, fold is clean, passing over is not, and the cascade's speed-up is faster than its tap pace",
    );
    return {
      what: "What a held key does to the cards once it has been held past `speeds up after`: nothing more than a tap does, speed up, fold every card to its header line, or let a leaving card pass over the next one. The cascade offers the first two.",
      effect: [
        [
          "same as taps",
          t`The springs and the top speed keep their tap values for the whole hold: \`natural\` holds ${nat.pace} cards/s, the cascade's \`no held ramp\` ${off.onePace}.`,
        ],
        [
          "speed up",
          t`The spring rises from ${f.def("w0")} to ${f.def("w1")} Hz and the top speed from ${f.def("cap")} to ${f.def("cap1")} px/s, ${f.rise.level} of the way in about ${f.rise.seconds} s. On \`natural\` that lifts held ↑ / ↓ from ${nat.pace} to ${alone.pace} cards/s, with ${alone.verdict}. The cascade's train tightens from \`pace before speed-up\` to \`pace\`: ${cd.onePace} cards/s on \`default\`.`,
        ],
        [
          "fold to the header line",
          t`Every card shrinks toward a ${f.def("h0")} px strip, so a trip no longer depends on the card's height: the \`fold\` preset reaches ${fold.pace} cards/s, ${fold.clean ? "clean" : fold.problems}. The card you land on unfolds when you release.`,
        ],
        [
          "pass over the next card",
          t`Cards stay whole, but a leaving card drops only as far as a ${f.def("h0")} px card would need, so it passes over the card it uncovers, washing out: \`loose\` reaches ${loose.pace} cards/s. The checker counts each pass as a draw-order swap (${loose.problems} in taps, holds and reversals), so this choice is outside its rules.`,
        ],
      ],
      needs:
        "Fold and pass over include the speed-up. Anything but `same as taps` shows `speeds up after`, `held spring` and `held top speed`; fold and pass over also show `held height`. A tap shorter than `speeds up after` changes nothing, and a hold that reaches the end of the queue stops there. The held readout in Measured shows how far the held state has risen.",
      tune: t`Start from a preset that makes the choice: \`shipped\` or \`even + held speed\` to speed up, \`fold\`, \`loose\`. Then set \`pacing\`: speeding up with the presses following the cards leaves a worst step-to-step change of ${alone.step}× (${nat.step}× on \`natural\`), which a steady beat or a plan evens out.`,
    };
  },
  "setting.pacing": (f) => {
    const nat = f.preset("natural");
    const even = f.preset("even");
    const c = f.sweep("pace", "steady beat").at(3.5);
    const fold = f.sweep("pace", "fold, steady beat").at(6.5);
    f.expect(
      even.raw.step < nat.raw.step && c.raw.step < nat.raw.step,
      "a steady beat or a plan evens the pace",
    );
    return {
      what: "How a held key's presses are spaced: as the cards allow, at a steady beat, or at an interval planned from the card heights ahead. Drum only: the cascade spaces its train by distance, so its pace is steady by construction.",
      effect: [
        [
          "follows cards",
          t`The pace follows each card's height: intervals ${nat.range} ms, so one step can take ${nat.step}× as long as the last, and held ↑ / ↓ is ${nat.pace} cards/s on \`natural\`. There is no pace to set, so the row shows the pace the page measured.`,
        ],
        [
          "steady beat",
          t`Presses at least an interval apart, which \`pace\` sets in cards/s: at ${c.value} cards/s the hold measures ${c.pace} with intervals of ${c.range} ms.`,
        ],
        [
          "planned",
          t`The interval eases up before a tall card and back after it: ${even.pace} cards/s, intervals ${even.range} ms, worst step-to-step change ${even.step}× (${nat.step}× when following the cards). \`plan\` scales it.`,
        ],
      ],
      needs:
        "`steady beat` shows `pace`; `planned` shows `plan` here and the plan's estimate (`plan window`, `plan base`, `plan per px`) in Finish. A beat or a plan only delays a press: the cards' own gate still sets the earliest start, so a tall card can outlast the beat.",
      tune: t`Choose \`steady beat\` when you know the pace you want and \`planned\` for the smoothest rhythm. Either trades pace for evenness, and fold wins pace back: folding with a steady beat of ${fold.value} cards/s measures ${fold.pace}, worst step-to-step change ${fold.step}×.`,
    };
  },
  "pace.cards": (f) => {
    const nat = f.preset("natural");
    return {
      what: "The pace of a held key while the presses follow the cards: nothing sets it, so the row shows the pace the page measured.",
      effect: [
        [
          "Reads",
          t`The latest hold each way, in cards/s, as the Measured module's pace lines read it. The simulation measures \`natural\` at ${nat.pace} cards/s.`,
        ],
      ],
      needs:
        "Shown in place of the `pace` slider while `pacing` is `follows cards`. It clears with the Measured numbers.",
      tune: "Hold a key on each Cards deck: the pace drops at tall cards. For one pace whatever the heights, choose `steady beat` or `planned`.",
    };
  },
  "setting.pace": (f) => {
    const c = f.sweep("pace", "steady beat");
    const slow = c.at(2.5),
      base = c.at(3.5),
      mid = c.at(4),
      fast = c.at(5);
    const h = f.sweep("pace", "speed up, steady beat");
    const h45 = h.at(4.5),
      h5 = h.at(5);
    const fo = f.sweep("pace", "fold, steady beat");
    const fo65 = fo.at(6.5),
      fo125 = fo.at(12.5);
    const d = f.sweep("pace", "default");
    const dw = d.at(8),
      db = d.at(12),
      dt = d.at(14),
      dmax = d.at(18);
    const o = f.sweep("pace", "no held ramp");
    const o96 = o.at(9.6),
      o12 = o.at(12);
    f.expect(
      rate(base) > rate(slow) &&
        rate(mid) > rate(base) &&
        rate(fast) > rate(mid),
      "a faster beat is faster on the drum",
    );
    f.expect(
      fo65.clean && fo125.clean && rate(h5) > rate(h45),
      "a fold holds the two beats quoted cleanly, and a faster beat while speeding up is faster",
    );
    f.expect(
      rate(dw) < rate(db) &&
        rate(db) < rate(dt) &&
        rate(dt) < rate(dmax) &&
        d.sweep.rows.every((r) => r.problems === 0) &&
        rate(o12) > rate(o96),
      "a faster cascade pace is faster and every value is clean, with the ramp and without it",
    );
    f.expect(
      dmax.raw.visible < dt.raw.visible &&
        dt.raw.visible < db.raw.visible &&
        dw.raw.channel < dmax.raw.channel &&
        dmax.raw.step > db.raw.step,
      "a faster cascade pace shows less of each card, puts more cards in front of the pile and is less steady",
    );
    f.expect(
      dmax.raw.heldJump <= Number(f.limit.jump) &&
        dmax.raw.heldJump > Number(f.limit.jump) - 1,
      "the fastest cascade pace moves an edge to within a pixel of the jump limit",
    );
    return {
      what: "How fast a held key moves the cards, in cards per second. On the drum it is a steady beat: a press waits at least a second divided by the pace after the last, so it shows while `pacing` is `steady beat`. On the cascade it is the spacing between leaving cards at the speed the train runs at, so the train holds it on every card height.",
      effect: [
        [
          "Raise",
          t`A faster hold. On the drum ${mid.value} cards/s measures ${mid.pace} with intervals of ${mid.range} ms, and ${fast.value} measures ${fast.pace} (${fast.range} ms): a tall card still takes about ${fast.ivMax} ms to clear, so past about ${mid.value} the trips set the pace, not the beat. On the cascade ${dt.value} cards/s measures ${dt.onePace} and ${dmax.value} measures ${dmax.onePace}; the median card then shows ${dmax.visible} px of itself at its best against ${db.visible} at ${db.value}, and ${dmax.channel} cards are in front of the pile at once.`,
        ],
        [
          "Lower",
          t`A slower, steadier hold: ${slow.value} cards/s on the drum measures ${slow.pace} with intervals of ${slow.range} ms, and ${dw.value} on the cascade measures ${dw.onePace}.`,
        ],
      ],
      needs: t`The line under the slider gives the beat in ms or the spacing in px, beside the pace the page measured: on the drum a beat is the least interval, so the measured pace is the one to read. Speeding up shortens the drum's trips so the beat can run faster: a steady ${h45.value} cards/s while speeding up holds ${h45.range} ms, ${h45.verdict}. Folding goes further: ${fo65.value} cards/s is ${fo65.verdict} and ${fo125.value} measures ${fo125.pace}. On the cascade the train runs at \`held top speed\` once it speeds up and at \`top speed\` with \`same as taps\`, where ${o96.value} cards/s measures ${o96.onePace}.`,
      tune: t`Set the pace you want and compare it with the measured one beside it; when they part, the trips are the limit, so lower the pace or speed up or fold. On the cascade every value swept is clean, so the limits are how much of each card you can still read and how even the pace stays: the worst step-to-step change is ${db.step}× at ${db.value} cards/s and ${dmax.step}× at ${dmax.value}, where the largest edge move, ${dmax.jump} px/frame, is at the checker's limit of ${f.limit.jump}.`,
    };
  },
  "setting.pace0": (f) => {
    const s = f.sweep("pace0", "default");
    const wide = s.at(5),
      base = s.at(6.7),
      tight = s.at(9.6);
    f.expect(
      rate(tight) > rate(base) && rate(base) > rate(wide),
      "a slower start is a slower hold",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every pace before the speed-up is clean",
    );
    f.expect(
      rate(tight) - rate(wide) < 1.5,
      "the pace before the speed-up moves a hold's pace by under a card per second",
    );
    return {
      what: "How fast the cascade's train leaves when a hold begins, before it speeds up, in cards per second: the spacing between leaving cards at `top speed`.",
      effect: [
        [
          "Raise",
          t`The hold starts closer to full pace: at ${tight.value} cards/s the whole hold measures ${tight.onePace} cards/s, and the median card shows ${tight.visible} px of itself at its best against ${base.visible} at ${base.value}.`,
        ],
        [
          "Lower",
          t`The first cards leave farther apart: at ${wide.value} cards/s the hold measures ${wide.onePace} cards/s with intervals of ${wide.range} ms, against ${base.onePace} and ${base.range} at ${base.value}.`,
        ],
      ],
      needs:
        "Cascade only, and only while `while held` is `speed up`. The speed-up moves the train from this pace to `pace` as the held state rises after `speeds up after`. The line under the slider gives the spacing in px.",
      tune: t`Start at ${base.value}. It shapes the start of a hold more than its pace: from ${wide.value} to ${tight.value} cards/s the hold moves from ${wide.onePace} to ${tight.onePace}, all clean. Lower it to make the speed-up easier to see; set the held pace with \`pace\`.`,
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
      "a larger plan is slower",
    );
    f.expect(
      hs.clean && hs.raw.step < noRamp.raw.step,
      "speeding up makes a smaller plan clean and steadier",
    );
    return {
      what: t`A multiplier on the planned interval, while \`pacing\` is \`planned\`. At ${f.def("ts")}× the plan is ${f.estimate.short} ms for a ${f.cards.min} px card and ${f.estimate.tall} ms for a ${f.cards.max} px card. The plan is per card, so it has no single pace; the line under it shows the pace the page measured.`,
      effect: [
        [
          "Raise",
          t`Longer intervals, a slower and steadier hold: ${slow.value}× gives ${slow.pace} cards/s (intervals ${slow.range} ms) and ${slower.value}× gives ${slower.pace}.`,
        ],
        [
          "Lower",
          t`Shorter intervals, until a tall card's real trip outlasts the plan. At ${half.value}× the pace is ${half.pace} cards/s, close to \`natural\`'s ${nat.pace}, and the worst step-to-step change is back up to ${half.step}× (${nat.step}× on \`natural\`).`,
        ],
      ],
      needs: t`Drum only. Speeding up shortens the real trips, so it lets the plan run shorter: \`even + held speed\` plans at ${hs.value}× and keeps ${hs.step}×, while the same plan without it reaches intervals of ${noRamp.ivMax} ms (${noRamp.step}×). Speeding up at ${hsLow.value}× gives ${hsLow.pace} cards/s with ${hsLow.verdict}. The plan's estimate is in Finish.`,
      tune: t`Start at ${f.def("ts")}×, or ${hs.value}× while speeding up. Lower it a little at a time until the pace suits you, and stop when the worst step-to-step change starts to climb or the checker reports a problem.`,
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
    const a = f.sweep("delay", "speed up");
    const a600 = a.at(600);
    const c = f.sweep("delay", "default");
    const c0 = c.at(0),
      c600 = c.at(600);
    f.expect(
      rate(f0) > rate(f250) &&
        rate(f250) > rate(f600) &&
        rate(f600) > rate(f800),
      "a later speed-up is slower on fold",
    );
    f.expect(
      [f0, f250, f600, f800].every((r) => r.clean),
      "every value is clean on fold",
    );
    f.expect(
      a.sweep.rows.every((r) => r.problems === 0),
      "every value is clean speeding up alone",
    );
    f.expect(
      Math.abs(rate(e0) - rate(e800)) < 0.1,
      "the delay does not move a planned pace",
    );
    f.expect(
      rate(c0) > rate(c600) && c.sweep.rows.every((r) => r.problems === 0),
      "a later speed-up is slower on the cascade and every value is clean",
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
      what: "How long a key must be held before it speeds up, folds or passes over, in ms. Both models share it.",
      effect: [
        [
          "Raise",
          t`The first cards of a hold run at tap pace for longer, then the pace steps up. On \`fold\`, ${f600.value} ms gives ${f600.pace} cards/s against ${f250.pace} at ${f250.value}, and the worst step-to-step change grows from ${f250.step}× to ${f600.step}×. On the cascade ${c600.value} ms gives ${c600.onePace} cards/s.`,
        ],
        [
          "Lower",
          t`The held state starts with the first press: on \`fold\`, ${f0.value} ms gives ${f0.pace} cards/s, and on the cascade ${c0.onePace}. A tap starts it too: a ${tap.ms} ms tap reaches a held state of ${t0.peak} at ${t0.delay} ms, ${t100.peak} at ${t100.delay} ms and ${t250.peak} at ${t250.delay} ms.`,
        ],
      ],
      needs: t`Shown while \`while held\` is anything but \`same as taps\`. Under a plan the plan sets the pace and the delay changes nothing measurable: \`even + held speed\` holds ${e0.pace} cards/s at ${e0.value} ms and ${e800.pace} at ${e800.value} ms. The held state reaches ${f.rise.level} about ${f.rise.seconds} s after the delay.`,
      tune: t`Start at ${f.def("delay")}. Lower it until a normal tap begins to fold or speed up, then back off. On \`fold\`, speeding up alone and on the cascade every value swept is clean, so it is a safe knob for pace; speeding up alone, ${a600.value} ms still gives ${a600.pace} cards/s.`,
    };
  },
  "setting.w1": (f) => {
    const fo = f.sweep("w1", "fold");
    const f3 = fo.at(3),
      f45 = fo.at(4.5),
      f5 = fo.at(5),
      f6 = fo.at(6);
    const a = f.sweep("w1", "speed up");
    const a3 = a.at(3),
      a35 = a.at(3.5),
      a7 = a.at(7);
    const e = f.sweep("w1", "even + held speed");
    const e3 = e.at(3),
      e7 = e.at(7);
    const c = f.sweep("w1", "default");
    const c45 = c.at(4.5),
      c6 = c.at(6),
      c8 = c.at(8);
    f.expect(
      rate(f3) < rate(f45) && rate(f45) < rate(f5) && rate(f5) < rate(f6),
      "a stiffer held spring speeds up a fold",
    );
    f.expect(
      fo.sweep.rows.every((r) => r.problems === 0) &&
        a.sweep.rows.every((r) => r.problems === 0) &&
        a7.raw.step > a35.raw.step,
      "every held spring swept on the drum is clean, and a stiffer one is less even",
    );
    f.expect(
      Math.abs(rate(e3) - rate(e7)) < 0.1,
      "the held spring does not move a planned pace",
    );
    f.expect(
      c45.clean && c6.clean && !c8.clean && c6.onePace === c45.onePace,
      "the cascade's held spring is clean to 6 Hz, fails at 8 and leaves the pace alone",
    );
    return {
      what: "The spring stiffness a held key ramps up to once it speeds up. Both models share it.",
      effect: [
        [
          "Raise",
          t`Cards snap faster once the held state is in. On \`fold\`, ${f3.value} Hz gives ${f3.pace} cards/s, ${f45.value} gives ${f45.pace} and ${f6.value} gives ${f6.pace}; speeding up alone, ${a35.value} gives ${a35.pace} and ${a7.value} gives ${a7.pace}. On the cascade the pace stays at ${c45.onePace} cards/s and the largest edge move grows from ${c45.jump} to ${c6.jump} px/frame at ${c6.value} Hz.`,
        ],
        [
          "Lower",
          t`The held state moves more like a tap: at ${a3.value} Hz, the tap spring's default, the speed-up comes from \`held top speed\` alone (${a3.pace} cards/s).`,
        ],
      ],
      needs: t`Shown while \`while held\` is anything but \`same as taps\`. \`held top speed\` caps what a stiffer spring can do. Under a plan it leaves the pace alone: \`even + held speed\` stays at ${e3.pace} cards/s from ${e3.value} to ${e7.value} Hz. The line under the slider gives it as a multiple of \`tap spring\`.`,
      tune: t`Start at ${f.def("w1")}. On the drum every value swept is clean, so judge by evenness: on \`fold\`, ${f5.value} Hz keeps a worst step-to-step change of ${f5.step}× (${f5.pace} cards/s) and ${f6.value} Hz ${f6.step}×; speeding up alone, ${a35.value} Hz gives ${a35.step}× and ${a7.value} Hz ${a7.step}×. On the cascade ${c8.value} Hz gives ${c8.verdict}. If a raise makes the rhythm uneven, add a steady beat before you lower the spring.`,
    };
  },
  "setting.cap1": (f) => {
    const fo = f.sweep("cap1", "fold");
    const f24 = fo.at(1440),
      f30 = fo.at(1800),
      f39 = fo.at(2340),
      f40 = fo.at(2400);
    const a = f.sweep("cap1", "speed up");
    const a24 = a.at(1440),
      a30 = a.at(1800),
      a39 = a.at(2340);
    const e = f.sweep("cap1", "even + held speed");
    const e24 = e.at(1440),
      e30 = e.at(1800),
      e39 = e.at(2340),
      e40 = e.at(2400);
    const c = f.sweep("cap1", "default");
    const c24 = c.at(1440),
      c30 = c.at(1800),
      c36 = c.at(2160);
    f.expect(
      rate(f24) < rate(f30) && rate(f30) < rate(f39),
      "a higher held top speed speeds up a fold",
    );
    f.expect(
      f39.clean && e39.clean && !f40.clean && !e40.clean,
      "a fold and even + held speed are clean through the last held top speed below the jump limit",
    );
    f.expect(
      a24.clean && a30.clean && a39.clean,
      "speeding up alone is clean below the jump limit",
    );
    f.expect(
      Math.abs(rate(e30) - rate(e39)) < 0.1,
      "the held top speed does not move a planned pace",
    );
    f.expect(
      rate(c24) < rate(c30) && rate(c30) < rate(c36) && c30.clean && !c36.clean,
      "on the cascade a higher held top speed is faster, clean to the default and failing above",
    );
    return {
      what: "The top speed a held key ramps up to once it speeds up, in px per second. Both models share it.",
      effect: [
        [
          "Raise",
          t`Held trips get faster. On \`fold\`, ${f24.value} px/s gives ${f24.pace} cards/s, ${f30.value} gives ${f30.pace} and ${f39.value} gives ${f39.pace}; speeding up alone the same three give ${a24.pace}, ${a30.pace} and ${a39.pace}. On the cascade it sets how fast the held train runs: with \`pace\` left at its preset's spacing, ${c30.value} gives ${c30.onePace} cards/s and ${c36.value} gives ${c36.onePace}, with ${c36.verdict}.`,
        ],
        [
          "Lower",
          t`Below \`top speed\` (${f.def("cap")} px/s) a hold moves slower than a tap would: on \`fold\`, ${f24.value} gives ${f24.pace} cards/s, and under a plan the pace stays at ${e24.pace}.`,
        ],
      ],
      needs: t`Shown while \`while held\` is anything but \`same as taps\`. The held spring decides how hard a card tries to move and this limits it. Under a plan the pace stays put: \`even + held speed\` holds ${e30.pace} cards/s at ${e30.value} and at ${e39.value}. A \`pace\` set on the cascade keeps its cards/s whatever this is, by changing the spacing. The line under the slider gives it in px per frame.`,
      tune: t`Start at ${f.def("cap1")}, the shipped engine's peak edge speed. ${f39.value} is the highest clean value on \`fold\`, on \`even + held speed\` and speeding up alone. At ${f40.value} the checker reports jumps (an edge moved over ${f.limit.jump} px in a frame): ${f40.problems} on \`fold\`, ${e40.problems} on \`even + held speed\`. On the cascade keep it at ${c30.value} or below and set the pace with \`pace\`.`,
    };
  },
  "setting.h0": (f) => {
    const s = f.sweep("h0", "fold");
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
      "a taller held height is slower",
    );
    f.expect(
      s.sweep.rows.every((r) => r.problems === 0),
      "every held height swept is clean",
    );
    return {
      what: "The height every card draws at while folded, or the height a leaving card clears while passing over, in px. A card shorter than this grows to it when folded.",
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
      needs: t`Drum only, shown while \`while held\` is \`fold to the header line\` or \`pass over the next card\`. A taller fold keeps more text but slows the hold: ${h160.value} gives ${h160.pace} cards/s. The line under the slider gives the shortest card on the stage.`,
      tune: t`Start at ${f.def("h0")}, one line of status and goal. Pick the height by what you want to read while scanning; the simulation is clean from ${h50.value} to ${h160.value}. To change the pace without changing the look, use \`speeds up after\`.`,
    };
  },

  // ---- finish: the fades and the plan window -----------------------------------------------------
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
      verdict: t`In the simulation: no landing time moves; clean to ${base.value} per second, a fade flicker from ${over.value}.`,
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
      verdict: t`In the simulation: no timing number moves; clean at every value.`,
      needs: t`The content fades as the rising card leaves the tuck and comes back once it has landed, when the card is a strip behind it. A card moving into the front on a ↓ never loses its content. The drawn bottom edge shrinks at a limited rate, so it never jumps. No position or timing changes: a tap ↑ lands in ${full.upLand} ms and held ↑ / ↓ runs at ${full.pace} cards/s at every value, ${full.verdict} at ${full.value}.`,
      tune: t`Start at ${full.value}. Lower it to ${half.value} to keep a trace of the text while the card is covered.`,
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
      what: "How many cards ahead and behind the one being covered the plan considers.",
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
      verdict: t`In the simulation on \`even\`: held ↑ / ↓ ${w1.pace} cards/s at ${w1.value} card, ${w3.pace} at ${w3.value}, the same above.`,
      needs: t`Shown while \`pacing\` is \`planned\`. Windows above ${w3.value} measure the same (${w6.pace} cards/s at ${w6.value}), so the slider stops there. \`plan\` multiplies whatever interval the window picks.`,
      tune: t`Start at ${w2.value}, which both even presets use. Raise it to ${w3.value} if a long hold still stutters at a tall card; lower it to ${w1.value} for more pace (${w1.pace} cards/s) and less easing. For overall speed use \`plan\`.`,
    };
  },

  // ---- route: the cascade's stage -----------------------------------------------------------------
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
      needs: t`The held pace stays at ${base.onePace} cards/s for every value swept. \`edge fade\` can reach at most \`park\` minus ${TALLEST_CARD + PILE_CLEARANCE} px, so lowering park lowers its range. The slider stops at ${short.value} px because the tallest card (${TALLEST_CARD} px) and its shadow must stay above the clip line.`,
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
      needs: t`A look setting: the simulation measures positions and timing, and a mask on the stage changes neither. It fades the last px above the clip line, so \`park\` places it and limits it to \`park\` minus ${TALLEST_CARD + PILE_CLEARANCE} px. \`leave shade\` also washes a card on its way down.`,
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
      needs: t`A look setting: the hold runs at ${base.onePace} cards/s, a tap ↑ lands in ${base.upLand} ms and the checker reports ${base.verdict} at ${lo.value}, ${base.value} and ${hi.value} alike. \`edge fade\` also hides a card's lower edge, so the two overlap in effect.`,
      tune: t`Start at ${base.value}. Hold ↓ and compare the lowest cards at ${lo.value}, ${base.value} and ${hi.value}: raise it to push leaving cards back, lower it to keep them readable until they park.`,
    };
  },
  // ---- route: the path, which every model shares -------------------------------------------------
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
      "A look setting: it moves cards sideways only, so the frame checker's numbers, the springs and the top speeds are the same at every value. The sway is a function of where the card is on its ring, so it reverses with a card that changes direction mid-flight. `widest point` places the bow, `sway behind` shapes the drum's other leg, and `Bezier path` draws it. The Path module shows while cards sway or the overlay draws the path; under reduced motion with `Bezier path` off it hides.",
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
        "Toward the left. The opposite sign to `sway` makes a closed loop around the turn; a larger value widens it.",
      ],
    ],
    needs:
      "Shown for the drum and the product; the cascade has no leg behind the pile. Most of this leg is hidden behind the pile, so it shows as the card leaves the turn and as a returning card (↑) drops toward it. The width eases between the two legs' widest points, so different values add no corner at the turn.",
    tune: "Set it to the negative of `sway` for a round loop, then press ↑ at `¼×` to watch the card come out from behind the pile.",
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
    needs: t`A look setting with the same numbers at every value, like \`sway\`. \`widest point behind\` places the other leg's widest point, and \`column crossing\` sets where this leg ends. Hidden while neither leg sways. Default ${f.def("peak")}.`,
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

  // ---- route and finish: the drum's tuck, wash and plan estimate ---------------------------------
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
      verdict: t`In the simulation: no tap number moves; clean from ${lo.value}× to ${hi.value}×.`,
      needs: t`Drum only. It acts only behind the pile, after the turn, so \`sway behind\` and the \`tuck\` anchor of \`Bezier path\` show where. The main spring is \`tap spring\`, or \`held spring\` once the held state rises; this multiplies it.`,
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
      verdict: t`In the simulation: tap ↑ lands in ${base.upLand} ms at ${base.value} px and ${hi.upLand} at ${hi.value}; clean at every value.`,
      needs: t`Drum only. A card too tall to hide this way washes out instead (\`tall-card wash rise\`), and the same depth decides which cards count as too tall. The \`tuck\` anchor of \`Bezier path\` marks the end of the tuck.`,
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
      verdict: t`In the simulation: no timing number moves; clean from ${quick.value} ms, a fade flicker at ${fast.value}.`,
      needs: t`Drum only, and only for a card taller than the room the tuck leaves (\`tuck depth\`); the tallest sample cards, ${f.cards.max} px, are. \`tall-card wash clear\` sets the way back, when a returning card regains its colour. Pace and landing times are the same at every value swept.`,
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
      verdict: t`In the simulation: no timing number moves; clean from ${base.value} to ${mid.value} ms.`,
      needs: t`Drum only, for cards too tall to hide behind the pile. \`incoming fade-in\` restores a card coming back with ↑ on its own clock, so this shows mostly on a card that reverses mid-tuck. Pace and landing times are the same at every value swept.`,
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
      verdict: t`In the simulation on \`even\`: held ↑ / ↓ ${lo.pace} cards/s at ${lo.value} ms, ${top.pace} at ${top.value}; all clean.`,
      needs: t`Shown while \`pacing\` is \`planned\`. \`plan per px\` is the height term and \`plan\` multiplies both. The flip gate still applies, so an estimate shorter than a real trip changes nothing. Default ${base.value} ms gives ${base.pace} cards/s on \`even\`.`,
      tune: t`Move \`plan\` first. Raise this for steadier pacing among short cards; every value swept, ${lo.value} to ${top.value} ms, is clean.`,
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
          t`The plan stops reading heights. At ${lo.value} the flip gate alone sets the pace, ${lo.pace} cards/s with ${lo.range} ms intervals and ${lo.step}× from one step to the next, as when the presses follow the cards.`,
        ],
      ],
      verdict: t`In the simulation on \`even\`: held ↑ / ↓ ${lo.pace} cards/s at ${lo.value} ms/px, ${top.pace} at ${top.value}; all clean.`,
      needs: t`Shown while \`pacing\` is \`planned\`. \`plan base\` is the constant term and \`plan\` multiplies both. Default ${base.value} ms/px gives ${base.pace} cards/s on \`even\`.`,
      tune: t`Raise it until the slowest tall card in a hold no longer bunches up behind the gate. Every value swept, ${lo.value} to ${top.value} ms/px, is clean.`,
    };
  },

  // ---- page: the fades ---------------------------------------------------------------------------
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
        "Handles at the knots the path's settings in Route move: each leg's widest point, and the drum's turn. Move `widest point` or `sway` to watch them swing.",
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
      ["Off", "Handles only at the knots the path's settings move."],
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
    tune: "Set it to zero with a large `sway` and watch the markers leave the curve, then return it to the default.",
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
  return t`The frame checker counts four problems. A jump: an edge moves more than ${f.limit.jump} px in a frame. An edge flash: a card's lower edge changes by more than ${f.limit.band} px with nothing covering the change. A fade flicker: a card's fade changes by more than ${f.limit.shade} in a frame. A swap: two cards change draw order while they overlap. A simulated run is clean when the checker finds none of them, over three sets of card heights. ${extra} Source: ${source}; goals and limits: \`DESIGN.md\`.`;
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
        t`A top speed of ${f.def("cap")} px/s, ${f.def("cap1")} while held, caps every edge.`,
      ),
    ],
    map: [
      ["Taps", "`tap spring` and `top speed` set how fast one card travels."],
      [
        "Held keys",
        "`while held` changes both once a key has been held past `speeds up after`, and `pacing` sets when the next press may start.",
      ],
      [
        "Route",
        "`tuck depth`, `sway` and `bank` shape where a leaving card goes.",
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
      t`A press in the direction of the last waits until a card at the train's speed has covered the spacing since the last press, the same time for ↑ and ↓ and for every card height: \`pace\` sets that spacing in cards/s. A held key raises the held state after \`speeds up after\`; with \`while held\` at \`speed up\`, the train goes from ${f.def("pace0", "cascade")} to ${f.def("pace", "cascade")} cards/s, the spring from ${f.def("w0", "cascade")} to ${f.def("w1", "cascade")} Hz and the top speed from ${f.def("cap", "cascade")} to ${f.def("cap1", "cascade")} px/s. A hold at either end of the queue moves nothing.`,
      checkerParagraph(
        f,
        "`src/cascade.ts`",
        "A card that crosses the clip line is cut there, so it is not a lower edge moving in view.",
      ),
    ],
    map: [
      ["Taps", "`tap spring` and `top speed` set how fast one card travels."],
      [
        "Held keys",
        "`pace before speed-up`, `pace` and `speeds up after` set how fast the train runs and when it speeds up.",
      ],
      [
        "Route",
        "`park`, `edge fade` and `leave shade` set where cards park and how they leave the page.",
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
