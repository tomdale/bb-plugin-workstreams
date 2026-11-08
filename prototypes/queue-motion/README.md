# Queue motion lab

The queue draws its cards as a pseudo-3D stack. This directory is where changes
to that motion are worked out before they reach the product. It holds one page
that runs the shipped engine as it is, or the elastic drum or the cascade with
the lab's own settings, one model at a time; headless sims that score the drum
and the cascade with a frame checker; and scripts that capture contact sheets
and recordings of each model.

The product runs the drum (`src/app/page/queue/drum.ts`) through
`src/app/page/queue/stackEngine.ts`, which keeps a short row of cards on the
drum as the queue's pile changes. The drum's settings as shipped are `QUEUE_CFG`
in `drum.ts`: the `even + held speed` preset with a constant 150 ms interval, a
3 Hz tap spring and 17 px/frame tap budget, and a 5 Hz held spring and 30
px/frame held budget after a 250 ms hold. The lab imports both files, so a
rebuild shows the product as it is on this branch. The cascade
(`src/cascade.ts`) is the lab's own model, and the product does not run it.
[DESIGN.md](DESIGN.md) lists the goals the motion must meet, explains how the
drum and the cascade work, and records what limits the pace of a held key, what
the cascade costs, and what is still open.

## Run the page

```sh
cd prototypes/queue-motion
npm ci
npm run build            # runs the sweeps and the tooltip check, writes dist/queue-motion.html
open dist/queue-motion.html
```

Press ↓ and ↑ (or `j` and `k`). A held key repeats at the OS rate; the first
press also starts the hold that the drum's fold and speed-up settings and the
cascade's ramp react to. The Model buttons switch between the shipped engine,
the drum and the cascade. The controls:

| Control               | What it does                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                 | `Product now` imports `src/app/page/queue/stackEngine.ts` as it is and hides the preset and settings rows. `Elastic drum` runs `drum.ts` with the lab's settings, and `Cascade` runs `src/cascade.ts` with its own. |
| Preset                | A named set of one model's settings (`PRESETS` in `drum.ts` or in `src/cascade.ts`). Each model shows its own buttons, built from its list. A click clears every slider change.                                     |
| Settings bar          | The running model's settings as sliders, toggles and one choice. The drum's are in the groups Taps, Pace and Held keys, the cascade's in Taps, Pace and Stage. Moving one overrides the preset.                     |
| Speed, Clock          | ¼×, ½×, 1×; pause and step one 1/60 s frame. The clock is the page's own, so a paused page is a frame you can read.                                                                                                 |
| Reduced motion        | No card moves; the new front fades in over 160 ms. The system's reduced-motion setting turns it on too.                                                                                                             |
| Held readout          | `held 0.00` to `held 1.00` beside the buttons while the drum's held speed-up, fold or loose clearing is on, or the cascade's ramp is: how far the held state has risen.                                             |
| How the drum works    | A panel at the bottom left: the ring path the cards follow, the four problems the frame checker counts, and which settings group acts on which part. The product shows it too.                                      |
| How the cascade works | The same panel while the cascade runs: the exit channel and the clip line, what sets the pace of a held key, the four problems, and which settings group acts on which part.                                        |
| Tooltips              | Every control has one. Hover shows it after a short pause, keyboard focus at once, and Escape dismisses it.                                                                                                         |

A tooltip says what its control is, what you see when you change it, what it
works with, and how to tune it. It lists the sweep commands behind its numbers.

The settings bar shows the running model's settings in groups. A setting shows
only while it changes something under the current configuration (last column of
its table), and a hidden setting keeps its value. Each slider's range and
default are in `SETTINGS` or `CASCADE_SETTINGS` in `src/controls.ts` and at the
top of its tooltip. The key is the setting's name in the URL hash. The drum's
settings are in three groups, Taps, Pace and Held keys:

| Group     | Setting                    | Key     | Shown when             |
| --------- | -------------------------- | ------- | ---------------------- |
| Taps      | spring Hz, tap             | `w0`    | always                 |
|           | edge budget, tap px/frame  | `cap`   | always                 |
| Pace      | tempo                      | `tk`    | always                 |
|           | tempo window               | `tw`    | tempo is `lookahead`   |
|           | tempo scale                | `ts`    | tempo is `lookahead`   |
|           | constant interval ms       | `tms`   | tempo is `constant`    |
|           | gate slack                 | `slack` | tempo is `none`        |
| Held keys | held speed-up              | `ramp`  | fold and loose are off |
|           | fold while held            | `fold`  | always                 |
|           | loosen clearing while held | `loose` | fold is off            |
|           | hold delay ms              | `delay` | a held setting is on   |
|           | spring Hz, held            | `w1`    | a held setting is on   |
|           | edge budget, held px/frame | `cap1`  | a held setting is on   |
|           | held height px             | `h0`    | fold or loose is on    |

The cascade's settings are in three groups too: Taps, Pace and Stage. The ramp
shapes `sp0` and `cdelay`, so the `no held ramp` preset hides them. The largest
`fade` is `park` minus 346 px: the fade starts no higher than the bottom of the
tallest card (330 px) and its 16 px shadow, so no pile card fades.

| Group | Setting                   | Key      | Shown when     |
| ----- | ------------------------- | -------- | -------------- |
| Taps  | spring Hz, tap            | `cw0`    | always         |
|       | edge budget, tap px/frame | `ccap`   | always         |
| Pace  | spacing at rest px        | `sp0`    | the ramp is on |
|       | spacing held px           | `sp1`    | always         |
|       | hold delay ms             | `cdelay` | the ramp is on |
| Stage | park px                   | `park`   | always         |
|       | edge fade px              | `fade`   | always         |
|       | leave shade               | `shade`  | always         |

The URL hash holds the state, for example `#v=drum&preset=fold&cap1=34` (`fold`
with a held edge budget of 34 px/frame) or `#v=cascade&sp1=125&fade=0` (the
cascade's `default` with a held spacing of 125 px and no edge fade). `v` is
`product`, `drum` or `cascade`. `preset` is a preset name of that model, and a
name the model lacks gives its first preset (`natural` for the drum, `default`
for the cascade); the product has no presets. `speed` is `0.25`, `0.5` or `1`,
and `reduced` is `1` or `0`. Every other key is a setting's key from the two
tables above: the drum's `w0`, `cap`, `tk`, `tw`, `ts`, `tms`, `slack`, `ramp`,
`fold`, `loose`, `delay`, `w1`, `cap1` and `h0`, and the cascade's `cw0`,
`ccap`, `sp0`, `sp1`, `cdelay`, `park`, `fade` and `shade`. The two models' keys
differ, so one hash can hold both models' settings, and the model that `v` names
reads only its own. A toggle is `1` or `0`, `tk` is one of its three choices,
and a slider's value is clamped to its range. The page ignores a key or value it
does not recognise.

The drum's presets:

| Preset              | What changes while a key is held                                                              |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `natural`           | Nothing. The pace follows card heights: tall cards slow it, short cards speed it up.          |
| `even`              | Presses are spaced by a tempo planned from the heights ahead.                                 |
| `even + held speed` | The same tempo at a smaller scale, with stiffer springs and a higher edge budget while held.  |
| `fold`              | Every card folds toward its header line, so trips are short and the pace passes 10 cards/s.   |
| `loose`             | Cards stay whole, but a leaving card clears a virtual height, so cards pass over one another. |

The cascade's presets:

| Preset         | What changes while a key is held                                                               |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `default`      | The train tightens: cards leave closer together, on a stiffer spring and a higher edge budget. |
| `no held ramp` | Nothing: the train runs at the held spacing from the first repeat.                             |

## Run the checks

```sh
npm run check                      # every drum preset, then the cascade's, at 60 and 120 Hz; exits 1 when an invariant fails
npm run suite -- natural,fold      # the same scenarios as markdown tables, for the drum presets named
npm run suite -- cascade           # the cascade's presets beside the drum's natural and even: a table per refresh rate
npm run sweep -- params            # effect of each drum setting, one at a time, on the configuration in its On column
npm run sweep -- slack             # starting the next press before the previous card flips
npm run sweep -- presets           # the drum's presets side by side
npm run sweep -- held              # how fast the held state ramps in, and how far a short tap pushes it
npm run sweep -- limits            # the checker's thresholds, the sample card heights, the planner's estimates
npm run sweep -- params cascade    # effect of each cascade setting, one at a time
npm run sweep -- presets cascade   # the cascade's presets side by side
npm run sweep -- limits cascade    # the same thresholds, and the rule for a card to count as shown
npm run smoke                      # drives the built page in Chrome (run `npm run build` first)
```

The sims run the drum or the cascade on a stepped clock with no browser
(`sim/lib.mjs`) over three height sets: a mixed set topping out at 284 px, a
second mixed set topping out at 330 px, and an alternating 330 / 73 px set. The
frame checker (`sim/check.mjs`) flags edge jumps, draw-order swaps while cards
overlap, shade jumps, and changes to a drawn bottom edge that nothing covers.
`npm run sweep -- limits` prints its thresholds. It has two rules for that last
case; DESIGN.md explains the difference. `npm run check` asserts the corrected
rule.

`npm run suite -- cascade` runs the cascade's presets with the drum's `natural`
and `even` beside them as controls, at 60 and 120 Hz (`--hz 60` runs one rate),
and prints one table per rate. `cascade:default` runs one cascade preset. The
edge budgets are px/frame, so the 120 Hz table runs the cascade's train faster
than the 60 Hz one. `npm run check` runs `npm run suite -- cascade --check`,
which holds the cascade's columns, and not the controls, to the drum's
invariants and to its own (`cascadeInvariants` in `sim/suite.mjs`): no
draw-order change among painted cards, the same held pace on every height set
within 5 %, held ↑ and ↓ within 5 % of each other over five key-repeat phases,
no step-to-step interval change over 1.35×, a landing speed of at most 2
px/frame, no reversal jump over the tap budget, every card that passes the front
shown for at least 10 frames (`npm run sweep -- limits cascade` prints the
rule), and the drum's pile.

The tooltips quote the sweeps, so `npm run build` runs them (`computeFacts` in
`sim/sweep.mjs`) and then the tooltip check (`src/verify.ts`). The build fails
when a control has no tooltip, when a tooltip has no control, or when a tooltip
claims something the sweeps no longer show. `dist/facts.json` caches the sweep
numbers, and a build reuses them until `drum.ts`, `src/cascade.ts` or a file in
`sim/` changes.

`npm run smoke` covers what the sims cannot: three cards drawn, and only those,
in every model when the page loads and when a hidden page is shown, that every
control has a tooltip and that hovering one shows it, and the preset buttons,
sliders and held keys driving the page. For the cascade it also checks which of
its settings show under each preset, that its stage is cut at `LEAD + park`, and
that `fade` is capped at `park` minus 346 px. It checks that this README names
every preset and setting key in backticks. `QUEUE_MOTION_PAGE` points it, and
the capture scripts, at a copy of the built page, so a rebuild cannot change the
page under a running script.

## Capture frames and recordings

Both need Chrome (`CHROME_PATH` overrides the macOS default path), and `record`
needs `ffmpeg`. Output goes to `out/`, which git ignores. Run `npm run build`
first.

```sh
npm run sheets -- drum,cascade held-up,reversal   # contact sheets: models, then scenarios
npm run record -- product,drum,drum:fold,cascade  # real-time mp4: hold ↑ from item 12 to 1, then ↓ back
```

A model is `product`, `drum`, `drum:<preset>`, `cascade` or `cascade:<preset>`;
a model named alone runs its first preset, and a preset name with spaces needs
quotes (`npm run sheets -- "cascade:no held ramp" held-down`). `sheets` steps
the page's clock and screenshots a frame every 50 or 100 ms, with its timestamp.
The scenarios are in `capture/sheets.mjs`. `record` presses keys in real time,
so its frame rate is that of headless Chrome's screencast (about 50 fps), not a
display's.

## Keep it current

- `Product now` imports the live engine, so rebuilding the page shows the
  product as it is on this branch. Changing `QUEUE_CFG` changes the product.
- A change to the drum's rules goes in `src/app/page/queue/drum.ts`, and a
  change to the cascade's in `src/cascade.ts`. `npm run check` must still pass.
  Where a change moves a number that DESIGN.md quotes, rerun the command named
  beside that number and update the text. The Cascade section quotes
  `npm run suite -- cascade` at 60 and 120 Hz, and the goals table has a column
  for the cascade's numbers.
- A new drum setting is a `DEFAULT_CFG` entry in `drum.ts`, a `SETTINGS` entry
  in `src/controls.ts` (its key, group, range, and when it shows), a tooltip
  entry in `src/help.ts` under `setting.<key>`, and a sweep in `PARAMS` in
  `sim/sweep.mjs`. A new cascade setting is a `DEFAULT_CFG` entry in
  `src/cascade.ts`, a `CASCADE_SETTINGS` entry in `src/controls.ts`, a tooltip
  entry, and a sweep in `CASCADE_PARAMS` in `sim/sweep.mjs`; a setting that only
  the page draws, like `fade`, has no `DEFAULT_CFG` entry and no sweep. Every
  control has a tooltip, and the build fails when one has none. Delete all of a
  setting's entries when it is dropped, so the lab holds only the options still
  in play.
- A new preset is a `PRESETS` entry in `drum.ts` or in `src/cascade.ts` and a
  tooltip entry under `preset.<name>`; the page picks the button up and the
  presets sweep measures it.
- Tooltip numbers come from the sweeps (`Facts` in `src/facts.ts`), from a
  setting's default, or from a named constant. The `t` text tag rejects a digit
  typed into the text, and `f.expect` rejects a claim the sweeps no longer show.
- Update the control, settings and preset tables and the hash keys above when a
  control, key or preset changes.
- Add a check to `sim/suite.mjs` when a setting must keep a promise, such as
  "never moves a card at an end" (the cascade's go in `cascadeInvariants`), and
  one to `capture/smoke.mjs` when the page itself must do something.
- Add a scenario to `capture/sheets.mjs` when a bug needs a frame-by-frame look.

## Files

| Path                                               | Holds                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../src/app/page/queue/drum.ts`                 | The drum model and its settings. The product, the page and the sims all import it.                                                             |
| `src/cascade.ts`                                   | The cascade model, its settings and its presets. The page and the sims import it; the product does not.                                        |
| `src/main.ts`, `page.html`, `page.css`, `items.js` | The page, its styles, and the sample cards.                                                                                                    |
| `src/controls.ts`                                  | Every control as data: the modes, presets, settings (key, group, range, when it shows), and the URL state.                                     |
| `src/help.ts`, `src/facts.ts`                      | The text of every tooltip and of the two panels, "How the drum works" and "How the cascade works", and the view of the sweeps they quote from. |
| `src/tooltip.ts`                                   | How a tooltip shows, places and dismisses itself.                                                                                              |
| `src/verify.ts`                                    | The build-time check that every control has a tooltip and every tooltip a control.                                                             |
| `build.mjs`                                        | Runs the sweeps, runs the tooltip check, and bundles the page into `dist/queue-motion.html`.                                                   |
| `sim/lib.mjs`, `sim/check.mjs`                     | The stepped-clock harness and the frame checker.                                                                                               |
| `sim/suite.mjs`, `sim/sweep.mjs`                   | The standard scenarios with `--check`, and the one-at-a-time sweeps the tooltips quote.                                                        |
| `capture/`                                         | Contact sheets, recordings, and the page smoke check.                                                                                          |
