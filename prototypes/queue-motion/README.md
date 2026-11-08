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
3 Hz tap spring and a 1020 px/s (17 px/frame) top speed, and a 5 Hz held spring
and a 1800 px/s (30 px/frame) held top speed after a 250 ms hold. The page
offers it as the drum's `shipped` preset. The lab imports both files, so a
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

Press ↓ and ↑ (or `j` and `k`); the line under the stack says so. A held key
repeats at the OS rate; the first press also starts the hold that `while held`
reacts to. The stack fills the window left of the inspector, a pane anchored to
the right edge at full height that scrolls on its own; on a window too narrow
for the 680 px card, the stack scales down to fit. The inspector is a column of
modules, each folded or opened from its heading, in the order a tuner asks its
questions: what am I looking at, how do I drive it, what does it measure, then
the knobs. Finish, Page and Overlay start folded. The page remembers which
modules are folded (in `localStorage`, not the URL hash), and a module with
nothing to show under the running model and its settings is hidden whole. The
modules:

| Module             | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run                | The Model buttons: `Product now` runs the drum at `shipped` through `src/app/page/queue/stackEngine.ts`, imported as it is, and shows the drum's Taps and Held keys read only at their shipped values; `Elastic drum` runs `drum.ts` with the lab's settings, and `Cascade` runs `src/cascade.ts`. Then the running model's preset buttons (the drum's `shipped`, which is `QUEUE_CFG`, then `PRESETS` in `drum.ts`; the cascade's `PRESETS` in `src/cascade.ts`), the state line, and the buttons `Revert to <preset>`, `Save as preset…` and, for the drum, `Copy as QUEUE_CFG`. A preset click clears every model setting change. |
| Drive              | Speed (¼×, ½×, 1×), Clock (Pause, and Step one 1/60 s frame; the clock is the page's own, so a paused page is a frame you can read), Hold (`↓ from top` jumps to the first card and holds ↓ until the last is in front, `↑ from bottom` the reverse, on the page's clock with the OS-like repeat set by `krd` and `kri`; the running button reads Stop, and a real key, a model switch or Reduced motion stops it), Cards (the deck on the stage, below), and `Reduced motion` (no card moves and the new front fades in; the system's reduced-motion setting turns it on too).                                                      |
| Measured           | What the page measures on its own frames: the held readout, the pace of the latest hold, the last hold the other way, the last tap each way, and the frame checker over the last run (below). Hidden under reduced motion.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Taps               | How one card travels: `tap spring` and `top speed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Held keys          | What a held key does: `while held`, the drum's `pacing`, `pace` (or the plan, or the measured pace), the cascade's `pace before speed-up`, `speeds up after`, `held spring`, `held top speed`, and the drum's `held height`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Route              | Where a leaving card goes: the drum's `tuck depth`, the cascade's `park`, `edge fade` and `leave shade`, the path's `sway` and `bank`, and a `more` line that folds the loop's shaping (`sway behind`, `widest point`, `widest point behind`, `column crossing`).                                                                                                                                                                                                                                                                                                                                                                    |
| Finish             | The drum's settings looked at once, after the motion is settled: the fades, the tall-card wash, the tuck spring, and the plan's estimate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Page               | The page's own fades and the simulated holds' key repeat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Overlay            | `Bezier path` draws the rounded loop a moving card follows as cubic Bezier segments: down in front of the pile, across the column at `turn`, and up behind it to `tuck` (the cascade: one bow down to `park`), with handles, a ring at each leg's widest point, anchors and live card markers. While it is on, the module shows what it draws.                                                                                                                                                                                                                                                                                       |
| How the drum works | The About module, folded at first: the ring path the cards follow, the four problems the frame checker counts, and which module acts on which part. The product shows it too. While the cascade runs its heading is How the cascade works: the exit channel and the clip line, what sets the pace of a held key, and the same problems.                                                                                                                                                                                                                                                                                              |

The state line under the presets names the preset the state is based on. At the
preset itself its chip is filled and the line reads `<preset>, nothing changed.`
with the preset's caption; once a model setting differs, the chip is outlined
and the line lists the changed settings, and `Revert to <preset>` puts them all
back. The `loose` chip is dashed and its state line says the preset is outside
the frame checker's rules: passing over a card is a draw-order swap by design,
so the checker's count is its cost. For the product the line says what it runs.

`Save as preset…` opens a name field and then saves the current settings under
that name as a preset of the running model in this browser's `localStorage` (the
product has none); Enter saves and Escape closes the field. A saved preset
records the built-in preset it starts from and every model, path and page
setting the URL hash overrides; speed, cards, reduced motion and `Bezier path`
are not part of it. Its chip, in the Saved row, restores those settings and is
marked while they match; its × deletes it. An empty name saves as `my preset`
and a number, a saved preset's name replaces that preset, and a built-in
preset's name is refused. Applying one rewrites the hash, which carries the
settings but not the name.

`Copy settings`, beside the inspector's title, copies the current state to the
clipboard as Markdown: the model, preset, speed, cards, reduced motion,
`Bezier path` and the URL hash; a line naming every setting that differs from
its preset or default, old and new value; and a table per module of every
setting the inspector shows, with changed values in bold beside the preset's
value (model settings) or the default (path and page settings). A hidden setting
changes nothing, so it is left out. The product's table lists the shipped values
it shows. The button reads `Copied` for a moment.

`Copy as QUEUE_CFG` copies the drum's configuration as the `QUEUE_CFG` literal
in `drum.ts`, in that file's idiom (`omega1: TAU * 5`, `vcap1: 30 * 60`,
`tempo: { kind: "constant", ms: 150 }`): every field `QUEUE_CFG` sets, in its
order, then any other field that differs from `DEFAULT_CFG`, with the tempo's
kind and the fields that kind reads. At `shipped` it copies the literal
`drum.ts` holds. A pace set in cards/s lands in it as the interval it writes.

The Cards switch picks the deck on the stage, 12 cards each: `lab`, the page's
six sample cards (240, 73, 162, 284, 96 and 140 px); `mixed 330`, real cards
close to the sims' `w2` height set (284, 96, 162, 328, 118 and 140 px); and
`330 and 73`, the 328 px and 73 px cards in turn, as the sims' `alt` set. A deck
starts at its first card.

The Measured module reads the page's own frames with the sims' functions
(`src/meter.ts`). A run starts with a press while nothing moves and ends at rest
with no key down; one card moved makes it a tap, more a hold. `held` is the held
state, a bar from 0.00 to 1.00, shown while `while held` is anything but
`same as taps`. `pace` is the latest hold: mean cards/s over its steps (a step
is the time between two changes of the model's front card, on the page's clock,
so ¼× reads as 1×), the shortest and longest step, and the worst change from one
step to the next. `last` is the last hold the other way. `tap` is the last tap
each way: ↑ lands and ↓ settles by `landFrame`, and the landing speed by
`landingSpeed`, both from `sim/lib.mjs`. `checker` runs `problems` (the
corrected rule) and `maxJump` from `sim/check.mjs` over the run: problems by
kind, the card and time of the last, the largest edge move, and for the cascade
the most cards in front of the pile. The page records a frame once about 1/60 s
of page clock has passed, so the per-frame figures read as the sims' at any
display rate or speed. The numbers clear when a model setting, the preset, the
model or the deck changes.

Every control has a tooltip, which says what the control is, what you see when
you change it, what it works with, and how to tune it, and lists the sweep
commands behind its numbers. Hover shows it after a short pause, keyboard focus
at once, and Escape dismisses it. It opens to the left of the inspector, over
the stage, and scrolls when it is taller than the window.

A setting shows only while it changes something under the current configuration
(last column of its table), and a hidden setting keeps its value. A slider's
value beside its name is a field: type a value and press Enter, and it is
clamped to the range. A value that differs from the preset's (model settings) or
the default (path and page settings) is bold, with a `reset` beside it, and a
folded module's heading, or Route's `more` line, says how many of its shown
settings are changed. Some settings carry a line under them: a top speed in
px/frame at 60 and 120 Hz, a pace as the beat in ms or the spacing in px beside
the pace the page measured, a held spring as a multiple of the tap spring, the
last tap the page measured under `tap spring`, and the shortest card under
`held height`. Under reduced motion no card moves, so the settings that shape
motion hide with their modules, and so do Measured and, unless `Bezier path` is
on, the path's settings; the cascade's `park`, `edge fade` and `leave shade`
stay, since they still cut and fade the stage. Each slider's range and default
are in `SETTINGS`, `CASCADE_SETTINGS`, `PATH_SETTINGS` or `VIEW_SETTINGS` in
`src/controls.ts` and at the top of its tooltip. The key is the setting's name
in the URL hash.

The two models share one key, one name and one row for each knob they have in
common, so a value set on the drum holds when the cascade runs and the other way
round. The drum's and the cascade's settings:

| Module    | Setting              | Key      | Model   | Shown when                                        |
| --------- | -------------------- | -------- | ------- | ------------------------------------------------- |
| Taps      | tap spring           | `w0`     | both    | always                                            |
|           | top speed            | `cap`    | both    | always                                            |
| Held keys | while held           | `held`   | both    | always                                            |
|           | pacing               | `pacing` | drum    | always                                            |
|           | pace                 | `pace`   | both    | the drum: pacing is `steady`; the cascade: always |
|           | plan                 | `ts`     | drum    | pacing is `planned`                               |
|           | pace before speed-up | `pace0`  | cascade | while held is `ramp`                              |
|           | speeds up after      | `delay`  | both    | while held is not `none`                          |
|           | held spring          | `w1`     | both    | while held is not `none`                          |
|           | held top speed       | `cap1`   | both    | while held is not `none`                          |
|           | held height          | `h0`     | drum    | while held is `fold` or `loose`                   |
| Route     | tuck depth           | `hide`   | drum    | always                                            |
|           | park                 | `park`   | cascade | always                                            |
|           | edge fade            | `fade`   | cascade | always                                            |
|           | leave shade          | `shade`  | cascade | always                                            |
| Finish    | incoming fade-in     | `fadein` | drum    | always                                            |
|           | covered card fade    | `cover`  | drum    | always                                            |
|           | tuck spring          | `tuck`   | drum    | always                                            |
|           | tall-card wash rise  | `wrise`  | drum    | always                                            |
|           | tall-card wash clear | `wclear` | drum    | always                                            |
|           | plan window          | `tw`     | drum    | pacing is `planned`                               |
|           | plan base            | `ta`     | drum    | pacing is `planned`                               |
|           | plan per px          | `tb`     | drum    | pacing is `planned`                               |

`held` is one choice for what a held key does once it has been held past
`speeds up after`: `none` (same as taps), `ramp` (speed up: the springs and top
speeds ramp to their held values), `fold` (fold every card to its header line)
and `loose` (pass over the next card: a leaving card clears only a virtual
height). Fold and pass over include the speed-up and write `ramp` too; the
cascade offers `none` and `ramp`. `pacing` is how the drum spaces a held key's
presses: `cards` (follows the cards: no pace to set, so the row shows the pace
the page measured), `steady` (a steady beat: `tempo.kind` constant) or `planned`
(`lookahead`, scaled by `ts`). The top speeds, `cap` and `cap1`, are px/s
(`vcap` and `vcap1`); the frame checker's limit is 40 px in a frame, so 2400
px/s is the limit at 60 Hz and twice that at 120 Hz.

`pace` is in cards/s. Under a steady beat the drum writes it as the least
interval between presses, `tempo.ms = 1000 / pace`; a tall card can outlast the
beat, so the pace measured beside it can be lower. The cascade writes it as the
spacing between leaving cards at the speed the train runs at,
`spacing1 = vcap1 / pace` (`vcap / pace` with `while held` at `same as taps`),
and `pace0` as `spacing0 = vcap / pace0`; a pace keeps its cards/s when a top
speed changes. `tuck` multiplies the spring on the last stretch behind the pile
(`tuckRate` in `drum.ts`), and `hide` is how far inside the pile's lower edge a
tucked card ends (`hidePx`); a card too tall to hide that way washes out
instead, rising with the `wrise` time constant (`washTauOut`) and clearing with
`wclear` (`washTauIn`). `ta` and `tb` are the plan's estimate of a trip,
`ts × (ta + tb · height)` ms (`tempo.a` and `tempo.b`), over `tw` cards each
way. The largest `fade` is `park` minus 346 px: the fade starts no higher than
the bottom of the tallest card (330 px) and its 16 px shadow, so no pile card
fades.

The path's settings shape the path a moving card follows in every model, the
product included, and Route shows them while the path shows on screen: while
cards sway, which is whenever reduced motion is off, or while `Bezier path`
draws it. They move cards sideways only: each model's vertical motion, springs
and top speeds, and so every number the frame checker reports, are the same at
any value. A preset button keeps them. The sway is a function of where the card
is on its ring, so a card that changes direction mid-flight retraces it;
`src/ring.ts` holds the curve.

| Module        | Setting             | Key     | Shown when                                                     |
| ------------- | ------------------- | ------- | -------------------------------------------------------------- |
| Route         | sway                | `sway`  | reduced motion is off, or `Bezier path` is on                  |
|               | bank                | `bank`  | reduced motion is off, and a leg sways                         |
| Route, `more` | sway behind         | `swayb` | the same as `sway`, and the drum or the product runs           |
|               | widest point        | `peak`  | reduced motion is off, or `Bezier path` is on, and a leg sways |
|               | widest point behind | `peakb` | the same, and the drum or the product runs                     |
|               | column crossing     | `cross` | the same, and the drum or the product runs                     |

`sway` is the widest sideways offset, in px, on the way down in front of the
pile (positive is right), `swayb` the same on the drum's leg behind the pile,
`peak` where the front leg's widest point sits, as a fraction of the leg from
the front, and `peakb` the same for the leg behind the pile, from the tuck.
`cross` moves where the drum's path crosses the column, in ring units from the
turn, so the loop leans one way or the other. `bank` turns a swaying card about
its top centre, in degrees at the widest sway; positive swings its bottom edge
out from the column. The defaults, `sway` 24, `swayb` −24, `peak` and `peakb`
0.5, `cross` 0 and `bank` 0, make a symmetric, upright loop. With `sway` and
`swayb` at 0 cards move as the models draw them, straight down and back up the
column, and the settings that shape the sway hide.

The page's own settings belong to no model, every model shows them, and a preset
button keeps them:

| Module  | Setting               | Key       | Shown when                                 |
| ------- | --------------------- | --------- | ------------------------------------------ |
| Page    | reduced fade          | `rfade`   | reduced motion is on                       |
|         | heading fade          | `hfade`   | reduced motion is off                      |
|         | hold repeat delay     | `krd`     | reduced motion is off                      |
|         | hold repeat interval  | `kri`     | reduced motion is off                      |
| Overlay | control handles       | `handles` | `Bezier path` is on                        |
|         | handles at every knot | `knots`   | `Bezier path` and `control handles` are on |
|         | knots per stretch     | `inner`   | `Bezier path` is on                        |
|         | direction arrows      | `arrows`  | `Bezier path` is on                        |
|         | labels                | `labels`  | `Bezier path` is on                        |
|         | pile spine            | `spine`   | `Bezier path` is on                        |
|         | card markers          | `dots`    | `Bezier path` is on                        |

`rfade` is how long the new front card fades in under reduced motion (160 ms by
default, 0 to 600), and `hfade` how long the heading fades in when the front
card changes (160 ms, 0 to 600; 0 swaps it at once). `krd` and `kri` time the
simulated holds: the wait before the first repeat (250 ms, 100 to 800) and the
interval between repeats (33 ms, 15 to 120). The overlay's toggles are all on by
default except `knots`. `inner` is how many knots the overlay puts inside each
stretch of the path (2 by default, 0 to 6): two keep the drawn curve within a
pixel of the path the cards follow, and fewer show how far a coarse fit strays.
It changes only the drawing.

The URL hash holds the state, for example `#v=drum&preset=fold&cap1=2040`
(`fold` with a held top speed of 2040 px/s) or `#v=cascade&pace=14&fade=0` (the
cascade's `default` at 14 cards/s held and no edge fade). `v` is `product`,
`drum` or `cascade`. `preset` is a preset name of that model, and a name the
model lacks gives its first preset (`shipped` for the drum, `default` for the
cascade); the product has no presets. `speed` is `0.25`, `0.5` or `1`, `cards`
is `lab`, `w2` (`mixed 330`) or `alt` (`330 and 73`), and `reduced` and `path`
are `1` or `0`. Every other key is a setting's key from the tables above: the
models' `w0`, `cap`, `held`, `pacing`, `pace`, `ts`, `pace0`, `delay`, `w1`,
`cap1`, `h0`, `hide`, `park`, `fade`, `shade`, `fadein`, `cover`, `tuck`,
`wrise`, `wclear`, `tw`, `ta` and `tb`, the path's `sway`, `bank`, `swayb`,
`peak`, `peakb` and `cross`, which every model reads, and the page's `rfade`,
`hfade`, `krd`, `kri`, `handles`, `knots`, `inner`, `arrows`, `labels`, `spine`
and `dots`. A key both models have sets both; a model ignores the keys it lacks.
A toggle is `1` or `0`, a choice is one of its options, and a slider's value is
clamped to its range. The page ignores a key or value it does not recognise.

The drum's presets:

| Preset              | What changes while a key is held                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `shipped`           | `QUEUE_CFG`: speed up after 250 ms, on a steady beat of 6.7 cards/s (150 ms). Not in the sweeps or `npm run check`.        |
| `natural`           | Nothing. The pace follows card heights: tall cards slow it, short cards speed it up.                                       |
| `even`              | Planned pacing: presses are spaced by an interval planned from the heights ahead.                                          |
| `even + held speed` | The same plan at 0.85×, and speed up while held.                                                                           |
| `fold`              | Every card folds toward its header line, so trips are short and the pace passes 10 cards/s.                                |
| `loose`             | Cards stay whole, but a leaving card clears a virtual height, so cards pass over one another. Outside the checker's rules. |

The cascade's presets:

| Preset         | What changes while a key is held                                                             |
| -------------- | -------------------------------------------------------------------------------------------- |
| `default`      | Speed up: the train goes from 6.7 to 12 cards/s, on a stiffer spring and a higher top speed. |
| `no held ramp` | Same as taps: the train runs at `pace` from the first repeat.                                |

## Run the checks

```sh
npm run check                      # every drum preset, then the cascade's, at 60 and 120 Hz; exits 1 when an invariant fails
npm run suite -- natural,fold      # the same scenarios as markdown tables, for the drum presets named
npm run suite -- cascade           # the cascade's presets beside the drum's natural and even: a table per refresh rate
npm run sweep -- params            # effect of each drum setting, one at a time, on the configuration in its On column
npm run sweep -- presets           # the drum's presets side by side
npm run sweep -- held              # how fast the held state ramps in, and how far a short tap pushes it
npm run sweep -- limits            # the checker's thresholds, the sample card heights, the planner's estimates
npm run sweep -- params cascade    # effect of each cascade setting, one at a time
npm run sweep -- presets cascade   # the cascade's presets side by side
npm run sweep -- limits cascade    # the same thresholds, and the rule for a card to count as shown
npm run smoke                      # drives the built page in Chrome (run `npm run build` first)
```

The sims run the drum or the cascade on a stepped clock with no browser
(`sim/lib.mjs`) over three height sets: `w1`, a mixed set topping out at 284 px,
`w2`, a second mixed set topping out at 330 px, and `alt`, an alternating 330 /
73 px set. `npm run sweep -- limits` prints them; the page's Cards decks match
them as closely as its real cards can. The frame checker (`sim/check.mjs`) flags
edge jumps, draw-order swaps while cards overlap, shade jumps, and changes to a
drawn bottom edge that nothing covers. `npm run sweep -- limits` prints its
thresholds. It has two rules for that last case; DESIGN.md explains the
difference. `npm run check` asserts the corrected rule.

`npm run suite -- cascade` runs the cascade's presets with the drum's `natural`
and `even` beside them as controls, at 60 and 120 Hz (`--hz 60` runs one rate),
and prints one table per rate. `cascade:default` runs one cascade preset. The
suite holds the top speeds at the same px/frame at both rates, so the 120 Hz
table runs the cascade's train faster than the 60 Hz one. `npm run check` runs
`npm run suite -- cascade --check`, which holds the cascade's columns, and not
the controls, to the drum's invariants and to its own (`cascadeInvariants` in
`sim/suite.mjs`): no draw-order change among painted cards, the same held pace
on every height set within 5 %, held ↑ and ↓ within 5 % of each other over five
key-repeat phases, no step-to-step interval change over 1.35×, a landing speed
of at most 2 px/frame, no reversal jump over the tap top speed, every card that
passes the front shown for at least 10 frames (`npm run sweep -- limits cascade`
prints the rule), and the drum's pile.

The tooltips quote the sweeps, so `npm run build` runs them (`computeFacts` in
`sim/sweep.mjs`) and then the tooltip check (`src/verify.ts`). The build fails
when a control has no tooltip, when a tooltip has no control, or when a tooltip
claims something the sweeps no longer show. `dist/facts.json` caches the sweep
numbers, and a build reuses them until `drum.ts`, `src/cascade.ts` or a file in
`sim/` changes.

`npm run smoke` covers what the sims cannot: three cards drawn, and only those,
in every model when the page loads and when a hidden page is shown, that every
control has a tooltip and that hovering one shows it, and the preset buttons,
sliders and held keys driving the page. It checks the state line, the preset
chips' marks, Revert, a setting's reset and typed value, the folded headings'
counts, `Save as preset…`, that `Copy as QUEUE_CFG` at `shipped` copies the
literal in `drum.ts`, the Cards decks, and that Measured reads a hold, a tap and
the checker. It checks which settings show in all twelve pacing and while-held
states, that a key both models share keeps its value across the model switch,
that a pace in cards/s writes the drum's beat and the cascade's spacing, Route's
`more` line, that Finish, Page and Overlay start folded, and that the product
shows its shipped settings read only. It checks that the inspector is anchored
to the right edge at full height with the stack fitting beside it, that each
model shows its own modules and hides the empty ones, and that a folded module
stays folded. For the cascade it also checks which of its settings show under
each preset, that its stage is cut at `LEAD + park`, and that `fade` is capped
at `park` minus 346 px. It checks that this README names every preset and
setting key in backticks. `QUEUE_MOTION_PAGE` points it, and the capture
scripts, at a copy of the built page, so a rebuild cannot change the page under
a running script.

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
  in `src/controls.ts` (its key, module, range, and when it shows), a tooltip
  entry in `src/help.ts` under `setting.<key>`, and a sweep in `PARAMS` in
  `sim/sweep.mjs`. A new cascade setting is a `DEFAULT_CFG` entry in
  `src/cascade.ts`, a `CASCADE_SETTINGS` entry in `src/controls.ts`, a tooltip
  entry, and a sweep in `CASCADE_PARAMS` in `sim/sweep.mjs`; a setting that only
  the page draws, like `fade`, has no `DEFAULT_CFG` entry and no sweep, and one
  that belongs to the page itself, like `rfade` or an overlay toggle, is a
  `VIEW_SETTINGS` entry that the page reads where it draws. A knob both models
  have takes the same key, name and module in both lists, one tooltip that
  covers both, and a sweep on each model's context. A setting in the page's
  units that the model stores differently (a pace in cards/s written as an
  interval or a spacing) computes its field in `write`; one whose field depends
  on another setting is marked `derived`, and its sweep's `make` reads the
  context's whole configuration. Every control has a tooltip, and the build
  fails when one has none. Delete all of a setting's entries when it is dropped,
  so the lab holds only the options still in play.
- A new preset is a `PRESETS` entry in `drum.ts` or in `src/cascade.ts` and a
  tooltip entry under `preset.<name>`; the page picks the button up and the
  presets sweep measures it. The drum's `shipped` is the lab's own entry,
  `QUEUE_CFG` at the head of `DRUM_PRESETS` in `src/controls.ts`, so the sweeps
  and `npm run check` do not measure it.
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
| `src/main.ts`, `page.html`, `page.css`, `items.js` | The page and its inspector, its styles, and the sample cards.                                                                                  |
| `src/meter.ts`                                     | The Measured module's numbers: the sims' checker and landing functions applied to the page's frames.                                           |
| `src/copy.ts`                                      | The text of `Copy settings` and `Copy as QUEUE_CFG`.                                                                                           |
| `src/controls.ts`                                  | Every control as data: the modes, presets, inspector modules, settings (key, module, range, when it shows), and the URL state.                 |
| `src/help.ts`, `src/facts.ts`                      | The text of every tooltip and of the two panels, "How the drum works" and "How the cascade works", and the view of the sweeps they quote from. |
| `src/tooltip.ts`                                   | How a tooltip shows, places and dismisses itself.                                                                                              |
| `src/verify.ts`                                    | The build-time check that every control has a tooltip and every tooltip a control.                                                             |
| `build.mjs`                                        | Runs the sweeps, runs the tooltip check, and bundles the page into `dist/queue-motion.html`.                                                   |
| `sim/lib.mjs`, `sim/check.mjs`                     | The stepped-clock harness and the frame checker.                                                                                               |
| `sim/suite.mjs`, `sim/sweep.mjs`                   | The standard scenarios with `--check`, and the one-at-a-time sweeps the tooltips quote.                                                        |
| `capture/`                                         | Contact sheets, recordings, and the page smoke check.                                                                                          |
