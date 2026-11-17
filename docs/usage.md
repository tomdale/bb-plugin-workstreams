# Usage

How Workstreams accounts for what its model calls spend, finds spend that looks
wrong, and stops it. `README.md` covers the settings and the Usage page; this
file holds the rules behind them.

## Ledger

The ledger (`src/server/usage.ts`, table `ws_usage`) holds one row for every
attempt that may have spent provider money. Everything that can spend goes
through `UsageGate`: `admit` before the request, `record` after it ends.
`tests/server/usage-instrumentation.test.ts` lists every path to a provider and
fails when a new one appears.

A row is one attempt: a model call, a start repair retry (its own row), a replay
from the inspector, one enhanced-response composition (`calls` holds the number
of requests it made), a debug thread, or a recap reminder or waiting check sent
to a thread.

A row's status:

- `ok`: Workstreams used the answer. A composition that chose to add no document
  is `ok`.
- `invalid`: the model answered, but Workstreams could not use the answer. The
  provider still billed it.
- `failed`: the request failed or timed out.
- `aborted`: the caller stopped waiting while the request was in flight.
  Workstreams does not use an answer that arrives after that, so its row is
  `aborted` too.

A row's path:

- `gateway`: a direct AI Gateway completion, which reports tokens and cost.
- `worker`: a hidden BB worker thread, which reports neither.
- `presentation`: the composition loop on the analysis machine. Its cost is the
  sum of what its requests reported.
- `thread`: a message that starts a turn in a BB thread. BB reports neither
  tokens nor cost for it.

Cost is `null` when the provider reported none, never `0`, because zero would
say the call was free. Totals add the reported costs and count the other
requests as `unmetered`. A failed or aborted request keeps null tokens and cost:
the provider may have billed it, and nothing says how much. It still counts as a
request, so the requests-per-hour limit covers it. The exception is a
composition the analysis machine answered: its row keeps the requests, tokens,
and cost the machine reported, whether its status is `failed`, `invalid`, or
`aborted` because the caller had stopped waiting.

A request that was never sent leaves no row when the spend guard refused it,
when its signal was already aborted, or when the analysis machine turned a
composition away before it reached a model. A request the spend guard admitted
that fails before it leaves the BB server still leaves one `failed` row with no
cost. The usual cause is that no analysis machine is connected, so `failure-run`
can flag a missing analysis machine.

The ledger keeps rows for 90 days, at most 250,000 of them, and prunes at most
once a minute. It is separate from model traces because traces are a debug
record: retention drops them after 7 days or 1,000 calls, **Delete model
traces…** removes them, and recording can be off. None of that changes the
ledger. A row keeps a short digest of its prompt and its length, never the
prompt.

## Limits and caps

The spend guard (`src/server/spendGuard.ts`) reads four limits from the `usage`
preferences. Each has a warning threshold and a pause threshold (the cap), and a
blank threshold is off.

| Limit             | Window                    | Warn at | Pause at |
| ----------------- | ------------------------- | ------- | -------- |
| Last hour         | The last 60 minutes       | $3      | $10      |
| Today             | Since local midnight      | $10     | $30      |
| This month        | Since the 1st, local time | off     | off      |
| Requests per hour | The last 60 minutes       | 150     | 500      |

Normal use is about $5 a day and up to about 75 requests in a busy hour, and the
defaults are multiples of that. The day warns at twice a normal day and pauses
at six times one. The hour warns at more than half a normal day spent in one
hour and pauses at two normal days, which only a loop reaches. The requests
limit warns at twice a busy hour and pauses at more than six times one; it
exists because worker-thread and agent-thread calls report no cost, so a spend
limit never sees them. The month is off because the right figure depends on the
budget.

Spend limits add the costs providers reported. The requests limit counts every
request, reported cost or not. Reaching a threshold counts (`used >= cap`), so
the call that crosses a cap is the last one let through. Below a cap the guard
throttles and delays nothing.

A reached cap pauses every Workstreams model call: the Inference calls on both
the gateway and worker paths, enhanced-response composition, debug threads, and
recap reminders. Calls already in flight finish, and your agents' own turns
continue. Workstreams work that asks no model carries on too: moving threads
yourself, snoozes, a recap an agent reports, the organizer's layout pass,
pruning categories after a departure, and a composer draft that names its
workstream.

A refused call counts as never asked. It writes no trace, ledger row, Activity
entry, or failure, moves no thread, and leaves stored analysis, workstreams,
categories, and waiting suggestions as they were. It uses no retry attempt and
no reminder. An action you started (a replay, **Suggest changes**, a debug
thread, **Automatic**, a drop into a group) reports the pause instead. The
composer makes no new workstream suggestion during a pause, and its **Debug**
disclosure gives the reason.

A pause ends when the window resets, when you resume, or when the cap is raised
or turned off. While paused the guard looks again at the next local midnight or
month start, and every 60 seconds for the rolling hour, since spend leaves that
window continuously. **Resume** lets calls through past every cap reached at
that moment, each until its own window resets: the next local midnight for the
day, the next month start for the month, and one hour for the rolling hour and
for the requests limit. A resume belongs to one limit. A limit that was under
its cap at that moment still pauses calls when usage reaches it, the other limit
of the same window included: resuming the hour's spend does not resume requests
per hour. The guard stores each resume (`usage-resumes` in `ws_meta`, by limit),
so a restart does not end it. Warnings still show during one.

When a pause ends, Workstreams takes up what it deferred. The analyzer runs
every thread whose turn-end analysis or workstream choice the pause refused. The
analyzer defers a run whole: when a turn needed only the status its agent
reported and a workstream choice, the refused choice holds the reported status
back until the lift too. A pause that begins while **Automatic** is settling a
thread reports the pause, and the analyzer chooses the thread's workstream when
the pause lifts. The start call names running threads that still have no title.
The organizer runs a pass, which brings category checks and arrangements with
it, and the suggestions check asks for whatever is due. Workstreams does not
compose enhanced responses afterwards for messages that arrived during a pause.

Calls already in flight when a cap trips finish, so spend can overshoot a cap by
what those calls cost: at most four turn-end analyses plus a few others, at
about $0.01 to $0.05 each.

## Flags

`detectUsageFlags` (`src/domain/usageAlerts.ts`) reads the ledger rows of the
last 8 days and returns what looks wrong in them. `UsageMonitor` runs it while
**detectors** is on and serves one reading for 15 seconds. The monitor stores no
flags: the detector raises a flag while the rows behind it are inside its window
and stops when they age out. A flag's id is the kind plus its subject (a thread,
a source, a prompt hash), so the same finding keeps one id across readings.

Rules that hold for every detector:

- Evidence comes from the last 24 hours. A loop that ran overnight is still
  flagged in the morning, and no flag outlives its day. `spend-spike` has its
  own two windows.
- A count or amount equal to its threshold raises the flag.
- A replay is spending the user chose, so replays count toward `spend-spike` and
  no other detector.
- Critical flags come first, then the newest evidence.

The numbers are `USAGE_FLAG_THRESHOLDS`; change one there and in this table
together.

| Flag              | Warning                                                                   | Critical                                       |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| `spend-spike`     | 4× the baseline; the last hour also needs $3                              | 10× the baseline; the last hour also needs $10 |
| `thread-burst`    | 40 requests from one thread in a rolling hour                             | 100                                            |
| `repeated-prompt` | 6 rows with one prompt hash in 10 minutes                                 | 15                                             |
| `cost-unreported` | 3 rows                                                                    | none                                           |
| `unmetered-calls` | 25 requests, 40% of them with no cost                                     | 100 requests, 70% with no cost                 |
| `oversize-input`  | over 4× the source's median and at least 50,000 tokens                    | the same, at least 150,000 tokens              |
| `failure-run`     | 8 failed or invalid rows of one source in 30 minutes, 80% of its attempts | 25                                             |

### `spend-spike`

Compares the reported cost of the last hour, and of the last 24 hours, with a
baseline: the median hour's reported cost over the 7 days before that window,
times the window's hours. Each window raises its own flag (`spend-spike:hour`,
`spend-spike:day`).

- The median, so one earlier spike does not raise the baseline.
- Idle hours count, and most hours of a week are idle, so the median is often
  $0. The baseline is therefore never under $0.25 an hour. At that floor the
  24-hour window warns at $24 and is critical at $60, well over a normal day of
  $5 to $10, so it needs no minimum of its own.
- 4× leaves room for a busy hour. 10× is an order of magnitude over the usual.
- The last hour also has to reach $3 for a warning and $10 to be critical, the
  default hour warning and pause thresholds. At the floor its multiples alone
  are $1 and $2.50, and an ordinary busy hour spends about $1.50.
- With under 24 hours of rows before the window there is no baseline, and the
  flag uses a rate per hour of the window: $5 warns and $15 is critical, either
  side of the default $10 hour cap. For the 24-hour window that is $120 and
  $360.

It usually means a model setting now selects a costlier model, many threads
finished together, a long replay session, or one of the loops below.

### `thread-burst`

Sums `calls` for one thread, whatever the status, over every rolling hour.
Normal is under 20 an hour: in one live sample the busiest of 39 threads made
128 calls in 15 hours, about 9 an hour. 40 is twice that ceiling and 100 is five
times it.

It usually means a thread whose turns end in quick succession, such as an agent
looping, or the analyzer rerunning on one thread.

### `repeated-prompt`

Counts the rows that share a `promptHash` inside 10 minutes; a row that stands
for several requests counts once. A prompt includes the thread's current
content, so an identical prompt means the question did not change between asks.
One call gets at most 3 attempts (`start.ts` retries within seconds,
`analyzer.ts` waits 10 minutes or more), so 6 in 10 minutes is more than a retry
sends, and 15 is a loop with no backoff.

It usually means a check that reruns without its inputs changing, or a failed
call retried without limit.

### `cost-unreported`

Counts rows on the `gateway` path with status `ok` or `invalid`, tokens above
zero, and a null cost. The provider answered those calls and counted their
tokens, so it left the cost out. One or two can be a single bad response; 3
means it stopped reporting. The flag has no critical level: it reports that
costs are missing and says nothing about how much was spent.

It usually means the selected model has no pricing behind the gateway. Every
total is low and the spend caps undercount while costs are missing; the
requests-per-hour limit still counts these calls.

### `unmetered-calls`

The share of the last 24 hours' requests (`calls` summed) whose cost is null:
worker-thread and agent-thread calls, which never report one, and failed or
aborted requests. The request minimums apply to all requests in the window, so
the detector does not flag a share of a handful of requests. At 40% the totals
describe barely half of what ran; at 70% they describe little of it.

It usually means Workstreams is running its model calls through worker threads.
On that setup the detector raises the flag every day, because spend totals and
spend caps count almost none of the calls. The requests-per-hour limit is the
one that stops them.

### `oversize-input`

Compares each row of the last 24 hours with the median input size of its own
source over the last 7 days. Sources differ by design (a tidy reads every
workstream, a turn end reads one turn), so a size is unusual only against its
own source. The median needs 10 rows that reported an input size. A flagged row
exceeds 4× the median (the one threshold where equal is not enough) and has at
least 50,000 input tokens; the minimum keeps the detector from flagging a
multiple of a small prompt. 150,000 tokens approaches the context window of many
models. The detector raises one flag per source, for its largest row.

It usually means a long response or thread history reached a prompt whole.

### `failure-run`

Looks for a stretch of at most 30 minutes that starts and ends on a row of one
source whose status is `failed` or `invalid`. The stretch needs 8 such rows, and
they must be 80% of that source's attempts inside it. The share keeps a busy
source with a normal error rate from flagging, and attempts that worked before
or after the stretch do not dilute it. 8 is more than the 3 attempts one call
gets, so several calls are failing; 25 is a retry storm.

An `aborted` row counts as neither a failure nor an attempt. The server aborts
an in-flight composer preview whenever the draft changes, so an abort says the
caller stopped waiting and nothing about the provider.

It usually means a provider outage, a rejected key, a model whose answer fails
to parse on every attempt, or no connected analysis machine. Failed requests can
still be billed.
