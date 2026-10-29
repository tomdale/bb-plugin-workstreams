# Workstreams specification

Workstreams keeps BB threads useful at a glance by maintaining each root's goal,
topic, status, and activity, then deriving native BB workstreams from topics.
See [Organizing workstreams](docs/organization.md) for the organizer's detailed
behavior.

## 1. Concepts and invariants

| Concept              | Definition                                                                                    | Owner                                     |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Thread**           | A BB thread; the unit named in the UI                                                         | BB                                        |
| **Root**             | A visible, non-archived thread with no visible active parent; the unit Workstreams organizes  | Derived from BB links                     |
| **Delegate**         | A child thread created for separable work; it uses its root's topic and workstream            | BB parent link                            |
| **Topic**            | An entry in the topic tree, representing a context, product, or capability                    | SQLite topic tables                       |
| **Topic assignment** | A root's topic or no topic, with its source and automatic-classification basis                | SQLite topic fact                         |
| **Workstream**       | A BB section bound to a topic; workstreams nest by the organizer's layout in sidebar and Home | BB section and SQLite binding             |
| **Suggestion**       | A split or tidy edit to the topic tree that applies only when accepted                        | SQLite suggestion table                   |
| **Unfiled**          | Roots without a topic and therefore without a workstream                                      | Derived                                   |
| **Objective**        | Durable user intent, scope, and supporting request IDs                                        | Stored analysis identity                  |
| **Goal/title**       | Concise display name for the accepted objective                                               | BB title and title metadata               |
| **Status**           | The latest state: needs you, review, blocked, working, done, or error                         | Question, report, error, or Full analysis |
| **Organization**     | The page tab showing current organizer state                                                  | Derived                                   |
| **Activity**         | Changes Workstreams made or observed                                                          | SQLite journal                            |

Invariants:

1. A root's topic determines its workstream. A sidebar move is recorded and
   reverted; assign another topic to change workstream.
2. Delegates inherit their root's topic and section.
3. The organizer reads stored facts and makes no model calls.
4. Quick analysis supplies a new thread's initial goal and topic. Placement
   settles the topic from the first request and after each new request. Full
   analysis settles the goal at turn end and fills recap/status/needs-you only
   when the agent did not report.
5. Topic sources have priority `manual` > `inherited` > `full` > `quick` for
   automatic updates. An inherited topic changes on a placement scope shift, a
   placement topic beneath it, or an explicitly user-approved repair or
   suggestion; manual assignments stay protected.
6. Automatic changes and observed outside changes are recorded in Activity, with
   undo where supported.
7. The bound topic supplies a workstream's name, description, and aliases.
8. The agent recap tool's `goal` field remains its current contract for
   compatibility with running sessions.
9. A topic holds threads or subtopics, never both. Every write that would put
   visible threads beside subtopics is refused, whoever makes it.
10. A thread changes group only through your action, an accepted suggestion, or
    placement after a new request. Counts, time, and display rules change how
    groups are drawn, never which topic a thread has.

## 2. Starting topics

A new root takes the first applicable topic: a topic selected in the composer
(`manual`); the topic of a source thread when forked, spawned, or started from
that thread (`inherited`); the topic bound to the workstream's ＋ (`inherited`);
otherwise the result of Quick analysis on the first request (`quick`), or no
topic. A source or workstream topic that has subtopics can't be inherited;
placement weighs it as a hint instead. Placement of the first request follows
within seconds (§3). Delegates use their root's assignment.

Quick analysis runs on a composer draft to preview a goal and topic. The
matching result is reused on first send; otherwise the sent text is analyzed. A
quick topic files the thread immediately.

## 3. Full analysis and status

At turn end, Full analysis receives requests, the latest reply, the prior goal
and objective, and an agent report when available. It returns the goal. Only
without a report does it supply fallback recap, status, and needs-you. Full
analysis runs after a substantive new request; a Workstreams status-check turn
runs it only if no report was made. Failed turns are marked error without
analysis.

Placement settles a root's topic with one closed-set call, on the first request
and beside Full analysis after a new substantive request. It reads the generated
title, the first, second, and latest substantive requests, the project, and the
checkout, with hints: the topic of a continued or source thread, a start topic
that has subtopics, and the checkout's usual topic unless the checkout
coordinates work in other repositories. Only topics without subtopics can be
chosen; it may propose one new topic named for a lasting area. A proposed
subtopic of a topic that holds threads files the thread in that topic. Its basis
is the requests, project, and classifier version, so topic edits and model
changes never re-place a thread.

Automatic topic application respects source priority: manual never changes;
inherited changes only on scope shift or to a topic beneath it; full replaces
quick and updates full; quick applies only before a stronger source. Explicit
user approval of a repair plan authorizes a correction to an inherited automatic
assignment even without a model-reported scope shift; the corrected assignment
then has Full provenance. Every inferred mutation validates live thread
evidence, assignment, and catalog freshness. Superseded results change no
analysis, observations, or topic facts.

Full analysis carries a durable objective separately from the latest task,
recap, and status. An identity candidate keeps the objective, refines it from
supported user evidence, or pivots when the latest user request changes
direction. Keep preserves the stored title and summary. Control-only replies
such as “continue” do not redefine identity. Referenced continuation threads
supply bounded opening intent. Objective summaries have a separate limit from
display titles. Automatic titling preserves outside title edits until the title
is cleared. Opening analysis only fills empty titles.

Question cards and agent reports precede analysis fallback for status. Agent
recap states map `complete` to `done`, `review` to `review`, and `waiting` to
`in_progress` (working). The serialized decision state is `needs_decision`;
“needs you” is its user-facing description. Runtime `error` is a BB thread
status, not a stored analysis work state. Fresh user input clears the prior
recap. Recap reminders remain configurable. With Structured replies on, agents
get no recap tool: they end each turn with a `:::reply{state="…"}` block, or a
question card when they need the user's answer, which is then the reply. The
block's card fields (a `#` headline, results, Review, Next, Waiting on, Links)
the server reads on idle and stores as the turn's recap through the tool's path,
asking for a correction when the block, its state or its headline is missing.
The rest of the block is the body the app draws inline; the inline block leaves
its card fields to the docked card while that turn's card shows. A short answer
is a block with only its headline. A block without `state` carries no recap and
draws as plain text. Structured replies needs the tomdale/bb fork's
message-block slot: the app shows the setting and reports the slot only where it
exists, and until a client reports it the server keeps the recap tool and the
usual recap instructions, as on upstream bb.

## 4. Organization

The organizer runs after relevant facts change. It lays out groups from the
topic tree and visible-root counts (completed roots count like any other) and
binds a BB section to each group that lists threads, files roots accordingly,
records outside moves and reverts them, and prunes unused discovered topics.
Mutations validate their topic plan, run through the serialized service queue,
and are journaled. Visual collapse is separate per-client state keyed by stable
topic identity.

The layout follows these rules, fixed rather than configured:

1. A group shows its subtopics as subgroups above 5 visible roots and one list
   again at 3 or fewer; the organizer persists which groups show split.
2. A top-level topic with subtopics and no threads is a context, and a topic
   with no threads and two or three subtopics with threads is a family; neither
   gets a header, and its name is dimmed before its children's. A topic whose
   subtopics a split created (partitioned) always keeps its header.
3. A topic with no threads and one subtopic with threads shows that subtopic,
   the parent dimmed first. A dimmed name the next name starts with is dropped.
4. A group showing subgroups that covers 40% or more of its parent's visible
   roots moves to the top level with its ancestors dimmed, and its roots leave
   the parent's count; it moves back below 30% or on showing one list. Only a
   parent with its own header promotes.
5. At most three header levels; a group that would show subgroups at the third
   level moves to the top.

BB keeps sections flat, so the sidebar and Home draw the layout the last pass
published. Focus covers a top-level group's sections; dragging a header moves
them together.

Empty workstreams remain in the sidebar and Home only while they had a visible,
non-archived, unsnoozed thread within the last ten minutes, with a shared
maximum of three, selected by most recent population. Focus and nesting do not
bypass this rule. Population timestamps persist across reloads; observing an
empty workstream never renews them. Expiry does not require another thread event
and does not delete threads or topics. The organizer keeps their sections and
topic bindings during the grace period so New work remains scoped correctly.

The Organization page shows organizing suggestions, current organizer state,
workstreams, counts, and agent-report coverage.
`bb workstreams organization [--rebuild]` reports or rebuilds the projection.
Topics are managed in the Topics tab or with `bb workstreams topics …`.

Organizing suggestions are made apart from the organizer and change nothing
until accepted. A split partitions a topic without subtopics that passes 5
visible roots, or files the threads of a topic that holds threads beside
subtopics, at most once a day per topic. A tidy pass proposes at most 8 edits
with reasons, at most once a day, after 3 new topics or 5 new roots or when
Unfiled roots plus one-thread groups reach 4 and changed, and not while earlier
edits wait. Tidy sees your manual filings, accepted suggestions, and declined
ones, and an edit identical to a declined one is dropped. Accepting applies
through the topic store and journals an undo that restores the topic tree and
assignments while the catalog revision is unchanged.

## 5. Composer, storage, and architecture

The BB composer exposes a Topic picker and Quick analysis preview. It has no
destination-workstream choice. A selected topic is manual; Automatic uses Quick
analysis. A workstream's ＋ seeds its topic.

SQLite stores topics, topic assignments, workstream bindings, analysis, title
history, agent reports, questions, traces, reconciler snapshots, preferences,
and Activity. Migrations retain the established topic-table names and remove
obsolete placement, drift, and project-shape state.

`src/domain/` owns classification, placement and suggestion prompts, layout,
status, grouping, and projections. `src/server/quick.ts` performs Quick
analysis; `analyzer.ts` performs Full analysis; `placement.ts` places roots;
`suggestions.ts` makes and applies suggestions; `topics.ts` persists topics;
`organizer.ts` derives membership; `preview.ts` serves composer previews. The
app uses the RPC schemas in `contract.ts`; the CLI uses the same services.

## 6. Settings and CLI

Quick analysis, Full analysis, placement, and suggestions have separate model
settings. The Quick analysis model remains available when typing suggestions are
disabled because first-send analysis still uses it. Automatic suggestions can be
turned off; asking for them still works. Existing title, sidebar, recap, snooze,
and display preferences remain. Six color tokens (complete, review, waiting,
needs you, failure, suggestions) each keep their Workstreams default, follow a
BB theme color, or use a custom `#rrggbb`; only those forms are accepted.

Quick analysis defaults to schema-constrained `openai/gpt-6-luna-fast` with
reasoning disabled. Its title and topic validate independently. Invalid topic
output receives one bounded repair attempt within the original time budget;
invalid results never file a thread or clear a valid assignment. Preview
suggestions use medium confidence; explicit workstream references use high
confidence.

The Organization tab and `bb workstreams topics preview [thread]` prepare a
read-only repair plan using current classification evidence.
`topics apply <plan>` consumes a fresh plan once; temporary SDK read failures
retain unprocessed rows so retries preserve the applied prefix. Plans expire
after 30 minutes, reject changed catalog definitions, and skip threads with
newer evidence or manual corrections. Preview and apply preserve titles and
status. Catalog definition keys exclude assignment and section-binding changes.

The CLI uses `topics`, `thread`, and `organization` vocabulary. See
`bb workstreams --help` for current commands.
