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
 * Claims `:::reply` blocks in agent messages. The slot is checked here, not
 * only through engines.bbPluginSdk, because an SDK version that satisfies the
 * range may come from a bb without it. Without the slot the plugin registers
 * nothing and those blocks show as ordinary Markdown between `:::` lines.
 */
export function registerReplyBlock(app: PluginAppBuilder): void {
  if (typeof app.slots.experimental_messageBlock !== "function") return;
  app.slots.experimental_messageBlock({
    name: REPLY_BLOCK,
    versions: REPLY_VERSIONS,
    parse: (input, context) => parse(input, context),
    toText,
    component: ReplyBlock,
  });
  drawn = true;
}
