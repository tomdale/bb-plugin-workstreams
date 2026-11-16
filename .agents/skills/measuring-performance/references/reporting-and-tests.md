# Reporting and regression tests

Report a performance result, store its artifacts, and turn it into a regression
test.

Report one table of Scenario, Before, After, Method (the instrument, and live
app or fixture), and Samples. Then give the unmeasured surfaces, the data scale,
the bundle hash and commit you measured, the load average, and the re-measured
user-facing metric, or an explicit statement that it did not move.

Write baselines, traces, and screenshots under thread storage or `/tmp`: this
repository is public, and a trace of the app shows local file paths, thread
titles, and message text. Commit the harness that regenerates a result.

`tests/app/browser-fixture.ts` exports `browserTest` and `browserUnavailable`;
open a browser test with `browserTest.skipIf(browserUnavailable)(...)` so it
skips where Chrome is missing. Assert CDP counters in a browser test, bytes on
the wire, or profiler durations. Derive expected values from the browser or a
literal. A test that computes its expectation with the component's own helper
passes through a curve bug. A zero-count assertion needs a positive control, or
a renamed class passes it. A compositor claim needs a paint or `LayerTree`
assertion alongside the transform, taken through playwright, since the desktop
backend forwards neither.

Browser counters live in `tests/app/status-mark-compositing.test.ts` and
`up-next-compositing.test.ts`. Call counts live in
`sidebar-performance.test.tsx`, `typing-performance.test.tsx`,
`client-performance.test.tsx`, `home-performance.test.tsx`, and
`duplicate-request-performance.test.tsx`. `README.md` records that React
duration samples are diagnostic, so a call count guards work removed and makes
no timing claim.
