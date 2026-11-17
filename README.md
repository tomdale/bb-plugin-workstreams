# Workstreams for BB

Workstreams organizes BB threads into workstreams and keeps each thread's
**title**, **goal**, **status**, and **activity** current. Each workstream with
open threads appears as a native BB section in the sidebar.

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

1. Open **Settings → Workstreams → Models** and choose the models that name and
   organize new threads and update threads after each turn. The default Gateway
   models need a connected BB machine with an AI Gateway key; see
   [model execution](#gateway-vs-provider-worker-models).
2. Select **Workstreams** as the sidebar thread list and open **Workstreams** in
   the main navigation to work through what needs you and to organize your
   workstreams and groups.
3. Start a thread with **Automatic**, or choose its **Workstream** yourself. To
   move existing work, drag a thread to another workstream or choose **Move to**
   from its menu.

See [ISSUES.md](ISSUES.md) for current limitations and audit dispositions.

## Core concepts

| Term             | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thread**       | A BB thread; the unit of work shown across the UI. Workstreams organizes visible, non-archived threads that have no visible active parent.                                                                             |
| **Child thread** | A thread another thread started for separable work. A child thread goes wherever its parent goes and is nested under it.                                                                                               |
| **Workstream**   | A lasting body of work that holds threads (`Vertex`, `bb › Workstreams Plugin`). It shows in the sidebar, as a native BB section, while it has open threads.                                                           |
| **Group**        | Holds workstreams and never nests. It shows as a dimmed name before its workstreams' names. A workstream doesn't have to be in a group.                                                                                |
| **Category**     | An automatic, temporary cluster of threads inside a busy workstream. Categories survive restarts separately from workstreams, appear at `6` threads, and are discarded at `3` or fewer.                                |
| **Other**        | The sidebar block for threads in no workstream. Those threads are in the **No workstream** state.                                                                                                                      |
| **Source**       | Where a thread's workstream came from: `manual`, `inherited`, `automatic`, or `composer` (see [Core rules](#core-rules)).                                                                                              |
| **Title**        | A thread's display name: an -ing verb and its subject ("Redesigning work tab") that leaves out what its workstream and parent thread already say (`2–5` words, under `34` characters).                                 |
| **Goal**         | The outcome a thread is working toward, in one sentence shown below its title.                                                                                                                                         |
| **Status**       | One per thread, in this order of precedence: **Working**, **Failed**, **Needs input**, **Blocked**, **Ready for review**, **Waiting**, **Complete** (JSON: `needs-input`, `blocked`, `review`, `waiting`, `complete`). |
| **Agent recap**  | A structured end-of-turn report submitted by the agent with the `WorkstreamsRecap` tool.                                                                                                                               |
| **Next actions** | A recap's follow-ups: up to three **actions**, each a message you can send to the thread.                                                                                                                              |
| **Up Next**      | The short ranked list of threads most worth your attention, shared by the sidebar, the phone Home screen, and the **next Up Next thread** command.                                                                     |
| **Focus**        | Moves a workstream to the top tier of the sidebar. A focused workstream's threads lead Up Next while one of them needs you.                                                                                            |
| **Suggestion**   | A proposed change to your workstreams and groups that changes nothing until you accept it. Review lists those that move threads apart from those that only change workstreams and groups.                              |
| **Organize**     | The page where you manage workstreams and groups, review suggestions, and preview automatic moves.                                                                                                                     |
| **Preview**      | A set of moves you review and then apply as a whole. A migration you apply saves a **backup** of the data it replaced.                                                                                                 |
| **Activity**     | The log of changes Workstreams made or observed, with undo where supported.                                                                                                                                            |

### Core rules

1. **A thread's workstream decides where it is listed.** Moving a thread between
   sections in BB's sidebar is logged as an outside change and reverted on the
   next organizer pass; move it to another workstream instead.
2. **Child threads follow their parent.** Child threads are in their parent's
   workstream and are nested under their parent in the sidebar, Home screen, and
   CLI.
3. **Source priority.** Workstream sources follow
   `manual > inherited > automatic > composer`:
   - `manual` (chosen by you in the composer, sidebar, Workstreams page, or CLI)
     is never overwritten by automatic analysis.
   - `inherited` (from a parent or source thread or a workstream's **＋**
     button) changes automatically only when a workstream choice reports a scope
     shift, or when you apply a preview or accept a suggestion.
   - `automatic` (chosen automatically from the thread's requests) replaces
     `composer` and earlier `automatic` choices.
   - `composer` (the workstream the composer guessed while you typed) holds a
     thread without a stronger source until its start call answers.
4. **Agent reports outrank fallback status.** Structured questions
   (`AskUserQuestion`) and agent recaps (`WorkstreamsRecap`) take precedence
   over the model's own reading of the turn for thread status, recap text, and
   what the thread asks of you, which the model supplies only when the agent did
   not report.
5. **A workstream holds threads; a group holds workstreams.** A group never
   holds threads directly, and groups don't nest, so a workstream path has at
   most two levels. Moves and merges that would put threads in a group are
   refused, whoever makes them, and workstream pickers list only workstreams.
   Splitting a workstream turns it into a group of new workstreams, and it needs
   a reviewed preview of where each thread goes, including archived work, using
   meaningful lasting areas rather than a General or Other catch-all.

---

## How it works

### 1. Starting a thread

When you compose a new thread, the composer includes a **Workstream** control
(in BB's picker row on wide viewports, or on its own strip above the prompt on
phones):

- **Automatic (`✦`, default):** While you type (after a `250 ms` pause, or
  `900 ms` for drafts of `20` characters or fewer), a fast model (the **Name and
  organize as you write** model, default `google/gemini-3.1-flash-lite`) guesses
  the thread's workstream and the composer shows it. When you send, that
  workstream holds the thread (`composer` source) until the start call answers
  on the **Name and organize new threads** model.
- **Explicit workstream reference:** A draft containing `@section:<id>` resolves
  to that section's workstream without a model call when **Name and organize as
  you write** is on. For example, `@section:sec_0123456789` uses a native BB
  section ID, not a workstream name or ID. Run `bb workstreams list` to find
  section IDs. Unknown section IDs, or sections that belong to no workstream,
  are asked like any other draft. This is a preview shortcut, not a separate
  destination control.
- **Workstream `＋` button:** Clicking **New work in \<workstream\>** in a
  sidebar header seeds the composer with that workstream (`inherited` source). A
  group's header can't hold the thread, so one of its workstreams is chosen,
  with where it started as a hint.
- **Forked or spawned threads:** Inherit their source thread's workstream
  (`inherited` source).
- **Choosing a workstream yourself:** Opening the Workstream picker lets you
  search your workstreams, create **New workstream "\<query\>"** inline, or
  choose **No workstream** (`manual` source, keeping the thread under
  **Other**).

When a thread's first request is sent, one model call titles the thread and, for
a thread with no parent, chooses its workstream (the **Name and organize new
threads** model, default `openai/gpt-6.1-sol`, reasoning `none`, `15 s`
timeout). The header reads **Organizing…** while it runs. The title leaves out
the name of the workstream the same answer chose. A child thread is only titled;
it follows its parent's workstream. An answer whose workstream is invalid is
repaired once and never blocks a valid title. Workstreams retries a failed call
twice with short delays, then leaves the thread to its turn's end; a newer
request cancels the retries. Titles only fill threads that do not yet have one
while the first turn is still running. Hidden threads, such as workflow and
subagent workers, get neither a title nor a workstream.

To associate a workstream with a BB project, open **Workstreams → Organize**,
click the workstream, and choose **Project**. **Automatic** learns an
association when at least three independent threads all use the same available
project. Archived threads count; child threads, forks, plugin-created threads,
hidden threads, and Personal do not. Groups are associated only when their
workstreams agree. Learning uses thread history, not another model call.

A workstream always has a project. When none is chosen or learned, it is **No
project**, shown as **Automatic · No project**. A learned project appears as
**Automatic · <project>**. Choosing a project explicitly makes it your choice,
which learning never changes. Choosing **No project** disables learning and
project inheritance for that workstream; choose **Automatic** to enable them
again. Existing explicit associations stay manual. Automatic associations,
manual changes, and suggestion decisions appear in **Activity**, with supporting
threads and undo where applicable. Undoing an automatic association disables
learning so it is not immediately recreated.

When independent history contradicts a learned association, **Project
associations** on **Organize** offers a correction to accept or decline.
Consistent alternative history suggests another project; mixed history suggests
**No project**. The current association stays until you accept, and declining
suppresses that correction while the association is unchanged. Acceptance
rechecks the history and becomes your explicit choice.

A workstream's project is the default for new threads, not a requirement.
Choosing a workstream manually, automatically, or with its **＋** button applies
that default only if you have not chosen a project yourself. The default can be
**No project**. A workstream in a group uses its group's default unless
overridden or disabled. Workstreams skips unavailable projects.

Your explicit choices are independent: changing the project keeps a workstream
you picked, and choosing or suggesting another workstream keeps a project you
picked. Threads can start in a project different from their workstream's
default, whether the workstream was picked or suggested. A project BB fills in
while the composer loads is not your choice. If a workstream's default lands
after you chose a project, the composer switches back to yours.

The composer keeps a draft's workstream and project choice until you send it,
including for up to an hour away from New thread. Sending, by **Enter** or the
send button, waits while the composer switches to a workstream's default, so the
thread starts in that project.

When you pick both a workstream and a different project, **Save as default
project** under the picker row offers to save your project as that workstream's
default. It then reads **Saved**. Ignoring the offer leaves the default
unchanged. Changing the project does not replace the draft or move existing
threads. Workstreams records when it supplied the composer's project, including
across reloads, so those threads cannot reinforce its own inference. Unknown
project choices on new threads do not count. Historical work with no association
can start learning; historical work that already had an association is excluded
when its project-choice source is unknown.

### 2. When a turn ends

When a visible, non-archived thread goes idle after a turn (`5 s` debounce, up
to `4` concurrent runs), one model call (the **Update threads after each turn**
model, default `openai/gpt-6.1-sol`, reasoning `none`) reads:

- The thread's opening request, recent substantive user requests (control-only
  replies such as `continue`, `yes`, or `ok` don't count as new requests),
  referenced continuation threads (`@thread:`), and the latest assistant reply.
- The thread's current title and who gave it, the goal and context digest it
  settled last time, and the latest agent recap if one was recorded.
- After a new request to a thread whose workstream you didn't choose: your
  workstreams and groups, the thread's current workstream, its project and
  checkout, and workstream hints.

It settles:

- **Title:** After a turn that followed a new request from you, when **Keep
  titles current** is enabled. A title names the goal you're working toward,
  phrased as what you're doing: an -ing verb that says what kind of work it is
  and the subject it acts on ("Reviewing Phase 1 security", not "Review Phase 1
  security and boundaries"). The model writes it as those two parts, and
  Workstreams joins them. The verb names the overall work, not the latest step,
  so a title Workstreams wrote is kept while the thread diagnoses, tests, or
  ships, and replaced when your requests change the goal; a title BB or an agent
  gave the thread is replaced. Titles keep identifiers such as a phase number,
  name a pull request by its subject rather than its number, and leave out what
  the thread's workstream and parent thread already say: a workstream name at
  the start or right after the verb is dropped from the result. They aim under
  `34` characters; titles over `48` are dropped rather than clipped. If you
  rename a thread outside Workstreams, Workstreams stops titling it until the
  title is cleared.
- **Goal:** A concise desired outcome shown below the thread title, independent
  of recap headlines. It is usually one sentence of 12–20 words, with an
  explicit subject and only enough detail to recognize the purpose. It leads
  with success, or with the problem when the motivation would otherwise be
  unclear. Goals follow changes in your purpose, not testing, shipping,
  housekeeping, or completion updates. They are settled after new requests even
  when you gave the thread its title; turns without new requests carry the goal
  forward. Existing open threads receive goals through catch-up. Until a goal is
  available, the subtitle is omitted.
- **Context digest:** Two or three short sentences recording what the work is,
  what it has established, and the product or area that owns it. The same call
  reads the digest it settled last time and revises it in place, so established
  facts survive later sub-step requests and a workstream choice rests on the
  thread's accumulated context.
- **Fallback recap and status:** Only when the agent did not call
  `WorkstreamsRecap`, a one-line recap, a status (`needs-input`, `blocked`,
  `review`, or `complete`), and a short `ask` saying what you must answer or do
  when the status is `needs-input` or `blocked`. A turn that stopped with
  requested work left and asked nothing is `needs-input`. Failed turns read
  **Failed** with no model call.
- **Workstream:** After a new request to a thread with no parent, the workstream
  its work belongs to now, usually the one it already has (see below).

### 3. How a workstream is chosen

A thread's workstream is chosen when its first request is sent and again when a
turn ends after a new substantive request; both calls use the same rules.
Workstream edits, model changes, and turns without a new request never move a
thread. A thread that only lacks a workstream, for example one analyzed before
it had one, is placed by a call that asks for the workstream alone. An invalid
workstream is refused on its own and retried with backoff; the rest of the
answer stands.

- **Evidence:** the thread's opening and recent substantive requests (a routed
  request is read without its `[bb message from thread:…]` wrapper); at a turn's
  end, its title and context digest; its project; and its checkout. Subagent
  results verified against Subagents' run records are not requests. If those
  records are unavailable, Workstreams keeps the message rather than discarding
  a possible user request.
- **Closed choice:** only workstreams can be chosen, never groups. When none
  fits, the answer may propose one new workstream named for a lasting area of
  work, never for a task, pull request, or bug. A proposed workstream inside a
  workstream that holds threads keeps the thread where it is and asks for a
  reviewed split. It does not create workstreams around existing threads. A
  workstream in a group covers finer areas without adding a third level.
- **Hints, not rules:** the workstream of the thread it continues (a fork's
  source or an explicit `Continue from @thread:…` request); the workstream or
  thread it was started from when that is a group; and the workstream most
  threads in its checkout have. A checkout whose threads point at other
  repositories (at least two of them name a GitHub repository or a `~/Code` path
  outside it) coordinates work elsewhere, so it gives no hint.
- **Source:** automatic choices write the `automatic` source under the priority
  above, and every update re-validates live thread evidence, the thread's
  current workstream, and whether your workstreams changed before writing. An
  answer that supplies both an existing workstream and a proposal is invalid;
  the thread's workstream and your workstreams stay intact.

### 4. The organizer and categories

The **Organizer** deterministically derives native BB sections from workstreams.
Every workstream with threads keeps its own section, regardless of volume. A
group's name is shown as a dimmed prefix before its workstream's name; an
already repeated prefix is omitted. A thread's workstream determines its native
section, and outside section moves are logged and reverted. Unused workstreams
that Workstreams found on its own are pruned. Collapse preferences follow
workstream IDs across windows and section recreation. Workstream colors are
allocated to each lasting workstream, so they survive section recreation and
renaming. Workstreams in one group receive related colors, chosen to separate
them from existing colors where the palette permits. Moving a workstream into or
out of a group can change its color. Native sections that belong to no
workstream use a section-based fallback color. Labels remain necessary when
colors look similar.

**Categories** arrange rows inside a workstream without changing its workstream,
native section, or color. Both the sidebar and phone Home screen show them. Any
workstream can have categories, whether or not it is in a group. Sidebar
category headings use a subdued version of the workstream color:

- At **6 threads**, the category classifier sees the whole collection and
  creates useful categories. It counts visible, non-archived, unsnoozed threads,
  including completed ones; child threads follow their parent and do not count
  separately.
- While categories exist, a departing thread just leaves its category. When a
  thread arrives or a substantive request changes its work, a quick check asks
  whether it fits one of the current categories; if every such thread fits, it
  joins that category and nothing else moves. When one fits none, or most
  categories hold a single thread, the classifier reconsiders the whole
  collection: it sees the current arrangement and should preserve it unless a
  change offers a meaningful organizational benefit. Requests are assessed when
  dispatched, without waiting for the turn to end. There is no cooldown or
  periodic assessment.
- At **4–5 threads**, an existing category set remains active. At **3 or
  fewer**, it is discarded without a model call. Reaching 6 again creates a
  fresh set.
- Category IDs and memberships survive restarts separately from threads'
  workstreams. A restart restores settled state and resumes an interrupted
  assessment. Title, status, focus, scrolling, and header-collapse changes do
  not trigger inference.
- Departing threads leave categories immediately. Arrivals remain visible while
  classification is pending. Invalid or superseded responses cannot replace a
  valid arrangement or hide threads. A failed assessment waits for changed work
  or membership, or an explicit **Rebuild**, before retrying.

Categories describe distinctions useful among the current threads: each groups
threads that share one theme, and its name states that theme, joining scopes
with &. Workstreams identify lasting areas that threads can belong to
independently of that collection. Volume and recurring category names do not
create workstreams.

### 5. Organizing suggestions

Workstreams proposes changes to your workstreams and groups and applies them
only when you accept them: from the count on the sidebar's Workstreams heading,
on **Organize**, or with `bb workstreams suggestions`. Suggestions use the
**Suggest changes** model and categories the **Arrange categories** model (both
default `anthropic/claude-sonnet-5.5`, reasoning `medium`). Turning off
**Suggest changes** does not disable automatic categories.

- **Splits:** When a workstream choice identifies a distinct lasting area inside
  a workstream that holds threads, Workstreams asks for a split: the new
  workstreams that would replace it in a group, and where each thread goes,
  including archived work. **Suggest now** also considers splits explicitly. A
  split must identify supported, independent areas, useful specificity, and a
  destination for every thread. The classifier can conclude that no lasting
  split is supported. Only acceptance creates the new workstreams; a workstream
  already in a group cannot be split.
- **Other changes:** At most `8` changes per pass (merge into, move a workstream
  into or out of a group, possibly renamed, rename, group related workstreams,
  move a thread), each with a one-line reason. A move into a group drops the
  words the names share: "Vercel Agent Code Review" moves into "Vercel Agent" as
  "Code Review". With **Suggest changes** on, a pass runs after changes to your
  workstreams or to which visible threads are in them settle. Checks are
  debounced by two seconds; titles and statuses alone do not start a pass.
  Applicable changes waiting for review pause automatic passes; after a
  decision, changed work is assessed. **Suggest now** runs splits and a pass
  right away, replacing pending changes. A pass sees at most `12` threads per
  workstream and `12` threads under Other; it can propose thread moves only for
  the threads shown in that call. Workstream and thread IDs in its answer can
  include the brackets shown in the prompt; unknown workstreams and threads not
  shown in the pass are still rejected.
- **Names:** A workstream outside any group whose name begins with a group's
  whole name ("Vercel Agent Code Review" beside "Vercel Agent") gets a
  suggestion to move into that group, renamed without the shared words ("Code
  Review"); the old name stays as an alias. These need no model call, so they
  appear whenever your workstreams change. A pass can also suggest clearer, more
  concise names in context, preserving recognizable identities and distinctions
  between workstreams.
- **Memory:** A pass sees the workstreams you moved threads to, the suggestions
  you accepted, and the ones you declined; a suggestion identical to a declined
  one is never proposed again.
- **Review and undo:** Each suggestion is a plain sentence saying what it does
  ("Merge Payments into Billing") and, in the app, a drawing of the sidebar now
  and after accepting that one change, with a ribbon from the threads it moves.
  `bb workstreams suggestions` lists each move instead, and both say why a
  suggestion can't apply when your workstreams changed since. A sentence names
  one or two destinations and counts three or more ("Split Agent Skills into 5
  workstreams"), since the drawing shows each one. Accepting one records it in
  Activity with **Undo**, which restores your workstreams, groups, and threads
  as they were while nothing has changed since.

---

## Surfaces in BB

### Sidebar (`Workstreams` thread list)

Select **Workstreams** as your sidebar thread list to organize threads into:

1. **Up Next:** A sticky amber card at the top of the sidebar with the few
   threads most worth your attention. Up Next and **Pinned** share one sticky
   plate at the top of the list, and the list fades into the sidebar background
   as it scrolls beneath them. Every thread that isn't archived, snoozed, or
   running is a candidate; a running thread joins only while it has a question
   card or approval pending, and otherwise returns, unread, when its turn ends.
   A thread with a question for you (`AskUserQuestion` or approval pending, or a
   **Needs input** or **Blocked** status) or a turn ready for review _needs your
   answer or review_; anything else (complete, failed) does not. A review or
   question whose turn ended more than `7` days ago ages out and no longer
   counts; a pending question card or approval never ages out. A thread the
   agent reported **Waiting** on a subagent or timer is never a candidate in the
   sidebar, Home screen, or next Up Next command: it stays in its workstream
   until it asks for you or finishes. The queue page lists those threads after
   everything else, because it is where a Waiting recap's status check is
   watched and cancelled. Candidates rank in tiers, each newest first by latest
   turn end. With **Prioritize unread threads** on (the default), every unread
   thread comes before every read thread, however its turn ended, and the unread
   ones rank by what their turn left you with:
   1. Unread threads that need your answer or review
   2. Other unread threads
   3. Read questions
   4. Read reviews
   5. Other read threads

   A failed turn gets no boost, so a thread that just failed cues up with the
   other unread threads by its turn-end time. With the setting off, each thread
   ranks by its kind alone, so a read question comes before an unread review:
   1. Questions
   2. Reviews
   3. Other threads

   **Prioritize recent threads** in those settings moves the threads whose turn
   ended within the chosen window above older ones, whatever they need from you,
   and keeps the tier order inside each group. Up Next then shows the **Threads
   shown** most urgent threads (`5` by default) and never more: the count is the
   whole list, and a thread that needs your answer or review is never a reason
   to grow it past that number. A thread you have read that needs neither
   therefore only fills a row nothing more urgent wants; turning **Show read
   threads** off drops those threads entirely, so Up Next lists just the threads
   that are unread or need your answer or review, fewer than **Threads shown**
   when there are fewer of them, and nothing when none of them do. **Show N
   more** lists the threads the count pushed out that are unread or need your
   answer or review, below the rest, and **Show less** collapses them; trimmed
   read threads that need neither stay in Recent and their workstreams. It
   re-ranks as recaps, read state, and activity change. A change in its rows
   waits until changes have been quiet for `120 ms`, so a burst moves once, and
   then everything moves together on one spring. A row that leaves or changes
   rank within `2 s` of opening another thread waits for `1.5 s` of quiet
   instead, so rows do not move as you switch threads; a row joining is not
   delayed. While the pointer moves over Up Next, and for `500 ms` after it
   stops, rows hold their places. A row joining Up Next opens its slot and fades
   in, a row leaving fades as its slot closes, and a row that changes rank
   travels to its new place over the rows it passes. A row the count pushes out
   slides under **Show N more** without fading, and a row that **Show N more**
   held rises out from under it into the last slot. The card's edge, **Pinned**,
   and the workstreams below follow the rows. A row's highlight and marks change
   at once, and **Show N more** and **Show less** apply without waiting. With
   reduced motion enabled, the new order appears at once, with nothing fading.
   The thread you have open keeps its row and place until you open another
   thread. Putting that thread away moves you on: snoozing it, or archiving it
   from anywhere (the recap card, the sidebar, the thread header, or a keyboard
   shortcut), opens the next row of Up Next after it, wrapping to the top. That
   is the same thread **Workstreams: next Up Next thread** opens from it, and
   the row you see below it in the sidebar, even when reading the thread changed
   its rank or **Show N more** is open. A child thread counts as its parent's
   row. When Up Next has no other thread, archiving a child thread leaves you on
   its parent, and archiving a thread with no parent opens the next thread in
   its workstream, then the most recently active thread, so you land on the
   composer only when no other thread is open. A toast names the thread that
   left and the one that opened, since a script or another device may have
   archived or snoozed it. Its **Undo** unarchives or wakes the thread and opens
   it again; a snooze you made in this app shows its own toast with **Undo**
   instead. Child threads do not appear as separate Up Next entries; find them
   under their parent in your workstream.
   - **Focus:** While a focused workstream has a thread that needs your answer
     or review, Up Next applies these rules to focused workstreams' threads only
     and marks its header with the focus icon.

2. **Pinned:** The threads you pinned in BB, in a quiet card directly under Up
   Next and inside the same sticky plate. Rows keep BB's pin order: pins you
   reordered lead, then the pins never reordered, newest first. Pinning is a
   second way to see a thread, not a move: the thread also stays in its
   workstream, and a pinned child thread stays under its parent. A snoozed pin
   waits in **Snoozed** until it wakes, and a pin's child threads list under it,
   hidden until you open them, as in Up Next.
3. **Workstreams (focused and other tiers):**
   - **Workstreams and categories:** Each workstream has its own header, with
     its group's name dimmed before its name when it is in a group (**Vercel
     Agent** Automations). The group's name reads in its own color, dimmed, so
     one group looks alike over every workstream in it, and the workstream name
     uses its own color. Categories are row headings inside that workstream, not
     additional workstreams. Focus, ordering, and Dormant continue to apply to
     workstreams.
   - **Small workstreams:** Every workstream with threads keeps its own header,
     regardless of its size.
   - **Indentation:** Child threads sit one step in from their parent thread.
     Categorized threads sit further in than their category heading, and child
     threads sit further in than their parent. Category headings use a muted
     version of the workstream color and have no independent focus, project, or
     New work action. Threads can be reordered within a category; dragging
     between workstreams moves the thread to another workstream, not to another
     category.
   - **Empty workstreams:** A workstream shows only while it holds a visible,
     non-archived, unsnoozed thread. The moment its last one is archived or
     snoozed, its group, header and **New work** action leave the sidebar, and
     its empty section is deleted on the next organizing pass. Threads and the
     workstream are kept, so a later thread in that workstream shows it again.
     Focusing an empty workstream keeps it no longer than any other.
   - Click a workstream's header, anywhere but its buttons, to open its
     **Overview** on the Workstreams page. The header takes a thread row's hover
     fill, and its selected fill while its Overview is open. Dragging the header
     by its name still reorders the workstream and opens nothing.
   - Press the chevron beside a workstream's name to collapse or expand its
     threads. The group closes and opens its height over `260 ms` with a fade,
     like rows and bands, so what follows slides rather than jumps, and the
     chevron turns a quarter turn. **Dormant**, **Archived**, **Snoozed**, and
     each archived workstream's group fold the same way. Under reduced motion
     they change at once.
   - Click the **Focus** button (viewfinder icon) on any workstream header to
     move it to the top tier. When at least one workstream is focused, the other
     workstreams, **Other**, and **Dormant** collapse behind **Show/Hide other
     workstreams**. While collapsed, the toggle sums how many of their threads
     need you and how many threads they hold, using the same amber and grey
     treatments and count settings as workstream headers.
   - Click **New work in \<workstream\>** (`＋`) on a workstream header to open
     the composer pre-seeded with that workstream.
   - Click **Snooze** (alarm-clock icon) on a workstream header to snooze its
     threads with your default preset, child threads included and whether or not
     it is collapsed; rest the pointer on it for the snooze menu. Each thread is
     snoozed with its child threads, as if snoozed from its own row, and
     **Undo** in the confirmation wakes them all. The button appears only while
     the header lists threads.
   - Use the **Sort workstreams** menu to order workstreams by **Name A–Z**,
     **Recent activity**, or **Manual order** (drag headers within their tier).
   - While organizing suggestions wait for review, their count ("2 suggestions")
     appears on the **Workstreams** heading. Click it to open them in a modal
     over the app, or a drawer from the bottom on a narrow window. On the left,
     each suggestion is one sentence, and the selected one is highlighted. On
     the right, that sentence is the title, with **Decline** and **Accept** at
     its end and the keys `D` and `A` on them. Below it are two small drawings
     of the whole sidebar, **Now** and **After accepting** that one change. Each
     workstream with a visible thread is its name over a tick for each thread,
     in your sort, with the sidebar's own nesting and name prefixes; dormant
     workstreams are drawn too, and categories are not. Snoozed threads, which
     the sidebar doesn't list, are dashed ticks, drawn only in the workstreams
     the change touches. A workstream the change touches is always drawn, as a
     name alone when it has no thread to show. Archived threads are never drawn,
     only counted under the drawing ("5 archived threads also move"). Under
     **Manual order** a workstream the change creates sits beside the one it
     grew from in the second drawing. The workstreams the change touches take
     their colors, and a ribbon runs from the threads that move to where they
     land; everything else is quiet gray. Rest the pointer on a ribbon, or focus
     it, to list its threads' titles and their number. A workstream draws about
     twelve ticks at most, shared out by its threads, so a ribbon's thickness is
     its real share. If the drawings are taller than the window they scroll
     together with the touched rows in view and count the rows beyond the edge.
     A decision applies at once. Its row keeps its place with **Undo** for six
     seconds (`U` undoes the latest), then dims until the modal closes, and the
     highlight moves to the next suggestion; `J` and `K` step between them. The
     **⋯** menu holds **Accept all**, **Decline all** and **Open Organize**, and
     the foot counts suggestions your workstreams have since outgrown ("1 out of
     date"). If your workstreams change while the modal is open, a suggestion
     that no longer applies stays where it was, dimmed and out of date, with its
     buttons off. **Close**, `Esc`, or a click outside closes the modal and
     leaves the rest waiting; deciding the last one closes it once its Undo has
     passed.
   - Drag a thread to another workstream to move it there; its child threads
     follow it. Drop on a row to place it before or after that thread, or on a
     header to place it first, including a collapsed workstream. Drop in
     **Other** to move it to No workstream. When you drop it on a group's
     header, the **Name and organize new threads** model chooses one of that
     group's workstreams. The sidebar shows **Choosing a workstream in the
     destination group…** while it chooses, then saves the choice as your own
     (`manual` source). When a group's workstreams list inline under its header,
     the chosen workstream's order applies. If the call fails, returns an
     invalid workstream, or the thread or your workstreams change while it runs,
     the thread stays where it was and the sidebar shows an error.
   - Drag threads within a workstream to set manual thread order (new threads
     appear at the top of their workstream; new workstreams appear at the
     bottom).
4. **Other:** Threads in no workstream.
5. **Dormant:** Unfocused workstreams with no activity in the last `30` days and
   nothing that needs you.
6. **Recent, Snoozed, and Archived bands:**
   - **Recent** lists the most recently active threads (`1–20`, default `5`)
     that Up Next isn't showing, so it carries on where Up Next stops. Snoozed
     threads stay out.
   - **Snoozed** lists snoozed threads ordered by soonest wake time (or
     `On update`), with their child threads under them while snoozed.
   - **Archived** paginates archived threads via BB's archive list.
   - Each band has a **⋯** menu for **Sort by** (`Recent activity`, `Title A–Z`,
     `Soonest to wake`, or `Archive date`) and **Show by workstream**. Grouped
     bands show each workstream under a header with its count; the header folds
     the group, and Archived groups start folded.

#### Row indicators and actions

Thread ages and the wake time a snooze button shows refresh once a minute, and
snoozes wake at their expiry time. An empty workstream leaves the list as soon
as its last visible thread does. Active rows use a highlighted background and
foreground text without changing title weight. Unread titles use medium weight.

- **Status marks:** Each row shows at most one mark before its title, in this
  order of precedence: the working spinner (customizable) while a turn runs, a
  red exclamation circle for a failed turn, an **amber Needs input** dot when
  the thread needs your input (a pending question or approval, an explicit ask,
  or a turn that stopped with requested work left), an amber struck-through
  circle when the thread is **Blocked** on something only you can do, a **blue
  Ready for review** dot when the latest turn is ready for your review, a grey
  spinner when the agent reported it is **Waiting** on a subagent or timer, and
  a **green Complete** dot when the latest turn finished. The Needs input and
  Ready for review dots are solid while the thread is unread and a ring once
  read; the Complete dot shows only while the thread is unread, so a read thread
  never carries a bare ring. Other unread threads with a mark also show a small
  blue dot before the title; unread threads without a mark rely on the
  medium-weight title alone. A failed turn keeps its circle until the thread
  runs again, so reading the row does not clear it. Rows in a list share one
  mark column, as wide as the widest mark any of them draws, so titles keep one
  left edge. A list with only dots has a narrow column, and a thread that has
  children adds its chevron without widening it. A spinner, failure circle, or
  blocked circle widens the column, and the titles slide over as marks come and
  go. The spinner shape chosen in Settings sets its own width.
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
- **Right-click context menu:** **Open in split**, **Open parent** (for child
  threads), **Move to** (**Automatic**, any workstream, or **No workstream**),
  **Rename…**, **Pin / Unpin**, **Mark read / Mark unread**, **Inspect model
  calls…** (when the debug UI is on), **Snooze / Change snooze / Wake now**,
  **Archive**, and **Delete…**. A workstream header's menu holds **Overview**
  and its hover actions: **Focus / Stop focusing**, **New work**, and **Snooze
  \<N\> threads**. On touch screens, a long press opens either menu.

### Phone Home screen

On compact viewports (when **Sidebar → Home screen → Up Next and workstreams on
phones** is enabled), Workstreams replaces BB's flat Recent list on the Home
screen with:

- The **Up Next** card at the top, with the **Pinned** card directly under it.
  Its rows use the same motion as the sidebar's Up Next rows.
- **Workstreams** sections with workstream color dots, needs-you and total
  badges, an **Expand all / Collapse all** toggle, and per-parent child thread
  fold controls. Focused workstreams (or a single active workstream) start
  expanded.
- A collapsible **Snoozed** section at the bottom.

### Stream Deck

An optional Stream Deck plugin in [stream-deck/](stream-deck/README.md) puts Up
Next on Stream Deck keys and a Stream Deck + dial. You install it into Stream
Deck 7.1 or later, on the Mac that runs BB, separately from Workstreams.

- **Up Next thread** keys each show one Up Next thread by position, drawn like
  its sidebar row: the row's mark, the workstream in its color, and the title.
  Positions past **Threads shown** continue with the threads **Show N more**
  lists. Pressing a key opens its thread in BB.
- The **Next Up Next thread** key shows how many Up Next threads are unread or
  need your answer or review, and pressing it runs **Workstreams: next Up Next
  thread** in each connected BB app.
- The **Up Next** dial shows one thread on the touch strip. Turning it moves
  through Up Next, and pressing it opens the thread.

The keys rank threads with the sidebar's rules and your **Up Next** settings,
and update as Up Next changes. They leave out the thread you have open in BB, so
every key opens a different thread; with BB open on several devices, that is the
thread open in the app you used last. They read it from Workstreams' Stream Deck
routes, which require the plugin token (`bb plugin token workstreams`); the
Stream Deck plugin gets that token from the `bb` CLI.

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
  in one move, and the band dissolves into the timeline along its bottom edge so
  the messages come up through it rather than being sliced by it; the **Title
  transition** does not apply. A heading that stays in the timeline keeps its
  title and workstream name left aligned. In **Settings → Workstreams →
  Threads**, choose **Title on scroll → Float** to leave the heading over the
  thread and let the timeline move beneath its shadow, **Title transition** to
  change how the large heading hands off to the minimized one (**Fade**,
  **Scroll**, **Morph**, **Stagger**, **Flip**, **Rack focus**, or **Cascade**),
  or **Title alignment → Centered** to center the minimized title's slot in the
  bar. Those last two appear only while the title minimizes. **Morph**,
  **Stagger**, **Flip**, **Rack focus** and **Cascade** time each line
  separately as you scroll away from the newest message (over 360 px at the 14px
  body size) and shade each large line on its own instead of under one plate.
  **Morph** carries the title to the bar, shrinking it as it goes. **Stagger**
  slides each line away and the next in behind it. **Flip** turns each line
  edge-on. **Rack focus** blurs the large title out while the minimized one
  sharpens in, so one of the two is always mostly legible. **Cascade** lifts the
  letters away one by one. With **Title alignment → Centered**, those five also
  center the minimized title and workstream name on the slot's middle. **Fade**
  and **Scroll** keep all title and workstream text left aligned. Reduced motion
  uses the stationary crossfade in the title bar for every transition, and
  removes the animation from the step down of a heading that stays in the
  timeline. Switching threads preserves your reading position. When you follow
  the newest message, the view stays attached to it as the heading loads.
- **Thread header actions:**
  - **Parent thread** (optional, off by default): Opens the parent thread from a
    child thread's header.
  - **Snooze:** Split button on desktop (one-click default snooze + chevron menu
    for all presets and **Custom…**) or menu button on phones; shows **Snoozed
    \<time\>** with a **Wake now** option while snoozed.
  - **Archive** (on by default): Archives the current thread through BB's
    archive flow.
- **Snooze in BB's thread menus:** On BB builds that take plugin thread actions,
  BB's thread menus (a sidebar row's menu and right-click menu, and the thread
  header's menu) list **Snooze** with your presets, after **Wake now** while
  snoozed. Add **Snooze** to the Quick Actions plugin's ring under its
  **Actions** settings, and the ring shows the same choices as a band with your
  default lit. These menus show preset names without wake times and have no
  **Custom…**.

### Agent recap card (`WorkstreamsRecap`)

When **End turns with a recap** is enabled (default), agents report the outcome
of each turn using `WorkstreamsRecap`, rendered as a card above the composer:

- **States and accents:**
  - **Complete** (emerald): Shows the turn's headline, completed `latest`
    bullets (none for a short answer, whose headline states the answer),
    optional **Next actions**, and offers **Archive** when the thread and all of
    its child threads, goals, and todos are finished and idle. Archiving opens
    the next Up Next thread, as archiving from anywhere does (see **Up Next**).
  - **Ready for review** (sky): Adds numbered **Review** steps (`1–3`) and up to
    `8` clickable **Links** (HTTPS URLs or absolute workspace/host file paths,
    including paths with spaces).
  - **Waiting** (violet): Used when the agent is waiting on background subagents
    or external work. Lists **Awaited agents** with live status dots (polled
    every `4 s`, including hidden worker threads) and a draining countdown bar
    (**Next check in M:SS**). When the timer expires, Workstreams automatically
    prompts the agent once to check status and report back.
  - **Blocked** (amber, the Needs input color): Used when the agent can't
    continue until you do something only you can do. The headline says what
    blocks it, and **To unblock** lists `1–3` steps for you. Use a question card
    instead when the agent needs a specific choice.
- **Interactive tokens:** `@thread:<id>` mentions render as clickable thread
  chips; Git commit hashes (`7–40` hex characters containing letters and digits)
  render shortened with configurable digit/letter tints and click-to-copy.
- **Next actions:** Up to `3` follow-up actions. After completed work, agents
  surface concrete useful recommendations and unresolved optional improvements
  as self-contained actions, including recommendations in the reply. Agents
  execute authorized continuations and use question cards for blocking input or
  approval. Answers without a useful follow-up need no action. **Click** an
  action to send its message immediately; **Shift-click** to insert it for
  editing. When the actions do not fit, **Next actions** collapses into a menu
  where a pick sends its message, and holding `Shift` shows an **Edit in
  composer** hint that makes the pick insert it instead.
- **Dismiss and restore:** Click **Dismiss recap** (`×`) to hide the card (and
  cancel any pending waiting-recap countdown); click the **Show recap** pill to
  restore it.
- **Reminders and loop guard:** If an enrolled agent ends a turn without a valid
  recap or a question card, Workstreams sends up to `3` automatic reminders
  (configurable `0–10`), each labeled **Reminder N of M**. Reminders name the
  recap tool rather than assuming the latest setting changed the session, tell
  the agent not to repeat an answer already visible to the user, and leave it
  one short line to end the turn with. If an active thread makes `5` identical
  tool calls in a row — the same failures, or the same arguments and the same
  output — Workstreams stops the turn and pauses automatic continuation to
  prevent an infinite retry loop.

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
    recommendations. A `message` is shown verbatim before **Copy** and **Add to
    message** controls. Adding appends to the original thread's composer without
    submitting or replacing its draft. It is disabled for another thread, a
    new-thread draft, an editor, or a gallery without that thread's composer.
    Items without a message have neither control. Reference, review, and action
    lists allow up to 256 entries, separately from the recap's short lists.
    These are rendering components, not a background UI-writing agent; recap
    state and send behavior are unchanged.
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

### Enhanced responses (experiment)

**Enhanced responses** is off by default (Settings → Workstreams → Recap). While
it is on:

- Agents in top-level threads write each final response as plain Markdown: the
  answer first, qualifications beside the claims they limit, exact source names,
  what was checked and where, and who acts next. They get no `:::reply`
  contract, and the recap tool, recap card, waiting checks, and question cards
  work as before. Child threads and side chats keep their usual contract.
- When a turn in a visible top-level thread finishes, Workstreams reads the
  thread's events to find that turn's final assistant message by its turn and
  item ids, then composes an enhanced document for it on the analysis machine.
  An interrupted or failed turn, a turn with no final text, a reply block, and a
  response over 24,000 characters get nothing.
- Workstreams draws the document below the original response, which stays as the
  agent wrote it. BB's stored messages, the CLI, exports, notifications, forks,
  and the agent's own context keep the original. **Copy** copies the document's
  complete text form, folded check rows included.
- Composition is a bounded loop with one tool, `preview_document`. The model
  receives the response, the thread's title, and its workstream; each preview
  validates the candidate and, when it is valid, returns screenshots at 720px
  and 360px, layout diagnostics, which blocks are folded, and the text form. At
  most 3 previews, 5 model calls, and 150 seconds per composition. The final
  answer is `null` or exactly the last document that previewed successfully, and
  the server validates it again before storing it.
- Previews render the same component and stylesheet as the appended view, as
  static markup in a private headless Chrome on the analysis machine. The page
  has no script, a Content-Security-Policy that blocks every fetch, and no host
  name resolution; the model's data can only become text.
- One document is stored per assistant message, so a repeated turn end, a second
  pane, a scroll, or a reload reads it without another model call. A document
  composed after a newer turn started still appears under the response it was
  composed for. Deleting a thread deletes its documents; turning the setting off
  hides every document until it is turned on again.
- When any step fails, Workstreams stores nothing and writes the reason to the
  plugin log (`bb plugin logs workstreams`); the original response stays as it
  was.

The document format is typed JSON: paragraphs, lists, sections, checks with
reported test totals, tables, notes, and callouts, with code spans inside text.
The validator rejects unknown fields, HTML in text, and documents over 24,000
characters or 40 blocks, naming the field at fault. The composing model must be
an AI Gateway model (a Pi `vercel-ai-gateway/…` pick) that accepts tools and
images, and the analysis machine needs Chrome (or `CHROME_PATH`).

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
  answerable above the composer until you answer it. Sending a message of your
  own from the composer closes it instead.
- **Dismiss** hides the card and leaves the question open. **Show question**
  brings the card back, and the agent keeps waiting until you answer or send a
  message.
- Submitted questions remain inline as read-only cards, collapsed by default to
  a compact summary of each question and answer. Expand a card to see the
  original question text, details, all options and previews, selected answers,
  free text, notes, and downloadable image or file attachments. They use the
  same display after an interruption, recovery, or page reload, without an extra
  raw JSON answer. Older answers retain the information saved with them; exact
  selections are marked when the structured submission is available. Cards
  expand and collapse with a short animation, unless reduced motion is enabled.
  Expanding at the bottom keeps the card's top in place and detaches the thread
  from the bottom. A question closed by a message of your own keeps its original
  content and shows that it was dismissed without an answer.

### Workstreams page (`/plugins/workstreams/home`)

Open **Workstreams** in the main navigation panel. The page is a queue that
shows one thing at a time that needs you: Up Next's threads in the sidebar's
order, then the threads that are still waiting, then the organizer's
suggestions. A waiting thread's card carries its status-check countdown, which
the sidebar's Up Next never shows. The order holds while the page is open. The
next items wait as a stack of cards behind the current one, the next two peeking
out above it. Acting on an item, or skipping it, tucks its card under: it drops
clear of the stack, slips behind it, and rises to the back while the others move
up a place; going back reverses the path. A card too tall to fit behind the next
one fades away on its way. A moving card follows a sideways loop and banks
slightly. Presses are taken one card at a time, at least 120 ms apart and only
when the previous card clears; a press that arrives while one waits is dropped,
and a press the other way is always taken. Holding `↓` moves cards on, and
holding `↑` brings them back. Repeats start after 250 ms and run every 25 ms,
and a held key starts at about 6 cards a second and, once it has been held for
1.2 s, tightens to about 9, so a short hold stays readable and a long one covers
ground; presses made one at a time are held only to the card clearing. As a hold
continues, the springs stiffen and clearing loosens while cards stay whole;
letting go rests on a whole card. When a card comes back from behind the stack
it regains its colour, and the card it is about to cover dims its content and
shrinks to the size it will have under it, keeping its frame and background.
Under reduced motion the new item only fades in. To look ahead or back without
acting, use the footer's arrows, which also show where you are ("2 of 9"), or
press `↓`, `→` or `J` for the next item and `↑`, `←` or `K` for the previous
one. The card stack's top edge sits about a quarter of the way down the page,
and the heading sits in a fixed place just above the stack. The replies and
actions follow the card and the page grows downward, so opening Reply, holding
`Shift`, or a receipt appearing above never moves anything. The stack keeps that
place from item to item and follows the window as you resize it; it only glides
down when the next item's heading wraps to more lines. The new heading fades in
place; the receipt line crossfades to the next one with a small drift. Under
reduced motion the card only fades in and the heading changes in place.

Question cards on this page use the same form as the thread: choose options,
review previews, add notes, answer in your own words, or attach files and
images, then submit or dismiss. Draft answers follow you between the page and
the thread. Submission resumes an active question tool; an interrupted question
sends its recovered answer to the thread. Question footers run edge to edge
inside the card, with **Dismiss** aligned to the question text and **Submit** on
the opposite side.

Waiting recaps show their status-check countdown. **Dismiss recap** (`D`)
cancels that check and removes the item from the queue; **Undo** restores the
recap with its check still cancelled. Review and complete recaps keep their
links and Next actions, and suggestions offer **Accept** and **Decline**.

Each thread shows its workstream (click it to open **Organize**) and title above
its latest recap card. Under the card:

- **Next actions:** the agent's proposed next messages, in full. Click one or
  press `1`–`3` to send it; hold `Shift` while clicking or pressing the number
  to edit it in the composer first. A hint saying so fades in while the pointer
  is over the actions, an action has keyboard focus, or `Shift` is held.
- **Reply** (`R`) opens a composer in place of the Next actions: `Enter` sends,
  `Shift+Enter` adds a line, `Esc` goes back.
- **Snooze…** (`S`) opens the snooze presets at the button; press `1`–`6` to
  choose one, or **Custom…**.
- **Archive** (`E`) and **Open** (`O`). On a complete recap with no Next
  actions, Archive comes first.

The row of actions is centered in the column.

A suggestion shows the workstreams its threads would move to (new ones marked),
with **Accept and move N threads** (`1`) and **Decline** (`2`).

Actions leave a receipt above the next item. Archive, snooze, recap dismissal,
and suggestion decisions offer **Undo** (`U`). A sent message waits `5` seconds
behind its receipt before it goes out, so Undo can keep it from sending.
Question answers apply immediately and cannot be undone. **Dismiss** on a
question hides its card and leaves the question open in its thread, where **Show
question** brings it back. While a question is open, its form replaces the Next
actions and the **Reply** action. The queue arrows stay below the scrollable
cards, including long questions. When Up Next is clear, the page says so and
offers to go through the earlier open threads, which include threads still
waiting on something else.

The **⋯** menu in the corner opens:

- **Activity:** Day-grouped log of automatic and outside changes. Each entry
  says what changed, who made the change (**You**, **Workstreams**, or **Outside
  Workstreams**), and how it stands (**Applied**, **Partially applied**,
  **Failed**, **Undone**, or **Declined**). Filter by workstream, by action, or
  with **Outside changes**. The actions are:
  - **Thread started:** a thread started from New thread, in the workstream
    Workstreams chose for it.
  - **Thread moved:** one or more threads moved to another workstream, by you,
    by Workstreams, or outside Workstreams.
  - **Title updated:** a thread was given its title, from its opening request or
    after a turn.
  - **Workstream created**, **Workstream renamed**, and **Workstream removed:**
    a workstream was added to the sidebar, renamed, or left it. A workstream
    Workstreams found is removed when nothing uses it; its threads are not
    deleted.
  - **Categories updated:** a workstream's categories changed; no thread changed
    workstream.
  - **Suggestion accepted:** you accepted an organizing suggestion, which
    changed your workstreams and groups or moved a thread.
  - **Project learned:** a workstream's project was learned, set, or kept.
  - **Change undone:** a previous change was reversed.

  Hover or focus any reversible entry and click **Undo** to revert its effect
  when current BB state still matches.

- **Organize:** The organizer's status with **Suggest now** (**Try again** after
  a failure) and, when more than one suggestion can apply, **Accept all N**. Its
  **⋯** menu holds **Rebuild** and **Preview automatic moves…**. Below that come
  every suggestion waiting for a decision (**Threads move**, which also lists
  threads with no workstream, each with a workstream picker; **Workstreams
  change**, where no threads move; and the collapsed **N out of date**),
  **Project associations**, and every workstream and group, with **New
  workstream…**. Click a workstream to edit its name, group, project,
  description, and aliases, or choose **Add workstream…** or **Merge into…**.
  **Preview automatic moves…** shows where Workstreams would move up to `100`
  visible threads it placed itself (model calls only) and applies the preview
  when you confirm; a preview expires after `30` minutes, leaves out threads you
  moved, and skips threads whose evidence changed. On Organize, `j`/`k` move
  between suggestions and `a`/`d`/`u` accept, decline, and undo.
- **Model traces** (debug UI only): Activity filtered to the recorded model
  calls behind Workstreams' decisions.
- **Gallery** (debug UI only): see [Development](#gallery-view).

Each opens as its own view with **Back**. Deep links open them directly:
`/plugins/workstreams/home/activity`, `/organize`, `/debug` (model traces),
`/gallery`, and `/overview/<workstream>`.

#### Overview

Click a workstream's header in the sidebar, or choose **Overview** from its
header's menu, to see that workstream's open threads as a table at
`/plugins/workstreams/home/overview/<workstream>`. It lists the threads the
header lists in the sidebar: a group's header lists all of its workstreams'
threads, and **Other** has an Overview too. Archived and snoozed threads are
left out, and child threads get no rows of their own. The heading shows the
workstream's name in its color and how many threads need you or are ready for
review. **New work** starts a thread in the workstream, and the **⋯** menu holds
**Focus / Stop focusing** and **Snooze \<N\> threads**.

Rows are ordered by status, then newest turn first:

| Status           | Summary                                           | Next steps                                                          |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Needs input      | The latest recap line                             | The pending question card's first question, or what the thread asks |
| Blocked          | The recap's headline, or the latest recap line    | The recap's **To unblock** steps, or what the thread asks           |
| Ready for review | The recap's headline                              | The recap's review steps, then its Next actions                     |
| Failed           | The last turn failed. Open the thread to see why. | Nothing                                                             |
| Working          | Nothing, or the message you sent from the table   | Nothing                                                             |
| Waiting          | The recap's headline                              | The awaited agents' tasks and the status-check countdown            |
| Complete         | The recap's headline                              | The recap's Next actions, or **Archive** when it proposes none      |

A thread whose latest turn has no status yet shows its analysis line when there
is one. Status marks match the sidebar's: a solid dot while unread and a ring
once read, and a read Complete thread has no mark. Unread titles use medium
weight. Everything comes from the recaps and analysis already stored, so opening
an Overview makes no model calls.

- **Open a thread:** click its title.
- **Next actions:** click one to send its message to the thread. The message
  waits `5` seconds behind a receipt that takes the place of the thread counts,
  where **Undo** keeps it from sending, and the row reads Working with the
  message until that turn ends. Leaving the page sends a waiting message at
  once. **Shift-click** opens the thread without sending, so you can edit the
  action from its recap card.
- **Archive** in Next steps appears on a complete recap that proposes no next
  action, once the thread has no turn, queued message, pending question, or
  background work. It archives the thread with its child threads and leaves a
  receipt with **Undo**.
- **Row actions:** hovering or focusing a row shows **Archive** and **Snooze**
  in place of its age, as on a sidebar row. Snooze confirms in a toast with
  **Undo**.

Summary has its own column when the page is wider than `1000px`. Below that it
sits under the title, and below `600px` each row stacks its status, title,
summary, and next steps.

---

## Commands and keyboard shortcuts

| Command / Shortcut                                              | Where                              | Action                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Workstreams: next Up Next thread` (`Cmd+Alt+J` / `Ctrl+Alt+J`) | Global command palette / shortcut  | Opens the Up Next row after the open thread's, wrapping to the top: the thread archiving the open thread would open.                     |
| `Workstreams: snooze this thread`                               | Command palette (active thread)    | Snoozes the current thread using your default snooze preset.                                                                             |
| `Workstreams: wake this snoozed thread`                         | Command palette (snoozed thread)   | Wakes the current snoozed thread immediately.                                                                                            |
| `Workstreams: toggle debug UI`                                  | Global command palette             | Shows or hides the debug UI without touching recording; bind a shortcut in **Settings → Keyboard** (unbound by default).                 |
| `1`–`3`, `Shift`, `R`, `S`, `E`, `O`, `U`, `↑`/`↓`/`←`/`→`      | Workstreams page                   | Sends a Next action (`Shift` edits it first), replies, snoozes, archives, opens, undoes, or skips (`↓`/`→`/`J` ahead, `↑`/`←`/`K` back). |
| `Shift+Click`                                                   | Recap card **Next actions** action | Copies the action's message into the composer for editing instead of sending immediately.                                                |
| `Shift`+pick                                                    | Recap card **Next actions** menu   | Copies the chosen action's message into the composer; holding `Shift` shows the **Edit in composer** hint.                               |
| `1`–`4`, `Enter` / `Shift+Enter`                                | `AskUserQuestion` card             | Selects an option by number; submits the answer (`Enter`) or inserts a newline (`Shift+Enter`).                                          |

---

## Snooze presets and wake behavior

Threads can be snoozed from the sidebar hover button, the sidebar right-click
menu, the thread header, or the command palette, and a whole workstream's
threads at once from its sidebar header. Every snooze menu lists your presets in
order, then **Custom…**; clicking a snooze button uses the default preset.

You keep between `1` and `6` presets in **Settings → Workstreams → Snooze**.
Each preset has an optional label (an empty label names it by its **Wake**
choice) and one **Wake** choice, which resolves to a wake time at the moment you
choose it:

| Wake          | Wakes                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Duration**  | That many minutes or hours from now (up to `999`), or that many days from now at the same clock time (up to `365`).                                                            |
| **Time**      | At a clock time on **Today** (tomorrow once that time has passed), **Tomorrow**, **Next workday** (Friday through Sunday wake on Monday), or the coming weekday (never today). |
| **On update** | At the first wake event (below), with no time (`until: null`).                                                                                                                 |

A **Duration** or **Time** preset also has **Wake early on events**: when on,
the thread wakes at its time or at the first wake event, whichever comes first.
It starts on for a duration (a short break while something runs) and off for a
time (work put away until then); a duration preset saved before this setting
existed wakes early until you turn it off.

The defaults are **1 hour** (wakes early), **Tomorrow morning** (tomorrow at
`9 AM`, the default), **Next week** (Monday at `9 AM`), and **On update**.

**Custom…** opens a dialog for a one-off snooze. Its **Wake** field lists the
same choices (**Duration**, **Time**, **On update**) plus **Date** as radio
buttons, and the chosen one shows its fields just beneath it, with **Wake early
on events** below for the timed ones (on for a duration, off for a time or date,
until you change it). It opens on **Date**, which picks any date and time up to
`366` days out. Editing a preset never moves a thread that is already snoozed: a
snooze stores only its wake time and whether it wakes on events.

### Wake events

A snooze that wakes on events ends at the first of these that happens after it
was set and is turned on in **Settings → Workstreams → Snooze** (all are on by
default; with every one off, **On update** never wakes on its own). The thread
returns marked unread.

| Group            | Event                        | Happens when                                                                                                                                 |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thread**       | **Needs input**              | A question card or approval is pending, or a turn ends needing your input.                                                                   |
|                  | **Blocked**                  | A turn ends blocked on something only you can do.                                                                                            |
|                  | **Ready for review**         | A turn ends ready for your review.                                                                                                           |
|                  | **Complete**                 | A turn ends complete.                                                                                                                        |
|                  | **Failed**                   | A turn fails and stays failed for a minute with no retry queued.                                                                             |
|                  | **Message fails to send**    | A queued message fails to send.                                                                                                              |
|                  | **Machine restart stops it** | The thread or a child thread has waited `5` minutes for its machine.                                                                         |
| **Child thread** | **Needs input**              | A child thread has a question card or approval pending, or its turn ends needing input, blocked, or ready for review.                        |
|                  | **Fails and work stops**     | A child thread failed and, for `5` minutes, nothing in the tree runs, queues, or asks you anything while the thread's last turn waits on it. |
| **Pull request** | **Changes requested**        | The thread's pull request moves to changes requested.                                                                                        |
|                  | **Checks failed**            | Its checks move to failed.                                                                                                                   |
|                  | **Ready to merge**           | It moves to approved, green, and mergeable.                                                                                                  |

A turn that ends **Waiting** on an external task, a turn starting, an automatic
retry, a background job, a retitle or move, and Workstreams re-summarizing a
thread never wake it: a turn counts by how it first read. A snoozed thread's
pull request is looked up when you snooze and then every `5` minutes, while the
snooze wakes on events and a pull request event is on. Only a change counts: a
pull request already failing its checks when you snooze doesn't wake the thread.
Likewise a question, failed send, or machine wait already there when you snooze
never wakes it.

- Snoozing a thread removes it and all of its child threads from its workstream
  and from **Up Next** / **Recent**, placing them in the **Snoozed** section
  until wake.
- **Time-only snoozes ignore agent activity** so an overnight run does not wake
  a thread before morning; when a timed snooze expires, Workstreams wakes the
  thread and marks it unread.
- Sending a message to a snoozed thread or clicking **Wake now** wakes it
  immediately.
- Snoozing the thread you have open opens the next thread in **Up Next** (the
  row after it, wrapping to the top) once the snooze lands, so the next thing to
  look at comes with it. Snoozing another thread leaves you where you are.

---

## Settings reference

Open **Settings → Workstreams** to configure:

| Section               | Setting                                                                                                          | Default                                           | Details                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sidebar**           | **Up Next**, **Recent**, **Snoozed**, **Archived**                                                               | All `On`                                          | Under **Sections**: show or hide each band in the Workstreams sidebar.                                                                                                                                                                                                                                                                                             |
| **Sidebar**           | Recent's count (**recent threads shown**)                                                                        | `5` (`1–20`)                                      | The stepper beside **Recent**, shown while Recent is on: the most threads the Recent band lists.                                                                                                                                                                                                                                                                   |
| **Sidebar**           | **Up Next and workstreams on phones**                                                                            | `On`                                              | Under **Home screen**: replaces BB's Recent list on a phone's Home screen with Up Next over your threads by workstream.                                                                                                                                                                                                                                            |
| **Sidebar**           | **Timestamp**                                                                                                    | `Always`                                          | Under **Details**: show each row's age, right after its title, `Always`, `On hover`, or `Never`.                                                                                                                                                                                                                                                                   |
| **Sidebar**           | **Thread count** / **Threads that need you**                                                                     | `When collapsed`                                  | Under **Details**: show a workstream header's thread count, and how many of its threads need you (Needs input or Blocked), `Always`, `When collapsed`, or `Never`.                                                                                                                                                                                                 |
| **Up Next**           | **Threads shown**                                                                                                | `5` (`1–10`)                                      | How many rows Up Next shows before **Show N more**. The list never grows past this count.                                                                                                                                                                                                                                                                          |
| **Up Next**           | **Show read threads**                                                                                            | `On`                                              | On, threads you have already read fill the rows left after the ones that need your answer or review. Off, it skips threads you have read that need neither, so Up Next holds fewer rows than **Threads shown**, or none.                                                                                                                                           |
| **Up Next**           | **Prioritize unread threads**                                                                                    | `On`                                              | On, unread threads come before read ones, and among the unread the ones that need your answer or review come first. Off, each thread ranks by what it needs from you, so a read question can come before an unread review.                                                                                                                                         |
| **Up Next**           | **Prioritize recent threads**                                                                                    | `Don't prioritize`                                | Threads whose turn ended within the chosen window (`Last hour` through `Last week`) come before older ones. Inside that group the tiers above still apply, so unread threads come first, then the ones that need your answer or review, while with **Prioritize unread threads** off those threads rank by what they need from you.                                |
| **Working indicator** | **Style**, **Color**, **Track**                                                                                  | `Spokes`, `Subtle gray`, `Faded color`            | Choose from `7` spinner shapes (`Spokes`, `Sunburst`, `Arc`, `Orbit`, `Ring`, `Braille`, `Dots`), named or custom `#rrggbb` colors, and track styles for `Arc`/`Orbit`/`Ring`.                                                                                                                                                                                     |
| **Colors**            | **Use vivid colors**, then **Complete**, **Review**, **Waiting**, **Needs input**, **Failed**, and **Automatic** | On                                                | Enhances the active BB theme inside Workstreams. Off uses normal semantic colors. Swatches can follow another theme color or use a custom `#rrggbb`; custom colors bypass vivid enhancement. Both modes follow theme changes and BB's light or dark appearance, even when the system's differs. **Automatic** colors Workstreams' own choices and its suggestions. |
| **Threads**           | **Keep titles current**                                                                                          | `On`                                              | Automatically titles new threads and updates titles as focus evolves. Outside manual title edits stay locked until cleared.                                                                                                                                                                                                                                        |
| **Threads**           | **Title on scroll**                                                                                              | `Minimize`                                        | Minimize shrinks the heading into the title bar as you scroll; `Float` leaves it over the thread, which moves beneath its shadow.                                                                                                                                                                                                                                  |
| **Threads**           | **Title transition**                                                                                             | `Fade`                                            | How the large heading hands off to the minimized title: `Fade`, `Scroll`, `Morph`, `Stagger`, `Flip`, `Rack focus`, or `Cascade`. In a narrow title bar the heading steps down at once. Shown only while **Title on scroll** is `Minimize`.                                                                                                                        |
| **Threads**           | **Title alignment**                                                                                              | `Left`                                            | Where the minimized title's slot sits in the title bar: `Left` after the thread's controls, or `Centered` in the bar's middle. `Fade` and `Scroll` keep title and workstream text left aligned; the other transitions center it on the slot's middle. Shown only while **Title on scroll** is `Minimize`.                                                          |
| **Threads**           | **Show parent thread link**                                                                                      | `Off`                                             | Adds a link to the parent thread in child thread headers.                                                                                                                                                                                                                                                                                                          |
| **Threads**           | **Show archive button**                                                                                          | `On`                                              | Shows an Archive button in thread headers.                                                                                                                                                                                                                                                                                                                         |
| **Recap**             | **End turns with a recap**                                                                                       | `On`                                              | Gives agents `WorkstreamsRecap` and displays the recap card above the composer.                                                                                                                                                                                                                                                                                    |
| **Recap**             | **Reminders**                                                                                                    | `3` (`0–10`)                                      | Maximum turn-end reminders sent when an enrolled agent omits a recap (`0` disables reminders).                                                                                                                                                                                                                                                                     |
| **Recap**             | **Structured replies**                                                                                           | `Off`                                             | Agents report each turn with the recap tool, then write the reply as one `:::reply` block that ends the turn. Shown only with the tomdale/bb fork.                                                                                                                                                                                                                 |
| **Recap**             | **Enhanced responses**                                                                                           | `Off`, `anthropic/claude-sonnet-5.5`              | Experimental. After each turn in a top-level thread, the chosen AI Gateway model composes a document below the final response, and agents write plain Markdown instead of reply blocks. The model reasons at its provider's default; the picker's reasoning level is not sent. See [Enhanced responses](#enhanced-responses-experiment).                           |
| **Recap**             | **Layout**                                                                                                       | `Full` (`Full` / `Compact`)                       | Card layout on desktop (`Compact` is always used on phones), with a live preview carousel.                                                                                                                                                                                                                                                                         |
| **Recap**             | **Commit hash colors**                                                                                           | Theme default                                     | Custom `#rrggbb` colors for commit-hash digits and letters, with **Reset**.                                                                                                                                                                                                                                                                                        |
| **Snooze**            | **Presets**                                                                                                      | `4` presets, **Tomorrow morning** default         | `1–6` presets every snooze menu lists before **Custom…**: add, edit, delete, drag to reorder, and choose the **Default** a click uses.                                                                                                                                                                                                                             |
| **Snooze**            | **Wake on thread events**, **Wake on child thread events**, **Wake on pull request events**                      | All `On`                                          | Which wake events end a snooze that wakes on events (see [Wake events](#wake-events)).                                                                                                                                                                                                                                                                             |
| **New threads**       | **Name and organize as you write**                                                                               | `On`                                              | Shows a guess at a new thread's workstream in the composer as you write. The guessed workstream holds the thread after you send until its start call answers.                                                                                                                                                                                                      |
| **Models**            | **Name and organize as you write**                                                                               | `google/gemini-3.1-flash-lite` (reasoning `none`) | Guesses a new thread's workstream in the composer while you type. It needs a model that answers in about a second and costs little per call.                                                                                                                                                                                                                       |
| **Models**            | **Name and organize new threads**                                                                                | `openai/gpt-6.1-sol` (reasoning `none`)           | Titles a new thread and chooses its workstream when its first request is sent. It also chooses the workstream for a thread you move into a group, previews automatic moves, and checks whether threads fit their workstream's categories.                                                                                                                          |
| **Models**            | **Update threads after each turn**                                                                               | `openai/gpt-6.1-sol` (reasoning `none`)           | When a turn ends, updates the thread's goal, its title while **Keep titles current** is on, and its status when the agent didn't report one. After a new request, it also decides whether the thread moves to another workstream.                                                                                                                                  |
| **Models**            | **Arrange categories**                                                                                           | `anthropic/claude-sonnet-5.5` (`medium`)          | Arranges a workstream's threads into categories when it reaches six, and rearranges them when a thread fits none.                                                                                                                                                                                                                                                  |
| **Models**            | **Suggest changes**                                                                                              | `On`, `anthropic/claude-sonnet-5.5` (`medium`)    | The switch on the row turns organizing suggestions on or off, and the picker chooses the model that writes them: splits and other changes to your workstreams and groups, for you to accept or decline. **Suggest now** works either way, and categories update on their own either way.                                                                           |
| **Models**            | **Analysis machine**                                                                                             | `Only connected machine`                          | Machine whose Pi key is used for AI Gateway calls. Shown only while more than one machine is connected; the default uses any connected machine.                                                                                                                                                                                                                    |

| Section      | Setting                          | Default          | Details                                                                                                                                                 |
| ------------ | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Advanced** | **Worker project**               | `First project`  | Where Workstreams' own background threads run when a model call runs as a BB thread. **First project** uses the first project BB lists.                 |
| **Advanced** | **Record model traces**          | `On`             | Saves each model call's prompt, reasoning, and response as a redacted model trace (`7` days / `1,000` records), whether or not the debug UI is showing. |
| **Advanced** | **Debug UI**                     | `Off`            | Shows the surface switches below. The **toggle debug UI** command flips it without touching recording.                                                  |
| **Advanced** | **Inspect buttons**              | `On`             | The bug button on rows and banners that opens the model traces behind a decision.                                                                       |
| **Advanced** | **Debug thread buttons**         | `On`             | The beaker button beside an AI-generated result: it starts a thread carrying that result and the model calls behind it.                                 |
| **Advanced** | **Show model traces**            | `On`             | Model traces listed in Activity, with kind and failure filters, reported cost, and **Delete model traces…**.                                            |
| **Advanced** | **Composer routing diagnostics** | `On`             | The **Debug** disclosure under the new-thread composer: confidence, inputs, and the server's notes on each routing step.                                |
| **Advanced** | **Reply diagnostics**            | `On`             | **Raw agent output** and reply syntax diagnosis on assistant replies.                                                                                   |
| **Advanced** | **Thread Info and context card** | `On`             | The **Workstreams debug** section listing the metadata Workstreams accumulated for a thread.                                                            |
| **Advanced** | **Debug threads project**        | `Worker project` | Where those debug threads start, so their agent can read the prompts and code behind the result.                                                        |

### Gateway vs. provider worker models

- **AI Gateway models** (the built-in defaults and `pi` models prefixed
  `vercel-ai-gateway/`) run directly on the connected analysis host via
  `~/.pi/agent/auth.json` or `AI_GATEWAY_API_KEY` (`90 s` timeout,
  schema-constrained JSON, no silent model fallback).
- **Other BB provider models** run inside a temporary hidden
  `"Workstreams worker"` BB thread in the **Worker project** (`120 s` timeout,
  automatically stopped and archived after completion), which takes several
  seconds longer per call. The released SDK does not expose schema-constrained
  generation or output-token limits for spawned threads. Responses still pass
  the same parser, validation, and bounded repair rules, but generation itself
  is unconstrained. Worker token usage, cost, and reasoning metadata are
  unavailable (`null` in traces), not evidence that the call was free.

---

## CLI reference

Run `bb workstreams --help` or any subcommand below. Every command except
`migration backup`, which always prints JSON, accepts `--json` for
machine-readable output.

### Workstreams, organization, analysis, and activity

```sh
# List the sidebar's workstreams, Other, and Dormant with thread counts and how many threads need you
bb workstreams list [--json]

# Show the threads in one workstream (by name or section ID, or "other" for threads in no workstream), child threads under their parents
bb workstreams show <workstream> [--json]

# Show how threads are listed in workstreams and agent-report coverage, or run an organizer pass now
bb workstreams organize [--rebuild] [--json]

# Analyze one thread now as its turn's end would, or queue every thread whose latest turn isn't analyzed yet
bb workstreams analyze [<thread-id>] [--json]

# Read the activity log (retained for 90 days / 2,000 entries; default --since unit is hours)
bb workstreams log [--limit 1..500] [--since <duration, e.g. 90m or 7d>] [--outside] [--json]

# Undo a logged activity entry when current BB state still matches
bb workstreams undo <entry-id> [--json]

# List organizing suggestions waiting for you (--all adds recent decisions), or suggest changes now
bb workstreams suggestions [--all] [--json]
bb workstreams suggestions run [--json]

# Accept or decline suggestions by id, or all waiting ones
bb workstreams suggestions accept <id...|all> [--json]
bb workstreams suggestions decline <id...|all> [--json]

# Show recorded model traces (kinds: start, turn-end, workstream-choice, categories, category-fit, split, tidy)
bb workstreams trace [<trace-id>] [--thread <id>] [--entry <id>] [--kind <kind>] [--limit 1..500] [--json]

# Compose an enhanced response for a thread's latest finished response, or validate and store a given document (Enhanced responses must be on)
bb workstreams present <thread-id> [--turn <turn-id>] [--document <json>] [--json]
# --document needs the BB server started with WORKSTREAMS_PRESENT_DOCUMENTS=1, for testing the drawn view

# Inspect an assistant reply's raw output and diagnose :::reply / component syntax issues
bb workstreams reply <thread-id|@thread:id[#msg=seq]|url> [--message <seq>] [--json]
```

`show` returns at most 200 rows and reports truncation; JSON includes `count`,
`shown`, and `hasMore`. `log` defaults to 50 entries (maximum 500), applies
`--since` to the matching query window, and reports whether more matching
entries remain. Its JSON adds `count`, `limit`, and `hasMore`. `trace` defaults
to 20 records (maximum 500). These are bounded inspection commands, not full
history exports. Text output prints status labels such as **Needs input**;
`--json` prints their ids, such as `needs-input`.

### Workstreams, groups, previews, and migration

```sh
# List every workstream and group by full path (bb › Workstreams Plugin), including ones with no open threads
bb workstreams tree [--json]

# Show a workstream's or group's ID, path, description, group, aliases, and thread count
bb workstreams describe <workstream-or-group> [--json]

# Create, rename or edit, move, or merge workstreams and groups (each runs the organizer)
bb workstreams create <name> [--description <text>] [--group <group-name-or-id>] [--aliases <a,b,c>] [--json]
bb workstreams edit <workstream-or-group> [--name <name>] [--description <text>] [--aliases <a,b,c>] [--json]
bb workstreams move <workstream> [--to <group-name-or-id|top>] [--json]
bb workstreams merge <source> <target> [--json]

# Preview where Workstreams would move threads now (up to 100 threads; previews expire after 30m), then apply it
bb workstreams preview [<thread-id>] [--json]
bb workstreams apply <preview-id> [--json]

# Preview folding deeper workstreams into two levels; blocked threads need explicit destinations
bb workstreams migration preview [--mapping '<JSON choices, newWorkstreams, resetThreadIds>'] [--json]
bb workstreams migration apply <preview-id> [--json]
bb workstreams migration backup <backup-id>
```

`move --to top` takes a workstream out of its group. `describe --json` adds
`path`, `listedInWorkstreamId`, and the thread IDs in the workstream.

A migration preview proposes folding deeper workstreams into their existing
second-level ancestor. It leaves threads in a first-level workstream blocked
when that workstream has become a group: supply a meaningful destination for
each, rather than creating a catch-all. `--mapping` accepts an object with
`choices` (`threadId`, `workstreamId`) and `newWorkstreams` (`key`, `name`,
`description`, `parentId`, optional `aliases`). A choice can refer to a new
workstream's `key`. Explicit `resetThreadIds` remove automatic workstream
choices instead of inventing destinations for obsolete work. Reset and move
choices cannot overlap, and a thread you moved yourself cannot be reset.
Resetting a choice does not delete threads or transcripts; a reopened thread may
stay under Other until Workstreams or you move it again.

A preview changes no workstreams or threads. Apply requires the reviewed preview
ID, refuses changed workstream definitions or thread workstreams, and keeps each
moved thread's source and evidence. It saves the original definitions, thread
workstreams, section bindings, and layout in a backup. Removed workstream paths
become aliases of their destination. Explicit project associations require
separate review; narrower learned associations are not copied onto a broader
workstream. A backup is exportable data, not an Undo that reinstates an invalid
set of workstreams.

### A thread's workstream

```sh
# Inspect a thread's workstream, where it came from, and where the sidebar lists it, including a parent it follows
bb workstreams thread show <thread-id> [--json]

# Move a thread to a workstream yourself, or to No workstream with "none" (manual source; automatic changes leave it there)
bb workstreams thread move <thread-id> <workstream-name-or-id|none> [--json]

# Let Workstreams choose the thread's workstream from its requests again, now and from then on
bb workstreams thread automatic <thread-id> [--json]
```

---

## Recording and the debug UI

Recording and the debug UI are separate settings under **Settings → Workstreams
→ Advanced**:

- **Record model traces**, on by default, controls what gets recorded. Model
  traces accumulate whether or not the debug UI is showing, so hiding the UI for
  a screen share keeps the record for later.
- **Debug UI**, off by default, controls what the UI shows, with one switch per
  surface beneath it while it is on. The **Workstreams: toggle debug UI**
  command and its keyboard shortcut flip **Debug UI** without touching
  recording, and the surface switches keep their own choices across those
  toggles.

What gets recorded:

- **Model traces and redaction:** Every model call (new thread, turn end,
  workstream choice, category check and arrangement, split suggestion, and
  suggested changes) records its redacted input, prompt, raw response, reasoning
  summary, parsed output, token usage, cost, duration, and applied outcome.
  Common secret patterns (`sk-…`, `ghp_…`, `github_pat_…`, `xoxb-…`, `Bearer …`,
  and `api_key`/`token`/`password`/`secret` assignments) are masked before
  prompts reach a model or trace store. Redaction is best effort, not a security
  boundary; do not put secrets in requests or assume diagnostics are safe to
  share without inspection. Conversation excerpts go to your selected model
  provider under that provider's policies. Model traces are retained for `7`
  days or `1,000` records and pruned automatically, and they keep arriving
  whether or not the debug UI is showing.

What the UI shows:

- **Thread Inspector:** Click the bug (`Inspect`) button on an Activity row or
  model trace to open the side-pane inspector. Inspect every recorded call for a
  thread, copy the full trace with **Copy JSON**, or click **Replay** to replay
  the stored prompt against the current model and compare canonical results
  (`Same result` vs. `Differs in <fields>`) without mutating thread state.
  Replays use the recorded output schema when available; a trace without one
  replays without a schema. The current parser interprets the reply, so a
  comparison can also differ when the output contract has changed.
- **Thread Info and context card:** Each thread's Info tab and context card gain
  a **Workstreams debug** section listing the metadata Workstreams accumulated
  for the thread: the settled goal, the context digest, its workstream and where
  that came from, the settled title, and the latest analysis run's status,
  model, and age. The activity list below the metadata combines related Activity
  events with the thread's new-thread, turn-end, and workstream-choice calls.
  Turn end rows label their historical assessment as **Work status** so it is
  distinct from the call's completion. Hovering or focusing a row reveals a
  chevron. Click an event to open every recorded model call behind it, including
  the exact prompt, reasoning, raw response, and parsed result.
- **Show model traces:** Check **Show model traces** in **Activity**, or choose
  the **Model traces** action, to list recorded calls among the entries. Filter
  them by kind (**New thread** `start`, **Turn end** `turn-end`, **Workstream
  choice** `workstream-choice`, **Category check** `category-fit`,
  **Categories** `categories`, **Split suggestion** `split`, or **Suggested
  changes** `tidy`) and **Failures only**, view total reported cost for the
  filtered calls, or click **Delete model traces…** to delete recorded model
  traces while keeping the Activity log intact.
- **Debug in a new thread:** Every AI-generated result carries a small beaker
  button: an organizing suggestion in the sidebar or Organize, the composer's
  routing preview, a thread's workstream and analysis, a project association, an
  Activity event, or a recorded model call. It starts a visible thread in the
  **debug threads project** whose first message is the result, what accepting it
  would change, and the exact prompt, response, parsed output, and applied
  outcome of every model call behind it, then opens it. A wrong or puzzling
  suggestion becomes a conversation with the context to name the prompt or code
  change, and `bb workstreams trace <id>` reprints any call it names. The thread
  starts a turn at once, so it spends tokens like any other thread.
- **Composer routing diagnostics:** Expand the **Debug** disclosure in the
  new-thread composer to inspect the live preview's confidence, inputs, token
  usage, reasoning, and copyable JSON diagnostics.
- **Reply raw output & syntax diagnostics:** Expand **Raw agent output** on any
  assistant reply (including unclosed `:::reply` blocks and responses where
  `:::reply` failed to parse) to view line-numbered syntax and component
  diagnostics alongside the raw agent output before parsing, or run
  `bb workstreams reply <target>` from the CLI. A message that simply has no
  `:::reply` block shows its raw output without a syntax diagnosis: the CLI
  reports its status as `missing`, and the debug UI reports no issue.

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
picker-only updates stay in the full model for submission and diagnostics;
workstream controls subscribe to the fields they draw. Identity reports remain
prompt for Enter: equal payloads and intermediate updates before the next
microtask are coalesced, without a typing debounce or waiting for an earlier
RPC. Clearing or disposing a draft flushes its pending nonempty report before it
can be discarded.

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

### Browser performance harness

`npm run perf` measures what a piece of the UI costs the browser. It builds a
fixture page from `gallery/perf.html`, opens it in headless Chrome, runs each
scenario ten times after a discarded warm-up, and prints each metric's median,
minimum, and maximum. A full run takes about two minutes and writes every sample
to `.perf/report.json`. The command draws fixtures and does not read the running
BB app. The page runs React's profiling build so the Profiler can report
commits, which raises absolute timings: read them as an upper bound and compare
arms or before-and-after runs. Set `CHROME_PATH` if Chrome is not installed in a
standard location.

| Scenario  | What it does                                                |
| --------- | ----------------------------------------------------------- |
| `render`  | Loads the page and draws it for the first time              |
| `hover`   | Crosses up to 16 hover targets, then opens a tooltip        |
| `fold`    | Collapses and expands the first two folds, 350 ms apart     |
| `idle`    | Leaves the page untouched for two seconds                   |
| `updates` | Re-renders the page from its root 20 times, one frame apart |

| Page       | What it draws                                                                            |
| ---------- | ---------------------------------------------------------------------------------------- |
| `sidebar`  | The production thread list: 64 threads in eight workstreams, with Up Next and Recent     |
| `question` | The production question card with eight options. It has no folds, so `fold` does not run |

With no arguments the command runs every scenario on `sidebar`. Name scenarios
to run only those, and pass `--page`, `--size`, or `--samples` to change the
page, its item count, or the sample count. Each scenario reports main-thread
task, script, style, and layout time; the number of style recalculations,
layouts, and paints; React commits and render time; and the machine's load
average. `npm run perf -- --help` describes every option with examples, and
`npm run perf -- list` prints the scenarios, pages, switches, and metrics.

To learn what one suspect costs, switch it off with `--without`. The command
then alternates two arms in one session, the page as it is and the page with the
suspect off, and prints the change between their medians. This run measures what
the spinners cost while the sidebar is at rest:

```sh
npm run perf -- idle --without spinners
```

```text
idle on sidebar, 10 samples: Two seconds untouched: what animations cost at rest
  metric                         current          min to max    without spinners          min to max              change
  task ms                            9.0         8.0 to 10.2                 3.2          2.9 to 3.4                -5.8        ranges apart
  style ms                           2.1          1.9 to 2.5                 0.1          0.1 to 0.2                -2.0        ranges apart
  style recalcs                       11            10 to 13                   2              2 to 3                  -9        ranges apart
  layouts                              0              0 to 0                   0              0 to 0                   0
  load average                     30.37         20.53 to 50               33.16         20.53 to 50               +2.79      ranges overlap
```

In that run the spinners accounted for about 6 ms of main-thread time and 9
style recalculations in each two idle seconds, and neither arm ran a layout.
"ranges apart" means the two arms' minimum-to-maximum ranges do not intersect.
"ranges overlap" means they do, so the change may be chance.

`--without` takes a switch (`animations`, `spinners`, `shimmer`, or `nothing`,
which runs the same arm twice to show how far equal runs differ) or CSS of your
own, as in `--without '.ws-row-actions { transition: none }'`. To measure a code
change, save a report with `--output` before the change and pass that file to
`--baseline` after it.

To add a scenario, page, switch, or metric, add an entry to its table at the top
of `scripts/perf.mjs`. A new page also needs a fixture in `gallery/perf/`.

### Queue motion lab

The [queue motion lab](prototypes/queue-motion/README.md) tests the queue's
motion outside the Workstreams page. When its BB file link opens in an external
browser on the BB machine, Workstreams launches the built lab on an isolated
loopback origin so named presets can use browser storage. The BB file preview
cannot save presets; copy its settings before using **Open in external browser**
and paste the copied hash into the browser address to restore them.

### Gallery view

With the debug UI on, the Workstreams page's **⋯** menu lists **Gallery** (deep
link `/plugins/workstreams/home/gallery`). It is a specimen sheet for reply
blocks: a short transcript whose replies together use every part a block
accepts, plus the two states an agent cannot write on purpose. Each block is
parsed and drawn by the same code that draws one in a thread.

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
and layout treatments are simulated. Workstream and status colors use the
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
default **Automatic** color; it is not a live BB theme.

The Primitives group documents the small pieces the plugin's components share,
one page each with its variants side by side: status dot, count pill, key chip,
section heading, and menu classes. They live in `src/app/primitives/`, and the
sidebar, Home screen, queue, Organize, and settings use them directly.

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

Gallery browser scenarios run in separate specimen, sidebar playground, and
built-from-disk files. Each development server uses a separate dependency cache.
Specimen and playground files run up to five scenarios concurrently, each in a
fresh browser context. Each file starts a browser server and kills it during
teardown.

Vitest caches transformed modules between runs with
`experimental.fsModuleCache`. Heading settlement and preview-loop tests advance
fake time past their observation intervals. Compositing tests finish finite
entrance animations before tracing the running loop; Braille tracing covers a
full 800 ms cycle.

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
Add `--workers 12` to compare a different worker count without changing the
Vitest configuration. Benchmark samples include load averages before and after
each run; compare timings under similar machine load. To check order
independence, run `npm test -- --sequence.shuffle --sequence.seed=104729`.

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
