import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import {
  parse,
  REPLY_BLOCK,
  REPLY_VERSIONS,
  toText,
} from "../../domain/reply.ts";
import { ReplyBlock } from "./ReplyBlock.tsx";

/**
 * Claims `:::reply` blocks in agent messages. A bb without message blocks
 * has no such slot; the plugin then registers nothing and those blocks show
 * as raw text.
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
}
