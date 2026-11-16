# bb instrumentation

Enable bb's built-in performance instrumentation in the bb checkout
(`~/Code/Repos/bb/main`); `docs/debugging-and-qa.md` documents each piece.

Server diagnostics, turn traces, stream traces, and browser marks enable after a
restart with `BB_PERF_DIAGNOSTICS=1` or `--perf-diagnostics`, plus the
`performanceDiagnostics` experiment on. `pnpm dev` takes only the environment
variable; the flag belongs to `pnpm start`, `pnpm start:worktree`, and `bb-app`.

Server diagnostics log DB operations at 25 ms and above, API requests at 100 ms,
event-loop stalls at 100 ms, a 5 s CPU/loop/GC/memory sample, and a V8 CPU
profile every 30 s under `$BB_DATA_DIR/logs/performance/`. Slow-query lines
cover bb's `bb.db`; a plugin's own database shows up only inside
`Event loop stall attribution` under `plugin:<id>` and in the profile stacks.

Turn and stream traces measure the send path: server and daemon spans,
first-output timing, chunk cadence, and timeline push bytes and build time.
Browser marks: `bb:timeline-applied` per thread with `source` of `fetch`,
`fetch-delta`, `push`, or `push-delta`, and `bb:stream-row-commit`.

`pnpm seed:perf -- --reset --events 400000`, after one `pnpm dev` run, rebuilds
bb's dev database at ~1,200 threads and ~400k event rows, and refuses to touch
`~/.bb`. It seeds bb's tables only; the plugin's tables keep their own rows.

`pnpm exec turbo run bench` runs the opt-in benchmarks;
`BB_SIDEBAR_BENCH_THREADS` and `BB_SIDEBAR_BENCH_OUT` shape the `@bb/app`
thread-list benchmark, which mounts `bb-plugin-thread-list`.
