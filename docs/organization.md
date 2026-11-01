# Organization

Workstreams separates durable **topics**, sidebar **workstreams**, and
contextual **categories**. A root's topic assignment is authoritative. Native
sidebar moves are logged and reverted; a topic change changes its workstream.
Delegates follow their root.

## Topics and workstreams

A topic path has at most two levels total: `Vertex`,
`Vercel Agent: Code Review`, `bb: Workstreams Plugin`, or `Toolbelt: Skills`.
Those levels can represent a product and feature or a category and product. A
topic holds threads or child topics, never both. Stored assignments, including
archived work, prevent adding children without a reviewed complete filing plan.

The organizer makes no model calls itself. After relevant facts change, it:

1. Reconciles visible, non-archived roots and their topic assignments.
2. Derives one workstream for each populated leaf topic. A container appears as
   the dimmed prefix of its child's header. Repeated prefix words are omitted.
3. Creates, renames, or removes topic-bound native sections and files roots to
   match. Every populated leaf keeps its section regardless of volume.
4. Logs outside membership changes and restores topic-derived membership.
5. Prunes discovered topics with no assignments, workstream, or child topics.
6. Notifies the category coordinator and checks whether topic suggestions or
   project learning are due.

The plan is fingerprinted and checked before mutations. Section writes run in
one serial queue with reconciliation; superseded plans schedule a fresh pass.
Invalid depth or threads beside child topics stops the plan before section
mutations, preserving the applied layout until a reviewed repair is available.
Completed roots remain filed and count in organization statistics.

BB sections are flat. The sidebar and phone Home use the applied layout, native
section rows, and category state to draw the same organization. Workstream
collapse preferences use topic IDs across windows and section recreation. Focus,
manual order, Dormant, and Up Next retain workstream identity; categories create
no additional section or workstream hue.

At most three recently emptied workstreams remain visible, and only while each
had an unsnoozed visible thread within the last ten minutes. Population
timestamps survive reloads and are not renewed by empty reads. Cleanup retains
their sections so New work still starts in the right topic. While any workstream
is focused, revealing other workstreams is temporary per-view state; hiding and
revealing that block starts it collapsed.

## Categories

Any topic without children can have categories, at either identity depth. The
eligible collection is its directly assigned visible, non-archived, unsnoozed
roots, including completed roots. Delegates follow their root without counting
separately. Header collapse, focus, scrolling, and which view is open do not
change eligibility. Sibling topics' counts are never combined.

| Existing category state | Eligible roots | Action                                                     |
| ----------------------- | -------------- | ---------------------------------------------------------- |
| None                    | 0–5            | Show one thread list                                       |
| None                    | 6 or more      | Classify the whole collection                              |
| Active                  | 4 or more      | Keep the generation; reconsider on collection/work changes |
| Active                  | 0–3            | Discard the generation without a model call                |

When a root arrives, leaves, or changes work after a substantive request, the
classifier receives the whole current collection and its current categories.
Substantive requests are assessed during dispatch, before Full analysis
finishes. The active collection retains request-version hashes for stale-result
checks; incoming request text is held temporarily until analyzed context catches
up. Each assessment fetches bounded first, second, and latest requests,
excluding verified subagent deliveries. It can recategorize all names and
memberships, but should preserve the arrangement unless a change offers a
meaningful organizational benefit. Cosmetic differences and marginal tidiness
are not reasons to regroup. There is no throttle, periodic assessment,
recommendation queue, or incremental-only mode.

The classifier chooses useful distinctions among these threads, with plain names
and coherent membership. It prefers several roots per category but may use a
singleton for distinct work. It does not force equal sizes or a General/Other
catch-all. Fresh generations need at least two categories; an active generation
can contract as its collection changes. Every eligible root must appear exactly
once. Unsupported IDs, omissions, duplicate memberships, empty categories, and
duplicate names invalidate a replacement.

Category state is stored in plugin database metadata, separately from topic
assignments: generation ID, category IDs and names, member root IDs, and the
collection evidence last assessed, including in-flight request-version hashes.
Settled state survives restarts without a new call; interrupted assessments
resume. Falling to three roots discards the set. Recrossing six starts fresh,
without resurrecting its names or memberships.

Departures are pruned immediately, even during a model call. Arrivals stay
visible directly in their workstream until classified. Invalid or superseded
responses cannot replace a valid set. A failed assessment is not retried for
unrelated updates or restarts; a changed collection/work key or explicit
organization rebuild can retry it. Title-only and status-only changes do not
alter that key. Category creation, removal, and recategorization are recorded in
Activity.

## Starting topics and placement

A root spawned from another thread inherits its topic. New work from a
workstream inherits its bound topic. A topic with children supplies a placement
hint rather than an inherited assignment. A matching automatic composer preview
supplies the topic it showed. Explicit composer choices have manual priority.

Placement makes one closed-set call on the first request and again beside Full
analysis after a new substantive request. It sees the generated title, first,
second, and latest substantive requests, project, checkout, and
continuation/start hints. A checkout's usual topic is a hint unless at least two
of its threads point at other repositories. Title edits, model changes,
topic-definition changes, and control-only requests do not re-place a thread.

Only leaf topics within the two-level limit can be chosen. A new first-level
proposal uses the owner's recognizable product name. With a known first-level
parent, placement may propose a supported lasting child. A new child beneath a
populated topic records a division request and keeps the current filing rather
than creating children around it. Quick's proposal can include one missing
product ancestor when both product and capability are supported.

Sources follow `manual > inherited > full > quick`. Manual choices survive
automatic analysis. Full can replace an inherited choice only for a scope shift
or a supported narrowing beneath it. Accepted repairs and suggestions have Full
provenance unless they preserve an explicit manual choice. Invalid output never
files a thread or clears a valid assignment.

## Reviewed topic changes

Topic divisions depend on lasting scope, not thread count or recurring category
names. A useful division has:

- Supported products, capabilities, or maintained areas rather than
  tasks/stages.
- Definitions that classify a future thread independently of its neighbors.
- Useful specificity within a broad parent; a single-purpose tool already covers
  its fixes, refactors, and reviews.
- A complete supported filing plan, with meaningful names rather than
  catch-alls.

Placement's division request asks for that plan. Asking for suggestions
explicitly also considers first-level divisions. Evidence includes the stored
assignments' requests, titles, and checkouts, including archived work. The
classifier can return no division. Acceptance rechecks the current collection,
excludes threads that changed topic, and classifies arrivals before applying. A
second-level topic cannot gain children. Topic changes wait for acceptance;
categories update independently even when automatic organizing suggestions are
off.

Tidy proposes at most eight edits: merge, reparent, rename, create a parent, or
refile a thread. It keeps its daily cadence: three new topics, five new roots,
or a changed set of at least four Unfiled roots plus one-thread groups can
trigger a pass. Pending tidy edits block another automatic pass. After all
waiting edits are decided and at least one was accepted, a follow-up may run
within the day. Asking for suggestions runs a pass explicitly. Tidy sees at most
twelve current threads per topic and twelve Unfiled threads, plus accepted and
declined decisions. Matching prefix names can also produce deterministic
reparent suggestions.

Every proposed and accepted edit passes leaf-only and depth guards. Accepted
suggestions are recorded in Activity with a guarded snapshot for Undo. Undo
requires the tree and assignments to still match and cannot reinstate an invalid
topic depth. Discovered topics are pruned only when unused and childless; user
configured topics are retained.

## Reviewed two-level migration

`bb workstreams topics migration preview --json` prepares a plan without
changing topics or assignments. Deeper topics map to their existing second-level
ancestor. Assignments in first-level topics with children are blockers until
explicit meaningful destinations are supplied. `--mapping` accepts `choices` and
`newTopics`; choices may refer to a new topic's key. Explicit `resetThreadIds`
remove selected nonmanual classification records with recovery data. They cannot
reset manual filing or overlap refile choices, and never delete threads or
transcripts. A reset thread can be Unfiled when reopened until placement or a
user files it again. Preview lists destination definitions, assignment
provenance, removed paths, project associations, and blockers.

Apply requires the reviewed plan ID and identical topic definitions and stored
assignments. The transaction preserves provenance and classification basis for
refiled threads, retains destination IDs, records recovery data, and adds
removed full paths as destination aliases. Explicit project associations on
removed topics block apply; learned narrower associations are not copied onto
broader destinations. Native section reconciliation follows the committed topic
changes. Unaffected category generations are retained.

Recovery snapshots retain original definitions, assignments, bindings, and
layout and can be exported with `topics migration backup`. They are deliberate
recovery data rather than an ordinary Undo that would restore unsupported depth.
Schema upgrades do not perform this filing migration.

## Topic repairs and observability

`topics preview [thread]` and `topics apply <plan>` review automatic topic
repairs for up to 100 roots. Manual topics are excluded; plans expire after 30
minutes, reject changed definitions, and consume each applied row once. SDK read
failures retain unprocessed rows for retry. A new preview replaces the previous
one.

The Organization page and `bb workstreams organization` report native filing,
active/completed counts, unresolved roots, and report coverage. `--rebuild` runs
a fresh pass and retries failed category assessments. Debug traces include
`categories` calls with redacted input, validated output, usage, and latency.
Activity records automatic and observed changes. Composer preview is Quick
analysis, not an organization preview.
