/**
 * The toast that says why the thread in view changed under the user. Moving on
 * after the open thread leaves (see `AdvanceAfterLeaving`) happens however it
 * left, including a script, another device, or another plugin archiving or
 * snoozing it, so the user is told what left, where they are now, and can go
 * back to it.
 */
import { toast } from "sonner";

/** Longest title the toast quotes before cutting it short. */
const TITLE_MAX = 60;

const quote = (title: string) =>
  `“${title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1)}…`}”`;

export type Move = {
  /** Why the thread left: it was archived, or it was snoozed. */
  readonly reason: "archived" | "snoozed";
  readonly leftTitle: string;
  readonly openedTitle: string;
  /** Reopens the thread that left. */
  readonly goBack: () => void;
};

export function announceMove(move: Move): void {
  toast(`${quote(move.leftTitle)} was ${move.reason}`, {
    description: `Opened ${quote(move.openedTitle)}`,
    action: { label: "Go back", onClick: move.goBack },
  });
}
