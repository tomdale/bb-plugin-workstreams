# Workstreams for BB

Workstreams keeps open BB threads useful at a glance by maintaining each root
thread's **goal**, **topic**, **status**, and **activity**, then deriving native
BB **workstreams** (sections) from topics.

## Install and start

Requires **BB 0.44+** and **Plugin SDK 0.6.5+**. From a retained local checkout:

```sh
git clone https://github.com/tomdale/bb-plugin-workstreams.git
cd bb-plugin-workstreams
npm ci
npm run build
bb plugin install "$PWD" --yes
```

Path installs load from that directory; do not delete it while installed. In
Tom's checkout, develop in a Workforest task and install only from canonical
`main` after integration.

1. Open **Settings → Workstreams** and choose the Quick and Full analysis
   models. The default Gateway models need a connected BB machine with an AI
   Gateway key; see [model execution](#gateway-vs-provider-worker-models).
2. Select **Workstreams** as the sidebar thread list and open **Workstreams** in
   the main navigation to browse the topic tree and organization state.
3. Start a thread with **Automatic**, or select its **Topic** yourself. To move
   existing work, drag its root thread to another workstream or change its
   Topic.

See [ISSUES.md](ISSUES.md) for current limitations and audit dispositions.

## Core concepts

| Term                 | Meaning                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Thread**           | A BB thread; the unit of work shown across the UI.                                                                                                                                                                             |
| **Root**             | A visible, non-archived thread with no visible active parent. Roots are the unit Workstreams classifies and organizes.                                                                                                         |
| **Delegate**         | A child thread created for separable work. Delegates inherit their root's topic and workstream.                                                                                                                                |
| **Topic**            | A durable product or area, with a path of at most two levels (`Vertex`, `Vercel Agent: Code Review`, `bb: Workstreams Plugin`). A topic holds threads or child topics, never both.                                             |
| **Topic tree**       | Every topic Workstreams knows, whether or not an open thread currently uses it.                                                                                                                                                |
| **Topic assignment** | A root's assigned topic (or **No topic**), together with its provenance (`manual`, `inherited`, `full`, or `quick`) and classification basis.                                                                                  |
| **Workstream**       | A native BB section bound to one topic in the topic tree.                                                                                                                                                                      |
| **Category**         | A contextual subdivision of a topic's current sidebar roots. Categories survive restarts separately from topic assignments, appear at `6` roots, and are discarded at `3` or fewer.                                            |
| **Group**            | A topic as suggestion review names it: where its threads sit in the sidebar, whether or not it has threads and a workstream yet.                                                                                               |
| **Placement**        | The one model call that chooses a root's topic from its requests, when it starts and after each new request.                                                                                                                   |
| **Suggestion**       | A proposed lasting topic division or tidy edit that changes nothing until you accept it. Review lists those that move threads apart from those that only tidy groups, which move no thread and decide where future threads go. |
| **Unfiled**          | Roots that currently have no topic and therefore belong to no workstream.                                                                                                                                                      |
| **Goal**             | What a thread is for, written as its display title: an -ing verb and its subject ("Redesigning work tab") that leaves out what its workstream and parent thread already say (`2–5` words, under `34` characters).              |
| **Status**           | How the latest turn ended: `needs you`, `review`, `blocked`, `working` (`in_progress` in JSON/CLI), `done`, or `error`.                                                                                                        |
| **Agent recap**      | A structured end-of-turn report submitted by the agent with the `WorkstreamsRecap` tool.                                                                                                                                       |
| **Organization**     | Deterministic topic-to-section filing plus automatic contextual categories; native filing status is under **Topics** on the Workstreams page.                                                                                  |
| **Activity**         | The log of changes Workstreams made or observed, with undo where supported.                                                                                                                                                    |

### Core rules

1. **Topics own workstreams.** A root's topic determines its workstream. Moving
   a thread between sections in BB's sidebar is logged as an outside change and
   reverted on the next organizer pass; change a root's topic to move it to
   another workstream.
2. **Delegates follow their root.** Child threads use their root's topic and
   workstream and are nested under their parent in the sidebar, Home view, and
   CLI.
3. **Topic provenance priority.** Topic sources follow
   `manual > inherited > full > quick`:
   - `manual` (chosen by you in the composer, sidebar, Workstreams page, or CLI)
     is never overwritten by automatic analysis.
   - `inherited` (from a parent/source thread or a workstream's **＋** button)
     changes automatically only when placement reports a scope shift or settles
     a more specific topic beneath it, or when you explicitly apply a reviewed
     topic-repair plan or accept a suggestion.
   - `full` (settled by placement from the thread's requests) replaces `quick`
     and updates prior `full` assignments.
   - `quick` (the topic the composer's Quick analysis preview showed) fills only
     threads without a stronger source.
4. **Agent reports outrank fallback status.** Structured questions
   (`AskUserQuestion`) and agent recaps (`WorkstreamsRecap`) take precedence
   over Full analysis for thread status, recap text, and `needs you` prompts.
   Full analysis supplies those fields only when the agent did not report.
5. **A topic holds threads or subtopics, never both.** Once a topic has
   subtopics, every thread in it is in one of them. Assignments, new subtopics,
   moves, and merges that would put threads beside subtopics are refused,
   whoever makes them; topic pickers list only topics without subtopics. Topic
   paths have at most two levels total. Adding children to a populated topic
   requires a reviewed filing plan for all stored assignments, including
   archived work, using meaningful lasting areas rather than a General or Other
   catch-all.

---

## How it works

### 1. Starting a thread & Quick analysis

When you compose a new thread, the composer includes a **Topic** control (in
BB's picker row on wide viewports, or on its own strip above the prompt on
phones):

- **Automatic (`✦`, default):** Runs **Quick analysis** on your draft while you
  type (after a `250 ms` pause, or `900 ms` for drafts of `20` characters or
  fewer) to preview a title and topic. When you send the first request, a
  matching draft preview is reused immediately without a second model call;
  otherwise Quick analysis titles the sent request.
- **Explicit workstream reference:** A draft containing `@section:<id>` resolves
  to that section's bound topic without a model call when typing suggestions are
  enabled. For example, `@section:sec_0123456789` uses a native BB section ID,
  not a topic name or topic ID. Run `bb workstreams list` to find section IDs.
  Unknown or unbound section IDs fall back to Quick analysis. This is a preview
  shortcut, not a separate destination-workstream control.
- **Workstream `＋` button:** Clicking **New work in \<workstream\>** in a
  sidebar group header seeds the composer with that workstream's topic
  (`inherited` provenance). A header whose topic has subtopics can't hold the
  thread, so placement chooses one of its subtopics, told where it started.
- **Forked or spawned threads:** Inherit their source thread's topic
  (`inherited` provenance).
- **Manual topic selection:** Opening the Topic picker lets you search the topic
  tree, create **New topic "\<query\>"** inline, or choose **No topic**
  (`manual` provenance, keeping the thread **Unfiled**).

To associate a workstream with a BB project, open **Workstreams → Topics**,
click its topic, and choose **Project**. **Automatic** learns an association
when at least three independent root threads all use the same available project.
Archived roots count; delegates, forks, plugin-created roots, hidden threads,
and Personal do not. Parents are associated only when their subtopics agree.
Learning uses thread history, not another model call.

A learned project appears as **Automatic · <project>**. Choosing a project
explicitly makes it your choice, which learning never changes. Choosing **No
associated project** disables learning and project inheritance for that topic;
choose **Automatic** to enable them again. Existing explicit associations stay
manual. Automatic associations, manual changes, and suggestion decisions appear
in **Activity**, with supporting threads and undo where applicable. Undoing an
automatic association disables learning so it is not immediately recreated.

When independent history contradicts a learned association, **Project
associations** under **Topics** offers a correction to accept or decline.
Consistent alternative history suggests another project; mixed history suggests
**No associated project**. The current association stays until you accept, and
declining suppresses that correction while the association is unchanged.
Acceptance rechecks the history and becomes your explicit choice.

Selecting an associated topic manually, through Quick analysis, or with the
workstream's **＋** button updates the new-thread composer to use its project.
Subtopics use their nearest ancestor's project unless overridden or disabled.
With no associated project, the composer keeps its current project; unavailable
projects are ignored. Changing the project does not replace the draft or refile
existing threads. Workstreams records when it supplied the composer's project,
including across reloads, so those threads cannot reinforce its own inference.
Unknown project choices on new threads do not count. Historical work with no
association can bootstrap learning; historical work that already had an
association is excluded when its project-choice provenance is unknown.

Quick analysis defaults to schema-constrained `openai/gpt-6-luna-fast` with
reasoning disabled (`15 s` timeout, up to `4` in-flight calls). A draft
preview's title and topic validate independently: an invalid topic receives one
bounded repair attempt within the remaining time budget and never blocks a valid
title. Opening titles only fill threads that do not yet have a title while the
first turn is still running.

A new root's first request is also **placed** right away (see below), so the
thread is filed within a few seconds; the opening title call doesn't choose a
topic.

### 2. Turn end & Full analysis

When a visible, non-archived thread goes idle after a turn (`5 s` debounce, up
to `4` concurrent runs), **Full analysis** runs with:

- The thread's opening request, recent substantive user requests (control-only
  replies such as `continue`, `yes`, or `ok` don't count as new requests),
  referenced continuation threads (`@thread:`), and the latest assistant reply.
- The thread's current title and who gave it, and the latest agent recap if one
  was recorded.

Full analysis settles:

- **Title:** After a turn that followed a new request from you, when **Keep
  titles current** is enabled. A title names the goal you're working toward,
  phrased as what you're doing: an -ing verb that says what kind of work it is
  and the subject it acts on ("Reviewing Phase 1 security", not "Review Phase 1
  security and boundaries"). Both analyses write it as those two parts, and
  Workstreams joins them. The verb names the overall work, not the latest step,
  so a title Workstreams wrote is kept while the thread diagnoses, tests, or
  ships, and replaced when your requests change the goal; a title BB or an agent
  gave the thread is replaced. Titles keep identifiers such as a phase number,
  name a pull request by its subject rather than its number, and leave out what
  the thread's workstream and parent thread already say: both analyses see both,
  and a workstream name at the start or right after the verb is dropped from the
  result. They aim under `34` characters; titles over `48` are dropped rather
  than clipped. If you rename a thread outside Workstreams, Full analysis stops
  titling it until the title is cleared.
- **Goal:** A concise desired outcome shown below the thread title, independent
  of recap headlines. It is usually one sentence of 12–20 words, with an
  explicit subject and only enough detail to recognize the purpose. It leads
  with success, or with the problem when the motivation would otherwise be
  unclear. Goals follow changes in your purpose, not testing, shipping,
  housekeeping, or completion updates. Full analysis settles them after new
  requests even when you gave the thread its title; turns without new requests
  carry the goal forward. Existing open threads receive goals through analysis
  catch-up. Until a goal is available, the subtitle is omitted.
- **Context digest:** Two or three short sentences recording what the work is,
  what it has established, and the product or area that owns it. Each settled
  turn revises the digest in place, so established facts survive later sub-step
  requests. Placement reads the digest when choosing a topic, so ownership
  decisions rest on the thread's accumulated context.
- **Fallback recap and status:** Only when the agent did not call
  `WorkstreamsRecap`, Full analysis supplies a one-line recap, work state
  (`needs_decision`, `review`, `blocked`, `in_progress`, or `done`), and a short
  `needsYou` prompt when waiting on your decision. Failed turns are marked
  `error` without running analysis.

### 3. Placement

A root's topic is settled by **placement**: a schema-constrained call (default
`openai/gpt-6-sol`, reasoning `none`) when the thread starts, and again beside
Full analysis when a turn ends after a new substantive request. If the first
call fails, Workstreams retries it twice with short delays; after those
attempts, the turn's end can still place the thread. Topic edits, model changes,
and turns without a new request never re-place a thread.

- **Evidence:** the thread's generated title; its first, second, and latest
  substantive requests (a routed request is read without its
  `[bb message from thread:…]` wrapper); the context digest Full analysis
  settled; its project; and its checkout. Subagent results verified against
  Subagents' run records are not requests. If those records are unavailable,
  Workstreams keeps the message rather than discarding a possible user request.
- **Closed choice:** only topics without subtopics can be chosen. When none
  fits, placement may propose one new topic named for a lasting area of work,
  never for a task, pull request, or bug. A proposed subtopic of a topic that
  holds threads keeps the thread there and requests a reviewed topic division.
  It does not create children around existing assignments. A second-level topic
  covers finer areas without adding a third identity level.
- **Hints, not rules:** the topic of the thread it continues (a fork's source or
  an explicit `Continue from @thread:…` request); the workstream or thread it
  was started from when that topic has subtopics; and the topic most threads in
  its checkout have. A checkout whose threads point at other repositories (at
  least two of them name a GitHub repository or a `~/Code` path outside it)
  coordinates work elsewhere, so it gives no hint.
- **Fast placement:** with **Fast placement** on, the same closed choice is
  first asked of a decision model (default `openai/gpt-6-luna-decisions`) as a
  typed question that answers with a topic and its probability. An answer at
  `0.95` confidence or above settles the topic in a few hundred milliseconds and
  the placement call is skipped. Everything else — a lower probability, an
  unfiled answer, a tree too large to ask about, a failed call — is asked of the
  placement model as usual, so a pick that needs a new topic or a scope shift
  still gets one. Each gate call is recorded with its probability, and it is not
  replayable, since the placement model answers the equivalent question.
- **Provenance:** placement writes `full` topics under the priority above, and
  every update re-validates live thread evidence, assignment state, and
  topic-tree freshness before writing. An answer that supplies both an existing
  topic and a proposal is invalid; the current assignment and catalog stay
  intact.

### 4. Organization and categories

The **Organizer** deterministically derives native BB sections from topics.
Every populated topic without children keeps its own workstream, regardless of
volume. A first-level container is shown as a dimmed prefix before its child's
name; an already repeated prefix is omitted. Topic assignments determine native
section membership, and outside section moves are logged and reverted. Unused,
childless discovered topics are pruned. Collapse preferences follow topic IDs
across windows and section recreation. Topic-bound workstream colors are
allocated to persistent topic identities, so they survive section recreation and
renaming. Related topics receive related colors, chosen to separate them from
existing colors where the palette permits. Reparenting a topic can change its
color. Unbound native sections use a section-based fallback until bound. Labels
remain necessary when colors look similar.

**Categories** arrange rows inside a workstream without changing its topic,
native section, or identity hue. Both the sidebar and phone Home show them. Any
topic without children can have categories, at either topic depth. Sidebar
category headings use a subdued version of the workstream color:

- At **6 roots**, the category classifier sees the whole collection and creates
  useful categories. It counts visible, non-archived, unsnoozed roots, including
  completed roots; delegates follow their root and do not count separately.
- While categories exist, every arrival, departure, or substantive request that
  changes a root's work causes the classifier to reconsider the whole
  collection. Requests are assessed when dispatched, without waiting for Full
  analysis. It sees the current arrangement and should preserve it unless a
  change offers a meaningful organizational benefit. Cosmetic changes do not
  justify regrouping. There is no cooldown, periodic assessment, or separate
  incremental mode.
- At **4–5 roots**, an existing category set remains active. At **3 or fewer**,
  it is discarded without a model call. Reaching 6 again creates a fresh set.
- Category IDs and memberships survive restarts separately from topic
  assignments. A restart restores settled state and resumes an interrupted
  assessment. Title, status, focus, scrolling, and header-collapse changes do
  not trigger inference.
- Departing roots leave categories immediately. Arrivals remain visible while
  classification is pending. Invalid or superseded responses cannot replace a
  valid arrangement or hide threads. A failed assessment waits for changed work
  or membership, or an explicit organization rebuild, before retrying.

Categories describe distinctions useful among the current threads: each groups
threads that share one theme, and its name states that theme, joining scopes
with &. Child topics identify lasting areas assignable independently of that
collection. Volume and recurring category names do not create child topics.

### 5. Organizing suggestions

Workstreams proposes changes to the topic tree and applies them only when you
accept them: from the count on the sidebar's Workstreams heading, on **Topics**,
or with `bb workstreams suggestions`. Suggestions and categories use the
**Organization model** (default `anthropic/claude-sonnet-5.5`, reasoning
`medium`). Turning off organizing suggestions does not disable automatic
categories.

- **Topic divisions:** When placement identifies a distinct lasting area beneath
  a populated first-level topic, Workstreams asks for a complete reviewed filing
  plan. **Ask now** also considers divisions explicitly. A plan must identify
  supported, independently assignable scopes, useful specificity, and a home for
  every stored assignment, including archived work. The classifier can conclude
  that no lasting division is supported. Only acceptance creates the child
  topics; a second-level topic cannot gain children.
- **Tidy passes:** At most `8` edits (merge, move under, possibly renamed,
  rename, create a parent for related topics, refile a thread), each with a
  one-line reason. A move under a parent drops the words the names share:
  "Vercel Agent Code Review" moves under "Vercel Agent" as "Code Review". With
  organizing suggestions on, a pass runs after changes to topic definitions or
  visible root membership and filing settle. Checks are debounced by two
  seconds; titles and statuses alone do not start a pass. Applicable tidy edits
  waiting for review pause automatic passes; after a decision, changed work is
  assessed. **Ask now** runs splits and a pass right away, replacing pending
  tidy edits. A tidy pass sees at most `12` threads per topic and `12` Unfiled
  threads; it can propose thread moves only for the threads shown in that call.
  Topic and thread IDs in its answer can include the brackets shown in the
  prompt; unknown topics and threads not shown in the pass are still rejected.
- **Names:** A top-level topic whose name begins with the whole name of a topic
  with subtopics ("Vercel Agent Code Review" beside "Vercel Agent") gets a
  suggestion to move under it, renamed without the shared words ("Code Review");
  the old name stays as an alias. These need no model call, so they appear
  whenever the tree changes. Tidy can also suggest clearer, more concise names
  in context, preserving recognizable identities and distinctions between
  topics.
- **Memory:** Tidy sees the topics you filed threads under, the suggestions you
  accepted, and the ones you declined; a suggestion identical to a declined one
  is never proposed again.
- **Review and undo:** Each suggestion names what moves and where, shows the
  change in a line or two in the app and in `bb workstreams suggestions`, and
  says why it can't apply when the tree changed since. Accepting one records it
  in Activity with **Undo**, which restores the topic tree and assignments as
  they were while nothing has changed since.

---

## Surfaces in BB

### Sidebar (`Workstreams` thread list)

Select **Workstreams** as your sidebar thread list to organize threads into:

1. **Up Next:** A sticky amber card at the top of the sidebar with the few root
   threads most worth your attention. Up Next and **Pinned** share one sticky
   plate at the top of the list, and the list fades into the sidebar background
   as it scrolls beneath them. Every root that isn't archived, snoozed, or
   running is a candidate; a running thread joins only while it has a question
   card or approval pending, and otherwise returns, unread, when its turn ends.
   A thread with a question for you (`AskUserQuestion` or approval pending, or a
   `needs_decision` status) or a turn ready for review is _blocked on you_;
   anything else (complete, waiting, failed) is not. A review or decision whose
   turn ended more than `7` days ago ages out and counts as not blocked; a
   pending question card or approval never ages out. Candidates rank in six
   tiers, each newest first by latest turn end:
   1. Unread threads
   2. Read questions
   3. Read reviews
   4. Other read threads
   5. Unread **Waiting** threads
   6. Read **Waiting** threads

   Unread threads come first by default, newest first, whatever their turn was
   blocked on; turning off **Unread first** in the Up Next settings ranks each
   thread by what it was blocked on instead, so a read question can lead an
   unread review. Waiting threads (the agent reported Waiting on a subagent or
   timer, or analysis found the work still in progress) rank after every other
   thread, even read ones. **Prioritize recent threads** in those settings moves
   the threads whose turn ended within the chosen window above older ones,
   whatever they were blocked on, and keeps the six tiers inside each group. Up
   Next then trims from the bottom: threads not blocked on you leave, least
   urgent first, until **Threads shown** remain (`5` by default); read blocked
   threads leave until `10` remain; past that, only the `10` most recently
   active stay, whatever their tier. So Up Next by default shows a few threads,
   grows only for threads blocked on you, and lists at most `10` on its own. A
   thread you have read that isn't blocked on you therefore only fills a row
   nothing more urgent wants; turning **Keep Up Next full** off drops those
   threads entirely, so Up Next lists just the threads that are unread or
   blocked on you, fewer than **Threads shown** when there are fewer of them,
   and nothing when none needs you. **Show N more** lists the trimmed threads
   that are unread or blocked on you below the rest, and **Show less** collapses
   them; trimmed read threads not blocked on you stay in Recent and their
   workstreams. It re-ranks as recaps, read state, and activity change. When the
   order changes, transforms slide existing rows to their new positions without
   changing their heights. A row joining Up Next fades in at its destination.
   With reduced motion enabled, the new order appears without sliding or fading.
   The thread you have open keeps its row and place until you open another
   thread. Nested delegates do not appear as separate Up Next entries; find them
   in their workstream's thread tree.
   - **Focus:** While a focused workstream has a thread blocked on you, Up Next
     applies these rules to focused workstreams' threads only and marks its
     header with the focus icon.

2. **Pinned:** The threads you pinned in BB, in a quiet card directly under Up
   Next and inside the same sticky plate. Rows keep BB's pin order: pins you
   reordered lead, then the pins never reordered, newest first. Pinning is a
   second way to see a thread, not a move: the thread also stays in its
   workstream, and a pinned delegate stays under its root. A snoozed pin waits
   in **Snoozed** until it wakes, and a pin's delegates list under it, hidden
   until you open them, as in Up Next.
3. **Workstreams (focused and other tiers):**
   - **Topics and categories:** Each leaf topic has its own workstream header,
     with its first-level container dimmed before its name when present
     (**Vercel Agent** Automations). The container reads in its own color,
     dimmed, so one parent looks alike under every area, and the workstream name
     uses its identity color. Categories are row headings inside that
     workstream, not additional workstreams or identity levels. Focus, ordering,
     and Dormant continue to apply to workstreams.
   - **Small workstreams:** Every populated topic keeps its own header,
     regardless of its size. Small workstreams do not gather in **Other**.
   - **Indentation:** Child threads sit one step in from their parent thread.
     Categorized threads sit further in than their category heading, and child
     threads sit further in than their parent. Category headings use a muted
     version of the workstream color and have no independent focus, project, or
     New work identity. Roots can be reordered within a category; dragging
     between workstreams changes topic, not category membership.
   - **Empty workstreams:** A workstream shows only while it holds a visible,
     non-archived, unsnoozed thread. The moment its last one is archived or
     snoozed, its group, header and **New work** action leave the sidebar, and
     its empty section is deleted on the next organizing pass. Threads and
     topics are kept, so a later thread on that topic gets a workstream again.
     Focusing an empty workstream keeps it no longer than any other.
   - Press the chevron beside a workstream's name to collapse or expand its
     threads. The group closes and opens its height over `260 ms` with a fade,
     like rows and bands, so what follows slides rather than jumps, and the
     chevron turns a quarter turn. **Dormant**, **Archived**, **Snoozed**, and
     each archived workstream's group fold the same way. Under reduced motion
     they change at once.
   - Click the **Focus** button (viewfinder icon) on any workstream header to
     pin it to the top tier. When at least one workstream is focused, the other
     workstreams, **Unfiled**, and **Dormant** collapse behind **Show/Hide other
     workstreams**. While collapsed, the toggle sums their waiting and total
     thread counts, using the same amber and grey treatments and count settings
     as workstream headers.
   - Click **New work in \<workstream\>** (`＋`) on a workstream header to open
     the composer pre-seeded with that topic.
   - Click **Snooze** (alarm-clock icon) on a workstream header to snooze its
     root trees with your default preset, delegates included and whether or not
     it is collapsed; rest the pointer on it for the snooze menu. Each root
     thread is snoozed with its delegate subtree, as if snoozed from its own
     row, and **Undo** in the confirmation wakes them all. The button appears
     only while the header lists threads.
   - Use the **Sort workstreams** menu to order workstreams by **Name A–Z**,
     **Recent activity**, or **Manual order** (drag headers within their tier).
   - While organizing suggestions wait for review, their count ("2 suggestions")
     appears on the **Workstreams** heading. Click it to open them below the
     heading, over the workstreams, so the list underneath doesn't move. Each
     suggestion takes two lines: what it does ("Merge Payments into Billing")
     with **Decline** (`×`) and **Accept** (`✓`), then the threads it moves (a
     count when a whole group moves), blank when none move. When that line names
     several threads, shows a count, or is cut short, click it to list every
     thread, one per line; click again to fold it. Archived threads move with
     their topic but aren't listed or counted. A decision applies at once and
     leaves **Undo** in its place for a few seconds; Activity keeps Undo after
     that. The foot counts suggestions the tree has since outgrown ("1 out of
     date") beside **Open Topics**, where you can dismiss them. **Close**,
     `Esc`, or a click outside closes the list and leaves the rest waiting.
   - Drag a root thread to another workstream to set its **Topic** to that
     workstream's topic; its delegates follow it. Drop on a row to place it
     before or after that root, or on a header to place it first, including a
     collapsed workstream. Drop in **Unfiled** to clear its topic. When the
     destination represents several topics, Workstreams uses the Placement model
     to choose an existing topic within that group. It shows **Choosing a topic
     in the destination workstream…** while choosing, then saves the choice as a
     manual topic. The same action works on a parent group's header, including
     groups whose topics list inline; when that header has no thread list of its
     own, the chosen subgroup's order applies. If the call fails, returns an
     invalid topic, or the thread or topic tree changes while it runs, the
     thread keeps its topic and the sidebar shows an error.
   - Drag root threads within a workstream to set manual thread order (newly
     created roots appear at the top of their workstream; newly created
     workstreams appear at the bottom).
4. **Unfiled:** Roots with no topic assignment.
5. **Dormant:** Unfocused workstreams with no activity in the last `30` days and
   nothing waiting on you.
6. **Recent, Snoozed, and Archived bands:**
   - **Recent** lists the most recently active root threads (`1–20`, default
     `5`) that Up Next isn't showing, so it carries on where Up Next stops.
     Snoozed threads stay out.
   - **Snoozed** lists snoozed threads ordered by soonest wake time (or
     `On update`), carrying their delegate subtrees with them while snoozed.
   - **Archived** paginates archived threads via BB's archive list.
   - Each band has a **⋯** menu for **Sort by** (`Recent activity`, `Title A–Z`,
     `Soonest to wake`, or `Archive date`) and **Group by workstream**.

#### Row indicators and actions

Thread ages refresh once a minute, and snoozes wake at their expiry time. An
empty workstream leaves the list as soon as its last visible thread does. Active
rows use a highlighted background and foreground text without changing title
weight. Unread titles use medium weight.

- **Status marks:** Live BB runtime indicators (customizable working spinner,
  `?` waiting, `!` error, `✎` unsent draft, unread dot) and Workstreams status
  glyphs (`◆` Needs your decision, `◇` Ready for your review, `⏸︎` Blocked on
  something else, `✓` Complete from agent recap, `↻` Waiting from agent recap).
- **Hover actions:** **Archive** and **Snooze** (click to snooze with your
  default preset; rest the pointer for `350 ms` to open the snooze menu, or
  click **Wake now** on a snoozed row). Thread rows and workstream headers share
  one set of buttons at the row's end: they appear while the row is hovered,
  holds keyboard focus, or has a menu open, and take no room otherwise. Thread
  rows show **Archive** then **Snooze** or **Wake now**; workstream headers show
  **New work**, **Snooze**, then **Focus**. A focused workstream's **Focus**
  mark always shows, at the trailing edge so revealing other actions doesn't
  move it. Touch screens, which can't hover, show only that mark; the rest stay
  in the row's long-press menu. Section **⋯** menus always show, dimmed until
  used.
- **Right-click context menu:** **Open in split**, **Open parent** (for
  delegates), **Topic** (switch to **Automatic** or assign any topic in the
  tree), **Rename…**, **Pin / Unpin**, **Mark read / Mark unread**, **Inspect
  model calls…** (when the debug UI is on), **Snooze / Change snooze / Wake
  now**, **Archive**, and **Delete…**. A workstream header's menu holds its
  hover actions: **Focus / Stop focusing**, **New work**, and **Snooze \<N\>
  threads**. On touch screens, a long press opens either menu.

### Phone Home screen

On compact viewports (when **Sidebar → Up next and workstreams on phones** is
enabled), Workstreams replaces BB's flat Recent list on the Home screen with:

- The **Up Next** card at the top, with the **Pinned** card directly under it.
  Its rows use the same motion as the sidebar's Up Next rows.
- **Workstreams** sections with topic color dots, waiting/total badges, an
  **Expand all / Collapse all** toggle, and per-parent delegate fold controls.
  Focused workstreams (or a single active workstream) start expanded.
- A collapsible **Snoozed** section at the bottom.

### Thread view and header

- **Sticky goal header:** Displays the thread's workstream (in its deterministic
  hue) above the thread title and its concise, success-first goal below it. The
  goal describes the thread's desired outcome, independently of the latest recap
  headline, and remains visible while later turns run. Goals wrap to fit the
  pane, with ellipsis only beyond three lines; generation favors concise wording
  that fits within that space. The header reserves room for the visible lines.
  As you scroll away from the newest message, the large heading hands off to a
  minimized title in the title bar over a feathered background. When the bar is
  too narrow, the heading stays in the timeline: it keeps its expanded size
  until you have scrolled back past it, then steps down to the minimized block
  in one move, on a short feather that lets the timeline resume right
  underneath; **Fade** and **Scroll** do not apply. Pinned titles and their
  workstream names stay left aligned. In **Settings → Workstreams → Threads**,
  choose **Title on scroll → Float** to leave the heading over the thread and
  let the timeline move beneath its shadow, **Title transition → Scroll** to
  slide both copies as they cross while the heading minimizes, or **Title
  alignment → Centered** to put the minimized title in the bar's middle. Those
  last two appear only while the title minimizes. Reduced motion uses the
  stationary crossfade in the title bar and removes the animation from a pinned
  heading's step. Switching threads preserves your reading position. When you
  follow the newest message, the view stays attached to it as the heading loads.
- **Thread header actions:**
  - **Parent thread** (optional, off by default): Opens the parent thread from a
    delegate's header.
  - **Snooze:** Split button on desktop (one-click default snooze + chevron menu
    for all presets and **Custom…**) or menu button on phones; shows **Snoozed
    \<time\>** with a **Wake now** option while snoozed.
  - **Archive** (on by default): Archives the current thread through BB's
    archive flow.

### Agent recap card (`WorkstreamsRecap`)

When **End turns with a recap** is enabled (default), agents report the outcome
of each turn using `WorkstreamsRecap`, rendered as a card above the composer:

- **States and accents:**
  - **Complete** (emerald): Shows the turn's goal, completed `latest` bullets
    (none for a short answer, whose goal states the answer), optional follow-up
    action buttons, and an **Archive** suggestion when the thread and all of its
    delegates, goals, and todos are finished and idle. Archiving opens the top
    Up Next thread when it is blocked on you or unread, and otherwise the next
    thread in the same workstream.
  - **Ready for Review** (sky): Adds numbered **Review** steps (`1–3`) and up to
    `8` clickable **Links** (HTTPS URLs or absolute workspace/host file paths,
    including paths with spaces).
  - **Waiting** (violet): Used when the agent is waiting on background subagents
    or external work. Lists **Awaited agents** with live status dots (polled
    every `4 s`, including hidden worker threads) and a draining countdown bar
    (**Next check in M:SS**). When the timer expires, Workstreams automatically
    prompts the agent once to check status and report back.
- **Interactive tokens:** `@thread:<id>` mentions render as clickable thread
  chips; Git commit hashes (`7–40` hex characters containing letters and digits)
  render shortened with configurable digit/letter tints and click-to-copy.
- **Next actions:** Up to `3` suggested follow-up buttons. After completed work,
  agents surface concrete useful recommendations and unresolved optional
  improvements as self-contained actions, including recommendations in the
  reply. Agents execute authorized continuations and use question cards for
  blocking input or approval. Answers without a useful follow-up need no action.
  **Click** a button to send its prompt immediately; **Shift-click** to insert
  it for editing. When the buttons do not fit, **Next actions** collapses into a
  menu where a pick sends its prompt, and holding `Shift` shows an **Edit in
  composer** hint that makes the pick insert it instead.
- **Dismiss and restore:** Click **Dismiss recap** (`×`) to hide the card (and
  cancel any pending waiting-recap countdown); click the **Show recap** pill to
  restore it.
- **Reminders and loop guard:** If an enrolled agent ends a turn without a valid
  recap or a question card, Workstreams sends up to `3` automatic reminders
  (configurable `0–10`). Reminders name the recap tool rather than assuming the
  latest setting changed the session, tell the agent not to repeat an answer
  already visible to the user, and leave it one short line to end the turn with.
  If an active thread makes `5` identical tool calls in a row — the same
  failures, or the same arguments and the same output — Workstreams stops the
  turn and pauses automatic continuation to prevent an infinite retry loop.

### Upstream bb and the tomdale/bb fork

Workstreams works on upstream bb (plugin SDK 0.6.5 or later): the recap tool,
the docked recap card, the question card, the sidebar, Up Next, and the
Workstreams page. With the [tomdale/bb](https://github.com/tomdale/bb) fork,
which adds a message-block slot, you also get **Structured replies**:

- Agents call `WorkstreamsRecap` first, then write the reply's prose and typed
  components in one `:::reply` block that ends the turn. The block carries no
  recap fields: the card comes from the tool call, so the two never disagree.
- Standalone message directives such as
  `::inline-vis{source="thread-storage" file="report.html"}` render through BB's
  installed directive plugins in body order, including after card sections or
  Details. Missing or disabled directive plugins leave the source readable.
- The body renders through BB's renderer. Prose stays plain Markdown, and a part
  is drawn by its shape: a part whose data is a list of parallel rows — checks,
  a delivery, a sequence, a comparison, a change, a supporting group — sits in a
  bordered, recessed panel holding its title, its scope and its rows, and a part
  with one subject (context, a recommendation, supporting detail) draws a label
  and no frame. Peers in a group share a row in equal columns when the message
  column is wide enough, with no frame; supporting components sit indented
  beneath the point they qualify inside the group's one panel. Prose is never
  framed.
- A panel holding a failed or blocked row takes the failure tone at its border,
  in its header and on its title, so a failure is findable before a row is read.
  Passing panels stay neutral, which keeps the recap card that ends the turn the
  loudest object on screen. Every row prints its status word beside its mark, so
  no status depends on colour alone.
- Parsing and validation retain the structured information: comparisons,
  sequences, behavior changes, checks, delivery records, recommendations, and
  bounded groups. Checks and delivery stages can include evidence links. A check
  reports `passed`, `failed`, `skipped`, `blocked` or `untested`; a delivery
  stage reports `done`, `pending`, `blocked`, `not-started` or `unknown`, where
  `blocked` is a stage that cannot proceed and `not-started` one nobody has
  reached. A checks header prints the test counts the reply reported and no
  others, so a run whose writer never counted skips shows no skipped count. A
  reply's kind remains separate from whether its work is complete, ready for
  review, or waiting.
- Report components also include `table`, `references`, `review`, and `actions`,
  rendered directly by Workstreams with the shared reply panels and no
  Generative UI dependency:
  - `table` shows Markdown cells, column headers, and an optional scope for
    units or conditions. Rows must match the columns. Wide tables scroll inside
    the reply; empty tables retain their headers.
  - `references` retains the complete list and each reference's purpose. Files
    open in native previews with explicit line ranges; web links retain their
    supplied revision. A `threadId` renders a native thread link with its role
    label. When a file cannot be routed, its literal path remains readable.
  - `review` shows ordered instructions, prerequisites, and expected results.
    These remain instructions to perform, without controls that mark them
    passed.
  - `actions` shows all supplied options, owners, conditions, permissions, and
    recommendations. A `message` is shown verbatim before **Copy request** and
    **Add to message** controls. Adding appends to the original thread's
    composer without submitting or replacing its draft. It is disabled for
    another thread, a new-thread draft, an editor, or a gallery without that
    thread's composer. Items without a message have no request controls.
    Reference, review, and action lists allow up to 256 entries, separately from
    the recap's short lists. These are rendering components, not a background
    UI-writing agent; recap state and send behavior are unchanged.
- Components are written as `name(field: value, …)` statements inside
  `workstreams` fences; one fence holds one or more of them. Every argument is
  named, and values are static: `"text"`, numbers, `true`, `false`, `null`,
  `[lists]`, `{key: value}` objects, bare enum words such as check `status`,
  and, inside `group`, nested components. `"""…"""` holds multi-line text; text
  containing a triple-backtick fence needs a four-backtick `workstreams` fence.
  Operators, templates, variables, and bindings are rejected. Field names,
  required fields, enums, and limits come from the same schemas that validate a
  component, and the signature lines in the agent instructions are generated
  from them.
- The instructions teach that strict form, but a component still renders when
  its writer's intent is clear: single, curly, or backtick quotes; unquoted
  text; missing or extra commas; `=` for `:`; positional arguments; names in
  another case, a common synonym, or a small misspelling that points at one
  field; enum words such as `Passed`, `ok`, or `not tested`; numbers and
  booleans written as text; a single value where a list belongs; a string for a
  step or evidence entry; unknown fields, which are dropped; indented `"""`
  text; nested groups, which flatten; a `Workstreams` or `workstream` fence; a
  call its writer closed with `}`, closed twice, or never closed at all; and a
  fence its writer closed at the end of the last component's line. A statement
  that still fails shows its source with a one-line reason that carries a line
  and column and, for a near-miss name or enum word, a "did you mean"; the other
  statements in the fence still render. Replies stored with a JSON object in the
  fence keep rendering.
- Checks and delivery stages can include evidence links. Relative evidence paths
  stay inside the message's workspace; external files use explicit absolute
  paths. Native file previews preserve literal filename characters and separate
  line ranges. Components contain reported information, not independently
  verified facts. Check and delivery scopes identify where and when a result
  applies. The read-only `WorkstreamsReplyExamples` tool supplies illustrative,
  validated examples only to sessions using Structured replies; it never
  executes work. Existing agent sessions may need a fresh start to receive a
  newly registered tool and its guidance.
- The docked recap owns its headline, results, and actions. Historical and
  dismissed recaps keep the card's fields inside the block and draw them
  plainly: the state as a small muted line, then Done, Not done, Review, Waiting
  on, Links and Next as labelled rows with their marks, and no frame, tint or
  actions. A malformed component shows its original source and a diagnostic
  without discarding the explanation or the recap. Streaming and upstream
  rendering fallbacks remain available.
- Completion messages from the Subagents plugin show their reply blocks inline,
  in a bordered panel labeled Subagent, with the worker's name and BB's standard
  thread chip for the full transcript. They use the thread's message type size,
  including completions delivered while the parent thread is running. File links
  use the worker's workspace. Unsupported, incomplete, or unverified deliveries
  keep BB's original message.

Workstreams detects the slot when its app loads and reports it to the server,
which keeps the latest report. Without the slot, Settings has no Structured
replies row and new provider sessions use the recap tool; a setting turned on
under the fork stays stored. Existing sessions retain their loaded tools and
instructions across setting changes, client capability changes, and plugin
reloads. While **End turns with a recap** is enabled, the recap tool supplies
every card and reminders ask for that call; disabling that setting removes the
reporting requirement and automatic reminders. Outside Subagents deliveries,
reply blocks without a renderer show as plain Markdown.

### Structured question card (`AskUserQuestion`)

When an agent needs a structured decision (and the active provider does not
supply its own native question tool), `AskUserQuestion` renders an amber card
above the composer:

- Supports `1–4` questions in tabs, each with up to `4` single-select or
  multi-select options (with number-key shortcuts and optional Markdown
  previews) plus an **Other…** freeform input.
- Freeform answers support pasted images and project file attachments. `Enter`
  advances to the next question or submits the final answer; `Shift+Enter`
  inserts a newline. On a compact viewport with a coarse pointer, `Enter`
  inserts a newline. Answers remain while the viewport or pointer mode changes.
  Switching between questions or options keeps the text you have typed.
- Draft answers save automatically to `sessionStorage` (`250 ms` debounce) and
  recover across page reloads or interrupted turns.
- A question outlives its turn when the turn is interrupted, so it stays
  answerable above the composer until you answer or dismiss it. Sending a
  message of your own from the composer closes it instead.
- Submitted questions remain inline as read-only cards, collapsed by default to
  a compact summary of each question and answer. Expand a card to see the
  original question text, details, all options and previews, selected answers,
  free text, notes, and downloadable image or file attachments. They use the
  same display after an interruption, recovery, or page reload, without an extra
  raw JSON answer. Older answers retain the information saved with them; exact
  selections are marked when the structured submission is available. Cards
  expand and collapse with a short animation, unless reduced motion is enabled.
  Expanding at the bottom keeps the card's top in place and detaches the thread
  from the bottom. Dismissed questions keep their original content and dismissal
  status.

### Workstreams page (`/plugins/workstreams/home`)

Open **Workstreams** in the main navigation panel. The page is a queue that
shows one thing at a time that needs you: Up Next's threads in the sidebar's
order, then the organizer's suggestions. The order holds while the page is open.
The next items wait as a stack of cards behind the current one, the next two
peeking out above it. Acting on an item, or skipping it, tucks its card under:
it drops clear of the stack, slips behind it, and rises to the back while the
others move up a place; going back reverses the path. A card too tall to fit
behind the next one fades away on its way. A moving card follows a sideways loop
and banks slightly. Presses are taken one card at a time, at least 60 ms apart
and only when the previous card clears; a press that arrives while one waits is
dropped, and a press the other way is always taken. Holding `↓` moves cards on,
and holding `↑` brings them back. Repeats start after 250 ms and run every 25
ms. As a hold continues, the springs stiffen and clearing loosens while cards
stay whole; letting go rests on a whole card. When a card comes back from behind
the stack it regains its colour, and the card it is about to cover dims its
content and shrinks to the size it will have under it, keeping its frame and
background. Under reduced motion the new item only fades in. To look ahead or
back without acting, use the footer's arrows, which also show where you are ("2
of 9"), or press `↓`, `→` or `J` for the next item and `↑`, `←` or `K` for the
previous one. The card stack's top edge sits about a quarter of the way down the
page, and the heading sits in a fixed place just above the stack. The replies
and actions follow the card and the page grows downward, so opening Reply,
holding `Shift`, or a receipt appearing above never moves anything. The stack
keeps that place from item to item and follows the window as you resize it; it
only glides down when the next item's heading wraps to more lines. The new
heading fades in place; the receipt line crossfades to the next one with a small
drift. Under reduced motion the card only fades in and the heading changes in
place.

Question cards on this page use the same form as the thread: choose options,
review previews, add notes, answer in your own words, or attach files and
images, then submit or dismiss. Draft answers follow you between the page and
the thread. Submission resumes an active question tool; an interrupted question
sends its recovered answer to the thread. Question footers run edge to edge
inside the card, with **Cancel** aligned to the question text and **Submit** on
the opposite side.

Waiting recaps show their status-check countdown. **Dismiss recap** (`D`)
cancels that check and removes the item from the queue; **Undo** restores the
recap with its check still cancelled. Review and complete recaps keep their
links and proposed replies, and suggestions offer **Accept** and **Decline**.

Each thread shows its workstream (click it to open **Topics**) and title above
its latest recap card. Under the card:

- **Replies:** the agent's proposed next messages, in full. Click one or press
  `1`–`3` to send it; hold `Shift` while clicking or pressing the number to edit
  it in the composer first. A hint saying so fades in while the pointer is over
  the replies, a reply has keyboard focus, or `Shift` is held.
- **Reply** (`R`) opens a composer in place of the replies: `Enter` sends,
  `Shift+Enter` adds a line, `Esc` goes back.
- **Snooze…** (`S`) opens the snooze presets at the button; press `1`–`6` to
  choose one, or **Custom…**.
- **Archive** (`E`) and **Open** (`O`). On a complete recap with no replies,
  Archive comes first.

The row of actions is centered in the column.

A suggestion shows the topics its threads would move to (new ones marked), with
**Accept and move N threads** (`1`) and **Decline** (`2`).

Actions leave a receipt above the next item. Archive, snooze, recap dismissal,
and suggestion decisions offer **Undo** (`U`). A sent message waits `5` seconds
behind its receipt before it goes out, so Undo can keep it from sending.
Question answers and question dismissal apply immediately and cannot be undone.
While a question is open, its form replaces the proposed replies and **Reply**
action. The queue arrows stay below the scrollable cards, including long
questions. When Up Next is clear, the page says so and offers to go through the
earlier open threads.

The **⋯** menu in the corner opens:

- **Activity:** Day-grouped log of automatic and outside changes. Filter by
  workstream, action (`Move`, `New workstream`, `Rename`, `Delete`, `Undo`,
  `Reorganize`, `Edit`, `New thread`, `Updated title`, `Removed topic`,
  `Suggestion`), **Needs review**, or **Outside changes**. Hover or focus any
  reversible entry and click **Undo** to revert its effect when current BB state
  still matches.
- **Topics:** The organizer's status with **Re-run** and **Rebuild…**, every
  suggestion waiting for a decision (**Threads move**, **Groups change**, and
  the collapsed **out of date**), threads with no topic, and the topic tree.
  Click a topic to rename it, move it under another, edit its description and
  aliases, add a subtopic, or merge it into another. **Review automatic topics**
  previews topic repairs for up to `100` visible roots against the current tree
  (model calls only) and applies them when you confirm; plans expire after `30`
  minutes and skip manual assignments and threads whose evidence changed. In
  Topics, `j`/`k` move between suggestions and `a`/`d`/`u` accept, decline, and
  undo.
- **Model calls** (debug UI only): the traces behind Workstreams' model calls.

Each opens as its own view with **Back**. Deep links still work:
`/plugins/workstreams/home/activity`, `/debug`, and `/topics` (also
`/organization`).

---

## Commands and keyboard shortcuts

| Command / Shortcut                                              | Where                             | Action                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Workstreams: next Up Next thread` (`Cmd+Alt+J` / `Ctrl+Alt+J`) | Global command palette / shortcut | Opens the next thread in Up Next, wrapping to the top.                                                                             |
| `Workstreams: snooze this thread`                               | Command palette (active thread)   | Snoozes the current thread using your configured **Click to snooze** default preset.                                               |
| `Workstreams: wake this snoozed thread`                         | Command palette (snoozed thread)  | Wakes the current snoozed thread immediately.                                                                                      |
| `Workstreams: toggle debug UI`                                  | Global command palette            | Shows or hides the debug UI without touching recording; bind a shortcut in **Settings → Keyboard** (unbound by default).           |
| `1`–`3`, `Shift`, `R`, `S`, `E`, `O`, `U`, `↑`/`↓`/`←`/`→`      | Workstreams page                  | Sends a reply (`Shift` edits it first), replies, snoozes, archives, opens, undoes, or skips (`↓`/`→`/`J` ahead, `↑`/`←`/`K` back). |
| `Shift+Click`                                                   | Recap card **Next action** button | Copies the suggested prompt into the composer for editing instead of sending immediately.                                          |
| `Shift`+pick                                                    | Recap card **Next actions** menu  | Copies the chosen prompt into the composer; holding `Shift` shows the **Edit in composer** hint.                                   |
| `1`–`4`, `Enter` / `Shift+Enter`                                | `AskUserQuestion` card            | Selects an option by number; submits the answer (`Enter`) or inserts a newline (`Shift+Enter`).                                    |

---

## Snooze presets and wake behavior

Threads can be snoozed from the sidebar hover button, the sidebar right-click
menu, the thread header, or the command palette, and a whole workstream's
threads at once from its sidebar header. Every snooze menu lists your presets in
order, then **Custom…**; clicking a snooze button uses the default preset.

You keep between `1` and `6` presets in **Settings → Workstreams → Snooze**.
Each preset has an optional label (an empty label names it by its rule) and one
rule, which resolves to a wake time at the moment you choose it:

| Rule                        | Wakes                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Duration**                | That many minutes or hours from now (up to `999`), or that many days from now at the same clock time (up to `365`).                                                            |
| **Time**                    | At a clock time on **Today** (tomorrow once that time has passed), **Tomorrow**, **Next workday** (Friday through Sunday wake on Monday), or the coming weekday (never today). |
| **Until there's an update** | At the first wake event (below), with no time (`until: null`).                                                                                                                 |

A **Duration** or **Time** preset also has **Wake early on events**: when on,
the thread wakes at its time or at the first wake event, whichever comes first.
It starts on for a duration (a short break while something runs) and off for a
time (work put away until then); a duration preset saved before this setting
existed wakes early until you turn it off.

The defaults are **1 hour** (wakes early), **Tomorrow morning** (tomorrow at
`9 AM`, the default), **Next week** (Monday at `9 AM`), and **Until there's an
update**.

**Custom…** opens a dialog for a one-off snooze. It lists the same rules
(**Duration**, **Time**, **Until there's an update**) plus **Date** as radio
buttons, and the chosen one shows its fields just beneath it, with **Wake early
on events** below for the timed ones (on for a duration, off for a time or date,
until you change it). It opens on **Date**, which picks any date and time up to
`366` days out. Editing a preset never moves a thread that is already snoozed: a
snooze stores only its wake time and whether it wakes on events.

### Wake events

A snooze that wakes on events ends at the first of these that happens after it
was set and is turned on in **Settings → Workstreams → Snooze** (all are on by
default; with every one off, **Until there's an update** never wakes on its
own). The thread returns marked unread.

| Group            | Event                        | Happens when                                                                                                                             |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Thread**       | **Needs you**                | A question card or approval is pending, or a turn ends needing your decision.                                                            |
|                  | **Ready for review**         | A turn ends ready for your review.                                                                                                       |
|                  | **Done**                     | A turn ends complete.                                                                                                                    |
|                  | **Error**                    | A turn fails and stays failed for a minute with no retry queued.                                                                         |
|                  | **Message fails to send**    | A queued message fails to send.                                                                                                          |
|                  | **Machine restart stops it** | The thread or a delegate has waited `5` minutes for its machine.                                                                         |
| **Delegate**     | **Needs you**                | A delegate has a question card or approval pending, or its turn ends needing a decision or review.                                       |
|                  | **Fails and work stops**     | A delegate failed and, for `5` minutes, nothing in the tree runs, queues, or asks you anything while the thread's last turn waits on it. |
| **Pull request** | **Changes requested**        | The thread's pull request moves to changes requested.                                                                                    |
|                  | **Checks failed**            | Its checks move to failed.                                                                                                               |
|                  | **Ready to merge**           | It moves to approved, green, and mergeable.                                                                                              |

A turn that ends still waiting or blocked on something else, a turn starting, an
automatic retry, a background job, a retitle or move, and Workstreams
re-summarizing a thread never wake it: a turn counts by how it first read. A
snoozed thread's pull request is looked up when you snooze and then every `5`
minutes, while the snooze wakes on events and a pull request event is on. Only a
change counts: a pull request already failing its checks when you snooze doesn't
wake the thread. Likewise a question, failed send, or machine wait already there
when you snooze never wakes it.

- Snoozing a root removes the root and its entire delegate subtree from its
  workstream and from **Up Next** / **Recent**, placing them in the **Snoozed**
  section until wake.
- **Time-only snoozes ignore agent activity** so an overnight run does not wake
  a thread before morning; when a timed snooze expires, Workstreams wakes the
  thread and marks it unread.
- Sending a message to a snoozed thread or clicking **Wake now** wakes it
  immediately.

---

## Settings reference

Open **Settings → Workstreams** to configure:

| Section               | Setting                                            | Default                                     | Details                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sidebar**           | **Up Next**, **Recent**, **Snoozed**, **Archived** | All `On`                                    | Show or hide each band in the Workstreams sidebar.                                                                                                                                                                                                 |
| **Sidebar**           | **Threads shown** (under Recent)                   | `5` (`1–20`)                                | Maximum root threads shown in the Recent band.                                                                                                                                                                                                     |
| **Sidebar**           | **Up next and workstreams on phones**              | `On`                                        | Replaces BB's flat Recent list on the compact phone Home screen.                                                                                                                                                                                   |
| **Sidebar**           | **Timestamp**                                      | `Always`                                    | Show each row's age, right after its title, `Always`, `On hover`, or `Never`.                                                                                                                                                                      |
| **Sidebar**           | **Thread count** / **Waiting count**               | `When collapsed`                            | Show workstream counts `Always`, `When collapsed`, or `Never`.                                                                                                                                                                                     |
| **Up Next**           | **Threads shown**                                  | `5` (`1–10`)                                | How many rows Up Next shows by default. Threads blocked on you still grow past this count, up to `10`.                                                                                                                                             |
| **Up Next**           | **Keep Up Next full**                              | `On`                                        | On, threads you have read top up the rows after the ones that need you. Off, Up Next leaves them out, so it holds fewer rows than **Threads shown**, or none, when nothing needs you.                                                              |
| **Up Next**           | **Unread first**                                   | `On`                                        | On, unread threads come before read ones, newest first. Off, each thread ranks by what its turn was blocked on, so a read question can lead an unread review.                                                                                      |
| **Up Next**           | **Prioritize recent threads**                      | `Don't prioritize`                          | Threads whose turn ended within the chosen window (`Last hour` through `Last week`) lead, whatever they were blocked on. The ranking above still orders the threads inside each group.                                                             |
| **Working indicator** | **Style**, **Color**, **Track**                    | `Spokes`, `Subtle gray`, `Faded color`      | Choose from `7` spinner shapes (`Spokes`, `Sunburst`, `Arc`, `Orbit`, `Ring`, `Braille`, `Dots`), named or custom `#rrggbb` colors, and track styles for `Arc`/`Orbit`/`Ring`.                                                                     |
| **Colors**            | **Default colors**, then six colors                | `Workstreams`                               | **Default colors** picks Workstreams' own shades or matching bb theme colors; each color's swatches can override it with a theme color or a custom `#rrggbb`.                                                                                      |
| **Threads**           | **Full analysis model**                            | `openai/gpt-6-sol-fast`                     | Model used at turn end to settle goals and fallback status.                                                                                                                                                                                        |
| **Threads**           | **Keep titles current**                            | `On`                                        | Automatically titles new threads and updates titles as focus evolves. Outside manual title edits stay locked until cleared.                                                                                                                        |
| **Threads**           | **Title on scroll**                                | `Minimize`                                  | Minimize shrinks the heading into the title bar as you scroll; `Float` leaves it over the thread, which moves beneath its shadow.                                                                                                                  |
| **Threads**           | **Title transition**                               | `Fade`                                      | While the title minimizes, `Fade` gently moves the large heading back as the minimized title rises into place, and `Scroll` slides both as they cross. Narrow pinned titles step down at once. Shown only while **Title on scroll** is `Minimize`. |
| **Threads**           | **Title alignment**                                | `Left`                                      | Where the minimized title sits in the title bar: `Left` after the thread's controls, or `Centered` in the bar's middle. Shown only while **Title on scroll** is `Minimize`.                                                                        |
| **Threads**           | **Show parent thread link**                        | `Off`                                       | Shows a parent-thread pill in delegate thread headers.                                                                                                                                                                                             |
| **Threads**           | **Show archive button**                            | `On`                                        | Shows an Archive button in thread headers.                                                                                                                                                                                                         |
| **Recap**             | **End turns with a recap**                         | `On`                                        | Gives agents `WorkstreamsRecap` and displays the recap card above the composer.                                                                                                                                                                    |
| **Recap**             | **Reminders**                                      | `3` (`0–10`)                                | Maximum turn-end reminders sent when an enrolled agent omits a recap (`0` disables reminders).                                                                                                                                                     |
| **Recap**             | **Structured replies**                             | `Off`                                       | Agents report each turn with the recap tool, then write the reply as one `:::reply` block that ends the turn. Shown only with the tomdale/bb fork.                                                                                                 |
| **Recap**             | **Layout**                                         | `Full` (`Full` / `Compact`)                 | Card layout on desktop (`Compact` is always used on phones), with a live preview carousel.                                                                                                                                                         |
| **Recap**             | **Commit hash colors**                             | Theme default                               | Custom `#rrggbb` colors for commit-hash digits and letters, with **Reset**.                                                                                                                                                                        |
| **Snooze**            | **Presets**                                        | `4` presets, **Tomorrow morning** default   | `1–6` presets every snooze menu lists before **Custom…**: add, edit, delete, drag to reorder, and choose the **Default** a click uses.                                                                                                             |
| **Snooze**            | **Wake on …events** (three groups)                 | All `On`                                    | Which wake events end a snooze that wakes on events (see [Wake events](#wake-events)).                                                                                                                                                             |
| **New threads**       | **Home project**                                   | `Don't work in a project`                   | Default project used for background worker fallback when a thread has no project.                                                                                                                                                                  |
| **New threads**       | **Suggestions while typing**                       | `On`                                        | Runs Quick analysis on composer drafts while typing.                                                                                                                                                                                               |
| **New threads**       | **Quick analysis model**                           | `openai/gpt-6-luna-fast` (reasoning `none`) | Model used for composer draft previews and first-send Quick analysis (remains active when typing suggestions are off because first-send analysis still uses it).                                                                                   |
| **Organization**      | **Placement model**                                | `openai/gpt-6-sol` (reasoning `none`)       | Model that chooses each root's topic from its requests, when it starts and after a new request.                                                                                                                                                    |
| **Organization**      | **Fast placement**                                 | `Off`                                       | Asks a decision model placement's closed choice as a typed question, and uses an answer at `0.95` confidence or above so the placement model is skipped. Anything less is asked of the placement model.                                            |
| **Organization**      | **Fast placement model**                           | `openai/gpt-6-luna-decisions`               | Decision model that answers placement's question with a topic and its probability. It must run on AI Gateway directly, not as a BB worker.                                                                                                         |

| **Organization** | **Organizing suggestions** | `On` | Suggests lasting topic
divisions and tidy edits for review. **Ask now** works either way; categories
update independently. | | **Organization** | **Organization model** |
`anthropic/claude-sonnet-5.5` (`medium`) | Model that categorizes current thread
collections and writes reviewed topic suggestions. | | **Advanced** | **Analysis
machine** | Automatic | Enrolled BB machine used for gateway model calls when
multiple machines are connected. |

| Section      | Setting                          | Default | Details                                                                                                                  |
| ------------ | -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Advanced** | **Record model calls**           | `On`    | Records redacted model traces (`7` days / `1,000` records), whether or not the debug UI is showing.                      |
| **Advanced** | **Debug UI**                     | `Off`   | Shows the surfaces below. The **toggle debug UI** command flips it without touching recording.                           |
| **Advanced** | **Inspect buttons**              | `On`    | The bug button on rows and banners that opens the recorded calls behind a decision.                                      |
| **Advanced** | **Activity model calls**         | `On`    | Recorded calls listed in Activity, with kind and failure filters, reported cost, and **Clear traces…**.                  |
| **Advanced** | **Composer routing diagnostics** | `On`    | The **Debug** disclosure under the new-thread composer: confidence, inputs, and the server's notes on each routing step. |
| **Advanced** | **Reply diagnostics**            | `On`    | **Raw agent output** and reply syntax diagnosis on assistant replies.                                                    |
| **Advanced** | **Thread Info and context card** | `On`    | The **Workstreams Debug** section listing the metadata Workstreams accumulated for a thread.                             |

### Gateway vs. provider worker models

- **AI Gateway models** (the built-in defaults and `pi` models prefixed
  `vercel-ai-gateway/`) run directly on the connected analysis host via
  `~/.pi/agent/auth.json` or `AI_GATEWAY_API_KEY` (`90 s` timeout,
  schema-constrained JSON for Quick analysis, no silent model fallback).
- **Other BB provider models** run inside a temporary hidden
  `"Workstreams worker"` BB thread (`120 s` timeout, automatically stopped and
  archived after completion), which takes several seconds longer per call. The
  released SDK does not expose schema-constrained generation or output-token
  limits for spawned threads. Responses still pass the same parser, validation,
  and bounded repair rules, but generation itself is unconstrained. Worker token
  usage, cost, and reasoning metadata are unavailable (`null` in traces), not
  evidence that the call was free.

---

## CLI reference

Run `bb workstreams --help` or any subcommand below. Every command accepts
`--json` for machine-readable output.

### Workstreams, organization, analysis, and activity

```sh
# List active workstreams, Unfiled, and Dormant groups with thread and Up Next counts
bb workstreams list [--json]

# Show threads in one workstream (by name, section ID, or "unfiled"), nested by parent
bb workstreams show <workstream> [--json]

# Inspect current organizer state and agent-report coverage, or force a fresh pass
bb workstreams organization [--rebuild] [--json]

# Run Full analysis on one thread now, or queue all unanalyzed active threads
bb workstreams analyze [<thread-id>] [--json]

# Read the activity log (retained for 90 days / 2,000 entries; default --since unit is hours)
bb workstreams log [--limit 1..500] [--since <duration, e.g. 90m or 7d>] [--external] [--json]

# Undo a logged activity entry when current BB state still matches
bb workstreams undo <entry-id> [--json]

# List organizing suggestions waiting for you (--all adds recent decisions), or ask for them now
bb workstreams suggestions [--all] [--json]
bb workstreams suggestions run [--json]

# Accept or decline suggestions by id, or all waiting ones
bb workstreams suggestions accept <id...|all> [--json]
bb workstreams suggestions decline <id...|all> [--json]

# Inspect recorded Debug-mode model traces (kinds: quick-analysis, full-analysis, placement, categories, split, tidy)
bb workstreams trace [<trace-id>] [--thread <id>] [--entry <id>] [--kind <kind>] [--limit 1..500] [--json]

# Inspect an assistant reply's raw output and diagnose :::reply / component syntax issues
bb workstreams reply <thread-id|@thread:id[#msg=seq]|url> [--message <seq>] [--json]
```

`show` returns at most 200 rows and reports truncation; JSON includes `count`,
`shown`, and `hasMore`. `log` defaults to 50 entries (maximum 500), applies
`--since` to the matching query window, and reports whether more matching
entries remain. Its JSON adds `count`, `limit`, and `hasMore`. `trace` defaults
to 20 records (maximum 500). These are bounded inspection commands, not full
history exports.

### Topic tree management and repair plans

```sh
# List all topics sorted by full path (Owner: Capability)
bb workstreams topics list [--json]

# Show a topic's ID, path, description, parent, aliases, active workstream home, and assigned threads
bb workstreams topics show <topic-name-or-id> [--json]

# Create, edit, reparent, or merge topics (automatically triggers the organizer)
bb workstreams topics create <name> [--description <text>] [--parent <topic-name-or-id>] [--aliases <a,b,c>] [--json]
bb workstreams topics edit <topic> [--name <name>] [--description <text>] [--aliases <a,b,c>] [--json]
bb workstreams topics reparent <topic> [--to <parent-topic-or-root>] [--json]
bb workstreams topics merge <source-topic> <target-topic> [--json]

# Preview and apply automatic topic repairs (up to 100 roots per preview; plans expire after 30m)
bb workstreams topics preview [<root-thread-id>] [--json]
bb workstreams topics apply <plan-id> [--json]

# Review a two-level identity migration; blocked assignments require explicit destinations
bb workstreams topics migration preview [--mapping '<JSON choices, newTopics, resetThreadIds>'] [--json]
bb workstreams topics migration apply <plan-id> [--json]
bb workstreams topics migration backup <backup-id>
```

A migration preview proposes folding deeper identities into their existing
second-level ancestor. It leaves first-level assignments blocked when that topic
has children: supply a meaningful destination for each, rather than creating a
catch-all. `--mapping` accepts an object with `choices` (`threadId`, `topicId`)
and `newTopics` (`key`, `name`, `description`, `parentId`, optional `aliases`).
A choice can refer to a new topic's `key`. Explicit `resetThreadIds` remove
nonmanual classification records instead of inventing destinations for obsolete
work. Reset and refile choices cannot overlap, and manual filing cannot be
reset. Resetting classification does not delete threads or transcripts; a
reopened thread may stay Unfiled until placed or filed again.

Preview changes no topics or assignments. Apply requires the reviewed plan ID,
refuses changed topic definitions or assignments, and preserves filing
provenance and classification basis for refiled threads. It retains original
definitions, assignments, bindings, and layout in a recovery snapshot. Removed
topic paths become aliases of their destination. Explicit project associations
require separate review; narrower learned associations are not copied onto a
broader topic. Recovery snapshots are exportable data, not an Undo that
reinstates an invalid topic tree.

### Per-thread topic assignment

```sh
# Inspect a thread's workstream, topic, provenance source, and parent inheritance
bb workstreams thread show <thread-id> [--json]

# Manually assign a thread to a topic (sets manual provenance; protected from automatic changes)
bb workstreams thread assign <thread-id> <topic-name-or-id> [--json]

# Manually clear a thread's topic so it stays Unfiled (sets manual provenance)
bb workstreams thread clear <thread-id> [--json]

# Hand a thread back to automatic classification and place it again now
bb workstreams thread reclassify <thread-id> [--json]
```

---

## Recording and the debug UI

Recording and the debug UI are separate settings under **Settings → Workstreams
→ Advanced**:

- **What gets recorded** holds **Record model calls**, on by default. Traces
  accumulate whether or not the debug UI is showing, so hiding the UI for a
  screen share keeps the record for later.
- **What the UI shows** holds **Debug UI**, off by default, with one switch per
  surface beside it. The **Workstreams: toggle debug UI** command and its
  keyboard shortcut flip **Debug UI** without touching recording, and the
  surface switches keep their own choices across those toggles.

What gets recorded:

- **Trace recording & redaction:** Every Quick analysis, Full analysis,
  placement, category, split, and tidy model call records its redacted input,
  prompt, raw response, reasoning summary, parsed output, token usage, cost,
  duration, and applied outcome. Common secret patterns (`sk-…`, `ghp_…`,
  `github_pat_…`, `xoxb-…`, `Bearer …`, and
  `api_key`/`token`/`password`/`secret` assignments) are masked before prompts
  reach a model or trace store. Redaction is best effort, not a security
  boundary; do not put secrets in requests or assume diagnostics are safe to
  share without inspection. Conversation excerpts go to your selected model
  provider under that provider's policies. Traces are retained for `7` days or
  `1,000` records and pruned automatically, and they keep arriving whether or
  not the debug UI is showing.

What the UI shows:

- **Thread Inspector:** Click the bug (`Inspect`) button on an Overview row,
  Activity row, or trace entry to open the side-pane inspector. Inspect every
  recorded call for a thread, copy the full trace JSON, or click **Run again**
  to replay the stored prompt against the current model and compare canonical
  results (`Same result` vs. `Differs in <fields>`) without mutating thread
  state. Replays use the recorded output schema when available; older traces
  without one replay without a schema. The current parser interprets the reply,
  so a comparison can also differ when the output contract has changed.
- **Thread Info and context card:** Each thread's Info tab and context card gain
  a **Workstreams Debug** section listing the metadata Workstreams accumulated
  for the thread: the settled goal, the context digest, the topic assignment and
  its provenance, the settled title, and the latest analysis run's status,
  model, and age. The activity list below the metadata combines related Activity
  events with the thread's Quick analysis, Full analysis, and Placement calls.
  Full analysis rows label their historical assessment as **Work status** so it
  is distinct from the call's completion. Hovering or focusing a row reveals a
  chevron. Click an event to open every recorded model call behind it, including
  the exact prompt, reasoning, raw response, and parsed result.
- **Activity model calls:** Filter the **Activity** tab by **Model calls**
  (`quick-analysis`, `full-analysis`, `placement`, `categories`, `split`, or
  `tidy`) and **Failures only**, view total reported cost for the filtered
  calls, or click **Clear traces…** to delete recorded model traces while
  keeping the Activity log intact.
- **Composer routing diagnostics:** Expand the **Debug** disclosure in the
  new-thread composer to inspect live Quick-analysis confidence, inputs, token
  usage, reasoning, and copyable JSON diagnostics.
- **Reply raw output & syntax diagnostics:** Expand **Raw agent output** on any
  assistant reply (including unclosed `:::reply` blocks and responses where
  `:::reply` failed to parse or was omitted) to view line-numbered syntax and
  component diagnostics alongside the raw agent output before parsing, or run
  `bb workstreams reply <target>` from the CLI.

---

## Development

Build and verify in an isolated Workforest task worktree; deploy only from the
canonical checkout.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

### UI performance

Client views share preference loads and pending-question polling. Equal server
and sidebar snapshots retain their unchanged values, so unrelated updates do not
redraw every thread row or reparse stable reply text. Timeline observers check
mutation records before scanning for delivered questions, subagent results, or a
replacement message scroller. The thread heading follows the active pane without
measuring intermediate pane replacements during navigation.

The New thread composer shares one identity reporter per draft. Text and
picker-only updates stay in the full model for submission and diagnostics; topic
controls subscribe to the fields they draw. Identity reports remain prompt for
Enter: equal payloads and intermediate updates before the next microtask are
coalesced, without a typing debounce or waiting for an earlier RPC. Clearing or
disposing a draft flushes its pending nonempty report before it can be
discarded.

Profile the composer's one-view and kept-alive two-view cases with
`npm test -- tests/app/typing-performance.test.tsx`. The tests count React
commits and RPCs across 60 edits, and verify that both views still share one
preview.

Run the render-count regressions with:

```sh
npm test -- tests/app/client-performance.test.tsx tests/app/sidebar-performance.test.tsx tests/app/home-performance.test.tsx tests/app/stable-content-rendering.test.tsx tests/app/duplicate-request-performance.test.tsx
```

The regressions count work with advancing clocks and JSON-cloned sidebar
updates; React duration samples are diagnostic, not timing thresholds.

Profile the Up Next shimmer in headless Chrome with `npm run profile:shimmer`.
The command writes Chrome traces and a JSON report to a temporary directory. Set
`CHROME_PATH` if Chrome is not installed in a standard location. To compare
another stylesheet, pass `-- --baseline /path/to/styles.css`. The profiler uses
an isolated card and does not load BB thread data. Browser regressions also
check the gradient trajectory, light and dark rendering, compositor activity,
and reduced motion.

### Queue motion lab

The [queue motion lab](prototypes/queue-motion/README.md) tests the queue's
motion outside the Workstreams page. When its BB file link opens in an external
browser on the BB machine, Workstreams launches the built lab on an isolated
loopback origin so named presets can use browser storage. The BB file preview
cannot save presets; copy its settings before using **Open in external browser**
and paste the copied hash into the browser address to restore them.

### Standalone design system gallery

Run `npm run gallery` and open the local URL printed by Vite to browse the
Workstreams design system outside BB. The development-only app in `gallery/`
imports the plugin's actual components and vendored BB controls. It is separate
from the plugin's Gallery view and is not registered or shipped in the plugin.
Build a static copy with `npm run gallery:build`. It writes
`gallery/dist/index.html` and `gallery/dist/sidebar.html`, each a single file
with its script, styles, fonts, and icons inline, so you can open them directly
from disk with no server. `npm run build` runs it after building the plugin, so
the pages stay current whenever the plugin is rebuilt.

The gallery includes foundations, a **Primitives** group, work identity,
settings, overlays, recap and question playgrounds, and reply examples. Its
**Sidebar playground** opens a separate development-only page with side-by-side
Trial and Current examples, configurable row treatments, and independent
connecting lines for the Workstreams section, shared parents, workstreams,
categories, and child threads. Trial starts with the plugin's sidebar defaults,
drawn from its geometry, typography, and preferences; reset returns to those
defaults. Sidebar width is a shared preview control because BB owns the actual
width. Experimental treatments with no app counterpart keep their own settings.
Line controls set visibility, width, color, indent, and spacing. Changes and
expandable state can be shared in the URL; fragments from older playground
settings URLs can be applied to this page. The examples use the plugin's thread
rows and workstream names with local fixtures, while the alternative grouping
and layout treatments are simulated. Topic and status colors use the
playground's light and dark fixtures, not your live BB settings. Nothing writes
to BB or ships in the plugin.

The playground batches real thread rows and workstream names into one React
update per affected preview. Trial-only settings leave Current untouched; focus
and sort update both previews, while width, theme, and bounds update their
styling without rebuilding rows. Each preview keeps its own collapse and
lower-tier state.

Settings and overlay actions show their latest outcome after interaction, with
earlier actions in an optional disclosure. Question presets cover freeform and
multi-question forms, submission states, and retained answers; recap presets add
artifacts, hashes, long content, and awaited-agent states. Color choices use the
production token generator and reset when you leave the example. The standalone
theme supplies neutral registry aliases and a Purple fixture from Workstreams'
default suggestion color; it is not a live BB theme.

The Primitives group documents the small pieces the plugin's components share,
one page each with its variants side by side: status dot, count pill, key chip,
section heading, and menu classes. They live in `src/app/primitives/`, and the
sidebar, Home, queue, Topics, and settings use them directly.

Gallery configuration sits in panels labeled **Gallery controls**. Frames
labeled **Live example** identify the demonstrated components and link to their
production sources. Interaction outcomes, action history, generated CSS, and
source disclosures sit outside those frames. Controls inside a live frame belong
to the demonstrated component, such as a settings switch or a question's answer
choices.

Use the theme and preview-width controls to inspect the components, and open
each example's source disclosure to see its imports. Preview width resizes the
live examples, not gallery configuration or documentation. Overlay presentation
can follow the viewport or use the registry's compact-view override; a drawer
preview does not emulate touch media queries or a soft keyboard. The
introduction preview fills the selected width: Wide uses the available space,
Narrow caps it at 640px, and Phone caps it at 360px. All three fit within the
page. Navigation links preserve the selected page in the URL hash.

Examples use synthetic data and local state. The standalone host cannot send
messages, change threads, upload attachments, or call the Workstreams server. It
supplies a development theme and Markdown renderer; BB-specific host behavior
still needs verification inside BB. Reply examples show the current renderer,
not the target presentation described in
[docs/design-system.md](docs/design-system.md).

### Tests and verification

`npm test` runs domain, server, DOM interaction, and browser layout tests. The
browser tests require Chromium (install it with
`npx playwright-core install chromium`) or a Chrome executable in `CHROME_PATH`;
ordinary runs skip them if neither is available. The optional real-snapshot test
requires `WORKSTREAMS_SNAPSHOT`. Paid model evaluations and the plugin
activation smoke check run separately.

Tests use up to eight worker processes with isolated VM test contexts and
reusable compiled dependency code. Each process owns its native modules. DOM
tests use jsdom; layout checks use real Chrome with a fresh browser context per
test. Server fixtures use real, disposable SQLite databases with synchronous
disk flushing disabled; they cover transactions, migrations, and reopening
storage, not recovery after power loss. Fake worlds copy an empty current-schema
image into each fresh database. Real migrations produce that image once per test
module, and plugin installation still verifies the migration ledger. Migration
and storage-boundary tests use `createTestPluginHost` to start from an empty
database. Fixture tests compare the cloned schema and hashes with a fresh
migration and check isolation, rollback, reopen, and cleanup.

Gallery browser scenarios share a file-scoped Vite server and browser, with at
most two scenarios running concurrently. Each scenario owns a fresh browser
context, so cookies, storage, viewport, and theme changes stay isolated.

Component tests mount the real component through the SDK harness without loading
unrelated UI surfaces. `tests/app/registration.test.tsx` checks the plugin's
production slot bindings, feature order, and new-thread integration. Sidebar
action tests use `sidebar-action-fixture.tsx` when broader list wiring is not
under test; it still mounts the real `ThreadList` for snooze, menu, and group
actions. Consolidated cases keep negative controls and cross-group states that
make their assertions discriminating. Sidebar fixtures omit Up Next and Recent
unless the case requests `mountWithBands`. Related gestures and display variants
can share a mounted scenario; keep failure, cancellation, and ownership
boundaries explicit. Ranking policy matrices belong in domain tests, with
representative UI cases checking rendering and interactions.

Stateful UI rules also run through production headless interfaces:
`src/app/sidebar/upNextState.ts` plans Up Next's selected-row anchor and
expanded rows, and `src/app/page/activityLoader.ts` owns Activity's pagination
and request invalidation. Their tests drive state changes and deferred responses
without mounting a page. DOM tests cover the React boundary: selection and
Snooze, pagination controls, filter changes, realtime refresh, and effect
cleanup. The Activity wiring test supplies a small loader result; the headless
tests exercise the real loader with full pages. Sidebar row presentation, count
preferences, archive ancestry, band sorting, tree folding, and batch snooze
membership run headlessly through `src/app/sidebar/{presentation,rows}.ts`.
Grouping policy matrices live in
`tests/domain/{groups,nested-groups,project}.test.ts`; sidebar integration tests
keep representative rendering and interaction cases. Native row shortcuts,
Archive, disclosure, and realtime preferences are tested on a single real row
through the SDK harness, without mounting the whole sidebar. Keep these tests in
`npm test`, not a separate fast suite.

Run `npm run test:benchmark -- --runs 5 --output-dir /tmp/workstreams-benchmark`
to measure full-suite wall-clock time, including npm and Vitest startup. The
command saves each test report and log plus `benchmark.json` with
machine/runtime information and min/median/p95/max timings. It exits nonzero if
a test fails, a browser layout test is skipped, or any run takes ten seconds or
longer. Dependencies and Chrome must already be installed; each run starts a
fresh process, keeps existing transform caches, and executes every test again.
To check order independence, run
`npm test -- --sequence.shuffle --sequence.seed=104729`.

The app draws with its color tokens (`src/app/theme/tokens.css`) and BB's theme
variables; `tests/app/color-lint.test.ts` fails on Tailwind palette classes and
color literals in `src/app`.

Then run the repository's `scripts/bb-plugin-smoke` against this package to
verify activation in an isolated throwaway BB server. Opt-in model evaluations
live in [eval/README.md](eval/README.md) (they make paid model calls and are not
part of the unit test suite). The
[reply comparison](eval/README.md#reply-comparison) compares **Answer and format
in one step**, **Show the answer as written**, and **Answer first, format in a
second step** on one code-inspection task. Both steps that choose UI blocks
receive the same worked examples. Results show whether the format is valid, how
many UI blocks were used, whether broken text was found, and whether the meaning
was kept. The default command previews the experiment without paid calls. See
[PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) and
[docs/organization.md](docs/organization.md) for architectural details. See
[docs/design-system.md](docs/design-system.md) for the BB visual foundation and
Workstreams' semantic colors, components, and layout idioms.
