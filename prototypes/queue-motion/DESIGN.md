# Queue stack motion: goals, model, limits

This file says what the stack's motion has to do, how the elastic drum
(`src/drum.mjs`) does it, what sets the pace of a held key, and what is still
open. The code is the authority on behaviour; the numbers below come from the
commands named beside them, on a stepped 60 Hz clock unless a row says 120 Hz.

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
| G10 | One mechanism, small enough to test with invariants.                                                                                  | line count                                                               | `drum.mjs` 463 lines with comments; `stackEngine.ts` 1661 |
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
- Every edge moves at most `vcap` px/s (24 px/frame at 60 Hz for a tap, 30
  held). The cap is applied per card, to the edges it drew.

## What sets the pace of a held key

A press is taken once every card in transit has passed its flip. The leaving
card has to drop until it clears the card it uncovers, so a step takes as long
as that card is tall: single ↓ presses reach the flip in 117 ms over a 92 px
card and 267 ms over a 330 px card (`singles` in `sim/lib.mjs`). A held key
therefore runs at 100 to 300 ms per card on the mixed height sets, and one step
can take three times as long as the one before it.

Faster means moving the same edges farther in the same time, and that is capped
by the edge budget. Three settings change the trade:

| Preset (60 Hz, `npm run sweep -- presets`) | Held ↑ / ↓, cards/s | Interval range | Worst step-to-step change | Max jump, px/frame | Problems |
| ------------------------------------------ | ------------------- | -------------- | ------------------------- | ------------------ | -------- |
| `natural`                                  | 5.5 / 5.5           | 100–300 ms     | 3.00×                     | 24                 | 0        |
| `even`                                     | 4.0 / 3.9           | 217–283 ms     | 1.15×                     | 25                 | 0        |
| `even + held speed`                        | 4.7 / 4.7           | 183–233 ms     | 1.18×                     | 31                 | 0        |
| `constant + held speed`                    | 4.4 / 4.4           | 217–233 ms     | 1.08×                     | 31                 | 0        |
| `fold`                                     | 10.1 / 10.8         | 83–167 ms      | 1.67×                     | 31                 | 0        |

- **`tempo`** spaces presses by a planned interval, so the pace follows the
  tallest card nearby and changes gently. `constant` uses one interval.
  `lookahead` takes, for each step, the moving average of the moving maximum of
  the estimated clear times over `window` cards each way, which never drops
  below the step's own estimate and eases toward a tall card before it arrives.
  A card of height `h` is estimated at `scale × (60 + 0.62·h)` ms, a fit to
  single ↓ presses that `↑` shares without a separate measurement. The even pace
  costs speed: `even` runs 27% below `natural`.
- **`ramp`** stiffens the springs (3 to 4.5 Hz) and raises the edge budget (24
  to 30 px/frame) while a key is held. Alone it raises the pace to 7.2 cards/s,
  gives 2 checker problems (a held ↓ on the second mixed set), and leaves the
  worst step-to-step change at 3.5×; with a tempo the suite stays clean.
- **`fold`** shrinks every card's drawn height toward `H0` (73 px) while a key
  is held, which takes the height out of the trip. The card that lands unfolds
  on release, or on arrival at the end of the queue. At 10 cards/s a card is on
  screen for 100 ms. Potter (1976, _J. Exp. Psychol. Hum. Learn. Mem._ 2:509)
  found that a picture shown for 113 ms in a stream is understood well enough to
  detect a target, with about 300 ms more of processing needed to keep it. That
  result is about pictures; applied to cards, a body cannot be read in 100 ms
  and a header line can be recognised.
- **`gateSlack`** lets a press start while the card before it is short of its
  flip by that many ring units. At 0.1 the held pace rises from 5.5 to 5.9
  cards/s with no problems. At 0.15 two draw-order swaps appear, and at 0.5 a
  held ↓ never settles (`npm run sweep -- slack`). Past a small slack,
  overlapping trips need the leader to open a gap of the follower's height
  before it can go behind, which is the rule the gate already enforces.

Each setting's effect on its own is in `npm run sweep -- params`. The ones that
matter most:

- Folding on or off moves held pace from 5.5 to 10.1 cards/s.
- The tap spring moves tap ↑ landing between 683 ms (2 Hz) and 383 ms (4.5 Hz);
  at 4.5 Hz the landing speed rises from 1.8 to 4.6 px/frame.
- An edge budget of 40 px/frame for taps gives 394 checker problems, and 50
  px/frame held gives 507.
- A fold rate of 3.2 Hz gives 20 problems and a 47 px jump.

## The edge budgets and the frame checker

The 24 and 30 px/frame budgets come from the shipped engine, whose held ↓ moves
edges up to about 30 px per frame. No perceptual threshold sets them. The budget
is per frame, so a 120 Hz display allows twice the px/s: the suite scales `vcap`
with the refresh rate, and the page's px/frame sliders convert at 60 Hz.

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
- **The corrected clip-band rule** needs a decision before a port (above).
- **Folding on a real page.** The sims and the page here show the motion; the
  cost of clipping four cards per frame in the product's DOM, the reply fade
  timing, and dark mode are not checked.
- **A real display and real key repeat.** The sims run on a stepped clock and
  the recordings on headless Chrome's screencast at about 50 fps.
