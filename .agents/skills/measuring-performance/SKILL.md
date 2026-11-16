---
name: measuring-performance
description: >
  Measure bb and Workstreams performance, and prove a change is faster: CDP
  counters and traces, profiler commits, frame capture, real-scale fixtures, and
  server pass and payload benchmarks. Use when something is slow, laggy, or
  janky; when asked to profile, benchmark, or investigate latency, frame drops,
  layout cost, or a large state payload; after changing renderer, layout,
  animation, or plugin server code; and before claiming a speedup.
---

# Measuring performance

A smaller call count, probe count, or commit count reports work removed. Credit
a speedup when the user-facing latency moves with it, and estimate the work's
share of that latency first: work inside 3% of it buys 3% at best.

Prefer the cheapest evidence that answers the question:

1. bb's own instrumentation: performance diagnostics, turn and stream traces,
   browser marks, opt-in benchmarks.
2. The live app with one thing switched off, measured through CDP.
3. A headless page driving the real component against production CSS.
4. A synthetic benchmark against real-scale data.

Level 1 needs no harness, and each level below it trades fidelity for
repeatability. Levels 3 and 4 report as fixture numbers. The live app decides: a
substitute mounted in a test, a lighter renderer, or a jsdom tree skips the
surrounding document, the real Markdown renderer, and the overlay the app
applies. When a fixture and the app disagree, report both numbers and name the
gap.

First write down the metric, its definition, the sample count, and whether the
run is cold (the first interaction after a reload).

| Symptom                          | Metric                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Sidebar slow to appear or update | Next-frame content readiness after the click; `TaskDuration`           |
| Typing feels slow                | Input-to-paint latency above 16 ms (Event Timing); long tasks at 50 ms |
| Thread switch slow               | Click to the frame where the new transcript has settled                |
| Jank while scrolling             | p95 frame time; `long-animation-frame` entries                         |
| Idle CPU                         | Style recalcs and paints per second at rest, plus process CPU          |
| Slow server pass                 | Wall time, longest synchronous stretch, statements and rows, SDK calls |
| Growing snapshot                 | Bytes for one `state` read, plus build, serialize, and parse time      |

Switch off the suspect itself: pause the animation, stop the one style write, or
drop the one observer. Add no candidate fix while measuring, since a second
change confounds the comparison, and measure cold and warm separately. Hold the
page, thread, window size, and build fixed across arms.

Run the baseline against itself first, with the same harness and sample count; a
difference inside that spread is no change. Alternate the arms within one
session; a stored baseline from another day compares two experiments. For
durations, take at least ten samples per arm, discard the first as warm-up, and
report the median, minimum, and maximum. A p95 needs 100 samples; below that,
report the maximum. Counts (layouts, commits, statements, bytes) are
deterministic, so two agreeing runs per arm suffice. Record the one-minute load
average with each timed sample, as `scripts/benchmark-tests.mjs` does, and rerun
any pair taken under different load.

| Reference                           | Read when                                                             |
| ----------------------------------- | --------------------------------------------------------------------- |
| `references/bb-instrumentation.md`  | Level 1: bb diagnostics, traces, browser marks, perf seed, benchmarks |
| `references/builds-and-fixtures.md` | Before the first sample: which build is live, fixtures versus the app |
| `references/browser-cdp.md`         | Measuring a page: counters, traces, frames, React commits, read sites |
| `references/server-passes.md`       | Measuring a plugin server pass or state payload                       |
| `references/reporting-and-tests.md` | Reporting results, storing artifacts, writing regression tests        |
