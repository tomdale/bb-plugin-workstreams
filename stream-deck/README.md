# BB Workstreams for Stream Deck

A Stream Deck plugin that shows the [Workstreams](../README.md) **Up Next** list
on Stream Deck keys and a Stream Deck + dial, and opens its threads in BB. It is
optional: Workstreams works the same without it.

It needs Stream Deck 7.1 or later on a Mac, and BB with the Workstreams plugin
running on that Mac, or on a server its `bb` CLI is set up to reach.

## Install

From this directory:

```sh
npm ci
npm run build
npx streamdeck dev     # once: lets Stream Deck load plugins from a folder
npm run link           # links com.tomdale.bb-workstreams.sdPlugin into Stream Deck
npm run restart
```

Stream Deck then runs the plugin from this folder, so rebuild after pulling
changes. To install a copy instead, `npm run pack` writes
`dist/com.tomdale.bb-workstreams.streamDeckPlugin`; opening it installs the
plugin into Stream Deck, and later builds here leave that copy unchanged.

Then drag actions from the **BB Workstreams** category onto the deck.

## Actions

- **Up Next thread** (key): one Up Next thread, chosen by its position in the
  list. The key draws it like its sidebar row: the row's mark (a solid dot while
  the thread is unread, a ring once read), the workstream in its color, and the
  title, bold while unread. Positions past **Threads shown** continue with the
  threads **Show N more** lists. Press the key to open the thread in BB. A key
  placed without a position takes the first one no other key holds, so a row of
  new keys lists Up Next in order; change it under **Position** in the key's
  settings.
- **Next Up Next thread** (key): shows how many Up Next threads are unread or
  blocked on you, in amber while one is blocked on you. Pressing it runs
  **Workstreams: next Up Next thread** in each connected BB app, which opens the
  Up Next thread after the one that app has open, wrapping to the top.
- **Up Next** (Stream Deck + dial): the touch strip shows one thread and a dot
  for each thread in Up Next. Turn the dial to move through the list, and press
  it or tap the strip to open the thread. Left alone for 20 seconds, the dial
  returns to the top.

Keys and the dial leave out the thread you have open in BB, so each one opens a
different thread. Opening a thread from a key therefore moves the threads after
it up one key. When a press opens a thread, the plugin brings the BB desktop app
forward. A key that can't show Up Next says why: it can't reach BB, can't get
the token, or BB has no Workstreams plugin running. After a dropped connection,
keys keep the last Up Next for 10 seconds while the plugin reconnects.

## Connection

The plugin reads BB's server URL from `~/.bb/config.json` (or `$BB_DATA_DIR`),
and Workstreams' token from `~/.bb/bin/bb plugin token workstreams`. After
`bb plugin token workstreams --rotate`, it asks for the new token on its own.
Every action's settings have **BB server** and **Token** fields, shared by all
actions, for a server the CLI on this Mac doesn't point at; leave them empty to
use what the plugin finds.

Workstreams serves these routes under
`/api/v1/plugins/workstreams/http/stream-deck/`, each behind the token in the
`x-bb-plugin-token` header:

| Route         | Purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `GET up-next` | The current Up Next snapshot.                                             |
| `WS live`     | The snapshot when the socket opens, then each time Up Next changes.       |
| `POST open`   | `{ "threadId": … }` opens that thread in the connected BB apps.           |
| `POST next`   | Each connected BB app opens the thread after its open one in its Up Next. |

[`src/domain/streamDeck.ts`](../src/domain/streamDeck.ts) defines the snapshot's
format, and this plugin bundles that file.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run validate   # checks the manifest and its files with Stream Deck's CLI
npm run watch      # rebuilds on change and restarts the linked plugin
```

The plugin writes its logs to `com.tomdale.bb-workstreams.sdPlugin/logs/`.
Stream Deck draws keys from SVG without a browser's text layout, so
`src/render.ts` measures text with Helvetica Neue's glyph widths and breaks
lines itself.
