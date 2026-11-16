---
name: measuring-performance
description: >
  Measure bb and Workstreams performance, and prove a change is faster: live-app
  CDP counters and traces, React Profiler commits, frame strips, real-scale
  fixtures, and server pass and payload benchmarks. Use when something is slow,
  laggy, or janky; when asked to profile, benchmark, or investigate latency,
  frame drops, layout cost, or a large state payload; and after changing
  renderer, layout, animation, or plugin server code.
---

# Measuring performance

Every speedup claim rests on a re-measured user-facing number. Reduce the work,
then measure the metric the user feels. A smaller call count, probe count, or
commit count reports work removed; the interaction got faster only when the
latency the user feels moves with it.

## Order of evidence

Reach for the cheapest instrument that answers the question, and stop there.

1. The app's own instrumentation: server performance diagnostics, turn and
   stream traces, browser `performance.mark` entries, opt-in benchmarks.
2. The live app with one thing switched off, measured with CDP.
3. An isolated page driving the real component against production CSS.
4. A synthetic benchmark against real-scale data.

Level 1 reports the mechanism and needs no harness. Levels 3 and 4 trade fidelity
for repeatability, so label their numbers as fixture numbers in the report.

## Name the metric first

Write down the metric, its definition, the sample count, and warm versus cold
before the first measurement. Otherwise two runs measure two different things.

| Symptom | Metric |
| --- | --- |
| Sidebar slow to appear or update | Next-frame content readiness after the click; `TaskDuration` |
| Typing feels slow | Input-event to paint latency, plus long tasks over 16 ms |
| Thread switch slow | Click to first pixel-identical transcript frame |
| Jank while scrolling | p95 frame time, long tasks, layout and paint per frame |
| Idle CPU | Style recalcs and paints per second at rest |
| Slow server pass | Wall time per pass, SQLite statements and rows, RPC counts |
| Growing snapshot | Bytes serialized for one `state` read, plus parse and serialize time |

## Use the app's instrumentation first

bb ships measurement for the paths the plugin exercises. These commands run in
the bb checkout (`~/Code/Repos/bb/main`), where `docs/debugging-and-qa.md`
documents each one.

- Server performance diagnostics, behind a startup permission and the **Server
  performance diagnostics** experiment: logs DB operations ≥ 25 ms, API requests
  ≥ 100 ms, event-loop stalls ≥ 100 ms, a 5 s sample of CPU, loop delay, GC and
  memory, and a V8 CPU profile every 30 s under `$BB_DATA_DIR/logs/performance/`.
- Turn traces and stream traces: send-path spans, daemon spans, first-output
  timing, chunk cadence, and timeline push bytes and build time.
- Browser marks: `bb:timeline-applied` per thread with `source` of `fetch`,
  `fetch-delta`, `push`, or `push-delta`.
- `pnpm seed:perf` for a real-scale fixture: ~1,200 threads and ~400k event rows.
  It refuses to touch `~/.bb`; `--reset --events 400000` restarts it.
- `pnpm exec turbo run bench` for opt-in benchmarks, with
  `BB_SIDEBAR_BENCH_THREADS` and `BB_SIDEBAR_BENCH_OUT` on `@bb/app`.

## Switch one thing off

A/B the suspect itself: pause the animation, stop the one style write, drop the
one observer, or substitute one component. Adding a candidate fix while
measuring changes two variables.

Keep the page, thread, window size, and plugin build fixed. Alternate baseline
and candidate runs and take medians; a single before/after pair measures machine
load as often as it measures code. Measure warm and cold separately, since a
warm switch skips fetches and mounts.

## CDP recipe

`scripts/profile-sidebar.mjs` and `scripts/profile-shimmer.mjs` are working
examples: Playwright drives a page, a CDP session enables `Performance` and
`Tracing`, and the run reports both. Drive the live app with `bb
browser-automation` or `playwright-core`, a devDependency here; both give a CDP
session.

- Counters: `Performance.getMetrics` before and after the interaction, subtracted
  — `TaskDuration`, `LayoutDuration`, `RecalcStyleDuration`, `LayoutCount`,
  `RecalcStyleCount`.
- Traces: `Tracing.start` with `devtools.timeline`, then count and sum
  `UpdateLayoutTree`, `Layout`, and `Paint`.
- React: `react-dom/profiling` with a `React.Profiler` wrapper records commit
  counts, mount versus update commits, and actual and base durations.
- Frames: `Page.startScreencast` at 60 fps, saved per frame, plus an in-page
  `requestAnimationFrame` sampler for ground truth. Screencast frames show what
  the page presented; a repaint claim comes from the trace's `Paint` events.

Units differ inside one report: `Performance.getMetrics` durations are seconds
and a trace event's `dur` is microseconds. Convert once, label every column, and
keep raw per-run values next to the medians.

## Attribute the read to a site

A geometry read that pays for pending layout is not removable time. Instrument
each read site with a count, a duration, and its stack, and show where the cost
sits before and after. Cost that moves from a row ref to a parent effect while
end-to-end latency holds is attribution, and belongs in the report as such.

A commit count misses work when a portal, row menu, or provider sits outside the
memo boundary. Record profiler duration with the commit counts, and run one arm
on real time: a frozen `Date` hides minute-driven invalidation.

## Fixture versus app

The live app decides. A substitute mounted in a test, a lighter renderer, or a
jsdom tree skips part of what the live card pays for: the surrounding document,
the real Markdown renderer, and the mask or overlay the app applies. When a
fixture and the app disagree, report both and name the gap between them.

## Server passes and payloads

Benchmark against a copy of the live database and never open the live one for
writing: copy `~/.bb/bb.db` to `/tmp`, then drive the plugin server with a fake
in-memory SDK that returns stored rows.

Report wall time per pass across at least three runs, the SQLite statements and
rows each pass touches, and the RPC calls it makes. For payloads, measure the
bytes one `state` read serializes plus the build, serialize, and parse time.

Costs here scale with history, so state the data scale you measured at: roots,
topics, subjects, recaps, lifetime threads. A pass that reads a table which grows
with history takes milliseconds on a new database and seconds once that table
holds thousands of rows.

## Verify end to end

Re-measure the metric from "Name the metric first" against the reloaded build,
and record the asset or bundle hash you measured. State whether the number came
from the live app or a fixture, and how many samples it rests on.

Say when a result lands inside noise. Task duration under load moves by several
percent between runs; a 2% task-time gain with unchanged click-to-content is
measurement noise.

## Record conditions

Every recorded run needs the machine load average, the builds and tests running
concurrently, the asset hash, the commit, the sample count, and warm versus
cold. Note what you did not measure, in the report, in the same place as the
numbers.

Write baselines, traces, and screenshots under thread storage or `/tmp`. The
repository is public, and a trace of the app shows local file paths, thread
titles, and message text. Commit the harness that regenerates them.

Shell working directories persist across tool calls in an agent session, and a
build or test invoked without `cd` silently runs somewhere else. Print `pwd` and
`git rev-parse HEAD` inside every recorded log, and check the report paths belong
to the checkout you meant to verify.

## Footguns

- `scrollTop = 0` does not scroll a bottom-pinned timeline. Print start, end, and
  max scroll for every scroll scenario and confirm it moved.
- `prefers-reduced-motion`, dark and light, and narrow widths select different
  code. Measure the mode the user reported.
- A desktop trace API can be restricted inside an automation session. Fall back
  to in-page `performance` events around the handler and say the run has no CPU
  trace.
- Cross-realm values defeat identity checks: `structuredClone` or a JSON round
  trip makes every object new, so structural sharing looks broken. Measure with
  values from the realm the app uses.
- `contain`, `will-change`, and `content-visibility` are hypotheses about a
  measured cost. Keep each one only with its own before/after on the same
  fixture.
- A concurrent build, full test run, or plugin reload invalidates a timing
  window. Coordinate the window, and re-record the asset hash afterwards.
- A reduced call count with no matching user-facing gain leaves the interaction
  where it was; report those numbers as work removed.

## Turn a finding into a regression test

Assert the observable: CDP counters inside a browser test (`LayoutCount`,
`RecalcStyleCount`, `UpdateLayoutTree` and `Paint` counts), bytes on the wire, or
`React.Profiler` durations. Derive expected values from the browser or from a
hand-written literal, never from the same helper the component uses to compute
them.

Existing examples to extend: `tests/app/sidebar-performance.test.tsx`,
`typing-performance.test.tsx`, `client-performance.test.tsx`,
`status-mark-compositing.test.ts`, `up-next-compositing.test.ts`. A compositor
claim needs a paint or layer assertion alongside the transform assertion.

## Report shape

One table with `Scenario`, `Before`, `After`, `Method`, and `Samples`; one row
per scenario, the method naming CDP, React Profiler, trace, fixture, or synthetic
benchmark. Below it, the unmeasured surfaces and the data scale. Then the
re-measured user-facing metric, or an explicit statement that it did not move.
