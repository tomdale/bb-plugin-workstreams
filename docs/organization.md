# Organization

Workstreams separates lasting **workstreams** and **groups**, the native BB
sections that list them in the sidebar, and automatic **categories**. A thread's
workstream is authoritative. Workstreams logs and reverts native sidebar moves;
changing a thread's workstream changes where the sidebar lists it. Child threads
go wherever their parent goes.

## Workstreams and groups

A workstream holds threads and a group holds workstreams. Groups don't nest, so
a path has at most two levels: `Vertex`, `Vercel Agent › Code Review`,
`bb › Workstreams Plugin`, or `Toolbelt › Skills`. The two levels can represent
a product and feature or a category and product. A workstream that holds
threads, including archived ones, becomes a group only through a reviewed split
that says where each of its threads goes.

The organizer makes no model calls itself. After relevant facts change, it:

1. Reconciles visible, non-archived threads and their workstreams.
2. Lists each workstream that holds threads. A group appears as the dimmed
   prefix of its workstreams' headers, left out when the workstream's name
   already starts with it.
3. Creates, renames, or removes the native sections Workstreams owns, and moves
   threads into them to match. Every workstream with threads keeps its section
   regardless of how many it holds.
4. Logs outside membership changes and restores each thread to its workstream's
   section.
5. Removes discovered workstreams and groups that have no threads, section, or
   workstreams.
6. Notifies the category coordinator and checks whether organizing suggestions
   or project learning are due.

The organizer fingerprints each pass. Workstreams, groups, thread workstreams,
and analysis can change only while a pass awaits BB, so after each awaited call
the pass checks them again before its next mutation. Section writes run in one
serial queue with reconciliation; a superseded pass schedules a fresh one. A
path deeper than two levels, or a group that holds threads, stops the pass
before any section changes, keeping the applied layout until a reviewed repair
is available. Completed threads stay in their workstream and count in the
organizer's thread counts.

BB sections are flat. The sidebar and phone Home use the applied layout, native
section rows, and category state to draw the same organization. Workstream
collapse preferences use workstream IDs, so they hold across windows and when a
section is recreated. Focus, manual order, Dormant, and Up Next keep workstream
identity; categories create no additional section or workstream hue.

A workstream stays on the list only while it holds a visible, non-archived,
unsnoozed thread. An emptied one leaves at once, inside a group or not, and
cleanup deletes its section on the next pass; the workstream and its threads
remain, so a later thread in that workstream brings it back. While any
workstream is focused, revealing the other workstreams is temporary per-view
state; hiding and revealing that block starts it collapsed.

## Categories

Any workstream can have categories, whether or not it is in a group. The
eligible collection is the visible, non-archived, unsnoozed threads in that
workstream, including completed ones. Child threads go with their parent and are
not counted separately. Header collapse, focus, scrolling, and which view is
open do not change eligibility. Counts from different workstreams in one group
are never combined.

| Existing category state | Eligible threads | Action                                                |
| ----------------------- | ---------------- | ----------------------------------------------------- |
| None                    | 0–5              | Show one thread list                                  |
| None                    | 6 or more        | Arrange the whole collection                          |
| Active                  | 4 or more        | Keep the arrangement; check arrivals and work changes |
| Active                  | 0–3              | Discard the arrangement without a model call          |

A departing thread leaves its category with no model call. When a thread arrives
or its work changes after a substantive request, a fit check first asks whether
each such thread fits an existing category as it stands; the check sees the
current categories, their other members' titles, and the changed threads'
requests. When every changed thread fits, it joins that category and nothing
else moves. When one fits none, the check fails, or most categories hold one
thread, the classifier receives the whole current collection and its current
categories. An arrangement that records no per-thread work (`arranged`) goes to
the classifier on its next change. The coordinator assesses a substantive
request when it is sent, before the turn-end call finishes. The stored record
keeps request-version hashes for stale-result checks; the coordinator holds
incoming request text in memory until analysis catches up. Each assessment
fetches the first, second, and latest substantive requests, excerpted, leaving
out verified child-thread deliveries. It can rename and regroup every category,
but should keep the arrangement unless a change makes the collection
meaningfully easier to scan. Cosmetic differences and marginal tidiness are not
reasons to regroup. Threads missing from the current categories join the
existing category whose theme they share. There is no throttle, periodic
assessment, or recommendation queue.

The classifier chooses useful distinctions among these threads, with plain names
and coherent membership. A category groups threads that share one theme; a
category of one is for work sharing a theme with no other thread, and an
arrangement that is mostly categories of one is regrouped. A name states its
members' shared theme and joins scopes with "&"; names that no longer cover
their members are renamed. It does not force equal sizes or a General/Other
catch-all. A new arrangement needs at least two categories; an active one can
shrink as its collection changes. Every eligible thread must appear exactly
once. Unknown IDs, omissions, duplicate memberships, empty categories, and
duplicate names make a replacement invalid. The classifier uses the **Arrange
categories** model; the fit check uses the **Name and organize new threads**
model.

Workstreams stores category state in plugin database metadata, separately from
thread workstreams: the arrangement's ID, category IDs and names, member thread
IDs, and the collection evidence last assessed, including in-flight
request-version hashes. Settled state survives restarts without a new call;
interrupted assessments resume. Falling to three threads discards the
categories. Reaching six again starts fresh, without bringing back the old names
or memberships.

The coordinator prunes departures immediately, even during a model call.
Arrivals stay visible directly in their workstream until they are placed in a
category. Invalid or superseded responses cannot replace a valid arrangement.
The coordinator doesn't retry a failed assessment for unrelated updates or
restarts; a changed collection or work key, or
`bb workstreams organize --rebuild`, retries it. Title-only and status-only
changes do not alter that key. Activity records each change to a workstream's
categories as **Categories updated**.

## Choosing a thread's workstream

A thread started from another thread inherits its workstream. A thread started
from a workstream's ＋ inherits that workstream. A group supplies a hint for
choosing among its workstreams rather than an inherited workstream. The
composer's preview, asked of a fast model as you type, supplies its workstream
with `composer` provenance until the thread's start call settles it with
`automatic` provenance. Choosing a workstream in the composer yourself is
manual.

A thread's workstream is a closed-set choice made in two calls that also do
other work: a thread's start (`src/domain/start.ts`), which titles it from its
first request, and a turn's end after a new substantive request
(`src/domain/turnEnd.ts`), which also settles title, goal, digest, and fallback
status. Both read the same evidence and rules
(`src/domain/workstreamChoice.ts`): the requests, project, checkout, and
continuation and start hints, and at a turn's end the title and the context
digest that call settled last time. The digest is two or three sentences naming
what the work is, what it has established, and its owner, revised in place as
turns settle. A separate workstream-choice call serves only a move into a group,
previews and repairs, and a thread that only lacks a workstream. A checkout's
usual workstream is a hint unless at least two of its threads point at other
repositories. Title edits, model changes, workstream description changes, and
control-only requests do not move a thread.

Only workstreams within the two-level limit can be chosen, never a group. A new
top-level proposal uses the owner's recognizable product name. Inside a known
top-level workstream or group, the call may propose a supported lasting
workstream. A proposed workstream inside a top-level workstream that already
holds threads records a split request and leaves the threads where they are,
rather than adding a workstream beside them.

Sources follow `manual > inherited > automatic > composer`. Manual choices
survive automatic analysis. An automatic choice can replace an inherited one
only for a scope shift or a supported narrower workstream inside it. Accepted
repairs and suggestions have `automatic` provenance unless they preserve a
manual choice. Invalid model output never moves a thread or clears a valid
workstream.

## Reviewed changes to workstreams and groups

Splits depend on lasting scope, not thread count or recurring category names. A
useful split has:

- Supported products, capabilities, or maintained areas rather than tasks or
  stages.
- Descriptions that place a future thread without reference to its neighbors.
- Useful specificity within a broad workstream; a single-purpose tool already
  covers its fixes, refactors, and reviews.
- A complete, supported answer for where each thread goes, with meaningful names
  rather than catch-alls.

A split request asks for that answer. **Suggest now** (or
`bb workstreams suggestions run`) also considers splitting any top-level
workstream with threads. Evidence includes the requests, titles, and checkouts
of every thread in the workstream, including archived ones. The model can
decline to split. Acceptance rechecks the current collection, leaves out threads
that moved to another workstream, and asks where threads that arrived since go
before applying. A workstream inside a group cannot be split. Changes to
workstreams and groups wait for acceptance; categories update independently even
when **Suggest changes** is off.

Tidy proposes at most eight edits: merge a workstream into another, move a
workstream into or out of a group, rename, group workstreams, or move a thread.
Automatic checks debounce changes for two seconds. A change to the workstreams
and groups or to which visible threads are in them starts a pass, unless an
applicable tidy edit awaits review. Titles and statuses alone do not trigger a
pass. Once pending edits are decided, a changed tree or thread move starts a
pass. **Suggest now** runs a pass explicitly and replaces pending tidy edits.
Tidy sees at most twelve current threads per workstream and twelve threads in No
workstream, plus accepted and declined decisions. Tidy favors concise,
meaningful names in context without losing recognizable identities or
distinctions between workstreams. A top-level workstream whose name starts with
a group's name also gets a deterministic suggestion to move it into that group.

Each waiting suggestion reaches the app with its `change` (what moves, as the
sentence and the CLI state it) and a `delta`: the workstreams the change
creates, renames, moves, or removes and the thread moves it makes, by ID, plus
the threads in the sidebar's population that are in the workstreams it touches
(`held`, with titles), the workstreams it touches (`touched`), and how many
archived threads it moves (`archived`). The app reads the workstreams of the
threads its sidebar lists, so `held` is how it learns of the snoozed ones a
change acts on, which it draws as dashed ticks. Archived threads are only
counted, since a workstream can hold thousands. The sidebar's review applies the
delta to the workstreams and thread moves it holds and lays out both states with
the sidebar's own code (`layoutGroups`, `arrangeGroups`, the user's sort), so
the server never sends a finished sidebar. A test accepts every kind of change
and compares the resulting workstreams and thread moves with the delta applied
to the state before it. A change that needs a workstream another suggestion
creates, or that moves threads that joined its split since, has no delta; the
review says it can't be drawn and still offers the decision.

Every proposed and accepted edit passes the two-level and threads-or-workstreams
guards. Activity records each accepted suggestion as **Suggestion accepted**,
with a guarded snapshot for Undo. Undo requires the workstreams and thread
workstreams to still match and cannot bring back a path deeper than two levels.
Discovered workstreams and groups are removed only when they have no threads and
no workstreams; workstreams you created stay.

## Two-level migration

`bb workstreams migration preview --json` prepares a preview without changing
any workstreams or threads. Deeper workstreams fold into their second-level
ancestor. Threads in a top-level workstream that has become a group are blockers
until explicit meaningful destinations are supplied. `--mapping` accepts
`choices`, `newWorkstreams`, and `resetThreadIds`; a choice may refer to a new
workstream's `key`. `resetThreadIds` removes selected automatic workstream
choices, saving them in the backup. A reset can't undo a move you made or
overlap a choice for the same thread, and never deletes threads or transcripts.
A reset thread can be in No workstream when reopened until Workstreams or you
move it again. The preview lists the resulting workstreams, each thread's move
and provenance, removed paths, project associations, and blockers.

`bb workstreams migration apply <preview-id>` requires the reviewed preview's ID
and unchanged workstreams, groups, and thread workstreams. The transaction keeps
each moved thread's provenance and the evidence it was chosen from, keeps
destination IDs, saves a backup, and adds each removed full path as an alias of
its destination. Explicit project associations on removed workstreams block
apply; learned associations of narrower workstreams are not copied onto broader
destinations. Native section reconciliation follows the committed changes.
Categories of workstreams the migration doesn't touch are kept.

A backup keeps the original workstreams, thread workstreams, section bindings,
and layout, and `bb workstreams migration backup <backup-id>` prints it. It is
recovery data rather than an ordinary Undo, which would bring back unsupported
depth. Schema upgrades do not perform this migration.

## Repairs and observability

`bb workstreams preview [thread]` and `bb workstreams apply <preview-id>` review
automatic workstream repairs for up to 100 threads; **Preview automatic moves…**
on the Organize page does the same. Threads you moved are left out. A preview
expires after 30 minutes, is rejected when the workstreams changed, and applies
each row once. Rows not yet processed after an SDK read failure can be retried.
A new preview replaces the previous one.

`bb workstreams organize` reports the organizer's status, active, complete, and
No workstream thread counts, and how many analyzed turns had an agent report.
`--rebuild` runs a fresh pass and retries failed category assessments. The
Organize page lists organizing suggestions, the threads in No workstream, and
every workstream and group. With **Record model traces** on, `categories` and
`category-fit` traces keep the redacted input, validated output, usage, and
latency. Activity records automatic and observed changes. The composer preview
asks the start call's prompt of a faster model; it is not a repair preview.
