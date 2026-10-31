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
   existing work, change its Topic rather than dragging between sections.

See [ISSUES.md](ISSUES.md) for current limitations and audit dispositions.

## Core concepts

| Term                 | Meaning                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Thread**           | A BB thread; the unit of work shown across the UI.                                                                                                                                                                                         |
| **Root**             | A visible, non-archived thread with no visible active parent. Roots are the unit Workstreams classifies and organizes.                                                                                                                     |
| **Delegate**         | A child thread created for separable work. Delegates inherit their root's topic and workstream.                                                                                                                                            |
| **Topic**            | An entry in the topic tree representing a context, product, or capability (`Owner: Capability`), with a description and aliases. A topic holds threads or subtopics, never both.                                                           |
| **Topic tree**       | Every topic Workstreams knows, whether or not an open thread currently uses it.                                                                                                                                                            |
| **Topic assignment** | A root's assigned topic (or **No topic**), together with its provenance (`manual`, `inherited`, `full`, or `quick`) and classification basis.                                                                                              |
| **Workstream**       | A native BB section bound to one topic in the topic tree.                                                                                                                                                                                  |
| **Subgroup**         | A workstream shown inside a busier group. A group shows its subtopics as subgroups above `5` visible roots and one list again at `3` or fewer.                                                                                             |
| **Other**            | The group that gathers small top-level groups, each with fewer than `3` threads, once there are `3` of them beside a bigger group. Its rows carry their workstreams' names.                                                                |
| **Group**            | A topic as suggestion review names it: where its threads sit in the sidebar, whether or not it has threads and a workstream yet.                                                                                                           |
| **Placement**        | The one model call that chooses a root's topic from its requests, when it starts and after each new request.                                                                                                                               |
| **Suggestion**       | A split of a busy topic, or a tidy edit to the topic tree, that changes nothing until you accept it. Review lists those that move threads apart from those that only tidy groups, which move no thread and decide where future threads go. |
| **Unfiled**          | Roots that currently have no topic and therefore belong to no workstream.                                                                                                                                                                  |
| **Goal**             | What a thread is for, written as its display title: a noun phrase that leads with its subject and leaves out what its workstream and parent thread already say (`2–5` words, aiming under `32` characters).                                |
| **Status**           | How the latest turn ended: `needs you`, `review`, `blocked`, `working` (`in_progress` in JSON/CLI), `done`, or `error`.                                                                                                                    |
| **Agent recap**      | A structured end-of-turn report submitted by the agent with the `WorkstreamsRecap` tool.                                                                                                                                                   |
| **Organization**     | The deterministic process—and Workstreams page tab—that derives workstreams and section membership from topics.                                                                                                                            |
| **Activity**         | The log of changes Workstreams made or observed, with undo where supported.                                                                                                                                                                |

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
   - `manual` (chosen by you in the composer, thread header, sidebar,
     Organization tab, or CLI) is never overwritten by automatic analysis.
   - `inherited` (from a parent/source thread or a workstream's **＋** button)
     changes automatically only when placement reports a scope shift or settles
     a more specific topic beneath it, or when you explicitly apply a reviewed
     topic-repair plan or accept a suggestion.
   - `full` (settled by placement from the thread's requests) replaces `quick`
     and updates prior `full` assignments.
   - `quick` (initial guess from Quick analysis) fills only threads without a
     stronger source.
4. **Agent reports outrank fallback status.** Structured questions
   (`AskUserQuestion`) and agent recaps (`WorkstreamsRecap`) take precedence
   over Full analysis for thread status, recap text, and `needs you` prompts.
   Full analysis supplies those fields only when the agent did not report.
5. **A topic holds threads or subtopics, never both.** Once a topic has
   subtopics, every thread in it is in one of them. Assignments, new subtopics,
   moves, and merges that would put threads beside subtopics are refused,
   whoever makes them; topic pickers list only topics without subtopics. A busy
   topic gets subtopics from an accepted split suggestion.

---

## How it works

### 1. Starting a thread & Quick analysis

When you compose a new thread, the composer includes a **Topic** control (in
BB's picker row on wide viewports, or on its own strip above the prompt on
phones):

- **Automatic (`✦`, default):** Runs **Quick analysis** on your draft while you
  type (after a `250 ms` pause, or `900 ms` for drafts of `20` characters or
  fewer) to preview a goal and topic. When you send the first request, a
  matching draft preview is reused immediately without a second model call;
  otherwise Quick analysis runs on the sent request.
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

Quick analysis defaults to schema-constrained `openai/gpt-6-luna-fast` with
reasoning disabled (`15 s` timeout, up to `4` in-flight calls). Title and topic
outputs validate independently: an invalid topic receives one bounded repair
attempt within the remaining time budget and never blocks a valid opening title
or clears an existing assignment. Opening titles only fill threads that do not
yet have a title while the first turn is still running.

A new root's first request is also **placed** right away (see below), so Quick
analysis's topic is a guess that placement settles within a few seconds.

### 2. Turn end & Full analysis

When a visible, non-archived thread goes idle after a turn (`5 s` debounce, up
to `4` concurrent runs), **Full analysis** runs with:

- The thread's opening request, recent substantive user requests (control-only
  replies such as `continue`, `yes`, or `ok` do not redefine the thread's
  objective), referenced continuation threads (`@thread:`), and the latest
  assistant reply.
- The thread's current durable objective and title, and the latest agent recap
  if one was recorded.

Full analysis settles:

- **Durable objective and goal (title):** Evaluates whether the thread's
  objective should `keep`, `refine` (requires new user request evidence), or
  `pivot` (requires the latest user request). When **Keep titles current** is
  enabled, Workstreams updates the thread title. Titles lead with the subject,
  so it survives a sidebar row's truncation ("Phase 1 security review", not
  "Review Phase 1 security and boundaries"), keep identifiers such as a phase
  number, name a pull request by its subject rather than its number, and leave
  out what the thread's workstream and parent thread already say: Quick and Full
  analysis see both, and a leading workstream name is dropped from the result.
  They aim under `32` characters; titles over `48` are dropped rather than
  clipped. If you rename a thread outside Workstreams, that title is locked and
  preserved until cleared. `bb workstreams titles restyle` proposes titles in
  this form for threads Workstreams titled earlier, using `openai/gpt-6-sol`
  (reasoning `low`), and `--apply` renames them.
- **Fallback recap and status:** Only when the agent did not call
  `WorkstreamsRecap`, Full analysis supplies a one-line recap, work state
  (`needs_decision`, `review`, `blocked`, `in_progress`, or `done`), and a short
  `needsYou` prompt when waiting on your decision. Failed turns are marked
  `error` without running analysis.
- **Observed product and feature names:** Accumulates product and feature names
  mentioned in analyzed conversation excerpts and agent recaps per thread,
  independent of topic assignments. Observations persist across model-trace
  pruning and are deleted when the thread is deleted.

### 3. Placement

A root's topic is settled by **placement**: one schema-constrained call (default
`openai/gpt-6-sol`, reasoning `none`) when the thread starts, and again beside
Full analysis when a turn ends after a new substantive request. Topic edits,
model changes, and turns without a new request never re-place a thread.

- **Evidence:** the thread's generated title; its first, second, and latest
  substantive requests (a routed request is read without its
  `[bb message from thread:…]` wrapper); its project; and its checkout.
- **Closed choice:** only topics without subtopics can be chosen. When none
  fits, placement may propose one new topic named for a lasting area of work,
  never for a task, pull request, or bug. A proposed subtopic of a topic that
  holds threads files the thread in that topic instead: subgroups come only from
  splits.
- **Hints, not rules:** the topic of the thread it continues (`@thread:` or a
  fork's source); the workstream or thread it was started from when that topic
  has subtopics; and the topic most threads in its checkout have. A checkout
  whose threads point at other repositories (at least two of them name a GitHub
  repository or a `~/Code` path outside it) coordinates work elsewhere, so it
  gives no hint.
- **Provenance:** placement writes `full` topics under the priority above, and
  every update re-validates live thread evidence, assignment state, and
  topic-tree freshness before writing.

### 4. Deterministic organization

The **Organizer** runs automatically after topic assignments or thread lifecycle
state change. It is completely deterministic and makes **no model calls**. It
counts **visible, non-archived roots**, including `done` roots, so completion
alone never regroups:

- **Subgroups:** A group shows its subtopics as subgroups once it covers more
  than `5` visible roots, and one list again at `3` or fewer. The gap keeps a
  group from flipping back and forth, so the organizer remembers which groups it
  showed split.
- **Contexts and families:** A top-level topic with subtopics and no threads of
  its own is a context: it never gets a header, and its name is dimmed before
  its children's (**Vercel** Inside Vercel). A topic with no threads of its own
  and two or three subtopics with threads collapses the same way (**Vercel
  Agent** Automations, **Vercel Agent** Code Review), unless a split created its
  subtopics, in which case it keeps its header. A topic with one subtopic with
  threads shows that subtopic under its own name, the parent dimmed first. A
  dimmed name the next name starts with is dropped.
- **Promotion and depth:** A group showing subgroups that covers `40%` or more
  of its parent's visible roots moves to the top level, its ancestors dimmed
  before its name (**BB Plugins** Workstreams), and its roots leave the parent's
  count. It moves back below `30%` or when it shows one list again. At most
  three header levels show; a group that would show subgroups at the third level
  moves to the top whatever its share.
- **Workstreams:** Each group that lists threads is one workstream (a BB section
  named by its topic path); headers above them have no section.
- **Section sync and cleanup:** Creates, renames, or removes Workstreams-owned
  BB sections, moves roots into their derived workstream, logs and reverts
  outside section moves, and prunes unused, childless discovered topics.
- **Stable visual collapse:** Expanding or collapsing a workstream in the
  sidebar follows its bound topic identity across windows and across section
  recreation. Collapsible group headers show a hand cursor on hover. Subgroup
  headers use small uppercase labels; each group's contents are indented behind
  a subtle vertical guide to distinguish headers from thread rows.

### 5. Organizing suggestions

Workstreams proposes changes to the topic tree and applies them only when you
accept them, on **Organization** (a sidebar notice links there) or with
`bb workstreams suggestions`. Suggestions use the **Suggestions model** (default
`anthropic/claude-sonnet-5.5`, reasoning `medium`).

- **Splits:** A topic without subtopics that passes `5` visible roots gets one
  call that partitions all of its roots into `2–5` subgroups, named for plain
  areas of work ("Planning", "PR Upkeep"), never a catch-all. A topic that holds
  threads beside subtopics, from before this rule, gets the same call to file
  each of its threads in a subgroup. At most once a day per topic.
- **Tidy passes:** At most `8` edits (merge, move under, possibly renamed,
  rename, create a parent for related topics, refile a thread), each with a
  one-line reason. A move under a parent drops the words the names share:
  "Vercel Agent Code Review" moves under "Vercel Agent" as "Code Review". A pass
  runs at most once a day, after `3` new topics or `5` new roots since the last
  one, or when Unfiled roots plus one-thread groups reach `4` and that set
  changed. It doesn't run on its own while earlier tidy edits wait for review.
  Once you've decided every waiting suggestion and accepted at least one, a
  follow-up pass runs even within the day, because accepted changes can make new
  edits possible. **Ask now** runs splits and a pass right away.
- **Names:** A top-level topic whose name begins with the whole name of a topic
  with subtopics ("Vercel Agent Code Review" beside "Vercel Agent") gets a
  suggestion to move under it, renamed without the shared words ("Code Review");
  the old name stays as an alias. These need no model call, so they appear
  whenever the tree changes.
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
   threads most worth your attention. Every root that isn't archived, snoozed,
   or running is a candidate; a running thread joins only while it has a
   question card or approval pending, and otherwise returns, unread, when its
   turn ends. A thread with a question for you (`AskUserQuestion` or approval
   pending, or a `needs_decision` status) or a turn ready for review is _blocked
   on you_; anything else (complete, waiting, failed) is not. A review or
   decision whose turn ended more than `7` days ago ages out and counts as not
   blocked; a pending question card or approval never ages out. Candidates rank
   in eight tiers, each newest first by latest turn end:
   1. Unread questions
   2. Unread reviews
   3. Read questions
   4. Read reviews
   5. Other unread threads
   6. Other read threads
   7. Unread **Waiting** threads
   8. Read **Waiting** threads

   Waiting threads (the agent reported Waiting on a subagent or timer, or
   analysis found the work still in progress) rank after every other thread,
   even read ones. Up Next then trims from the bottom: threads not blocked on
   you leave, least urgent first, until `5` remain; read blocked threads leave
   until `10` remain; past that, only the `10` most recently active stay,
   whatever their tier. So Up Next always shows a few threads, grows only for
   threads blocked on you, and lists at most `10` on its own. **Show N more**
   lists the trimmed threads that are unread or blocked on you below the rest,
   and **Show less** collapses them; trimmed read threads not blocked on you
   stay in Recent and their workstreams. It re-ranks as recaps, read state, and
   activity change. The thread you have open keeps its row and place until you
   open another thread. Nested delegates do not appear as separate Up Next
   entries; find them in their workstream's thread tree.
   - **Focus:** While a focused workstream has a thread blocked on you, Up Next
     applies these rules to focused workstreams' threads only and marks its
     header with the focus icon.

2. **Workstreams (focused and other tiers):**
   - **Nesting:** Workstreams nest as the organizer laid them out (see
     [Deterministic organization](#4-deterministic-organization)): a busy
     group's subgroups sit under its header, contexts and small families show as
     dimmed names before their children's (**Vercel Agent** Automations), and a
     dominant group moves to the top level (**BB Plugins** Workstreams). A
     header above subgroups has no threads of its own. Subgroups collapse
     independently. Focus, ordering, and Dormant apply to a top-level group as a
     whole.
   - **Small groups:** When fewer than two subgroups show at least `3` threads,
     all list inline in their parent's thread list, each labeled with its
     subgroup's name. Otherwise all sibling headers stay visible, including
     small subgroups. A recently emptied subgroup retained for New work also
     keeps its siblings' headers. A parent shows threads or subgroup headers,
     never both. If a parent holds threads of its own, all subgroups list
     inline; its right-click menu offers New work for retained empty subgroups.
     Once `3` or more top-level groups are that small beside a bigger one, they
     gather in **Other**, after the rest, each row labeled with its workstream.
     Focused workstreams keep their own headers.
   - **Indentation:** Each level starts where its parent's names start: a
     subgroup's header and threads sit one step in from its parent's, and a
     child thread one step in from its parent thread. Headers and threads share
     one row height and one column for chevrons and status marks; subgroup names
     are smaller and muted.
   - **Empty workstreams:** Keep at most `3` empty workstreams, and only while
     they had a visible, non-archived, unsnoozed thread within the last `10`
     minutes. The most recently populated win; focused and nested workstreams
     share the same limit. This briefly keeps **New work** available after the
     last thread is archived or snoozed, then removes the empty row without
     deleting threads or topics. The grace period survives reloads and is shared
     across windows; polling an empty workstream never extends it.
   - Click the **Focus** button (viewfinder icon) on any workstream header to
     pin it to the top tier. When at least one workstream is focused, the other
     workstreams, **Unfiled**, and **Dormant** collapse behind **Show/Hide other
     workstreams**. While collapsed, the toggle sums their waiting and total
     thread counts, using the same amber and grey treatments and count settings
     as workstream headers.
   - Click **New work in \<workstream\>** (`＋`) on a header or subgroup header
     to open the composer pre-seeded with that topic.
   - Click **Snooze** (alarm-clock icon) on a header or subgroup header to
     snooze every thread it lists with your default preset, subgroups included
     and whether or not it is collapsed; rest the pointer on it for the snooze
     menu. Each root thread is snoozed with its delegate subtree, as if snoozed
     from its own row, and **Undo** in the confirmation wakes them all. The
     button appears only while the header lists threads.
   - Use the **Sort workstreams** menu to order workstreams by **Name A–Z**,
     **Recent activity**, or **Manual order** (drag headers within their tier).
   - Drag root threads within a workstream to set manual thread order (newly
     created roots appear at the top of their workstream; newly created
     workstreams appear at the bottom).
3. **Unfiled:** Roots with no topic assignment. Below the groups, a notice
   counts organizing suggestions waiting for you and opens them.
4. **Dormant:** Unfocused workstreams with no activity in the last `30` days and
   nothing waiting on you.
5. **Recent, Snoozed, and Archived bands:**
   - **Recent** lists the most recently active root threads (`1–20`, default
     `5`) that Up Next isn't showing, so it carries on where Up Next stops.
     Snoozed threads stay out.
   - **Snoozed** lists snoozed threads ordered by soonest wake time (or
     `On update`), carrying their delegate subtrees with them while snoozed.
   - **Archived** paginates archived threads via BB's archive list.
   - Each band has a **⋯** menu for **Sort by** (`Recent activity`, `Title A–Z`,
     `Soonest to wake`, or `Archive date`) and **Group by workstream**.

#### Row indicators and actions

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
  mark and an empty workstream's `＋` always show, at the trailing edge so
  revealing other actions doesn't move them. Touch screens, which can't hover,
  show only those two; the rest stay in the row's long-press menu. Section **⋯**
  menus always show, dimmed until used.
- **Right-click context menu:** **Open in split**, **Open parent** (for
  delegates), **Topic** (switch to **Automatic** or assign any topic in the
  tree), **Rename…**, **Pin / Unpin**, **Mark read / Mark unread**, **Inspect
  model calls…** (when Debug mode is on), **Snooze / Change snooze / Wake now**,
  **Archive**, and **Delete…**. A workstream header's menu holds its hover
  actions: **Focus / Stop focusing**, **New work**, and **Snooze \<N\>
  threads**. On touch screens, a long press opens either menu.

### Phone Home screen

On compact viewports (when **Sidebar → Up next and workstreams on phones** is
enabled), Workstreams replaces BB's flat Recent list on the Home screen with:

- The **Up Next** card at the top.
- **Workstreams** sections with deterministic hue dots, waiting/total badges, an
  **Expand all / Collapse all** toggle, and per-parent delegate fold controls.
  Focused workstreams (or a single active workstream) start expanded.
- A collapsible **Snoozed** section at the bottom.

### Thread view and header

- **Sticky goal header:** Displays the thread's workstream (in its deterministic
  hue) above the thread's goal title and—when the latest recap has a more
  specific turn goal—a subtitle below it. As you scroll away from the newest
  message, the large heading fades out over a feathered background while a
  compact copy fades into the top bar (or stays pinned in the timeline when the
  bar is too narrow). In **Settings → Workstreams → Threads**, choose **Title
  transition → Scroll** to have both headings slide as they fade, or **Hybrid**
  to keep the large heading at the start of the conversation and fade in the
  compact title as the large title scrolls out of view.
- **Thread header actions:**
  - **Parent thread** (optional, off by default): Opens the parent thread from a
    delegate's header.
  - **Topic:** Shows the root's current topic path (or _No topic_ /
    _Classifying…_) and provenance on hover. Click to search and assign a topic
    (`manual`) or choose **Automatic** to reclassify with Full analysis.
  - **Observed names** (Debug mode only): Opens a popover of products and
    features observed across Full analysis runs for the thread, with run counts
    and first/last-seen timestamps on hover.
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
- **Next actions:** Up to `3` suggested follow-up buttons. **Click** a button to
  send its prompt immediately; **Shift-click** (or choose **Edit in composer**
  from the overflow menu) to insert the prompt into the composer for editing.
- **Dismiss and restore:** Click **Dismiss recap** (`×`) to hide the card (and
  cancel any pending waiting-recap countdown); click the **Show recap** pill to
  restore it.
- **Reminders and loop guard:** If an enrolled agent ends a turn without calling
  `WorkstreamsRecap` or `AskUserQuestion`, Workstreams sends up to `3` automatic
  reminders (configurable `0–10`). If an active thread hits `5` identical
  consecutive tool-call failures, Workstreams stops the turn and pauses
  automatic continuation to prevent an infinite retry loop.

### Upstream bb and the tomdale/bb fork

Workstreams works on upstream bb (plugin SDK 0.6.5 or later): the recap tool,
the docked recap card, the question card, the sidebar, Up Next, and the
Workstreams page. With the [tomdale/bb](https://github.com/tomdale/bb) fork,
which adds a message-block slot, you also get **Structured replies**:

- Agents end each turn with a `:::reply` block instead of calling the recap
  tool; its headline and results become the recap card. Card text preserves
  inline Markdown and is not clipped to the recap tool's character limits.
- The reply combines full Markdown explanations with information components:
  findings and evidence, comparisons, sequences, behavior changes, checks,
  delivery records, and recommendations. Components can be grouped as peers or
  as an explanation with supporting evidence. A group entry can keep a list of
  components together, such as prose and a causal sequence beside their sources.
  Groups contain at most eight components in total and do not nest. A reply's
  kind is separate from whether its work is complete, ready for review, or
  waiting.
- Substantive replies keep a distinct answer heading in the article, including
  while the recap is docked. A leading prose paragraph receives introductory
  styling without changing the rest of the explanation. Purpose and work-state
  labels remain separate: completing an investigation does not assert that its
  cause was established. Comparisons use quiet paired views or divided option
  rows, and sequences reflow to fit their content column.
- Context identifies the broad task, reported place, and background. The compact
  **Workspace** control opens BB's **Current workspace** path without repeating
  that full path in every opening. Relative evidence paths stay inside the
  message's workspace; external files use explicit absolute paths. File line
  ranges are separate from literal filename characters.
- Qualifications stay beside the claims they limit. Evidence references and
  their descriptions remain visible. Failed, skipped, blocked, and untested
  checks stay visible; passed checks open on demand. Explanations are not
  shortened or automatically folded based on sentence or section counts. Authors
  can explicitly fold supporting excerpts, code, and logs.
- Components contain reported information, not independently verified facts.
  Check and delivery scopes identify where and when a result applies. The
  read-only `WorkstreamsReplyExamples` tool supplies illustrative, validated
  examples only to sessions using Structured replies; it never executes work.
  Existing agent sessions may need a fresh start to receive a newly registered
  tool and its guidance.
- A substantive article keeps its heading while the docked card owns the compact
  recap fields. Historical and dismissed recaps close the article with their
  results and review references, without duplicate send actions. A malformed
  component shows its original source and a diagnostic without discarding the
  explanation or the recap.
- Completion messages from the Subagents plugin show their reply blocks inline,
  in a bordered panel labeled Subagent, with the worker's name and transcript
  link. They use the thread's message type size, including completions delivered
  while the parent thread is running. File links use the worker's workspace.
  Unsupported, incomplete, or unverified deliveries keep BB's original message.

Workstreams detects the slot when its app loads and reports it to the server.
Without the slot, Settings has no Structured replies row and agents use the
recap tool; a setting turned on under the fork stays stored but has no effect.
Outside Subagents deliveries, reply blocks written earlier show as plain
Markdown.

### Structured question card (`AskUserQuestion`)

When an agent needs a structured decision (and the active provider does not
supply its own native question tool), `AskUserQuestion` renders an amber card
above the composer:

- Supports `1–4` questions in tabs, each with up to `4` single-select or
  multi-select options (with number-key shortcuts and optional Markdown
  previews) plus an **Other…** freeform input.
- Freeform answers support pasted images and project file attachments (`Enter`
  to submit, `Shift+Enter` for a newline).
- Draft answers save automatically to `sessionStorage` (`250 ms` debounce) and
  recover across page reloads or interrupted turns.
- Submitted questions remain inline as read-only cards with the original
  question text, details, options and previews, selected answers, free text,
  notes, and downloadable image or file attachments. They use the same display
  after an interruption, recovery, or page reload, without an extra raw JSON
  answer. Older answers retain the information saved with them; exact selections
  are marked when the structured submission is available. Dismissed questions
  keep their original content and dismissal status.

### Workstreams page (`/plugins/workstreams/home`)

Open **Workstreams** in the main navigation panel to access four tabs:

1. **Overview:** Press `/` to search across workstream names, thread titles, and
   recaps; click **New work…** to open the composer; browse active workstream
   cards ranked by `needs you` and recency; or expand the quiet/dormant
   workstreams disclosure.
2. **Topics:** Browse and search the full topic tree (`Owner › Capability`),
   descriptions, and aliases. Create top-level topics (**New topic**), **Add
   subtopic**, **Rename**, **Move** (reparent to another topic or top level),
   **Merge** (moves assigned threads and subtopics into the target topic and
   deletes the source), or **Edit details** (description and comma-separated
   aliases).
3. **Organization:**
   - Inspect live organizer status (`Workstreams up to date`,
     `Analyzing threads N of M`, `Updating workstreams`, or
     `Organizing stopped`), summary counts (**Active threads**, **Active
     workstreams**, **No topic**, **Done**), and click **Refresh** or
     **Rebuild…**.
   - **Suggestions:** Each organizing suggestion is a headline naming what moves
     and where ("Split Automations into PR Upkeep and Design", "Move “Record
     demo video” to PantryPal", "Move Workforest under bb"), the change in a
     line or two, and its reason. They are listed in three parts:
     - **Moves threads**, biggest change first. A suggestion moving several
       threads lists each destination group once with the threads going there
       (`+` marks a new group, and a thread from another group says where from).
       Any other change is one `group now → group after` line.
     - **Tidies groups**: changes to how groups nest and are named that move no
       thread, which decide where new threads go, each one line
       (`Workforest → bb › Workforest`).
     - **Out of date**, collapsed: suggestions blocked for now, such as moving a
       group under one that holds threads, each with why. Decline them or **Ask
       now** for fresh ones.

     A suggestion that would no longer change anything (none of a split's
     threads remain, something it names is gone, the change was already made, or
     it needs a group another declined suggestion would have made) is retired on
     its own after each organizer pass and decision, and shows under **Recently
     decided** as "Nothing left to change".

     Small changes since a split was suggested don't stop it: threads that moved
     or closed are left out, and threads that joined its group are filed too
     when you accept (one model call; the card says "Also files…"). A split
     stops only when its group is gone, none of its threads remain, more threads
     joined than remain, or it would leave one subgroup. A tidy edit stops only
     when it would break a rule, such as giving subgroups to a group that holds
     threads.

     **Accept all N** accepts every suggestion that can apply. **Recently
     decided** lists the latest decisions.

   - Assign topics directly to **Threads with no topic** or inspect **Derived
     Workstreams** with their active/total counts and grouping policy reason.
   - **Review automatic topics:** After editing topic definitions, click
     **Preview topic repairs** to evaluate up to `100` visible roots against the
     current topic tree (making model calls without changing any assignments,
     titles, or statuses). Review the proposed `from → to` changes and click
     **Apply topic repairs** to commit them. Plans expire after `30` minutes,
     reject stale topic trees, preserve manual assignments, and skip threads
     whose evidence changed since the preview.
4. **Activity:** Day-grouped log of automatic and outside changes. Filter by
   workstream, action (`Move`, `New workstream`, `Rename`, `Delete`, `Undo`,
   `Reorganize`, `Edit`, `New thread`, `Updated title`, `Removed topic`,
   `Suggestion`), **Needs review**, or **Outside changes**. Hover or focus any
   reversible entry and click **Undo** to revert its effect when current BB
   state still matches.

---

## Commands and keyboard shortcuts

| Command / Shortcut                                              | Where                             | Action                                                                                          |
| --------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Workstreams: next Up Next thread` (`Cmd+Alt+J` / `Ctrl+Alt+J`) | Global command palette / shortcut | Opens the next thread in Up Next, wrapping to the top.                                          |
| `Workstreams: snooze this thread`                               | Command palette (active thread)   | Snoozes the current thread using your configured **Click to snooze** default preset.            |
| `Workstreams: wake this snoozed thread`                         | Command palette (snoozed thread)  | Wakes the current snoozed thread immediately.                                                   |
| `/`                                                             | Workstreams page                  | Switches to the **Overview** tab and focuses the search box.                                    |
| `Shift+Click`                                                   | Recap card **Next action** button | Copies the suggested prompt into the composer for editing instead of sending immediately.       |
| `1`–`4`, `Enter` / `Shift+Enter`                                | `AskUserQuestion` card            | Selects an option by number; submits the answer (`Enter`) or inserts a newline (`Shift+Enter`). |

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

| Section               | Setting                                            | Default                                     | Details                                                                                                                                                                        |
| --------------------- | -------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sidebar**           | **Up Next**, **Recent**, **Snoozed**, **Archived** | All `On`                                    | Show or hide each band in the Workstreams sidebar.                                                                                                                             |
| **Sidebar**           | **Threads shown** (under Recent)                   | `5` (`1–20`)                                | Maximum root threads shown in the Recent band.                                                                                                                                 |
| **Sidebar**           | **Up next and workstreams on phones**              | `On`                                        | Replaces BB's flat Recent list on the compact phone Home screen.                                                                                                               |
| **Sidebar**           | **Timestamp**                                      | `Always`                                    | Show each row's age, right after its title, `Always`, `On hover`, or `Never`.                                                                                                  |
| **Sidebar**           | **Thread count** / **Waiting count**               | `When collapsed`                            | Show workstream counts `Always`, `When collapsed`, or `Never`.                                                                                                                 |
| **Working indicator** | **Style**, **Color**, **Track**                    | `Spokes`, `Subtle gray`, `Faded color`      | Choose from `7` spinner shapes (`Spokes`, `Sunburst`, `Arc`, `Orbit`, `Ring`, `Braille`, `Dots`), named or custom `#rrggbb` colors, and track styles for `Arc`/`Orbit`/`Ring`. |
| **Colors**            | **Default colors**, then six colors                | `Workstreams`                               | **Default colors** picks Workstreams' own shades or matching bb theme colors; each color's swatches can override it with a theme color or a custom `#rrggbb`.                  |
| **Threads**           | **Full analysis model**                            | `openai/gpt-6-sol-fast`                     | Model used at turn end to settle goals and fallback status.                                                                                                                    |
| **Threads**           | **Keep titles current**                            | `On`                                        | Automatically titles new threads and updates titles as focus evolves. Outside manual title edits stay locked until cleared.                                                    |
| **Threads**           | **Show parent thread link**                        | `Off`                                       | Shows a parent-thread pill in delegate thread headers.                                                                                                                         |
| **Threads**           | **Show archive button**                            | `On`                                        | Shows an Archive button in thread headers.                                                                                                                                     |
| **Recap**             | **End turns with a recap**                         | `On`                                        | Gives agents `WorkstreamsRecap` and displays the recap card above the composer.                                                                                                |
| **Recap**             | **Reminders**                                      | `3` (`0–10`)                                | Maximum turn-end reminders sent when an enrolled agent omits a recap (`0` disables reminders).                                                                                 |
| **Recap**             | **Structured replies**                             | `Off`                                       | Agents end each turn with a `:::reply` block whose card fields become the recap, instead of calling the recap tool. Shown only with the tomdale/bb fork.                       |
| **Recap**             | **Layout**                                         | `Full` (`Full` / `Compact`)                 | Card layout on desktop (`Compact` is always used on phones), with a live preview carousel.                                                                                     |
| **Recap**             | **Commit hash colors**                             | Theme default                               | Custom `#rrggbb` colors for commit-hash digits and letters, with **Reset**.                                                                                                    |
| **Snooze**            | **Presets**                                        | `4` presets, **Tomorrow morning** default   | `1–6` presets every snooze menu lists before **Custom…**: add, edit, delete, drag to reorder, and choose the **Default** a click uses.                                         |
| **Snooze**            | **Wake on …events** (three groups)                 | All `On`                                    | Which wake events end a snooze that wakes on events (see [Wake events](#wake-events)).                                                                                         |
| **New threads**       | **Home project**                                   | `Don't work in a project`                   | Default project used for background worker fallback when a thread has no project.                                                                                              |
| **New threads**       | **Suggestions while typing**                       | `On`                                        | Runs Quick analysis on composer drafts while typing.                                                                                                                           |
| **New threads**       | **Quick analysis model**                           | `openai/gpt-6-luna-fast` (reasoning `none`) | Model used for composer draft previews and first-send Quick analysis (remains active when typing suggestions are off because first-send analysis still uses it).               |
| **Organization**      | **Placement model**                                | `openai/gpt-6-sol` (reasoning `none`)       | Model that chooses each root's topic from its requests, when it starts and after a new request.                                                                                |
| **Organization**      | **Organizing suggestions**                         | `On`                                        | Suggests splits of busy topics and tidy edits to the topic tree on their own. **Ask now** works either way.                                                                    |
| **Organization**      | **Suggestions model**                              | `anthropic/claude-sonnet-5.5` (`medium`)    | Model that writes split and tidy suggestions.                                                                                                                                  |
| **Advanced**          | **Analysis machine**                               | Automatic                                   | Enrolled BB machine used for gateway model calls when multiple machines are connected.                                                                                         |
| **Advanced**          | **Debug mode**                                     | `Off`                                       | Records redacted model traces (`7` days / `1,000` records) and reveals **Observed names**, **Inspect** buttons, composer diagnostics, and Activity model-call rows.            |

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

# Propose titles in the current form for threads Workstreams titled earlier; --apply renames them (titles you renamed stay)
bb workstreams titles restyle [--apply] [--json]

# Inspect recorded Debug-mode model traces (kinds: quick-analysis, full-analysis, placement, split, tidy, restyle)
bb workstreams trace [<trace-id>] [--thread <id>] [--entry <id>] [--kind <kind>] [--limit 1..500] [--json]
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
```

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

## Debug mode and observability

Enabling **Settings → Workstreams → Advanced → Debug mode** turns on trace
recording and unlocks diagnostic tools across the UI:

- **Trace recording & redaction:** Every Quick analysis, Full analysis,
  placement, split, and tidy model call records its redacted input, prompt, raw
  response, reasoning summary, parsed output, token usage, cost, duration, and
  applied outcome. Common secret patterns (`sk-…`, `ghp_…`, `github_pat_…`,
  `xoxb-…`, `Bearer …`, and `api_key`/`token`/`password`/`secret` assignments)
  are masked before prompts reach a model or trace store. Redaction is best
  effort, not a security boundary; do not put secrets in requests or assume
  diagnostics are safe to share without inspection. Conversation excerpts go to
  your selected model provider under that provider's policies. Traces are
  retained for `7` days or `1,000` records and pruned automatically even after
  Debug mode is turned off.
- **Thread Inspector:** Click the bug (`Inspect`) button on an Overview row,
  Activity row, or trace entry to open the side-pane inspector. Inspect every
  recorded call for a thread, copy the full trace JSON, or click **Run again**
  to replay the stored prompt against the current model and compare canonical
  results (`Same result` vs. `Differs in <fields>`) without mutating thread
  state.
- **Observed names:** Open **Observed names** in the thread header to inspect
  all product and feature names accumulated from Full analysis runs on that
  thread, with run counts and first/last-seen timestamps.
- **Activity model calls:** Filter the **Activity** tab by **Model calls**
  (`quick-analysis`, `full-analysis`, `placement`, `split`, or `tidy`) and
  **Failures only**, view total reported cost for the filtered calls, or click
  **Clear traces…** to delete recorded model traces while keeping the Activity
  log intact.
- **Composer routing diagnostics:** Expand the **Debug** disclosure in the
  new-thread composer to inspect live Quick-analysis confidence, inputs, token
  usage, reasoning, and copyable JSON diagnostics.

---

## Development

Build and verify in an isolated Workforest task worktree; deploy only from the
canonical checkout.

```sh
npm ci
npm run typecheck
npx vitest run
npm run build
```

The app draws with its color tokens (`src/app/theme/tokens.css`) and BB's theme
variables; `tests/app/color-lint.test.ts` fails on Tailwind palette classes and
color literals in `src/app`.

Then run the repository's `scripts/bb-plugin-smoke` against this package to
verify activation in an isolated throwaway BB server. Opt-in model evaluations
live in [eval/README.md](eval/README.md) (they make paid model calls and are not
part of the unit test suite). See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) and
[docs/organization.md](docs/organization.md) for architectural details.
