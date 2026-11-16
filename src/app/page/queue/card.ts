/**
 * What a queue item's card shows for a thread, from the thread's state.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { NextAction, Recap } from "../../../domain/recap.ts";
import type { WorkView } from "../../../domain/status.ts";
import { STATUS_LABEL, threadStatus } from "../../../domain/presentation.ts";
import type { Sent } from "./useQueueActions.ts";

export type QueueCard =
  | { kind: "recap"; recap: Recap }
  | { kind: "sent"; sent: Sent }
  | { kind: "working"; line: string | null }
  | { kind: "needs"; label: string; line: string | null }
  | { kind: "failed" }
  | { kind: "line"; label: string; line: string | null };

/**
 * A message sent from the page shows until its turn ends; a turn underway
 * shows Working; a failed turn says so; a thread that needs input, or is
 * blocked with no recap saying why, waits on the user. Otherwise the agent's recap, or failing that the one-line analysis
 * recap in a neutral card.
 */
export function cardOf(
  thread: PluginSidebarThread,
  work: WorkView,
  recap: Recap | undefined,
  sent: Sent | undefined,
  running: boolean,
): QueueCard {
  const analysis =
    work.kind === "current"
      ? work.analysis
      : work.kind === "pending"
        ? work.previous
        : null;
  if (sent) return { kind: "sent", sent };
  const status = threadStatus(thread, work);
  if (running || status === "working")
    return { kind: "working", line: analysis?.recap ?? null };
  if (status === "failed") return { kind: "failed" };
  const shown = recap && thread.status === "idle" ? recap : null;
  if (status === "needs-input" || (status === "blocked" && !shown))
    return {
      kind: "needs",
      label: STATUS_LABEL[status],
      line:
        (work.kind === "current" ? work.analysis.ask : null) ??
        analysis?.recap ??
        null,
    };
  if (shown) return { kind: "recap", recap: shown };
  return {
    kind: "line",
    label: status ? STATUS_LABEL[status] : "No recap",
    line: analysis?.recap ?? null,
  };
}

/** The agent's proposed replies, at most three (keys 1–3). */
export const nextActionsOf = (card: QueueCard): NextAction[] =>
  card.kind === "recap" ? card.recap.next.slice(0, 3) : [];

/** The message a next action sends, which the queue shows in full. */
export const actionMessage = (action: NextAction) =>
  typeof action === "string" ? action : action.message;
