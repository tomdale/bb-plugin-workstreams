# Workstreams

Workstreams organizes BB threads into workstreams and keeps each thread's title,
goal, and status current. A workstream holds threads and a group holds
workstreams; the sidebar lists each workstream as a native BB section. A
thread's workstream decides where it is listed: Workstreams logs and reverts a
sidebar move, and a thread changes workstream only when you move it, you accept
a suggestion, or a new request leads Workstreams to choose another.

## Architecture

The package has three entries, declared under `bb` in `package.json`, and an
optional Stream Deck plugin.

- **`src/server`** is the plugin server (`index.ts`). It runs the model calls,
  stores state in the plugin database (`db.ts`), and applies every change to BB
  sections through one serial queue (`service.ts`).
  - A thread's start (`start.ts`) is one call that titles a new thread and
    chooses its workstream. The composer asks the same prompt of a faster model
    about a draft as you type; its workstream holds the thread until the start
    call answers after send.
  - A turn's end (`analyzer.ts`) is one call that settles the title, goal, and
    context digest, supplies the status when the agent didn't report one, and,
    after a new request, decides whether the workstream changes. The agent's
    recap (`recap.ts`) outranks it.
  - The organizer (`organizer.ts`) lays out sections from thread workstreams
    without model calls. Categories (`categories.ts`) arrange the threads inside
    a busy workstream. Suggestions (`suggestions.ts`) propose splits and tidy
    edits that apply only when you accept them.
  - The journal (`journal.ts`) records every automatic and observed change for
    Activity, with undo where supported. Model traces (`trace.ts`) record model
    calls while **Record model traces** is on.
  - A Gateway model call runs in the `host` entry on the machine
    (`inference/host.ts`, `inference/gateway.ts`). A provider model runs in a
    hidden BB thread in the **Worker project** (`inference/worker.ts`).
  - `cli.ts` registers `bb workstreams`. `agents.ts` gives agent sessions the
    recap tool, the question card, and the reply block. `streamDeck.ts` serves
    Up Next to the Stream Deck plugin.
- **`src/app`** is the React UI (`index.tsx`): the sidebar thread list with Up
  Next, Recent, workstreams, Other, Snoozed, and Archived; the phone Home
  screen; the thread header; the recap card, question card, and reply block; the
  Workstreams page (queue, Overview, Organize, Activity, and, with the debug UI
  on, Gallery); and the settings sections.
- **`src/domain`** holds the pure rules both sides share: statuses (`status.ts`,
  `presentation.ts`), the prompts and parsers for each model call (`start.ts`,
  `turnEnd.ts`, `workstreamChoice.ts`, `categories.ts`, `tidy.ts`), the sidebar
  projection (`project.ts`, `groups.ts`, `layout.ts`), Up Next (`upNext.ts`),
  snooze and wake rules, and the reply-block format.
- **`stream-deck/`** is a separate npm package that shows Up Next on Stream Deck
  keys and a dial. It reads token-protected routes and bundles
  `src/domain/streamDeck.ts`, the wire format, which imports nothing.

See [README.md](README.md) for usage and
[docs/organization.md](docs/organization.md) for the organizer.
