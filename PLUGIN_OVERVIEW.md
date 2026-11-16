# Workstreams

Workstreams keeps BB threads' goals, topics, status, and activity current, then
derives native BB workstreams from each root's topic.

## Phases

- **A thread's start** is one model call that titles a new thread and chooses
  its topic. Workstreams asks it about the composer draft as you type and reuses
  the answer when you send exactly that text; otherwise it asks when the first
  request is sent. Only topics without subtopics hold threads.
- **A turn's end** is one model call that settles the title after new requests,
  the goal, and the context digest, supplies recap and fallback status only when
  the agent did not report, and after a new request decides whether the topic
  changes. Titles name the goal as an -ing verb and its subject; a title
  Workstreams wrote is kept until the goal changes, and one you gave is never
  replaced.
- **Organization** deterministically lays out workstreams from topic assignments
  without model calls: busy groups show subgroups, contexts and small families
  collapse into dimmed names, and dominant groups move to the top level. Sidebar
  moves are logged and reverted; changing a topic changes the workstream.
- **Suggestions** propose splits of busy topics and tidy edits to the topic
  tree, which apply only when accepted.
- **Activity** records automatic and observed changes, with undo where
  supported.

A thread spawned from another thread inherits its topic; a thread created from a
workstream's ＋ inherits that workstream's topic. Otherwise its start chooses a
topic from its first request or leaves it Unfiled. Explicit composer choices are
manual.

The sidebar includes Up Next, Recent, workstream groups, snooze, and archive
views. An optional Stream Deck plugin in `stream-deck/` shows Up Next on keys
and a dial, reading it from token-protected routes. The **Organization** page
shows suggestions and current derived state; **Topics** manages the topic tree;
**Activity** shows changes and model calls. Settings name each model by its
task: naming and filing new threads, updating threads after each turn, arranging
categories, and suggesting changes.

The recap tool's `goal` field remains unchanged for compatibility with running
agent sessions.

See [README.md](README.md) for usage and
[docs/organization.md](docs/organization.md) for the organizer.
