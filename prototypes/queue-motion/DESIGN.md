# Queue stack motion: goals, models, limits

This file says what the stack's motion has to do, how the elastic drum
(`src/app/page/queue/drum.ts`) does it, what sets the pace of a held key, how
the cascade (`prototypes/queue-motion/src/cascade.ts`), a second model that only
the lab runs, does it differently and what that costs, and what is still open.
The code is the authority on behaviour; the numbers below come from the commands
named beside them, on a stepped 60 Hz clock unless a table says 120 Hz.

## Goals

The cards are opaque and range from about 73 px (one line) to 330 px (a long
recap). Motion is judged by how it feels, so each goal below is paired with the
number the suite prints for it. The last column is the cascade's `default`
preset (`npm run suite -- cascade`, 60 Hz); `same` means the number equals the
natural preset's.

| #   | Goal                                                                                                                                  | Checked by (`npm run suite`)                                             | Natural preset, 60 Hz                                   | Cascade `default`, 60 Hz                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| G1  | No card visibly passes through another: draw order changes only while two cards are apart, or a third card covers where they overlap. | `problems`, swap kind                                                    | 0 in every scenario                                     | 0 in every scenario, and no draw-order change among painted cards (natural: 813) |
| G2  | Every landing slows into rest.                                                                                                        | landing speed, px/frame over the last 5 frames                           | 1.8                                                     | same                                                                             |
| G3  | Position and velocity stay continuous when a press reverses a move in flight.                                                         | reversal ↑↓↑ max jump and problems                                       | 24.1 px, 0 problems                                     | 24.0 px, 0 problems                                                              |
| G4  | ↑ and ↓ run at the same pace and with the same quality.                                                                               | held ↑ and ↓ cards/s                                                     | 5.5 and 5.5                                             | 10.8 and 10.8                                                                    |
| G5  | The first visible change comes within a frame of a press.                                                                             | first visible change                                                     | 16.7 ms                                                 | same                                                                             |
| G6  | A held key can speed up, with every card still reaching the front.                                                                    | held cards/s per preset                                                  | up to 10.1 and 10.8 (`fold`)                            | 10.8 and 10.8, with no fold                                                      |
| G7  | A single tap is a full, readable move.                                                                                                | tap ↑ lands, tap ↓ settles                                               | 483 ms and 217 ms                                       | 550 ms and 217 ms                                                                |
| G8  | Tall and short cards in any order show no ghost, no half-covered text, and no two cards' text in the same pixels.                     | `problems` over three height sets, one of them alternating 330 and 73 px | 0                                                       | 0 problems; a held ↓ covers part of the next card's text (Costs)                 |
| G9  | Releasing the key rests on a whole card, with at most one more card after the release.                                                | release: rests on a card / extra cards                                   | all / 1                                                 | same                                                                             |
| G10 | One mechanism, small enough to test with invariants.                                                                                  | line count                                                               | `drum.ts` 566 lines with comments; `stackEngine.ts` 401 | `cascade.ts` 406 lines with comments                                             |
| G11 | The heading and counter stay outside the motion.                                                                                      | by construction                                                          | the page swaps their text                               | same                                                                             |
| G12 | Reduced motion is calm.                                                                                                               | by construction                                                          | no card moves; the new front fades in over 160 ms       | same                                                                             |

A hold that reaches an end of the queue moves nothing (0 px in
`hold at an end moves`), and a fold that was running unfolds as the last card
arrives. The cascade's held state falls below 5 % 467 ms after the last card
arrives.

## The drum

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

## What sets the pace of a held key on the drum

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
`natural` from 5.0 / 5.2 cards/s at 24 px/frame (1440 px/s) to 5.4 / 5.9 at 30
and 5.9 / 6.4 at 39, with no checker problems (`top speed` in
`npm run sweep -- params`). The pace stays tied to card height: the intervals
run 83–333 ms at 39 and 100–367 ms at 24. The first failure is at 40 px/frame,
with 391 jumps, because the checker's jump rule fires when an edge moves more
than 40 px in a frame. No perceptual threshold sets the budget (see the edge
budgets section below), so the sweep shows where the checker stops a higher one,
not where the motion starts to look rushed.

`tempo`, `ramp` and `fold` change the trade too. The presets set them:

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
- **`incomingFade`** is how fast, in shade per second, a card coming back (a ↑)
  regains its colour, counted from the moment it starts to move and not from its
  position: its wash goes to nothing at once and its shade falls at that rate.
  At 8 per second a returning card that starts at a shade of 0.66 is whole in
  about 80 ms, where before it followed its path and took about 200 ms. The rate
  is the limit: at 8.5 the checker is clean and at 9 a fade changes by more than
  0.2 in a frame (16 flickers in taps), so the default keeps a margin. Other
  cards' shade changes are limited to 10.5 per second so a card that turns
  around mid-flight cannot jump.
- **`coverFade`** fades the content, not the card, of the card a returning card
  is about to cover. On a ↑ the pile card after the rising card loses its
  content (up to 1, so none is visible) as the card leaves its tuck, and gets it
  back once the card has landed and the card behind is a strip with no content
  showing. Only that card fades: a card moving into the front on a ↓, or sitting
  in the pile, keeps its content, because a pile card whose content was hidden
  by position showed as an empty tall frame when it moved into the front during
  a hold. The content follows its target with a 50 ms time constant going out
  and 20 ms coming back. The frame and background are not faded, so the card
  keeps the colour it has in the pile and nothing brightens when the rising card
  lands; an earlier version faded the whole card and it jumped back to the
  pile's colour at the end.
- **The covered card shrinks early.** Each card's drawn bottom edge follows the
  bottom it is heading for, at no more than 720 px/s (12 px a frame at 60 Hz,
  under the checker's 16 px). A pile card is clipped to the front card's lower
  edge, and a front card that is still rising counts at its resting bottom, so
  the covered card shrinks to the height it has under the front card while the
  rising card is on its way, instead of staying tall until covered. The limit
  holds for every card, so no edge jumps when a card turns around mid-flight.
  The cost is in the margins, not the presets: every preset passes
  `npm run check`, but a tap spring of 4.5 Hz or more, a held budget of 39 on
  `even + held speed` and a 225 ms beat with held speed-up each give one to a
  few more.
- **`loose`** includes `ramp`'s speed-up and shrinks only the heights the
  clearing geometry uses, toward `H0` with λ, while every card is drawn whole. A
  leaving card drops just far enough to clear a card of that virtual height, so
  it passes over the card it uncovers instead of around it, and washes out by up
  to 60 % at the turn. The leaver no longer clips the card behind it to its own
  lower edge. With a constant 100 ms beat the `loose` preset holds 9.3 / 9.4
  cards/s with intervals of 100–167 ms and no problem in taps or reversals. The
  checker counts 110 problems in the holds over its three height sets,
  draw-order swaps and clip bands: passing over a card changes the draw order
  while the cards overlap. `npm run check` allows them in the holds of a loose
  preset and nowhere else. Each setting's effect on its own is in
  `npm run sweep -- params`. The ones that matter most:

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
checker's jump rule, 40 px in a frame, stops a higher budget: taps on `natural`,
and held keys on `even + held speed` and `fold`, are clean at 39 px/frame and
fail at 40. The budget is per frame, so a 120 Hz display allows twice the px/s:
the suite scales `vcap` with the refresh rate. The page gives the budgets as top
speeds in px/s, the models' own unit, with px/frame at 60 and 120 Hz beside
each.

`sim/check.mjs` has two rules for a drawn bottom edge that changes by more than
16 px in a frame:

- **original**: the rows that change must be covered by a card in front, in the
  new frame. `sim/check.mjs` keeps it as its `orig` mode.
- **corrected**: the rows must have been covered in the frame in which the card
  drew them, which is the new frame for rows that appear and the old frame for
  rows that disappear.

The two differ where a card rises over a taller card behind it. The rising
card's bottom edge removes the lower part of the card behind, and no pixel of
that card is drawn in the band. The original rule counts the band and reports
169 hits (all of the clip-band kind) across the natural preset's suite
scenarios, and 148 across the cascade's `default` (`npm run suite -- cascade`).
The corrected rule reports 0 for both. The suite asserts the corrected rule. The
product test (`tests/app/queue/stack-engine.test.ts`) runs neither rule, so
adding one is a decision (see Open).

The lab page runs the corrected rule too: its Measured module applies `problems`
and `maxJump` to the frames the page draws, recorded about every 1/60 s of page
clock, together with the held pace and the tap landing times the sweeps report.
The sims stay the reference. A count on the page that the sweeps do not show
comes from what only the page has: the OS key repeat, the browser's frame clock,
and, in `Product now`, the engine's short row of cards.

## Cascade

The cascade (`prototypes/queue-motion/src/cascade.ts`) is a second model of the
same stack. The drum tucks a card that leaves behind the pile and changes its
draw order there, so a step lasts as long as the leaver takes to clear the card
it uncovers. The cascade tucks nothing. A card that leaves slides down in front
of the pile and parks below a clip line, so a held key sends a train of cards
down the page and each one uncovers the top of the card behind it. The lab runs
the cascade; the product runs the drum.

### The model

Each card has one coordinate `c` and one critically damped spring along it:

- `c ≥ 0`: a pile slot, as in the drum.
- `−1 < c < 0`: the **exit channel**, in front of the pile at full scale, the
  card's top `−c · park` px below the front pose.
- `c ≤ −1`: **parked** below the **clip line**, which is `park` px (480) below
  the front pose. A parked card is not painted.

A key press moves one integer, `front`. A card's spring target is a function of
`(card, front)` alone: `index − front` for the pile, and −1.25 for a card before
the front. A leaver therefore aims past the clip line and slows out of sight. ↑
runs the channel the other way: a parked card rises from the clip line and slows
into the front slot.

No card tucks, turns or flips, so draw order never changes: nearest first it is
the channel cards by index, then the pile cards by index. The suite counts 0
draw-order changes among painted cards in every scenario. The pile above the
front card is the drum's, and the suite checks that the two models draw the same
poses for it (a difference of 0 px).

Four rules shape what is drawn:

- A channel card's edges stop at the clip line, so a card sliding through it is
  not a lower edge moving in view of the frame checker. The page draws a card
  that reaches the line at its full height and lets the clip box cut it, so the
  card shows no rounded corner or border on the line.
- Each card is drawn no taller than the card in front of it, channel cards
  included, so the stack shows no more than the cards it covers. Without this
  the new front reaches its full height at once while the leaver is still
  sliding away, and the frame checker reports edge flashes.
- A leaver is washed toward the page colour as it falls: nothing at the front,
  `leave shade` (0.25) at the clip line.
- The page masks the last `fade` px above the clip line (100 by default), so a
  card dissolves into the page instead of vanishing along one line. The sims do
  not draw the mask, so no number in this file depends on it.

### What sets the pace

A press in the direction of the last waits until the edge budget's speed has
covered `spacing` px since the last press was taken, which is `spacing` ÷
budget. At rest that is 216 px at 24 px/frame (1440 px/s): 150 ms. With the held
state up it is 150 px at 30 px/frame (1800 px/s): 83 ms. A press the other way
does not wait for the gate. One press may wait for it, and a press that arrives
while one waits is dropped, so a release rests on a whole card with at most one
more card after it (G9).

The held state λ rises from 0 to 1 on the drum's 1.6 Hz spring once a key has
been held for the hold delay, 250 ms. As it rises, `spacing` runs from 216 to
150 px, the spring from 3 to 4.5 Hz and the edge budget from 24 to 30 px/frame.
It falls on release and at either end of the queue. With the ramp off
(`no held ramp`) the train runs at 150 px, 3 Hz and 24 px/frame from the first
repeat.

A card's height does not enter. A tall card and a short one leave the front the
same time apart, so the held pace is the same on all three height sets, 10.8
cards/s, where `natural` varies by 12.4 % and `even` by 16.3 %. Held ↑ and ↓
take the same time per card: over five phases of the 33 ms key repeat they
differ by 0.0 % at 60 and 120 Hz, and `npm run check` fails past 5 %.

A gate on how far the last card has travelled would measure the spacing
directly, and the cascade does not use one. A card that ↓ releases is still
settling into the front slot, and its first stretch is in the pile region, where
one unit of `c` is 10 px on screen against 480 px in the channel. A gate on
screen travel waits through that stretch, so ↓ runs slower than ↑: it ran held ↑
at 9.8 and held ↓ at 8.5 cards/s over five key-repeat phases at 60 Hz, 15 %
apart, and 15.6 and 12.0 cards/s, 30 % apart, at 120 Hz.

### Measured numbers

`npm run suite -- cascade` runs the cascade's two presets and the drum's
`natural` and `even` over three height sets and prints one table per refresh
rate. The sets are `w1`, a mixed set topping out at 284 px; `w2`, a mixed set
topping out at 330 px; and `alt`, alternating 330 and 73 px. The rows below are
the ones this file uses; the output has a few more. The suite keeps the edge
budgets at the same px/frame at both rates, so the 120 Hz table runs at twice
the px/s of the 60 Hz table.

At 60 Hz:

| Suite row                                             | cascade `default`  | cascade `no held ramp` | drum `natural`  | drum `even`     |
| ----------------------------------------------------- | ------------------ | ---------------------- | --------------- | --------------- |
| held ↑ cards/s per set (w1 / w2 / alt)                | 10.8 / 10.8 / 10.8 | 9.6 / 9.6 / 9.6        | 5.8 / 5.5 / 5.3 | 4.3 / 3.9 / 3.8 |
| held ↓ cards/s per set (w1 / w2 / alt)                | 10.8 / 10.8 / 10.8 | 9.6 / 9.6 / 9.6        | 5.8 / 5.3 / 5.2 | 4.3 / 3.8 / 3.7 |
| pace spread between height sets, worst of ↑ and ↓     | 0.0 %              | 0.0 %                  | 12.4 %          | 16.3 %          |
| ↑ and ↓ apart over the phases, worst set              | 0.0 %              | 0.0 %                  | 3.4 %           | 1.5 %           |
| held interval range, ms                               | 83–117             | 100–117                | 100–300         | 217–283         |
| worst step-to-step interval change                    | 1.2                | 1.2                    | 3.0             | 1.2             |
| tap ↑ lands, ms (median)                              | 550                | 550                    | 483             | 483             |
| tap ↓ settles, ms (median)                            | 217                | 217                    | 217             | 217             |
| first visible change, ms (max)                        | 16.7               | 16.7                   | 16.7            | 16.7            |
| landing speed, px/frame (max, last 5 frames)          | 1.8                | 1.8                    | 1.8             | 1.8             |
| tap max jump, px/frame                                | 24.0               | 24.0                   | 24.1            | 24.1            |
| held max jump, px/frame                               | 32.8               | 26.6                   | 24.2            | 24.8            |
| problems (corrected rule): taps / holds / reversals   | 0 / 0 / 0          | 0 / 0 / 0              | 0 / 0 / 0       | 0 / 0 / 0       |
| cards in front of the pile at once (max in holds)     | 4                  | 4                      | 1               | 1               |
| cards still moving after release, ms (max)            | 617                | 700                    | 783             | 800             |
| page area the train uses: park, px                    | 480                | 480                    | –               | –               |
| lowest drawn edge below the front pose, px (max)      | 480                | 480                    | 511             | 511             |
| visible px: least a card shows at its best / median   | 73 / 156           | 73 / 150               | 73 / 162        | 73 / 162        |
| frames visible: fewest at min(height, 100) px         | 10                 | 13                     | 2               | 1               |
| cards that fail "every card visible" (need 10 frames) | 0                  | 0                      | 20              | 19              |
| draw-order changes among painted cards, all scenarios | 0                  | 0                      | 813             | 738             |

At 120 Hz:

| Suite row                                             | cascade `default`  | cascade `no held ramp` | drum `natural`  | drum `even`     |
| ----------------------------------------------------- | ------------------ | ---------------------- | --------------- | --------------- |
| held ↑ cards/s per set (w1 / w2 / alt)                | 19.4 / 19.4 / 19.4 | 18.6 / 18.6 / 18.6     | 7.6 / 7.5 / 7.3 | 4.3 / 3.8 / 3.8 |
| held ↓ cards/s per set (w1 / w2 / alt)                | 19.4 / 19.4 / 19.4 | 18.6 / 18.6 / 18.6     | 8.5 / 7.9 / 7.6 | 4.3 / 3.9 / 3.8 |
| pace spread between height sets, worst of ↑ and ↓     | 0.0 %              | 0.0 %                  | 10.9 %          | 15.8 %          |
| ↑ and ↓ apart over the phases, worst set              | 0.0 %              | 0.0 %                  | 11.1 %          | 0.1 %           |
| held interval range, ms                               | 42–67              | 50–58                  | 83–183          | 225–267         |
| worst step-to-step interval change                    | 1.2                | 1.2                    | 2.2             | 1.1             |
| tap ↑ lands, ms (median)                              | 442                | 442                    | 450             | 450             |
| tap ↓ settles, ms (median)                            | 208                | 208                    | 208             | 208             |
| first visible change, ms (max)                        | 8.3                | 8.3                    | 8.3             | 8.3             |
| landing speed, px/frame (max, last 5 frames)          | 0.4                | 0.4                    | 0.5             | 0.5             |
| tap max jump, px/frame                                | 24.0               | 24.0                   | 24.1            | 24.1            |
| held max jump, px/frame                               | 32.4               | 25.0                   | 24.1            | 24.4            |
| problems (corrected rule): taps / holds / reversals   | 0 / 0 / 0          | 0 / 0 / 0              | 0 / 0 / 0       | 0 / 0 / 0       |
| cards in front of the pile at once (max in holds)     | 4                  | 4                      | 1               | 1               |
| cards still moving after release, ms (max)            | 542                | 633                    | 667             | 758             |
| page area the train uses: park, px                    | 480                | 480                    | –               | –               |
| lowest drawn edge below the front pose, px (max)      | 480                | 480                    | 511             | 511             |
| visible px: least a card shows at its best / median   | 73 / 160           | 73 / 150               | 73 / 162        | 73 / 162        |
| frames visible: fewest at min(height, 100) px         | 10                 | 11                     | 2               | 2               |
| cards that fail "every card visible" (need 10 frames) | 0                  | 0                      | 16              | 11              |
| draw-order changes among painted cards, all scenarios | 0                  | 0                      | 858             | 738             |

For `default` at 60 Hz:

- **Pace.** The cascade holds 10.8 cards/s on every set, ↑ and ↓ alike, with
  intervals of 83–117 ms and no step between consecutive intervals over 1.2×.
  `natural` runs 5.2–5.8 cards/s with intervals of 100–300 ms and a 3.0× step,
  and `even` 3.7–4.3.
- **Taps.** ↓ settles in 217 ms, as on the drum. ↑ lands in 550 ms against the
  drum's 483, because the card rises from the clip line, 480 px below.
- **Checker.** Taps, holds and reversals show 0 problems. The largest edge move
  in a held run is 32.8 px/frame, above the held budget of 30; the drum's is
  24.2.
- **Screen.** Up to 4 cards are in front of the pile at once. The lowest edge is
  480 px below the front pose; the drum's is 511.
- **Visibility.** A card counts as shown when a frame holds at least
  min(height, 100) px of it that no nearer card covers, and the suite asks for
  10 such frames per card (`npm run sweep -- limits cascade` prints the rule).
  The cascade's fewest is 10, so no card fails; `natural` fails on 20 cards and
  `even` on 19. A card's best frame shows a median of 156 px of it.
- **Draw order.** No painted pair changes order; `natural` has 813 changes and
  `even` 738, where the checker finds no swap that can be seen.
- **Release.** Cards keep moving for 617 ms after the key is up; `natural` takes
  783 ms.
- **`no held ramp`.** It holds 9.6 cards/s at 100–117 ms, with a largest held
  edge move of 26.6 px/frame and 13 frames for the card shown fewest; its taps
  are the same.

At 120 Hz `default` holds 19.4 cards/s with intervals of 42–67 ms, and tap ↑
lands in 442 ms, a little before the drum's 450. The fewest frames any card is
shown stays at 10, and the frames are half as long. The model's budgets are
px/s: left unscaled, a 120 Hz run holds 10.7 cards/s and its largest move is
18.1 px/frame.

### Settings kept and pruned

The page has eleven cascade settings, and the five it shares with the drum
(`w0`, `cap`, `delay`, `w1`, `cap1`) use the drum's keys and names. Nine move a
number the suite prints, and two, `shade` and `fade`, change only what the page
draws. `held` is the ramp, on (`speed up`) or off (`same as taps`, the
`no held ramp` preset). `pace` and `pace0` are written as the spacings the model
reads: `spacing1` is the train's top speed divided by `pace`, and `spacing0` is
`vcap` divided by `pace0`. `npm run sweep -- params cascade` changes one setting
at a time on `default`, at 60 Hz:

| Setting                       | Swept          | What it moves                                                                                                                    |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pace`                        | 8–18 cards/s   | Held pace, 7.7 up to 14.7 cards/s. At 18 cards/s (100 px) the largest held move is 40 px/frame, the checker's limit.             |
| `pace0`, pace before speed-up | 5–9.6 cards/s  | Held pace by under a card per second, 10.5 up to 11.4, and the first cards of a hold.                                            |
| `park`                        | 360–560 px     | Tap ↑, 483 to 617 ms; the fewest frames a card is shown, 7 to 10; cards in front of the pile, 3 to 4. Held pace 10.8 throughout. |
| `w0`, tap spring              | 2–6 Hz         | Tap ↑, 700 to 433 ms; tap ↓, 317 to 117 ms; landing speed, 0.8 to 7.7 px/frame. Held pace 10.8 throughout.                       |
| `cap`, top speed              | 960–2400 px/s  | Tap ↑, 700 to 467 ms; held pace, 10.5 to 11.6 cards/s. At 2400 px/s (40 px/frame) the checker finds 30 jumps.                    |
| `delay`, speeds up after      | 0–600 ms       | Held pace, 11.6 down to 9.6 cards/s.                                                                                             |
| `w1`, held spring             | 3–8 Hz         | No pace: 10.8 cards/s throughout. See below.                                                                                     |
| `cap1`, held top speed        | 1440–2640 px/s | Held pace, 9.0 up to 14.7 cards/s, with the spacing left at 150 px. See below.                                                   |
| `shade`, leave shade          | 0–0.5          | No number: all three rows print the same.                                                                                        |
| `fade`, edge fade             | 0–134 px       | No number: the page draws the mask, and the sims do not.                                                                         |

- **The held spring** does not move the pace: at 3, 4.5 and 6 Hz the held run is
  10.8 cards/s at 83–117 ms with a 1.20× step. It moves the largest held edge
  move (32, 33 and 38 px/frame) and the fewest frames a card is shown (8, 10 and
  10). A held spring of 3 Hz fails the visibility rule, and 8 Hz gives 36
  problems (15 jumps, 21 fade flickers).
- **The held top speed** sets the pace the way `pace` does, with a smaller
  margin. Top speeds of 1440, 1800 and 2160 px/s give 9.0, 10.8 and 12.7 cards/s
  at the default spacing; a `pace` of 10, 12 and 14 cards/s gives 9.3, 10.8 and
  12.2 with 0 problems and 10 or more frames for every card. A top speed of 2160
  gives 6 jumps (largest held move 42 px/frame) and shows the fewest card for 8
  frames. On the page a `pace` set in cards/s keeps its value when the held top
  speed changes, by changing the spacing.

### Defaults settled by looking

Four defaults came from looking at the page and at contact sheets; the sweeps
above show what each costs.

- **`fade` is 100 px.** With no fade, cards vanish along a horizontal line in
  the middle of the page, and the line shows. A fade of 100 to 134 px dissolves
  a card over the last stretch before the clip line. The slider stops at 134 px
  with `park` at 480 (480 − 330 − 16): the most that leaves the tallest pile
  card and its shadow unfaded. The fade is a mask on the clip box, which masks
  the finished stage, so cards that overlap in the train do not show through
  each other. A fade applied to each card would let them.
- **`park` is 480 px.** Below it a card is shown for fewer frames: the fewest is
  7 at 360 and 400 px against the 10 the visibility rule needs. Above it tap ↑
  lands later (617 ms at 560 px against 550) and the largest held move rises to
  36 px/frame. 480 px is the smallest value in the sweep that meets the rule.
- **`leave shade` is 0.25.** It changes no number in the sweeps, so only the
  page shows what it does: a card washes toward the page colour as it falls.
- **`spacing` is 216 px at rest and 150 px held.** At 150 px held the cascade
  holds 10.8 cards/s with 0 problems, and a card's best frame shows a median 156
  px of it. At 125 px the pace is 12.7 cards/s and the median 127 px. At 100 px
  it is 14.7 cards/s and the median 106 px, with the largest held move at the
  checker's limit. On the sheets a reviewer saw about 200 ms per card at the
  start of a hold and about 100 ms held.

### Costs

A reviewer who saw only contact sheets and did not know which model was which
read held ↓ and held ↑ over 12 cards, single presses, a reversal and an
alternating 330 and 73 px set, for the cascade, the drum's `natural` and the
drum's `fold`. Stills show positions and not easing, judder or a pop shorter
than a sheet's frame step, so what follows is a reading and not a measurement.
Pixel figures are on the sheets' tiles, which are 1/1.75 of the page.

The reviewer found that the cascade accelerates without folding, from about 200
ms per card at the start of a hold to about 100 ms held; runs the same both
ways; rises from below the stack on ↑ in one continuous motion; leaves no ghost;
and settles quickly, with the last card whole by about 1300 ms in a 12-card
hold. Its costs:

- **The falling card covers the next card.** In 8 of the 12 moving frames of a
  held ↓ the falling card covers the lower part of the card behind it, so a tall
  card in the train is never whole in one frame. The spacing gate puts cards
  `spacing` px apart whatever their heights, so at speed each card shows a
  header strip.
- **No easing in the channel.** Cards fall and rise at one constant speed,
  because the edge budget caps the whole channel; only a rising card's landing
  slows.
- **The front slot in a held ↑.** It shows a retreating, faded card until the
  arriving cards have passed, so no crisp front card shows during the hold.
- **Uneven gaps.** In a held ↑ the gaps between neighbouring cards alternate
  between about 58 and 95 px on the tiles, which is about 100 and 166 px on the
  page.
- **A reversal leaves the page.** When a press reverses a move in flight, the
  card leaves the visible area for one frame of the sheet, 50 ms.

Against the drum, the reviewer ranked `natural` first overall, the cascade
second and `fold` last. The margin between `natural` and the cascade depends on
acceleration: `natural` shows each card whole and never speeds up, and if a held
key must accelerate the cascade comes first. By scenario:

- **Held ↓:** `natural`, then the cascade, then `fold`.
- **Held ↑:** the cascade, narrowly over `natural`, then `fold`.
- **Single ↑:** the cascade. `natural` and `fold` wind up with a drop and a
  hover before they rise.
- **Single ↓:** `natural` and `fold`, which draw the same frames, over the
  cascade, whose fall is clean but linear.
- **Reversal:** `natural` and `fold`, by a small margin, because their card
  stays on the page.
- **Pace across heights:** `natural`, on the alternating set, where a tall card
  reached the front every 400 ms, which is 200 ms per card. The cascade's steps
  in time were even (200 to 300 ms between tall arrivals) and its steps in space
  were not: a fixed fall speed leaves gaps behind short cards and covers tall
  ones.

### What a port needs

A port into `stackEngine.ts` and the product page has these parts:

- **The stack needs a clip region** `LEAD + park` px tall (514 px at the default
  `park`), with the fade's mask on it. The product's stage is `LEAD` plus the
  front card's height (`StackFrame.height`), so the region reaches 150 to 407 px
  below the front card (480 minus its height, over the sample heights) and
  covers whatever the page puts there: the replies and any other content in that
  band. It has to overlay the layout and not take space in it, because the
  layout height keeps following the front card.
- **The replies during a held key.** The engine fades the replies out when it
  takes a press (`BELOW_OUT`, 90 ms) and back in (`BELOW_IN`, 180 ms) once no
  moving card is over them (`overReplies`, after `BELOW_WAIT`, 160 ms). The
  cascade's train passes over them at every step, so they stay out until the
  train has stopped: cards keep moving up to 617 ms after the release at 60 Hz
  in the suite. How they fade for a whole hold, and what `overReplies` tests, is
  for the port to decide.
- **`motion.ts` and the engine adapter.** `StackEngine` calls members of `Drum`
  that `Cascade` lacks (`insert`, `remove`, `settle`, and `more` for the cards
  beyond its row), and it rests a card that has left at `PARKED` (−2) behind the
  pile, where a cascade card parks at `c = −1`. `motion.ts` draws a card at the
  height `vis` gives it, with rounded corners where it is cut, so the adapter
  reports a channel card that reaches the clip line at its full height, as the
  lab's adapter does, and the clip region cuts it.
- **The product test.** `stack-engine.test.ts` asserts that a held key moves a
  card about every 150 ms (8 to 11 cards in 1500 ms) and that no painted card's
  top moves more than 31 px in a frame. The cascade's `default` holds 10.8
  cards/s, and its largest held edge move is 32.8 px/frame at 60 Hz (32.7 for a
  card's top alone, which is what the test measures; `no held ramp`: 26.6), so
  the test changes or the cascade's held budget does. The test has no draw-order
  or clip-band rule. The cascade changes no draw order among painted cards and
  the corrected clip-band rule finds 0 problems, so a rule can be added if the
  product wants one.
- **A decision on the fade.** No sim measures the mask. Whether the product's
  stage takes a mask on every frame, or cuts at the clip line and shows the
  line, is open, and so is the mask's cost over four shadowed cards in the
  product's DOM.
- **A decision on pace and tap ↑.** The product ships a constant 150 ms between
  presses (`QUEUE_CFG`), and the cascade runs 83–117 ms held, which `pace` sets.
  Its tap ↑ lands in 550 ms against the drum's 483, because the card rises from
  480 px below. `park` at 360 px lands in 483 ms and shows a card for 7 frames
  against the 10 the rule needs.
- **The budgets' unit.** `QUEUE_CFG` and the cascade keep their budgets in px/s,
  so a 120 Hz display runs the 60 Hz pace with about half the move per frame
  (10.7 cards/s and 18.1 px/frame, above). The suite's 120 Hz table keeps
  px/frame and doubles the pace.

## Options the drum does not use

- **A cross-fade to hide the draw-order change.** The new front would show
  through the leaving card, putting two cards' text in the same pixels (G8). A
  card washed to the page colour is still opaque and blanks the text under it.
- **Replaying a recorded ↓ trip backwards for ↑.** A ↓ trip starts with a kick
  and ends gently, so its reverse speeds up into a stop (a landing of about 14
  px/frame in that version) and the first response is late.
- **One scalar position with every pose a function of it.** It is continuous by
  construction, but ↑ and ↓ share one path, and with the edge budget on its held
  pace stayed near 4 cards/s.
- **Parking a leaver below the visible area.** The drum tucks a leaver behind
  the pile and changes draw order there, so its pace follows card heights. The
  cascade slides a leaver down in front of the pile and parks it below a clip
  line, so draw order never changes and the pace follows the spacing between
  cards. The Cascade section has its numbers and its costs.
- **Starting a press before the previous card flips.** A press could be taken
  while the leaving card was still short of its flip by a margin. On `natural` a
  margin of 0.1 ring units raised the held pace from 5.1 to 5.5 cards/s with 4
  draw-order swaps, and no margin above 0 was clean. Under a tempo it moved the
  pace by at most 0.1 cards/s, because the planned interval outlasts the gate.
  It also let several cards reach the turn together, where each held the others
  in its turn band and the drum never settled, which took two more rules at the
  turn to prevent. The gate waits for the flip.

## Open

- **Port or not.** The cascade holds 10.8 cards/s with no fold, the same on ↑
  and ↓ and on every height set, at the costs above and the work in What a port
  needs. The reviewer put the drum's `natural` ahead overall and the cascade
  ahead if a held key must accelerate.
- **Tap ↑ against tap ↓.** Tap ↑ lands in 483 ms and tap ↓ settles in 217 ms
  (median over the height sets). ↑ shows the arriving card after it has risen
  over the old front, while ↓ shows the new front at once. On the cascade tap ↑
  takes 550 ms and tap ↓ 217 ms.
- **The edge budget.** The checker stops a budget at 40 px/frame, and no
  measurement says how far an edge may move in a frame before the motion looks
  rushed. The defaults, 24 and 30 px/frame, come from the shipped engine, and
  the cascade's held run moves an edge up to 32.8 px/frame.
- **The clip-band rule in the product test.** `stack-engine.test.ts` has no
  clip-band or draw-order rule. A port can add the corrected rule, which the
  drum and the cascade meet, or leave the test as it is.
- **The cascade's costs.** The lab has no fix for them yet. The reviewer would
  try drawing the arriving card above the falling one, or scaling and fading the
  falling card as the drum does; capping the train at two cards; and easing the
  fall and the rise, which the edge budget flattens. The suite counts frames
  that show min(height, 100) px of a card. No row counts the frames in which a
  tall card is whole, so nothing measures what the reviewer saw of tall cards.
- **Folding on a real page.** The sims and the page here show the motion; the
  cost of clipping four cards per frame in the product's DOM, the reply fade
  timing, and dark mode are not checked. The cascade's clip region and mask are
  unchecked there too.
- **A real display and real key repeat.** The sims run on a stepped clock and
  the recordings on headless Chrome's screencast at about 50 fps.
