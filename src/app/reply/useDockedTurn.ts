/**
 * Whether a message's turn is the one the docked recap card shows. The card
 * reads the thread's stored recap, which a reply block's card fields wrote,
 * so the article only repeats the compact recap fields for historical or
 * dismissed cards. Its primary answer heading remains in the article.
 *
 * Every block shares one server-state read. While it loads, the article
 * withholds its historical footer so recap fields do not appear then vanish.
 */
import { useSharedServerState } from "../serverState.ts";

export function useDockedTurn(
  threadId: string | null,
  turnId: string | null,
): boolean | null {
  const { server } = useSharedServerState();
  if (!threadId || !turnId) return false;
  if (!server.ready) return null;
  const recap = server.recaps[threadId];
  return (
    !!recap &&
    recap.turnId === turnId &&
    !(server.dismissedRecaps ?? []).includes(recap.id)
  );
}
