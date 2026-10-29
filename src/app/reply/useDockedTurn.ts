/**
 * Whether a message's turn is the one the docked recap card shows. The card
 * reads the thread's stored recap, which a reply block's card fields wrote,
 * so while it is docked the block leaves its headline and results to it.
 *
 * Read from the plugin's shared server state, so every block on screen
 * shares one read. Null until that state has loaded: the block then draws
 * the docked layout, so its card fields never appear and then vanish.
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
