# Workstreams

Workstreams keeps BB threads' goals, topics, status, and activity current, then derives native BB workstreams from each root's topic.

## Phases

- **Quick analysis** titles a new thread from its first request, and previews a title and topic for a composer draft. A matching composer result is reused when the first request is sent.
- **Placement** settles a root's topic with one closed-set call on its first request and after each new request. Only topics without subtopics hold threads.
- **Full analysis** runs at turn end, settles the title after new requests, and supplies recap and fallback status only when the agent did not report. Titles name the goal as an -ing verb and its subject; a title Workstreams wrote is kept until the goal changes, and one you gave is never replaced.
- **Organization** deterministically lays out workstreams from topic assignments without model calls: busy groups show subgroups, contexts and small families collapse into dimmed names, and dominant groups move to the top level. Sidebar moves are logged and reverted; changing a topic changes the workstream.
- **Suggestions** propose splits of busy topics and tidy edits to the topic tree, which apply only when accepted.
- **Activity** records automatic and observed changes, with undo where supported.

A thread spawned from another thread inherits its topic; a thread created from a workstream's ＋ inherits that workstream's topic. Otherwise placement classifies its first request or leaves it Unfiled. Explicit composer choices are manual.

The sidebar includes Up Next, Recent, workstream groups, snooze, and archive views. The **Organization** page shows suggestions and current derived state; **Topics** manages the topic tree; **Activity** shows changes and model calls. Settings separate the Quick analysis, Full analysis, placement, and suggestions models.

The recap tool's `goal` field remains unchanged for compatibility with running agent sessions.

See [README.md](README.md) for usage and [docs/organization.md](docs/organization.md) for the organizer.
