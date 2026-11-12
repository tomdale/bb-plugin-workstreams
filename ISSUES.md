# Workstreams issues

This list distinguishes confirmed defects from SDK limitations and intentional
behavior. Resolved defects belong in regression tests and Git history, not an
open bug list. Paths below are relative to this package.

## Open limitations

### Provider-worker generation controls and telemetry

**Evidence:** `src/server/inference/worker.ts`, `src/server/index.ts`, and the
released SDK 0.6.5 `ThreadSpawnArgs` / `ThreadOutputResponse` types.

Non-Gateway models run in hidden BB threads. The spawn API has no output-schema
or output-token-limit fields, and `threads.output` returns text only. Responses
are parsed and validated, but generation cannot be constrained in the same way
as a direct Gateway call. Usage, cost, and reasoning metadata are unavailable;
worker traces use `usage: null`, not fabricated zero usage.

**Workaround:** Use a Gateway model for constrained Quick analysis and reported
usage. The requested completion API is recorded in the BB SDK wishlist,
`docs/bb-sdk-wishlist.md` in tomdale/bb-plugins. Do not infer total spend from
the sum of reported costs when worker calls exist.

### Topic discovery without a matching known area

**Evidence:** `eval/classification-cases.ts`, `src/domain/classify.ts`, and
`src/domain/placement.ts`.

Quick analysis can choose a similarly described topic under the wrong owner when
the correct area is absent. Cold discovery can also establish a product without
its supported capability, or qualify a new root with a capability name.
Structural validation enforces leaf-only filing and the two-level limit, not
semantic accuracy. A small synthetic evaluation is not a production accuracy
estimate.

**Workaround:** Review topic previews and lasting divisions. Placement settles
the topic from request evidence; manual filing remains authoritative.

### Placement and suggestion evidence

**Evidence:** `src/server/placement.ts`, `src/domain/tidy.ts`.

Placement reads requests, title, project, and checkout; it doesn't read the
titles or changed files of pull requests a thread names, since the plugin has no
GitHub client. Checkout hints and the coordination check know only the checkouts
placement has recorded, so threads placed before checkouts were recorded
contribute nothing until they're placed again. Tidy sees threads by title and
checkout, at most 12 per topic.

### User-selected colors

**Evidence:** `src/domain/spinner.ts`, `src/app/settings/SpinnerSettings.tsx`,
and `src/domain/workstreamColor.ts`.

Custom colors accept any valid hex value, including low-contrast choices.
Workstream colors are allocated from a finite palette; a large family or many
workstreams can produce similar colors. Labels and status text remain necessary;
color is not an identity or status guarantee.

### Stream Deck keys

**Evidence:** `src/server/streamDeck.ts`, `src/app/upNext/StreamDeckBridge.tsx`,
and `stream-deck/src/render.ts`.

The Next key and the keys that open a thread act in every connected BB app, a
phone included, because BB's thread open and plugin realtime signals reach all
of them. The keys leave out the thread open in the BB app that reported last,
and each app reports when it opens a thread or comes to the front. After you use
BB on a phone, the keys leave out the phone's thread until the desktop app comes
to the front again. The plugin breaks key text into lines using Helvetica Neue's
widths as Chrome measures them; Stream Deck draws the text itself, so a line can
end a little short or run slightly long. The plugin supports only macOS.

### Suggestions the review cannot draw

**Evidence:** `src/server/suggestions.ts` (`delta`) and
`src/app/sidebar/suggestionMiniatures.ts`.

The review draws the sidebar after a suggestion from its `delta`. Two kinds of
suggestion have none: a change that needs a topic another suggestion of the same
pass creates, and a split whose group gained threads since it was made, since a
model call files those threads only when you accept it. Neither shows a drawing,
and **Accept** still works. The drawing counts root threads, as suggestions do,
and leaves out categories. Snoozed threads are dashed ticks, only in the
workstreams a change touches. Archived threads are only counted, never drawn,
since a topic can hold thousands.

**Workaround:** Accept the suggestion that creates the topic first; a split's
newcomers land where the model files them, which Activity records.

### An old reply's unfinished results

**Evidence:** `src/domain/reply.ts` (`parse`) and
`src/app/reply/LegacyCard.tsx`.

A reply that carries a card keeps its unchecked results in the body as a "Not
done" section, so they stay visible when the live card, not the block, draws the
turn. Where the block draws the card's fields itself, that section reads as a
Markdown heading above the labelled Done, Review, Links and Next rows, and the
card's own Not done row stays empty. The two shapes show the same unfinished
work; the heading above a label row is not a distinction the stored data makes.

### A part that fails to parse draws as body text

**Evidence:** `src/app/reply/PlainBody.tsx`.

A component the schema rejects prints its reason and then its source at body
size, in body order. The reply renderer has no fallback frame, so the problem is
legible without announcing that the part below it is not the real thing.

### Best-effort redaction

**Evidence:** `src/domain/redact.ts`.

Regex masking covers common credential shapes, not every possible secret. It is
not an access-control or data-loss-prevention boundary. Inspect diagnostic
exports before sharing; don't put secrets in prompts. Provider processing
policies apply to conversation excerpts sent for analysis.

## Audit findings that are not defects

- **Completed roots in grouping:** Completed roots count toward the split and
  merge-back thresholds just like other visible roots, so finishing work never
  regroups a topic; see `tests/server/grouping-regressions.test.ts`.
- **Nested Up Next / archive destinations:** Up Next contains only roots, so
  delegates cannot become separate archive destinations in that band. See
  `tests/domain/upNext.test.ts` and `tests/domain/archiveNavigation.test.ts`.
- **Projection defaults:** The pure forest projection has no stored analysis
  input, so its default attention predicate can only inspect native pending
  interactions. App and CLI callers supply the shared `needsAttention` rule.
- **Archive suggestion withdrawal:** `useArchiveSuggestion` deliberately treats
  drafting a continuation as declining Archive for that recap. Clearing the
  draft does not restore it; a new recap can offer Archive again. This behavior
  is explicitly covered in `tests/app/recap-card.test.tsx`. The thread header
  and context menu remain available for deliberate archive actions.
- **Human labels versus JSON states:** “Working” / “needs you” are prose;
  `in_progress` / `needs_decision` are serialized work states. Runtime `error`
  is a BB thread status, not an inferred `WorkState` value.
- **Short labels:** “On update” is the sidebar row's compact version of “Until
  there's an update”; “New threads” names a settings section while “New work…”
  is an action. These are not separate features or state values.
- **Snooze dates:** A weekday rule is always a future day: Saturday at 9 AM
  chosen on a Saturday means next Saturday. Use a Today rule or Custom… for the
  current day.
- **Wake event timing:** Turn-end events are checked when BB reports the turn
  idle, when its recap or Full analysis lands, and on the minute-long reconcile.
  Lasting conditions (a pending question, failed send, machine wait) are dated
  by the inventory read before the one that showed them, so one that began
  within a minute before or after a snooze may be taken as older and not wake
  it; a question card's own event still wakes it at once. Pull request state is
  polled every 5 minutes. A delegate cut off without failing (an interrupted
  turn that ends idle) is not seen as failed. A server restart forgets failure
  times (a failed turn then counts when its attention moved after the snooze)
  and how each turn first read, so a turn re-analyzed after a restart counts by
  its new reading.
- **Activity compatibility values:** The retired proposal action stays in the
  journal's action list because retained Activity rows still use it.
- **Retitle enablement checks:** Re-checking title settings after awaited SDK
  work protects against a setting change during the request, not redundant
  validation.

## Regression coverage for confirmed defects

- Topic dialog name, description, and alias limits:
  `tests/app/topic-dialog-limits.test.tsx`.
- Activity debug filters and empty states: `tests/app/activity-debug.test.tsx`.
- Overview search counts: `tests/app/page.test.tsx`.
- Setting-save errors and title-lock copy: `tests/app/settings.test.tsx`.
- Snooze rules, preset repair, and valid custom snoozes:
  `tests/domain/snooze.test.ts`, `tests/app/custom-snooze-dialog.test.tsx`,
  `tests/app/snooze-settings.test.tsx`.
- Wake events: `tests/domain/wake.test.ts`, `tests/server/snooze-wake.test.ts`.
- Question answer limits and attachment availability: `tests/app/question/`.
- Sidebar ordering/drop affordances and shared band preferences:
  `tests/app/drop.test.ts`, `tests/app/sidebar.test.tsx`.
- CLI JSON, bounded output, diagnostics, and topic-repair titles:
  `tests/server/cli-topics.test.ts`, `tests/server/service.test.ts`,
  `tests/server/trace.test.ts`, `tests/server/reclassification.test.ts`.
- Shared attention rules and response validation: `tests/domain/status.test.ts`,
  `tests/domain/analysis.test.ts`, `tests/domain/recap.test.ts`.
- Unknown worker usage: `tests/server/worker.test.ts`.
- Bounded inspector history explicitly reports truncation:
  `tests/app/inspector-limit.test.tsx`.
