# Browser measurement

Measure a page through CDP: script, style, layout, paint, frames, React commits,
and read-site attribution.

Harnesses: `npm run profile:shimmer -- --baseline <styles.css>` alternates two
stylesheets in one session (`scripts/profile-shimmer.mjs`).
`scripts/profile-sidebar.mjs` builds `gallery/sidebar-profile` with 64 rows,
runs `--runs` samples (default 3, at most 20, so pass ten or more for a
duration), and compares them against a saved `--baseline <sidebar.json>` report.
Its five scenarios are `initial-render`, `hover`, `expand-collapse`,
`animation`, and `react-commits`, and it mounts a build that imports
`react-dom/profiling`, so use its numbers for before/after deltas within one
build; a profiling React inflates their absolute values.
`prototypes/queue-motion/capture/record.mjs` captures screencast frames.

For the running app, open `$BB_SERVER_URL` in `playwright-core` (a devDependency
here) and report that page as a second client of the live server. A
`bb browser-automation` session runs a subprocess per call and keeps a preview
screencast attached, and its desktop backend forwards neither `Tracing` nor
`Profiler`: take traces through playwright or a local headless session. Measure
from a separate thread or a second client, on a visible window: the measuring
thread is itself a working row streaming into its own transcript, and an
occluded window throttles `requestAnimationFrame`. Measure the mode the user
reported; `prefers-reduced-motion`, dark versus light, and narrow widths select
different code.

Counters: `Performance.getMetrics` before and after, subtracted: `TaskDuration`,
`ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`, `LayoutCount`,
`RecalcStyleCount`. Read "after" once work has settled (two animation frames
past the last DOM change), over the same window length in both arms, lengthened
until timers, idle callbacks, and transitions settle.

Traces: `Tracing.start` with `devtools.timeline`, then count and sum complete
(`ph: "X"`) `UpdateLayoutTree`, `Layout`, and `Paint` events. Add
`disabled-by-default-devtools.timeline.stack` for the stack behind each forced
layout, `disabled-by-default-devtools.timeline.invalidationTracking` for
selector-driven recalculations that carry no JavaScript stack, and
`disabled-by-default-v8.cpu_profiler` for script self time.

Frames: `Page.startScreencast` emits a frame only when the picture changes and
paces by `everyNthFrame`, with a `Page.screencastFrameAck` per frame. Pair it
with an in-page `requestAnimationFrame` sampler, take a repaint claim from the
trace's `Paint` events, and sample per frame on a thread switch, where the
aggregate window hides a transcript that paints before its heading.

React: commits and durations exist only on a profiling or development build
(`gallery/sidebar-profile`, the jsdom tests). The live app runs the host's
production React, where `Profiler.onRender` never fires, so zero commits there
means the instrument is missing; report the missing instrument in place of a
zero. A commit count misses work when a portal, row menu, or provider sits
outside the memo boundary. Record mount and update commits with their actual and
base durations, and run one arm on real time: a frozen `Date` hides
minute-driven invalidation.

Units: `Performance.getMetrics` durations are seconds; a trace event's `dur` is
microseconds. Convert in one place, label each column's unit, and keep raw
per-run values beside the medians.

A read that pays for pending layout is not removable time. Instrument each read
site with a count, a duration, and its stack, and show where the cost sits
before and after. Cost that moves from a row ref to a parent effect while
end-to-end latency holds is attribution; report it as such.

`scrollTop = 0` does not scroll a bottom-pinned timeline; print start, end, and
max scroll for every scroll scenario, and confirm it moved. Keep `contain`,
`will-change`, or `content-visibility` only when its own before/after on the
same fixture shows a win.
