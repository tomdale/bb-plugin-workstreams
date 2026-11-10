/**
 * Whether a message's turn is the one the docked recap card shows. The card
 * reads the thread's stored recap, so a block's Markdown includes recap
 * fields only when its message predates the recap tool and is not the docked
 * turn. Every block of a thread shares one read: the server snapshot's, or
 * for an archived or hidden thread one on-demand record. While it loads,
 * recap fields are withheld so they do not appear then vanish.
 */
import { useThreadRecordSelector } from "../serverState.ts";

export function useDockedTurn(
  threadId: string | null,
  turnId: string | null,
): boolean | null {
  const docked = useThreadRecordSelector(
    threadId && turnId ? threadId : null,
    ({ recap, dismissed }) => !!recap && recap.turnId === turnId && !dismissed,
  );
  if (!threadId || !turnId) return false;
  return docked ?? null;
}
