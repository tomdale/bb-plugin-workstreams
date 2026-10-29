import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import {
  parse,
  REPLY_BLOCK,
  REPLY_VERSIONS,
  toText,
} from "../../domain/reply.ts";
import { ReplyBlock } from "./ReplyBlock.tsx";

let drawn = false;

/** Whether this bb draws reply blocks; false before the app registers. */
export function replyBlocksDrawn(): boolean {
  return drawn;
}

/**
 * Claims `:::reply` blocks in agent messages. Only the tomdale/bb fork has
 * the message-block slot, and no SDK version tells the fork apart, so the
 * slot is detected here. Without it the plugin registers nothing, those
 * blocks show as ordinary Markdown, and the server keeps
 * the recap tool (see `reportClient` in server/recap.ts).
 */
export function registerReplyBlock(app: PluginAppBuilder): void {
  drawn = typeof app.slots.experimental_messageBlock === "function";
  if (!drawn) return;
  // Called as a method: the host's slot may rely on its receiver.
  app.slots.experimental_messageBlock!({
    name: REPLY_BLOCK,
    versions: REPLY_VERSIONS,
    parse: (input, context) => parse(input, context),
    toText,
    component: ReplyBlock,
  });
}
