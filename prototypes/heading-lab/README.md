# Heading lab

A standalone page that draws the sticky goal heading the way the plugin draws
it, so its states can be inspected in isolation, in one place, without a thread
and without a build step.

```sh
open prototypes/heading-lab/index.html
```

The heading is a solid band the timeline scrolls under, so its edges only show
up against content that is moving underneath. The page therefore puts the
heading over a real scrolling column of messages, on a white surface where every
wash and step in contrast is visible, with controls for the states that change
it:

- **Layout** — pinned in the timeline, or minimized into a title bar.
- **Transition** — `Fade` and `Scroll`, the same two the settings offer.
- **Title** — a short title, one that fills a line, and one that wraps, since
  wrapping changes the heading's height and the pinned block's threshold.
- **Pane** — 380, 560, and 760 pixels wide.
- **Surface** — white (default) or dark.
- **Float**, **Reduced motion**, **Goal line**, **Workstream line** — each state
  on its own, so a change can be isolated to one of them.
- **Scroll** — jump to the top of the thread, to two pixels either side of the
  pinned threshold, or to the newest message.

The readout beside the pane reports what the geometry works out to: the body
font size the heading scales with, the heading's height and title line count,
its exit distance, how far the timeline is from the newest message, the stepped
progress, the drawn plate and its edge, the feather length, and the scroll
padding the heading reserves.

## Keeping it honest

`index.html` holds two things: the shipped CSS rules, copied verbatim from
`src/app/styles.css`, and a JavaScript port of `src/app/goalHeading.ts` plus the
inline style arithmetic in `src/app/StickyGoalHeader.tsx`. A test in
`tests/prototypes/heading-lab.test.ts` fails when the copied CSS drifts from the
shipped rules, and the port is small enough to re-read when `goalHeading.ts`
changes:

- `eyebrowMetrics`, `headingHeight`, `titleExitDistance`
- `headingScrollLimit`, `headingScroll`, `headingFade`, `headingOpacity`,
  `headingBackdropOpacity`, `plateFadeScale`, `pinnedTitleScale`
- `compactBlock`, `pinnedHeight`, `pinnedEdge`, `pinnedStep`, `titleBarSlot`

This directory is a lab, not a product surface: nothing here ships, and the page
is the place to look at a change to the heading's geometry or its edges before
making one.
