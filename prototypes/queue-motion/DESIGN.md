# Queue stack motion: goals, model, limits

This file says what the stack's motion has to do, how the elastic drum
(`src/drum.mjs`) does it, what sets the pace of a held key, and what is still
open. The code is the authority on behaviour; the numbers below come from the
commands named beside them, on a stepped 60 Hz clock.

## Goals

The cards are opaque and range from about 73 px (one line) to 330 px (a long
recap). Motion is judged by how it feels, so each goal below is paired with the
number the suite prints for it.

| #   | Goal                                                                                                                                  | Checked by (`npm run suite`)                                             | Natural preset, 60 Hz                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| G1  | No card visibly passes through another: draw order changes only while two cards are apart, or a third card covers where they overlap. | `problems`, swap kind                                                    | 0 in every scenario                                       |
| G2  | Every landing slows into rest.                                                                                                        | landing speed, px/frame over the last 5 frames                           | 1.8                                                       |
| G3  | Position and velocity stay continuous when a press reverses a move in flight.                                                         | reversal ↑↓↑ max jump and problems                                       | 24.1 px, 0 problems                                       |
| G4  | ↑ and ↓ run at the same pace and with the same quality.                                                                               | held ↑ and ↓ cards/s                                                     | 5.5 and 5.5                                               |
| G5  | The first visible change comes within a frame of a press.                                                                             | first visible change                                                     | 16.7 ms                                                   |
| G6  | A held key can speed up, with every card still reaching the front.                                                                    | held cards/s per preset                                                  | up to 10.1 and 10.8 (`fold`)                              |
| G7  | A single tap is a full, readable move.                                                                                                | tap ↑ lands, tap ↓ settles                                               | 483 ms and 217 ms                                         |
| G8  | Tall and short cards in any order show no ghost, no half-covered text, and no two cards' text in the same pixels.                     | `problems` over three height sets, one of them alternating 330 and 73 px | 0                                                         |
| G9  | Releasing the key rests on a whole card, with at most one more card after the release.                                                | release: rests on a card / extra cards                                   | all / 1                                                   |
| G10 | One mechanism, small enough to test with invariants.                                                                                  | line count                                                               | `drum.mjs` 449 lines with comments; `stackEngine.ts` 1661 |
| G11 | The heading and counter stay outside the motion.                                                                                      | by construction                                                          | the page swaps their text                                 |
| G12 | Reduced motion is calm.                                                                                                               | by construction                                                          | no card moves; the new front fades in over 160 ms         |

A hold that reaches an end of the queue moves nothing (0 px in
`hold at an end moves`), and a fold that was running unfolds as the last card
arrives.

## The model

Each card has one coordinate `c` on a closed ring path and one critically damped
spring along it:

- `c ≥ 0`: a pile slot. 0 is the front, 1 and 2 peek above the front card, 3
  waits hidden behind it.
- `−1 < c < 0`: the **drop** in front of the pile, from the front pose down to
  the **turn**, a pose clear below the card the mover uncovers.
- `−2 ≤ c ≤ −1`: the **tuck** behind the pile, from the turn up to flush behind
  the pile's lower edge.
- `c ≤ −2`: parked, hidden.

A key press moves one integer, `front`. A card's spring target is a function of
`(card, front)` alone: `index − front` for the pile, and `index − front − 1` for
cards before the front, so a leaver's target is two units away. It passes the
turn still moving and slows into the tuck. A card coming back runs the same ring
in reverse, which is what `↑` shows: the card rises from just below the pile and
slows into the front.

`c = −1` is the one place draw order changes, and a card crosses it only when it
is clear of every card it swaps with (`clearToFlip`). A card that is not clear
waits at the turn. Nothing else changes order, so cards cannot pass through one
another.

Three more rules shape what is drawn:

- A card behind the front is drawn no taller than the card in front of it, so
  the pile is as tall as its front card.
- A card too tall to hide behind the new front recedes only a little and washes
  toward the page colour before the part hanging below the pile would show.
  Coming back, it starts washed out and regains colour as it rises.
- Every edge moves at most `vcap` px/s, the edge budget (24 px/frame at 60 Hz
  for a tap, 30 held). The cap is applied per card, to the edges it drew.

## What sets the pace of a held key

A press is taken once every card in transit has passed its flip. The leaving
card has to drop until it clears the card it uncovers, so a step takes as long
as that card is tall: single ↓ presses reach the flip in 117 ms over a 92 px
card and 267 ms over a 330 px card (`singles` in `sim/lib.mjs`). A held key
therefore runs at 100 to 300 ms per card on the mixed height sets, and one step
can take three times as long as the one before it. One press may wait for the
gate. A press that arrives while another waits is dropped, so a release rests on
a whole card with at most one more card after it (G9).

Faster means moving the same edges farther in the same time, and the edge budget
caps that. With no tempo, `ramp` or `fold`, raising the tap budget alone lifts
`natural` from 5.5 / 5.5 cards/s at 24 px/frame to 6.3 / 6.3 at 30 and 7.0 / 7.3
at 39, with no checker problems (`edge budget, tap` in
`npm run sweep -- params`). The pace stays tied to card height: the intervals
run 83–200 ms at 39 and 100–300 ms at 24. The first failure is at 40 px/frame,
with 394 jumps, because the checker's jump rule fires when an edge moves more
than 40 px in a frame. No perceptual threshold sets the budget (see the edge
budgets section below), so the sweep shows where the checker stops a higher one,
not where the motion starts to look rushed.

`tempo`, `ramp`, `fold` and `gateSlack` change the trade too. The presets set
the first three:

| Preset (60 Hz, `npm run sweep -- presets`) | Held ↑ / ↓, cards/s | Interval range | Worst step-to-step change | Max jump, px/frame | Problems |
| ------------------------------------------ | ------------------- | -------------- | ------------------------- | ------------------ | -------- |
| `natural`                                  | 5.5 / 5.5           | 100–300 ms     | 3.00×                     | 24                 | 0        |
| `even`                                     | 4.0 / 3.9           | 217–283 ms     | 1.15×                     | 25                 | 0        |
| `even + held speed`                        | 4.7 / 4.7           | 183–233 ms     | 1.18×                     | 31                 | 0        |
| `fold`                                     | 10.1 / 10.8         | 83–167 ms      | 1.67×                     | 31                 | 0        |

While a key is held, a held state λ rises from 0 to 1 (the page's `held`
readout). It starts once the key has been held for the hold delay, 250 ms, and
follows a spring of fixed rate, 1.6 Hz: 387 ms after the delay ends it reaches
0.9 (`npm run sweep -- held`). A tap shorter than the delay does not start it:
at 250 ms, taps of 60, 100 and 150 ms peak at 0.00 on `fold`. `ramp` and `fold`
both read λ.

- **`tempo`** spaces presses by a planned interval, so the pace follows the
  tallest card nearby and changes gently. `constant` uses one interval; with
  `ramp` on, 225 ms gives 4.4 / 4.4 cards/s with no problems and 200 ms gives 2
  swaps (`constant interval` on `constant with held speed-up`). `lookahead`
  takes, for each step, the moving average of the moving maximum of the
  estimated clear times over `window` cards each way, which never drops below
  the step's own estimate and eases toward a tall card before it arrives. A
  window of 3, 4 or 6 cards measures the same (3.9 / 3.9 cards/s, intervals
  233–283 ms), so the slider stops at 3. A card of height `h` is estimated at
  `scale × (60 + 0.62·h)` ms, which is 105 ms for the 73 px card and 265 ms for
  the 330 px card at scale 1 (`npm run sweep -- limits`). The estimate is a fit
  to single ↓ presses that `↑` shares without a separate measurement. At scale
  0.5, `even` runs at 5.5 / 5.3 cards/s, within 0.2 of `natural`, and a smaller
  scale gives `natural`'s pace because the trips outlast the plan. The even pace
  costs speed: `even` runs 28% below `natural`.
- **`ramp`** stiffens the springs (3 to 4.5 Hz) and raises the edge budget (24
  to 30 px/frame) with λ. Alone it raises the pace to 7.2 / 7.3 cards/s and
  gives 2 checker problems, both swaps in a held ↓ on the second mixed set; the
  intervals run 67–233 ms and the worst step-to-step change is 3.50× (3.00× in
  `natural`). With the held spring at 3 or 3.5 Hz the suite is clean (6.2 / 6.4
  and 6.6 / 6.8 cards/s). `even + held speed` adds a tempo and is clean at the
  default 4.5 Hz.
- **`fold`** includes `ramp`'s speed-up and shrinks every card's drawn height
  toward `H0` (73 px) with λ, which takes the height out of the trip. The card
  that lands unfolds on release, or on arrival at the end of the queue. At 10
  cards/s a card is on screen for 100 ms. Potter (1976, _J. Exp. Psychol. Hum.
  Learn. Mem._ 2:509) found that a picture shown for 113 ms in a stream is
  understood well enough to detect a target, with about 300 ms more of
  processing needed to keep it. That result is about pictures; applied to cards,
  a body cannot be read in 100 ms and a header line can be recognised.
- **`gateSlack`** lets a press start while the card before it is short of its
  flip by that many ring units. At 0.1 the held pace rises from 5.5 to 5.9
  cards/s with no problems. At 0.15 two draw-order swaps appear, and at 0.5 a
  held ↓ never settles (`npm run sweep -- slack`). Under a tempo it moves the
  pace by at most 0.1 cards/s through 0.3, because the planned interval outlasts
  the gate (`gate slack` on `even` in `npm run sweep -- params`). Past a small
  slack, overlapping trips need the leader to open a gap of the follower's
  height before it can go behind, which is the rule the gate already enforces.

Each setting's effect on its own is in `npm run sweep -- params`. The ones that
matter most:

- Folding on or off moves held pace from 5.5 / 5.5 to 10.1 / 10.8 cards/s.
- The tap spring moves tap ↑ landing between 683 ms (2 Hz) and 383 ms (4.5 Hz);
  at 4.5 Hz the landing speed rises from 1.8 to 4.6 px/frame and the held pace
  from 5.5 / 5.5 to 6.3 / 6.0 cards/s.
- The tap edge budget moves held pace from 5.5 / 5.5 cards/s at 24 px/frame to
  7.0 / 7.3 at 39. At 40 px/frame it gives 394 checker problems, all jumps.
- A held edge budget of 39 px/frame is clean on `even + held speed` and `fold`.
  At 40 px/frame they give 131 and 5 jumps, and held speed-up alone gives 122
  problems.
- The held state's rate is fixed. The hold delay moves when it starts: on
  `fold`, 0 ms gives 10.9 / 11.9 cards/s and 800 ms gives 8.0 / 8.3.

## The edge budgets and the frame checker

The 24 and 30 px/frame budgets come from the shipped engine, whose held ↓ moves
edges up to about 30 px per frame. No perceptual threshold sets them. The
checker's jump rule, the product test's threshold of 40 px in a frame, stops a
higher budget: taps on `natural`, and held keys on `even + held speed` and
`fold`, are clean at 39 px/frame and fail at 40. The budget is per frame, so a
120 Hz display allows twice the px/s: the suite scales `vcap` with the refresh
rate, and the page's px/frame sliders convert at 60 Hz.

`sim/check.mjs` has two rules for a drawn bottom edge that changes by more than
16 px in a frame:

- **original**: the rows that change must be covered by a card in front, in the
  new frame. This is the rule in `tests/app/queue/stack-engine.test.ts`.
- **corrected**: the rows must have been covered in the frame in which the card
  drew them, which is the new frame for rows that appear and the old frame for
  rows that disappear.

The two differ where a card rises over a taller card behind it. The rising
card's bottom edge removes the lower part of the card behind, and no pixel of
that card is drawn in the band. The original rule counts the band and reports
169 hits (all of the clip-band kind) across the natural preset's suite
scenarios. The corrected rule reports 0. The suite asserts the corrected rule.
Porting the drum into the product needs the product test's rule changed to
match, and that decision is open.

## Options the model does not use

- **A cross-fade to hide the draw-order change.** The new front would show
  through the leaving card, putting two cards' text in the same pixels (G8). A
  card washed to the page colour is still opaque and blanks the text under it.
- **Replaying a recorded ↓ trip backwards for ↑.** A ↓ trip starts with a kick
  and ends gently, so its reverse speeds up into a stop (a landing of about 14
  px/frame in that version) and the first response is late.
- **One scalar position with every pose a function of it.** It is continuous by
  construction, but ↑ and ↓ share one path, and with the edge budget on its held
  pace stayed near 4 cards/s.
- **A cascade that swaps order below the visible area.** Cards would slide down
  in a train and go behind only once out of view, so the pace would depend on
  the spacing between cards and not on their heights. Not built: cards would
  travel to the bottom of the view over the replies, and each new front would
  show only a header strip at speed.

## Open

- **Tap ↑ against tap ↓.** Tap ↑ lands in 483 ms and tap ↓ settles in 217 ms
  (median over the height sets). ↑ shows the arriving card after it has risen
  over the old front, while ↓ shows the new front at once.
- **The edge budget.** The checker stops a budget at 40 px/frame, and no
  measurement says how far an edge may move in a frame before the motion looks
  rushed. The defaults, 24 and 30 px/frame, come from the shipped engine.
- **The corrected clip-band rule** needs a decision before a port (above).
- **Folding on a real page.** The sims and the page here show the motion; the
  cost of clipping four cards per frame in the product's DOM, the reply fade
  timing, and dark mode are not checked.
- **A real display and real key repeat.** The sims run on a stepped clock and
  the recordings on headless Chrome's screencast at about 50 fps.
