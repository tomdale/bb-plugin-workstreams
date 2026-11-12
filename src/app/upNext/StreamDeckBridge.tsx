import { useBbContext, useRealtime } from "@get-bb/plugin-sdk/app";
import {
  isStreamDeckCommand,
  STREAM_DECK_CHANNEL,
} from "../../domain/streamDeck.ts";
import { openNextUpThread } from "./NextUpCommand.tsx";

/**
 * Runs the Stream Deck's Next key in this app. The server relays the press
 * because only the app knows which thread it has open, and the next thread is
 * the Up Next row after that one, as with the next Up Next command.
 */
export function StreamDeckBridge(): null {
  const { threadId } = useBbContext();
  useRealtime(STREAM_DECK_CHANNEL, (payload) => {
    if (isStreamDeckCommand(payload)) openNextUpThread(threadId);
  });
  return null;
}
