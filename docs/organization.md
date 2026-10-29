# Organization

Workstreams derives BB sections from root threads' topics. The topic assignment
is authoritative: moving a root in BB's sidebar is logged and reverted;
assigning another topic changes its workstream. Delegates follow their root.

## Organizer pass

The organizer is deterministic and makes no model calls. After relevant fact or
lifecycle changes it:

1. Reads visible, non-archived roots, stored topic assignments, and statuses.
2. Lays out the groups from the topic tree, visible-root counts, and the
   previous layout (`src/domain/layout.ts`): which topics list threads, which
   only head subgroups, and the names dimmed before each header.
3. Creates, renames, or removes a topic-bound section for each group that lists
   threads, and files roots to match.
4. Logs outside section changes, then restores topic-derived membership.
5. Prunes discovered topics that have no assigned roots, workstream, or child
   topics.

A pass fingerprints its facts and the previous layout, validates its topic plan
before mutations, and uses the service's serial queue so reconciliation and
section mutations cannot interleave. Superseded plans schedule a fresh pass.
Every visible, non-archived root counts, including completed roots, so
completion alone never regroups. The pass stores the layout it applied, which
the sidebar and phone Home draw.

## Layout

A topic holds threads or subtopics, never both: once a topic has subtopics,
every thread in it is in one of them. The layout then decides how much of the
tree to show:

- **Subgroups by volume.** A group shows its subtopics as subgroups once it
  covers more than 5 visible roots, and one list again at 3 or fewer. Between
  those it keeps its previous shape, so it doesn't flip back and forth.
- **Contexts.** A top-level topic with subtopics and no threads of its own (an
  employer, a personal toolbox) never gets a header; its name is dimmed before
  its children's ("[Vercel] Inside Vercel").
- **Families.** A topic with no threads of its own and two or three subtopics
  with threads collapses the same way ("[Vercel Agent] Automations", "[Vercel
  Agent] Code Review"). A topic whose subtopics a split created is partitioned
  and always keeps its header.
- **Only children.** A topic with no threads of its own and one subtopic with
  threads shows that subtopic under its own name, the parent dimmed first.
- **Prefix words.** A dimmed name that the next name starts with is dropped, so
  "Vercel" and "Vercel Agent" read "Vercel Agent".
- **Promotion.** A group showing subgroups that covers 40% or more of its
  parent's visible roots moves to the top level with its ancestors dimmed ("[BB
  Plugins] Workstreams"), and its roots leave the parent's count. It moves back
  below 30%, or when it shows one list again. Only a parent that shows its own
  header promotes.
- **Depth.** At most three header levels show; a group that would show subgroups
  at the third level moves to the top whatever its share.

A topic from before the partition rule that holds threads beside subtopics lists
its own threads and still shows its subgroups, so no thread disappears; a split
suggestion repairs it.

BB sections are flat; each group that lists threads is one section, named by its
topic path, and headers above them have no section. At most three empty
workstreams remain visible, newest first for eligibility, and only while each
had an unsnoozed visible thread within the last ten minutes. Focus and nesting
do not exempt a workstream. Empty rows expire without thread events; stored
population timestamps survive reloads and are never renewed by empty reads.
Cleanup retains the matching topic-bound sections during this grace period, so
their New work action still starts in the right topic. Focus, Dormant, and
manual order apply to the top-level group: focus names every section in it, and
dragging its header moves its sections together. Persistent collapse preferences
use stable topic IDs and synchronize mounted surfaces and windows independently
of automatic grouping. In the tiered sidebar (any workstream focused), revealing
and expanding the other workstreams is temporary per-view state; hiding and
revealing that block starts it collapsed. Each pass that changes sections or
membership is recorded as one Activity entry. Topic edits and assignments are
recorded too. Undo is available where it can preserve the topic-only rule; the
organizer restores derived membership when a later pass runs.

## Starting topics and placement

A root spawned from another thread inherits that thread's topic. A root started
from a workstream's ＋ inherits the bound topic. A topic with subtopics can't be
inherited; placement weighs it as a hint instead. Otherwise Quick analysis of
the first request supplies a guess or leaves the root Unfiled. Explicit composer
choices have manual priority.

Placement settles the topic with one closed-set call on the first request, and
again beside Full analysis after a new substantive request. It reads the
generated title, the first, second, and latest substantive requests, the
project, and the checkout. Hints are the topic of the thread it continues, the
start topic it couldn't inherit, and the topic most threads in its checkout
have, unless the checkout coordinates work in other repositories (at least two
of its threads name a GitHub repository or `~/Code` path outside it). Only
topics without subtopics can be chosen. When none fits, placement may propose
one new topic named for a lasting area; a proposed subtopic of a topic that
holds threads files the thread in that topic, since subgroups come only from
splits. Placement may replace an inherited topic only when it reports a scope
shift or settles a topic beneath it. Explicit user approval of a repair plan or
a suggestion can also correct an inherited assignment; that correction has Full
provenance and remains eligible for future automatic updates.

## Organizing suggestions

Suggestions change nothing until you accept them, on Organization or with
`bb workstreams suggestions`; a sidebar notice counts the ones waiting. Review
names each one by what moves and where, and lists those that move threads
(biggest first) apart from those that only tidy groups and those out of date
(`src/domain/suggestion-change.ts`).

- **Split.** A topic without subtopics that passes 5 visible roots gets one call
  that partitions all of its roots into 2–5 subgroups: plain areas a person
  would name without effort, with work about the whole group in a plainly named
  subgroup such as "Planning", never a catch-all. A topic that holds threads
  beside subtopics gets the same call to file each of its threads in a subgroup.
  At most once a day per topic.
- **Tidy.** At most 8 edits (merge, move under, rename, create a parent for
  related topics, refile a thread), each with a reason. A pass runs at most once
  a day, after 3 new topics or 5 new roots since the last pass, or when Unfiled
  roots plus one-thread groups reach 4 and that set changed; never while earlier
  tidy edits wait for review. Asking for suggestions runs splits and a pass now.
- **Memory.** Tidy sees the topics you filed threads under, the suggestions you
  accepted, and the ones you declined. An edit identical to a declined one is
  never proposed again.
- **Guards.** An edit that would put threads beside subtopics is dropped when
  proposed and refused when accepted. A split tolerates small changes since it
  was made (`splitNow` in `src/domain/tidy.ts`): threads that moved or closed
  are left out, and threads that joined are filed by one split call on accept.
  It stops only when its group is gone, none of its threads remain, more threads
  joined than remain, or it would leave one subgroup. A suggestion that stopped
  fitting says why.
- **Undo.** Each accepted suggestion is one Activity entry whose undo restores
  the topic tree and assignments as they were, while nothing has changed since.

## Topic tree

Topics provide a workstream's name, description, and aliases. Edit them in
Topics or with `bb workstreams topics`; merges remain manual. Discovered topics
are pruned only when unused and childless. Database names remain stable for
migration compatibility.

## Reviewing topic repairs

A preview accepts up to 100 roots. With larger sets, use
`bb workstreams topics preview <thread-id>` followed by
`bb workstreams topics apply <plan-id>` for each root you want to repair.

Use Organization → Preview topic repairs, or
`bb workstreams topics preview [thread] --json`, after changing topic
definitions. Preview uses production evidence and parsing but changes no
assignments, titles, or status. Review the before/after paths, then apply with
the button or `bb workstreams topics apply <plan-id>`. Manual topics are
excluded. Plans expire after 30 minutes and reject topic-definition changes;
apply skips newer thread evidence or corrections and consumes each reviewed row
once. Temporary SDK read failures retain unprocessed rows for retry with the
same plan ID. A completed apply consumes the plan. A new preview replaces the
previous preview.

## Observability

The Organization page reports organizer state, active and completed counts,
visible-root counts, the grouping rule, and agent-report coverage.
`bb workstreams organization` reads current state;
`bb workstreams organization --rebuild` runs a fresh pass. `bb workstreams log`
shows Activity, including a sidebar move and its automatic reversion.

The composer preview is Quick analysis, not an organization preview.
