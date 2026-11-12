/**
 * What the Workstreams server and its Stream Deck plugin (`stream-deck/`) send
 * each other. The Stream Deck package bundles this file into its own build,
 * so it imports nothing.
 *
 * The Stream Deck plugin reads Up Next from the `live` WebSocket, which sends
 * a snapshot when it opens and another whenever Up Next changes, and acts
 * through the POST routes. Every route requires Workstreams' plugin token
 * (`bb plugin token workstreams`) in the `x-bb-plugin-token` header.
 */

/** Bumped when a snapshot changes shape in a way older readers would misread. */
export const STREAM_DECK_PROTOCOL = 1;

/** Route paths under `/api/v1/plugins/workstreams/http`. */
export const STREAM_DECK_ROUTES = {
  /** GET: the current snapshot. */
  upNext: "/stream-deck/up-next",
  /** WebSocket: the current snapshot, then each changed one. */
  live: "/stream-deck/live",
  /** POST `{ threadId }`: opens that thread in the connected BB apps. */
  open: "/stream-deck/open",
  /** POST: each connected BB app opens the next thread in its Up Next. */
  next: "/stream-deck/next",
} as const;

/**
 * The realtime channel the server relays the Next key on. Each app opens the
 * thread after the one it has open, as the next Up Next command does, which
 * the server cannot do itself because it doesn't know what each app shows.
 */
export const STREAM_DECK_CHANNEL = "stream-deck";

export type StreamDeckCommand = { readonly command: "next-up-thread" };

export function isStreamDeckCommand(
  value: unknown,
): value is StreamDeckCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { command?: unknown }).command === "next-up-thread"
  );
}

/** The sidebar marks a Stream Deck key draws, in the sidebar's precedence. */
export const STREAM_DECK_MARKS = [
  "error",
  "needs-you",
  "review",
  "done",
] as const;
export type StreamDeckMark = (typeof STREAM_DECK_MARKS)[number];

export type StreamDeckThread = {
  readonly id: string;
  readonly title: string;
  /**
   * The thread's workstream, or null when it is Unfiled. `color` is the
   * workstream's identity color for a dark surface, as `#rrggbb`.
   */
  readonly workstream: { readonly name: string; readonly color: string } | null;
  /** The mark the sidebar row shows before the title, or null for none. */
  readonly mark: StreamDeckMark | null;
  readonly unread: boolean;
  /** A question or review waits on the user (see `isBlockedOnUser`). */
  readonly onYou: boolean;
};

export type StreamDeckSnapshot = {
  readonly protocol: typeof STREAM_DECK_PROTOCOL;
  /** Up Next's rows, most urgent first, as the sidebar lists them. */
  readonly rows: readonly StreamDeckThread[];
  /** The threads Show more lists below the rows, most urgent first. */
  readonly more: readonly StreamDeckThread[];
};

const isString = (value: unknown): value is string => typeof value === "string";
const HEX = /^#[0-9a-f]{6}$/i;

function parseThread(value: unknown): StreamDeckThread | null {
  if (typeof value !== "object" || value === null) return null;
  const thread = value as Record<string, unknown>;
  const workstream = thread.workstream as Record<string, unknown> | null;
  if (
    !isString(thread.id) ||
    !isString(thread.title) ||
    typeof thread.unread !== "boolean" ||
    typeof thread.onYou !== "boolean" ||
    !(
      thread.mark === null ||
      STREAM_DECK_MARKS.includes(thread.mark as StreamDeckMark)
    ) ||
    !(
      workstream === null ||
      (typeof workstream === "object" &&
        isString(workstream.name) &&
        isString(workstream.color) &&
        HEX.test(workstream.color))
    )
  )
    return null;
  return {
    id: thread.id,
    title: thread.title,
    workstream: workstream
      ? { name: workstream.name as string, color: workstream.color as string }
      : null,
    mark: thread.mark as StreamDeckMark | null,
    unread: thread.unread,
    onYou: thread.onYou,
  };
}

/**
 * A snapshot read off the wire, or null when it isn't one this protocol
 * version describes. A malformed thread fails the whole snapshot rather than
 * dropping out, which would shift every later thread to another key.
 */
export function parseStreamDeckSnapshot(
  value: unknown,
): StreamDeckSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.protocol !== STREAM_DECK_PROTOCOL ||
    !Array.isArray(snapshot.rows) ||
    !Array.isArray(snapshot.more)
  )
    return null;
  const rows = snapshot.rows.map(parseThread);
  const more = snapshot.more.map(parseThread);
  if (rows.includes(null) || more.includes(null)) return null;
  return {
    protocol: STREAM_DECK_PROTOCOL,
    rows: rows as StreamDeckThread[],
    more: more as StreamDeckThread[],
  };
}
