---
name: measuring-performance
description: >
  Measure bb and Workstreams performance, and prove a change is faster: CDP
  counters and traces, profiler commits, frame capture, real-scale fixtures, and
  server pass and payload benchmarks. Use when something is slow, laggy, or
  janky; when asked to profile, benchmark, or investigate latency, frame drops,
  layout cost, or a large state payload; and after changing renderer, layout,
  animation, or plugin server code.
---

# Measuring performance

Every speedup claim rests on a re-measured user-facing number. Reduce the work,
then measure the metric the user feels. A smaller call count, probe count, or
commit count reports work removed; the interaction got faster when the latency
the user feels moves with it.

## Order of evidence

Reach for the cheapest instrument that answers the question and stop at the
first one that settles it.

1. bb's own instrumentation: performance diagnostics, turn and stream traces,
   browser marks, opt-in benchmarks.
2. The live app with one thing switched off, measured through CDP.
3. A headless page driving the real component against production CSS.
4. A synthetic benchmark against real-scale data.

Level 1 reports a mechanism, and its diagnostics enable on a server restart.
Levels 3 and 4 trade fidelity for repeatability, so their numbers are fixture
numbers in the report.
The live app decides: a substitute mounted in a test, a lighter renderer, or a
jsdom tree skips part of what the real surface pays for, including the
surrounding document, the real Markdown renderer, and the overlay the app
applies. When a fixture and the app disagree, report both and name the gap.

## Name the metric first

Write the metric, its definition, the sample count, and warm versus cold before
the first measurement.

| Symptom | Metric |
| --- | --- |
| Sidebar slow to appear or update | Next-frame content readiness after the click; `TaskDuration` |
| Typing feels slow | Input-to-paint latency above 16 ms (Event Timing); long tasks at 50 ms |
| Thread switch slow | Click to the frame where the new transcript has settled |
| Jank while scrolling | p95 frame time; `long-animation-frame` entries |
| Idle CPU | Style recalcs and paints per second at rest, plus process CPU |
| Slow server pass | Wall time, longest synchronous stretch, statements and rows, SDK calls |
| Growing snapshot | Bytes for one `state` read, plus build, serialize, and parse time |

## Use bb's instrumentation first

These run in the bb checkout (`~/Code/Repos/bb/main`), where
`docs/debugging-and-qa.md` documents each one. Enable the diagnostics, traces,
and marks in the first three bullets by restarting the server with
`BB_PERF_DIAGNOSTICS=1` or `--perf-diagnostics` and turning on the **Server
performance diagnostics** experiment. The seeder and the benchmarks need only
their own command.

- Server diagnostics log DB operations at 25 ms and above, API requests at
  100 ms, event-loop stalls at 100 ms, a 5 s CPU/loop/GC/memory sample, and a V8
  CPU profile every 30 s under `$BB_DATA_DIR/logs/performance/`. Event-loop
  stall attribution totals sampled time per `plugin:<id>`.
- Turn traces and stream traces measure the send path: server and daemon spans,
  first-output timing, chunk cadence, and timeline push bytes and build time.
- Browser marks: `bb:timeline-applied` per thread with `source` of `fetch`,
  `fetch-delta`, `push`, or `push-delta`, and `bb:stream-row-commit`.
- `pnpm seed:perf -- --reset --events 400000` rebuilds bb's dev database at
  ~1,200 threads and ~400k event rows after one `pnpm dev` run, and refuses to
  touch `~/.bb`. It seeds bb's tables only, so a seeded run measures bb's scale
  and leaves the plugin's own tables empty; measure plugin scale with the
  snapshots in "Server passes and payloads".
- `pnpm exec turbo run bench` runs the opt-in benchmarks; `BB_SIDEBAR_BENCH_OUT`
  and `BB_SIDEBAR_BENCH_THREADS` apply to `@bb/app`.

## Know which build you measured

The daily app loads Workstreams from the canonical checkout, which `bb plugin
list` reports as `source: path:`. A task worktree's change reaches the daily app
after the canonical integration, rebuild, and reload that
`personal-repo-lifecycle` describes. The numbers before that step come from the
gallery fixture, a browser test, or a throwaway BB server set up the way
`scripts/bb-plugin-smoke` does, labeled as pre-deploy. A claim about the live app
needs a live measurement after the reload.

For every arm, write down the working directory, `git rev-parse HEAD`, and
`shasum -a 256 dist/app.js dist/app.css dist/server.js`, taken from the checkout
the app loads. The file names never change between builds, so compare the digests
before crediting a difference to code. Then confirm the measured page runs the
candidate by finding one marker only it emits: a `performance.mark`, a DOM
attribute, or a log line. A `cd` inside one tool call ends with that call, so give
every build and test its own `cd` or an absolute path; otherwise it runs in the
thread's default checkout.

## Switch one thing off

A/B the suspect itself: pause the animation, stop the one style write, drop the
one observer, or substitute one component. Adding a candidate fix while
measuring changes two variables. Measure cold, the first interaction after a
reload, separately from warm.

## Sample so the difference is real

Keep the page, thread, window size, and build fixed. Run the baseline against
itself first with the same harness and sample count: that spread is the noise
floor, and a difference inside it is no change. Alternate arms in one session
(A B A B); a baseline captured another day, under another load, or in another
Chrome is a different experiment. Take at least ten samples per arm for a
duration, discard the first as warm-up, and report the median with the minimum
and maximum. A p95 needs 100 samples; below that, report the maximum.

Counts (layouts, commits, statements, bytes) are deterministic, so two agreeing
runs per arm suffice, and they are the numbers to trust on a busy machine.
Record the one-minute load average with every timed sample, as
`scripts/benchmark-tests.mjs` does, and rerun any pair taken under different
load.

## CDP recipe

The examples in this repository drive headless Chrome on fixtures:
`scripts/profile-shimmer.mjs` (`npm run profile:shimmer`, which alternates a
baseline stylesheet with the current one), `scripts/profile-sidebar.mjs`
(`--runs`, `--baseline`, `--output-dir`; builds `gallery/sidebar-profile` with 64
rows), and `prototypes/queue-motion/capture/record.mjs` for screencast frames. To
measure the running app, open `$BB_SERVER_URL` in a browser you control with
`playwright-core`, a devDependency here. That page is a second client of the live
server, with its own Chromium, viewport, and cold caches; label its numbers as a
second client.

- Counters: `Performance.getMetrics` before and after, subtracted —
  `TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`,
  `LayoutCount`, `RecalcStyleCount`. Read "after" once work has settled, two
  animation frames past the last DOM change, over the same window length in both
  arms. Work that a timer, idle callback, or transition defers past the window
  has moved, so lengthen the window until both arms go quiet.
- Traces: `Tracing.start` with `devtools.timeline`, then count and sum complete
  (`ph: "X"`) `UpdateLayoutTree`, `Layout`, and `Paint` events. Add
  `disabled-by-default-devtools.timeline.stack` for the stack behind each forced
  layout and `disabled-by-default-v8.cpu_profiler` for script self time. A
  desktop `bb browser-automation` session forwards a fixed domain list without
  `Tracing` or `Profiler`, so take a trace through playwright or a local headless
  session.
- Frames: `Page.startScreencast` emits a frame only when the picture changes and
  paces by `everyNthFrame`, with a `Page.screencastFrameAck` per frame. Pair it
  with an in-page `requestAnimationFrame` sampler, and take a repaint claim from
  the trace's `Paint` events.
- React: commits and durations exist on a profiling or development build, which
  means `gallery/sidebar-profile` and the jsdom tests. The live app runs the
  host's production React, where `Profiler.onRender` never fires, so zero commits
  there means the instrument is missing; report that in place of a zero.

Units differ inside one report: `Performance.getMetrics` durations are seconds
and a trace event's `dur` is microseconds. Convert in one place, label each
column with its unit, and keep the raw per-run values beside the medians.

## Attribute the read to a site

A geometry read that pays for pending layout is not removable time. Instrument
each read site with a count, a duration, and its stack, and show where the cost
sits before and after. Cost that moves from a row ref to a parent effect while
end-to-end latency holds is attribution, and the report files it there.

A commit count misses work when a portal, row menu, or provider sits outside the
memo boundary. Record the mount and update commit counts with their actual
and base durations, and run one arm on real time: a frozen `Date` hides
minute-driven invalidation.

## Server passes and payloads

Workstreams keeps its tables in `~/.bb/plugins/workstreams/data.db`; thread and
event rows live in `~/.bb/bb.db`, several gigabytes on a working machine. The
running app writes both as WAL databases, so snapshot them through SQLite and
never open the originals for writing:

```
sqlite3 -readonly ~/.bb/plugins/workstreams/data.db ".backup '/tmp/ws-data.db'"
sqlite3 -readonly ~/.bb/bb.db ".backup '/tmp/ws-bb.db'"
```

Load the plugin on `createFakePluginHost` from `@get-bb/plugin-sdk/testing`;
`tests/server/test-host.ts` shows how to replace its database file with a
snapshot, and `tests/server/fake-bb.ts` how to answer SDK reads. Leave
`synchronous` at its default, because the test host turns it off and hides
commit cost.

Report per pass, over at least ten runs after one discarded warm-up: wall time,
the longest synchronous stretch (`perf_hooks.monitorEventLoopDelay` maximum),
SQLite statements and rows, and SDK calls. Plugin server code runs on the BB
server's main thread, so that stretch stalls every API request for its duration,
and wall time can fall while the stretch grows. The fake host answers SDK and
model calls instantly: say the number excludes them, and take model latency from
`bb workstreams trace` and `eval/README.md`.

For payloads, measure bytes, build, serialize, and parse time for one `state`
read, which happens on first load and on reconnect, and for the `stateSlices`
reads one user action causes. Count the reads per action.

Costs scale with history, so state the scale: roots, topics, and row counts of
the tables the pass reads. Delete the snapshots when done: they copy real thread,
topic, and recap data and run to gigabytes.

## Verify and record

Re-measure the metric from "Name the metric first" on the build you deployed,
using the digest from "Know which build you measured". Report the before and
after medians, the spread, the sample count, whether the number came from the
live app or a fixture, and what went unmeasured. A result inside the noise floor
counts as no change, whatever the mechanism explains.

Record the load average, the builds and tests running concurrently, the commit
and digest, and warm versus cold with every run. Write baselines,
traces, and screenshots under thread storage or `/tmp`: this repository is
public, and a trace of the app shows local file paths, thread titles, and message
text. Commit the harness that regenerates a result, so the next person can rerun
it.

## Footguns

- `scrollTop = 0` does not scroll a bottom-pinned timeline. Print start, end, and
  max scroll for every scroll scenario and confirm it moved.
- `prefers-reduced-motion`, dark and light, and narrow widths select different
  code. Measure the mode the user reported.
- The measuring thread is itself a working row that streams into its own
  transcript, and an occluded window throttles `requestAnimationFrame`. Measure
  from a separate thread or a second client, on a visible window.
- Cross-realm values defeat identity checks: `structuredClone` or a JSON round
  trip makes every object new, so structural sharing looks broken. The app
  receives a fresh JSON tree on every read, and tests clone on purpose, so
  compare like with like.
- `contain`, `will-change`, and `content-visibility` are hypotheses about a
  measured cost. Keep each one only with its own before/after on the same
  fixture.
- A concurrent build, full test run, or plugin reload invalidates a timing
  window. Coordinate the window, and record the digest again afterwards.
- Measure how much of the latency a change owns first: work responsible for 3%
  of the latency buys 3% at best.

## Turn a finding into a regression test

Assert the observable: CDP counters in a browser test, bytes on the wire, or
profiler durations. `tests/app/browser-fixture.ts` provides `browserTest`, which
skips when Chrome is absent. Derive expected values from the browser or from a
hand-written literal, never from the helper the component uses to compute them. A
zero-count assertion needs a positive control, or a renamed class passes it.

Browser counters live in `tests/app/status-mark-compositing.test.ts` and
`up-next-compositing.test.ts`; a compositor claim needs a paint or `LayerTree`
assertion alongside the transform assertion, or a transform-only test passes
while the element repaints. Call counts live in `sidebar-performance.test.tsx`,
`typing-performance.test.tsx`, `client-performance.test.tsx`,
`home-performance.test.tsx`, and `duplicate-request-performance.test.tsx`.
`README.md` records that React duration samples are diagnostic, so a call count
guards work removed and makes no timing claim.

## Report shape

One table with Scenario, Before, After, Method, and Samples, one row per
scenario; below it the unmeasured surfaces, the data scale, and the re-measured
user-facing metric or an explicit statement that it did not move.
