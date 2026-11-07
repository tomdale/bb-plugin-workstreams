# Queue motion lab

The queue draws its cards as a pseudo-3D stack. This directory is where changes
to that motion are worked out before they reach
`src/app/page/queue/stackEngine.ts`. It holds one page that runs the shipped
engine and a candidate model, the elastic drum, side by side; headless sims that
score both against the same checks; and scripts that capture contact sheets and
recordings.

The product still runs `stackEngine.ts`. The drum (`src/drum.mjs`) is the
candidate to replace it. [DESIGN.md](DESIGN.md) lists the goals the motion must
meet, explains how the drum works, and records what limits the pace of a held
key and what is still open.

## Run the page

```sh
cd prototypes/queue-motion
npm ci
npm run build            # writes dist/queue-motion.html, one self-contained file
open dist/queue-motion.html
```

Press ↓ and ↑ (or `j` and `k`). A held key repeats at the OS rate; the first
press also starts the hold the drum's fold and speed-up settings react to. The
controls:

| Control        | What it does                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Model          | `Product now` imports `src/app/page/queue/stackEngine.ts` as it is. `Elastic drum` runs `src/drum.mjs`.             |
| Preset         | A named set of drum settings (`PRESETS` in `src/drum.mjs`); the buttons come from that list.                        |
| Settings bar   | Every drum setting a preset can change, as sliders and toggles. Moving one overrides the preset.                    |
| Speed, Clock   | ¼×, ½×, 1×; pause and step one 1/60 s frame. The clock is the page's own, so a paused page is a frame you can read. |
| Reduced motion | No card moves; the new front fades in over 160 ms.                                                                  |

The URL hash holds the state, for example `#v=drum&preset=fold&cap1=34`. `v` is
`product` or `drum`, `preset` is a preset name, and the other keys are the
settings' short names (`w0`, `w1`, `cap`, `cap1`, `delay`, `dip`, `slack`,
`queue`, `h0`, `wfold`, `tw`, `ts`, `tms`, `fold`, `ramp`, `tk`).

Presets:

| Preset                  | What changes while a key is held                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `natural`               | Nothing. The pace follows card heights: tall cards slow it, short cards speed it up.        |
| `even`                  | Presses are spaced by a tempo planned from the heights ahead.                               |
| `even + held speed`     | The same tempo, with stiffer springs and a higher edge budget while held.                   |
| `constant + held speed` | One constant interval between presses, with the held speed-up.                              |
| `fold`                  | Every card folds toward its header line, so trips are short and the pace passes 10 cards/s. |

## Run the checks

```sh
npm run check                      # every preset at 60 and 120 Hz; exits 1 when an invariant fails
npm run suite -- natural,fold      # the same scenarios as markdown tables, for the presets named
npm run sweep -- params            # effect of each setting, one at a time
npm run sweep -- slack             # starting the next press before the previous card flips
npm run sweep -- presets           # the presets side by side
```

The sims run the drum on a stepped clock with no browser (`sim/lib.mjs`) over
three height sets: a mixed set topping out at 284 px, a second mixed set topping
out at 330 px, and an alternating 330 / 73 px set. The frame checker
(`sim/check.mjs`) flags edge jumps, draw-order swaps while cards overlap, shade
jumps, and changes to a drawn bottom edge that nothing covers. It has two rules
for that last case; DESIGN.md explains the difference. `npm run check` asserts
the corrected rule.

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
  product as it is on this branch.
- A change to the drum's rules goes in `src/drum.mjs`, and `npm run check` must
  still pass. Where it moves a number that DESIGN.md quotes, rerun the command
  named beside that number and update the text.
- A new idea is a setting in `DEFAULT_CFG` with a preset in `PRESETS`; the page
  picks both up. Delete an idea's setting and preset when it is dropped, so the
  lab holds only the options still in play.
- Add a check to `sim/suite.mjs` when a new setting carries a promise, such as
  "never moves a card at an end".
- Add a scenario to `capture/sheets.mjs` when a bug needs a frame-by-frame look.

## Files

| Path                                               | Holds                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/drum.mjs`                                     | The drum model and its settings. The page and the sims both import it. |
| `src/main.ts`, `page.html`, `page.css`, `items.js` | The page, its styles, and the sample cards.                            |
| `build.mjs`                                        | Bundles the page into `dist/queue-motion.html`.                        |
| `sim/lib.mjs`, `sim/check.mjs`                     | The stepped-clock harness and the frame checker.                       |
| `sim/suite.mjs`, `sim/sweep.mjs`                   | The standard scenarios with `--check`, and the one-at-a-time sweeps.   |
| `capture/`                                         | Contact sheets and recordings.                                         |
