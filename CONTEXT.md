# Workstreams

Workstreams keeps open BB threads' topics, goals, statuses, and activity
current, and groups roots into native BB sections derived from their topics.

## Language

**Thread**: A BB thread; the UI's unit of work. _Avoid_: task, conversation

**Root**: A visible, non-archived thread with no visible active parent; the unit
Workstreams organizes. Delegates use its topic and workstream. _Avoid_: task
thread, top-level task

**Delegate**: A child thread created for separable work. _Avoid_: subtask, child
task

**Topic**: One topic-tree entry representing a context, product, or capability,
with a description and aliases. A topic holds threads or subtopics, never both.
_Avoid_: entity, subject, identity, Catalog entry, product or feature

**Context**: A top-level topic with subtopics and no threads of its own, such as
an employer or a personal toolbox. It never gets a header; its name is dimmed
before its children's. _Avoid_: hat, area

**Family**: A topic with no threads of its own and two or three subtopics with
threads, which collapses into a dimmed name like a context. _Avoid_: product
group

**Topic tree**: Every topic Workstreams knows, whether or not a thread uses it.
_Avoid_: Catalog, corpus

**Topic assignment**: A root's topic or no topic, with its source and
automatic-classification basis. _Avoid_: task identity, canonical assignment,
subject

**No topic**: A root whose assignment names no topic. _Avoid_: unresolved,
unclassified

**Workstream**: A BB section bound to one topic. Workstreams nest by the
organizer's layout in the sidebar and Home. _Avoid_: group, home, navigation
group

**Subgroup**: A workstream drawn inside a busier group's header. A group shows
its subtopics as subgroups above 5 visible roots and one list again at 3 or
fewer. _Avoid_: child workstream, nested section

**Split**: Partitioning a busy topic's threads into new subtopics, which makes
it partitioned: it always keeps its header. _Avoid_: breakout, partition (for
the action)

**Promotion**: Drawing a dominant group at the top level, its ancestors dimmed
before its name. _Avoid_: hoisting

**Unfiled**: Roots without a topic and therefore without a workstream. _Avoid_:
unsorted

**Focus**: The workstreams the user chose to work on now. They lead the sidebar
with the rest behind a toggle, and while one has a thread blocked on the user,
Up Next lists only focused workstreams' threads. Stored as `prioritized`.
_Avoid_: prioritize, priority, lower priority

**Up Next**: The short, ranked list of roots most worth the user's attention,
shared by the sidebar, phone Home, and the next-Up-Next command (see
`src/domain/upNext.ts`). A running root joins it only while it has a question
card or approval pending. _Avoid_: For You, needs you (for the list)

**Blocked on you**: A thread with a question for the user (a pending question
card or approval, or a needs-you status) or a turn ready for review. A review or
needs-you status from a turn that ended more than 7 days ago has aged out and no
longer counts; a pending question card or approval never ages out. Distinct from
the **blocked** status, which means blocked on something else.

**Organizer**: The deterministic process that syncs topic-derived workstreams
and membership. _Avoid_: coordinator, regroup

**Organization**: The page tab showing organizer state. _Avoid_: Organize tab

**Goal**: What a thread is for; written as its title. _Avoid_: inferred title

**Quick analysis**: Fast analysis of a draft or first request, returning a goal
and topic.

**Full analysis**: Turn-end analysis that settles a goal, and fills recap/status
only when the agent did not report.

**Placement**: The closed-set call that settles a root's topic from its
requests, on the first request and after each new one. _Avoid_: classification
(for the call), routing

**Suggestion**: A split or tidy edit to the topic tree that applies only when
accepted. _Avoid_: proposal, recommendation

**Status**: How the latest turn ended: needs you, review, blocked, working,
done, or error. _Avoid_: work state, completed

**Agent recap**: An agent's report for its latest turn. Its `goal` field remains
the contract used by running sessions.

**Wake event**: Something that happens to a snoozed thread, its delegates, or
its pull request that ends a snooze set to wake on events: a turn ending needing
you, ready for review, done, or failed; a failed send; stuck work; or pull
request feedback. "Until it needs me" waits only for one. _Avoid_: update,
activity (for the trigger)

**Activity**: The log of changes Workstreams made or observed, with undo where
supported. _Avoid_: journal (in the UI)

**Launch settings**: Project and environment choices for a new thread. _Avoid_:
placement
