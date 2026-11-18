/*
 * An in-memory thread event log behind `sdk.threads.events.list`, filtered
 * the way BB filters it: by type, exclusive sequence bounds, order, and limit.
 */
type Event = {
  seq: number;
  type: string;
  scope: { kind: "turn"; turnId: string } | { kind: "thread" };
  data: Record<string, unknown>;
};

export function eventLog() {
  const events: Event[] = [];
  let seq = 0;
  const add = (event: Omit<Event, "seq">) => {
    events.push({ ...event, seq: ++seq });
    return seq;
  };
  const turn = (turnId: string) => ({ kind: "turn" as const, turnId });
  const log = {
    events,
    startTurn(turnId: string, nested = false) {
      return add({
        type: "turn/started",
        scope: turn(turnId),
        data: nested ? { parentToolCallId: "call_1" } : {},
      });
    },
    message(turnId: string, itemId: string, text: string, nested = false) {
      return add({
        type: "item/completed",
        scope: turn(turnId),
        data: {
          item: {
            type: "agentMessage",
            id: itemId,
            text,
            ...(nested ? { parentToolCallId: "call_1" } : {}),
          },
        },
      });
    },
    tool(turnId: string, itemId: string) {
      return add({
        type: "item/completed",
        scope: turn(turnId),
        data: { item: { type: "commandExecution", id: itemId, command: "ls" } },
      });
    },
    /** A turn request: the user's message, another thread's, or a reminder. */
    request(text: string) {
      return add({
        type: "client/turn/requested",
        scope: { kind: "thread" },
        data: { input: [{ type: "text", text, mentions: [] }] },
      });
    },
    endTurn(turnId: string, status = "completed") {
      return add({
        type: "turn/completed",
        scope: turn(turnId),
        data: { status },
      });
    },
    /** A complete turn whose last message is `text`. */
    turn(turnId: string, text: string, itemId = `${turnId}-final`) {
      log.startTurn(turnId);
      log.message(turnId, `${turnId}-progress`, "Working on it.");
      log.tool(turnId, `${turnId}-tool`);
      log.message(turnId, itemId, text);
      log.endTurn(turnId);
    },
    list: async (args: {
      types?: string[];
      afterSeq?: string;
      beforeSeq?: string;
      order?: "asc" | "desc";
      limit?: string;
    }) => {
      let found = events.filter(
        (event) =>
          (!args.types || args.types.includes(event.type)) &&
          (args.afterSeq === undefined || event.seq > Number(args.afterSeq)) &&
          (args.beforeSeq === undefined || event.seq < Number(args.beforeSeq)),
      );
      if (args.order === "desc") found = [...found].reverse();
      return found.slice(0, args.limit ? Number(args.limit) : undefined);
    },
  };
  return log;
}
