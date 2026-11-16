# Server passes and payloads

Measure a plugin server pass or state payload against snapshots of the real
databases.

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
`pragma("synchronous = OFF")`, which hides commit cost, so keep them for
behavior tests.

Wrap `db.prepare` (`all`, `get`, `run`) and `db.exec` on
`host.bb.storage.database()` to count statements and rows, and run
`EXPLAIN QUERY PLAN` against the snapshot for any statement whose cost grows
with history.

Report per pass, over at least ten runs after one discarded warm-up: wall time,
the longest synchronous stretch, statements and rows, and SDK calls. Time that
stretch with `performance.now()` around the body before the first `await` and
inside `async_hooks.createHook({ before, after })`; `monitorEventLoopDelay`
reports nanoseconds and discards the interval before the first timer tick after
`reset()`. Plugin server code runs on the BB server's main thread, so that
stretch stalls every API request, and wall time can fall while the stretch
grows. The fake host answers SDK and model calls instantly: say the number
excludes them, and take model latency from `bb workstreams trace` and
`eval/README.md`.

For payloads, measure bytes, build, serialize, and parse time for one `state`
read (first load and reconnect) and for the `stateSlices`, `recap_get`, and
`question_at` reads one action or server event causes, alongside the `changed`
signals it publishes and their scope: slice, thread, or whole snapshot.

Costs grow with history, so state roots, topics, and row counts of the tables
the pass reads. Delete the snapshots when done; they copy real thread, topic,
and recap data and run to gigabytes.
