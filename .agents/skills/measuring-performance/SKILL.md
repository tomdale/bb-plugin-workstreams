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

A smaller call count, probe count, or commit count reports work removed. Credit
a speedup when the user-facing latency moves with it, and estimate the work's
share of that latency first: work inside 3% of it buys 3% at best.

## Order of evidence

1. bb's own instrumentation: performance diagnostics, turn and stream traces,
   browser marks, opt-in benchmarks.
2. The live app with one thing switched off, measured through CDP.
3. A headless page driving the real component against production CSS.
4. A synthetic benchmark against real-scale data.

Use the cheapest level that answers the question: level 1 needs no harness, and
each level below it trades fidelity for repeatability. Levels 3 and 4 report as
fixture numbers. The live app decides: a substitute mounted in a test, a lighter
renderer, or a jsdom tree skips the surrounding document, the real Markdown
renderer, and the overlay the app applies. When a fixture and the app disagree,
report both numbers and name the gap.

## Name the metric first

Write down the metric, its definition, the sample count, and whether the run is
cold, meaning the first interaction after a reload, before the first measurement.

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
`docs/debugging-and-qa.md` documents each one.

- Server diagnostics, turn traces, stream traces, and browser marks enable after
  a restart with `BB_PERF_DIAGNOSTICS=1` or `--perf-diagnostics`, and the
  `performanceDiagnostics` experiment turned on. `pnpm dev` takes only the
  environment variable; the flag belongs to `pnpm start`, `pnpm start:worktree`,
  and `bb-app`.
- Server diagnostics log DB operations at 25 ms and above, API requests at
  100 ms, event-loop stalls at 100 ms, a 5 s CPU/loop/GC/memory sample, and a V8
  CPU profile every 30 s under `$BB_DATA_DIR/logs/performance/`. The slow-query
  lines cover bb's `bb.db`; a plugin's own database shows up only inside
  `Event loop stall attribution` under `plugin:<id>` and in the profile stacks.
- Turn traces and stream traces measure the send path: server and daemon spans,
  first-output timing, chunk cadence, and timeline push bytes and build time.
- Browser marks: `bb:timeline-applied` per thread with `source` of `fetch`,
  `fetch-delta`, `push`, or `push-delta`, and `bb:stream-row-commit`.
- `pnpm seed:perf -- --reset --events 400000` rebuilds bb's dev database at
  ~1,200 threads and ~400k event rows after one `pnpm dev` run, and refuses to
  touch `~/.bb`. It seeds bb's tables only; the plugin's tables keep their own
  rows.
- `pnpm exec turbo run bench` runs the opt-in benchmarks, and
  `BB_SIDEBAR_BENCH_THREADS` with `BB_SIDEBAR_BENCH_OUT` shape the `@bb/app`
  thread-list benchmark, which mounts `bb-plugin-thread-list`.

## Know which build you measured

The daily app loads Workstreams from the canonical checkout, which `bb plugin
list` reports as `source: path:`. A task worktree's change reaches it after the
canonical integration, rebuild, and `bb plugin reload` that
`personal-repo-lifecycle` describes; before that, numbers come from the gallery
fixture, a browser test, or a throwaway BB server built the way
`scripts/bb-plugin-smoke` does, labeled as pre-deploy. A live-app claim needs a
live measurement of the daily app after the reload.

The server serves plugin assets from a content hash. `GET /api/v1/plugins`
reports `bundle.hash` for `workstreams`, and the page loads
`/api/v1/plugin-app-assets/<hash>/app.js` with a `<link
data-bb-plugin-css="workstreams">`. Read that hash, or the matching resource
entries, from the page you measured, record `git rev-parse HEAD` and
`shasum -a 256 dist/app.js dist/app.css dist/server.js dist/host.js` from the
checkout you edited, and confirm the hash moves when you rebuild and reload that
checkout: an unchanged hash means the page still serves the earlier build. Give every build and test its own `cd` or an absolute path: each
bash call starts in the thread's directory, so a build without one runs in the
thread's environment instead of the checkout you edited.

## Switch one thing off

A/B the suspect itself: pause the animation, stop the one style write, or drop
the one observer. Add no candidate fix during the measurement, because a second change confounds
the comparison, and measure cold and warm separately.

## Sample so the difference is real

Hold the page, thread, window size, and build fixed across arms. Run the
baseline against itself first, with the same harness and sample count, and treat
a difference inside that spread as no change. Alternate the arms within one
session; a stored baseline from another day compares two experiments. Take at
least ten samples per arm for a duration, discard the first as warm-up, and
report the median with the minimum and maximum. A p95 needs 100 samples, and
below that report the maximum. Counts (layouts, commits, statements, bytes) are
deterministic, so two agreeing runs per arm suffice. Record the one-minute load
average with each timed sample, as `scripts/benchmark-tests.mjs` does, and rerun
any pair taken under different load.

## CDP recipe

`npm run profile:shimmer -- --baseline <styles.css>` alternates two stylesheets
in one session (`scripts/profile-shimmer.mjs`). `scripts/profile-sidebar.mjs` builds
`gallery/sidebar-profile` with 64 rows, runs `--runs` samples, and compares them
against a saved report when given `--baseline <sidebar.json>`. `prototypes/queue-motion/capture/record.mjs`
captures screencast frames. To measure the running app, open `$BB_SERVER_URL` in
`playwright-core`, a devDependency here: that page is a second client of the live
server, and the report labels it as one. A `bb browser-automation` session runs a
subprocess per call and keeps a preview screencast attached, and its desktop
backend forwards neither `Tracing` nor `Profiler`; take traces through playwright
or a local headless session.

- Counters: `Performance.getMetrics` before and after, subtracted —
  `TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`,
  `LayoutCount`, `RecalcStyleCount`. Read "after" once work has settled, two
  animation frames past the last DOM change, over the same window length in both
  arms, and lengthen the window until timers, idle callbacks, and transitions
  settle.
- Traces: `Tracing.start` with `devtools.timeline`, then count and sum complete
  (`ph: "X"`) `UpdateLayoutTree`, `Layout`, and `Paint` events. Add
  `disabled-by-default-devtools.timeline.stack` for the stack behind each forced
  layout, `disabled-by-default-devtools.timeline.invalidationTracking` for
  selector-driven recalculations that carry no JavaScript stack, and
  `disabled-by-default-v8.cpu_profiler` for script self time.
- Frames: `Page.startScreencast` emits a frame only when the picture changes and
  paces by `everyNthFrame`, with a `Page.screencastFrameAck` per frame. Pair it
  with an in-page `requestAnimationFrame` sampler, take a repaint claim from the
  trace's `Paint` events, and sample per frame on a thread switch, where the
  aggregate window hides a transcript that paints before its heading.
- React: commits and durations exist on a profiling or development build, which
  means `gallery/sidebar-profile` and the jsdom tests. The live app runs the
  host's production React, where `Profiler.onRender` never fires, so zero commits
  there means the instrument is missing; report that in place of a zero.

Units differ inside one report: `Performance.getMetrics` durations are seconds
and a trace event's `dur` is microseconds. Convert in one place, label each
column with its unit, and keep the raw per-run values beside the medians.

## Attribute the read to a site

A read that pays for pending layout is not removable time. Instrument each read
site with a count, a duration, and its stack, and show where the cost sits before
and after. Cost that moves from a row ref to a parent effect while end-to-end
latency holds is attribution, and the report files it there.

A commit count misses work when a portal, row menu, or provider sits outside the
memo boundary. Record the mount and update commits with their actual and base
durations, and run one arm on real time: a frozen `Date` hides minute-driven
invalidation.

## Server passes and payloads

Workstreams keeps its tables in `~/.bb/plugins/workstreams/data.db`; thread and
event rows live in `~/.bb/bb.db`. The running app writes both as WAL databases,
so snapshot them through SQLite and never open the originals for writing:

```
sqlite3 -readonly ~/.bb/plugins/workstreams/data.db ".backup '/tmp/ws-data.db'"
sqlite3 -readonly ~/.bb/bb.db ".backup '/tmp/ws-bb.db'"
```

Build the host with `createFakePluginHost` from `@get-bb/plugin-sdk/testing`,
close `host.bb.storage.database()`, copy the snapshot over `db.name` with any
`-wal` and `-shm` removed, then call `await plugin(host.bb)`. Stub SDK reads the
way `tests/server/fake-bb.ts` does. `createTestPluginHost` and `fakeWorld` set
`pragma("synchronous = OFF")`, which hides commit cost, so keep them for behavior
tests.

Wrap `db.prepare` (`all`, `get`, `run`) and `db.exec` on
`host.bb.storage.database()` to count statements and rows, and run
`EXPLAIN QUERY PLAN` against the snapshot for any statement whose cost grows with
history.

Report per pass, over at least ten runs after one discarded warm-up: wall time,
the longest synchronous stretch, statements and rows, and SDK calls. Time that
stretch with `performance.now()` around the body before the first `await` and
inside `async_hooks.createHook({ before, after })`; `monitorEventLoopDelay`
reports nanoseconds and discards the interval before the first timer tick after
`reset()`. Plugin server code runs on the BB server's main thread, so that
stretch stalls every API request, and wall time can fall while the stretch grows.
The fake host answers SDK and model calls instantly: say the number excludes
them, and take model latency from `bb workstreams trace` and `eval/README.md`.

For payloads, measure bytes, build, serialize, and parse time for one `state`
read, which happens on first load and on reconnect, and measure the same for the
`stateSlices`, `recap_get`, and `question_at` reads one action or one server
event causes, alongside the `changed` signals it publishes and their scope:
slice, thread, or whole snapshot.

Costs scale with history, so state the scale: roots, topics, and row counts of
the tables the pass reads. Delete the snapshots when done; they copy real thread,
topic, and recap data and run to gigabytes.

## Verify and record

Report one table of Scenario, Before, After, Method, and Samples, with Method
naming the instrument and whether the run was the live app or a fixture, then the
unmeasured surfaces, the data scale, the bundle hash and commit you measured, the
load average, and the re-measured user-facing metric, or an explicit statement
that it did not move.

Write baselines, traces, and screenshots under thread storage or `/tmp`: this
repository is public, and a trace of the app shows local file paths, thread
titles, and message text. Commit the harness that regenerates a result.

## Footguns

- `scrollTop = 0` does not scroll a bottom-pinned timeline. Print start, end, and
  max scroll for every scroll scenario, and confirm it moved.
- Measure the mode the user reported: `prefers-reduced-motion`, dark versus
  light, and narrow widths select different code.
- The measuring thread is itself a working row that streams into its own
  transcript, and an occluded window throttles `requestAnimationFrame`. Measure
  from a separate thread or a second client, on a visible window.
- Compare like with like: `structuredClone` or a JSON round trip makes every
  object new, so structural sharing looks broken. The app receives a fresh JSON
  tree on every read, and the tests clone on purpose.
- Keep `contain`, `will-change`, or `content-visibility` only when its own
  before/after on the same fixture shows a win.
- Discard samples taken during a concurrent build, full test run, or plugin
  reload, rerun them, and check the bundle hash afterwards.

## Turn a finding into a regression test

`tests/app/browser-fixture.ts` provides `browserTest`, which skips when Chrome is
absent. Assert CDP counters in a browser test, bytes on the wire, or profiler
durations, and derive expected values from the browser or a literal, because a
test that reuses the component's own helper stays green through a curve bug. A
zero-count assertion needs a positive control, or a renamed class passes it. A
compositor claim needs a paint or `LayerTree` assertion alongside the transform,
taken through playwright, since the desktop backend forwards neither.

Browser counters live in `tests/app/status-mark-compositing.test.ts` and
`up-next-compositing.test.ts`. Call counts live in `sidebar-performance.test.tsx`,
`typing-performance.test.tsx`, `client-performance.test.tsx`,
`home-performance.test.tsx`, and `duplicate-request-performance.test.tsx`.
`README.md` records that React duration samples are diagnostic, so a call count
guards work removed and makes no timing claim.
