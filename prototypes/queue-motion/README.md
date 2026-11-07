# Queue motion lab

The queue draws its cards as a pseudo-3D stack. This directory is where changes
to that motion are worked out before they reach the product. It holds one page
that runs the shipped engine and the elastic drum with the lab's own settings
side by side; headless sims that score the drum with a frame checker; and
scripts that capture contact sheets and recordings of both models.

The product runs the drum (`src/app/page/queue/drum.ts`) through
`src/app/page/queue/stackEngine.ts`, which keeps a short row of cards on the
drum as the queue's pile changes. The drum's settings as shipped are `QUEUE_CFG`
in `drum.ts`: the `even + held speed` preset with a constant 150 ms interval, a
3 Hz tap spring and 17 px/frame tap budget, and a 5 Hz held spring and 30
px/frame held budget after a 250 ms hold. The lab imports both files, so a
rebuild shows the product as it is on this branch. [DESIGN.md](DESIGN.md) lists
the goals the motion must meet, explains how the drum works, and records what
limits the pace of a held key and what is still open.

## Run the page

```sh
cd prototypes/queue-motion
npm ci
npm run build            # runs the sweeps and the tooltip check, writes dist/queue-motion.html
open dist/queue-motion.html
```

Press ↓ and ↑ (or `j` and `k`). A held key repeats at the OS rate; the first
press also starts the hold the drum's fold and speed-up settings react to. The
controls:

| Control            | What it does                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model              | `Product now` imports `src/app/page/queue/stackEngine.ts` as it is and hides the preset and settings rows. `Elastic drum` runs `drum.ts` with the lab's settings. |
| Preset             | A named set of drum settings (`PRESETS` in `drum.ts`); the buttons come from that list. A click clears every slider change.                                       |
| Settings bar       | The drum's settings as sliders, toggles and one choice, in three groups: Taps, Pace and Held keys. Moving one overrides the preset.                               |
| Speed, Clock       | ¼×, ½×, 1×; pause and step one 1/60 s frame. The clock is the page's own, so a paused page is a frame you can read.                                               |
| Reduced motion     | No card moves; the new front fades in over 160 ms. The system's reduced-motion setting turns it on too.                                                           |
| Held readout       | `held 0.00` to `held 1.00` beside the buttons while held speed-up or fold is on: how far the held state has risen.                                                |
| How the drum works | A panel at the bottom left: the ring path the cards follow, the four problems the frame checker counts, and which settings group acts on which part.              |
| Tooltips           | Every control has one. Hover shows it after a short pause, keyboard focus at once, and Escape dismisses it.                                                       |

A tooltip says what its control is, what you see when you change it, what it
works with, and how to tune it. It lists the sweep commands behind its numbers.

The settings bar has three groups. A setting shows only while it changes
something under the current configuration (last column), and a hidden setting
keeps its value. Each slider's range and default are in `SETTINGS` in
`src/controls.ts` and at the top of its tooltip. The key is the setting's name
in the URL hash.

| Group     | Setting                    | Key     | Shown when                  |
| --------- | -------------------------- | ------- | --------------------------- |
| Taps      | spring Hz, tap             | `w0`    | always                      |
|           | edge budget, tap px/frame  | `cap`   | always                      |
| Pace      | tempo                      | `tk`    | always                      |
|           | tempo window               | `tw`    | tempo is `lookahead`        |
|           | tempo scale                | `ts`    | tempo is `lookahead`        |
|           | constant interval ms       | `tms`   | tempo is `constant`         |
|           | gate slack                 | `slack` | tempo is `none`             |
| Held keys | held speed-up              | `ramp`  | fold is off                 |
|           | fold while held            | `fold`  | always                      |
|           | hold delay ms              | `delay` | held speed-up or fold is on |
|           | spring Hz, held            | `w1`    | held speed-up or fold is on |
|           | edge budget, held px/frame | `cap1`  | held speed-up or fold is on |
|           | folded height px           | `h0`    | fold is on                  |

The URL hash holds the state, for example `#v=drum&preset=fold&cap1=34` (`fold`
with a held edge budget of 34 px/frame). `v` is `product` or `drum`, `preset` is
a preset name, `speed` is `0.25`, `0.5` or `1`, and `reduced` is `1` or `0`.
Every other key is a setting's key from the table above (`w0`, `cap`, `tk`,
`tw`, `ts`, `tms`, `slack`, `ramp`, `fold`, `delay`, `w1`, `cap1`, `h0`). A
toggle is `1` or `0`, `tk` is one of its three choices, and a slider's value is
clamped to its range. The page ignores a key or value it does not recognise.

Presets:

| Preset              | What changes while a key is held                                                             |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `natural`           | Nothing. The pace follows card heights: tall cards slow it, short cards speed it up.         |
| `even`              | Presses are spaced by a tempo planned from the heights ahead.                                |
| `even + held speed` | The same tempo at a smaller scale, with stiffer springs and a higher edge budget while held. |
| `fold`              | Every card folds toward its header line, so trips are short and the pace passes 10 cards/s.  |

## Run the checks

```sh
npm run check                      # every preset at 60 and 120 Hz; exits 1 when an invariant fails
npm run suite -- natural,fold      # the same scenarios as markdown tables, for the presets named
npm run sweep -- params            # effect of each setting, one at a time, on the configuration in its On column
npm run sweep -- slack             # starting the next press before the previous card flips
npm run sweep -- presets           # the presets side by side
npm run sweep -- held              # how fast the held state ramps in, and how far a short tap pushes it
npm run sweep -- limits            # the checker's thresholds, the sample card heights, the planner's estimates
npm run smoke                      # drives the built page in Chrome (run `npm run build` first)
```

The sims run the drum on a stepped clock with no browser (`sim/lib.mjs`) over
three height sets: a mixed set topping out at 284 px, a second mixed set topping
out at 330 px, and an alternating 330 / 73 px set. The frame checker
(`sim/check.mjs`) flags edge jumps, draw-order swaps while cards overlap, shade
jumps, and changes to a drawn bottom edge that nothing covers.
`npm run sweep -- limits` prints its thresholds. It has two rules for that last
case; DESIGN.md explains the difference. `npm run check` asserts the corrected
rule.

The tooltips quote the sweeps, so `npm run build` runs them (`computeFacts` in
`sim/sweep.mjs`) and then the tooltip check (`src/verify.ts`). The build fails
when a control has no tooltip, when a tooltip has no control, or when a tooltip
claims something the sweeps no longer show. `dist/facts.json` caches the sweep
numbers, and a build reuses them until `drum.ts` or a file in `sim/` changes.

`npm run smoke` covers what the sims cannot: three cards drawn when the page
loads and when a hidden page is shown, only the pile visible in either model,
that every control has a tooltip and that hovering one shows it, and the preset
buttons, sliders and held keys driving the page. `QUEUE_MOTION_PAGE` points it,
and the capture scripts, at a copy of the built page, so a rebuild cannot change
the page under a running script.

## Capture frames and recordings

Both need Chrome (`CHROME_PATH` overrides the macOS default path), and `record`
needs `ffmpeg`. Output goes to `out/`, which git ignores. Run `npm run build`
first.

```sh
npm run sheets -- drum,product held-up,reversal   # contact sheets: models, then scenarios
npm run record -- product,drum,drum:fold          # real-time mp4: hold ↑ from item 12 to 1, then ↓ back
```

`sheets` steps the page's clock and screenshots a frame every 50 or 100 ms, with
its timestamp. The scenarios are in `capture/sheets.mjs`. `record` presses keys
in real time, so its frame rate is that of headless Chrome's screencast (about
50 fps), not a display's.

## Keep it current

- `Product now` imports the live engine, so rebuilding the page shows the
  product as it is on this branch. Changing `QUEUE_CFG` changes the product.
- A change to the drum's rules goes in `src/app/page/queue/drum.ts`, and
  `npm run check` must still pass. Where it moves a number that DESIGN.md
  quotes, rerun the command named beside that number and update the text.
- A new setting is a `DEFAULT_CFG` entry in `drum.ts`, a `SETTINGS` entry in
  `src/controls.ts` (its key, group, range, and when it shows), a tooltip entry
  in `src/help.ts` under `setting.<key>`, and a sweep in `PARAMS` in
  `sim/sweep.mjs`. Delete all four when the setting is dropped, so the lab holds
  only the options still in play.
- A new preset is a `PRESETS` entry in `drum.ts` and a tooltip entry under
  `preset.<name>`; the page picks the button up and the presets sweep measures
  it.
- Tooltip numbers come from the sweeps (`Facts` in `src/facts.ts`), from a
  setting's default, or from a named constant. The `t` text tag rejects a digit
  typed into the text, and `f.expect` rejects a claim the sweeps no longer show.
- Update the control, settings and preset tables and the hash keys above when a
  control, key or preset changes.
- Add a check to `sim/suite.mjs` when a setting must keep a promise, such as
  "never moves a card at an end", and one to `capture/smoke.mjs` when the page
  itself must do something.
- Add a scenario to `capture/sheets.mjs` when a bug needs a frame-by-frame look.

## Files

| Path                                               | Holds                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `../../src/app/page/queue/drum.ts`                 | The drum model and its settings. The product, the page and the sims all import it.                          |
| `src/main.ts`, `page.html`, `page.css`, `items.js` | The page, its styles, and the sample cards.                                                                 |
| `src/controls.ts`                                  | Every control as data: the modes, presets, settings (key, group, range, when it shows), and the URL state.  |
| `src/help.ts`, `src/facts.ts`                      | The text of every tooltip and of the "How the drum works" panel, and the view of the sweeps it quotes from. |
| `src/tooltip.ts`                                   | How a tooltip shows, places and dismisses itself.                                                           |
| `src/verify.ts`                                    | The build-time check that every control has a tooltip and every tooltip a control.                          |
| `build.mjs`                                        | Runs the sweeps, runs the tooltip check, and bundles the page into `dist/queue-motion.html`.                |
| `sim/lib.mjs`, `sim/check.mjs`                     | The stepped-clock harness and the frame checker.                                                            |
| `sim/suite.mjs`, `sim/sweep.mjs`                   | The standard scenarios with `--check`, and the one-at-a-time sweeps the tooltips quote.                     |
| `capture/`                                         | Contact sheets, recordings, and the page smoke check.                                                       |
