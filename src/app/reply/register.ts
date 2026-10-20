import type { ComponentType } from "react";
import type {
  PluginAppBuilder,
  PluginMessageDirectiveMessage,
} from "@get-bb/plugin-sdk/app";
import { REPLY_LANGUAGE } from "../../domain/reply.ts";
import { ReplyBlock } from "./ReplyBlock.tsx";

/**
 * What bb's `experimental_codeFenceRenderer` slot (plugin SDK 0.6.40, bb
 * 0.46.1) hands a component, mirrored here because this plugin builds
 * against an older SDK: newer published SDK types drop hooks Workstreams
 * still uses. `code` is the fence body so far, without delimiters;
 * `Original` renders bb's own code block for the fence.
 */
export type CodeFenceStatus = "streaming" | "closed" | "unclosed";
export type CodeFenceProps = {
  code: string;
  language: string;
  status: CodeFenceStatus;
  index: number;
  message: PluginMessageDirectiveMessage;
  Original: ComponentType;
};
type CodeFenceSlot = (registration: {
  id: string;
  languages: readonly string[];
  component: ComponentType<CodeFenceProps>;
}) => void;

let drawn = false;

/** Whether this bb draws reply blocks; false before the app registers. */
export function replyBlocksDrawn(): boolean {
  return drawn;
}

/**
 * Claims ```` ```reply ```` fences in agent messages. A bb without the code
 * fence renderer slot registers nothing, and those fences show as bb's code
 * block.
 */
export function registerReplyBlock(app: PluginAppBuilder): void {
  const slot = (app.slots as { experimental_codeFenceRenderer?: CodeFenceSlot })
    .experimental_codeFenceRenderer;
  if (typeof slot !== "function") return;
  slot.call(app.slots, {
    id: "reply",
    languages: [REPLY_LANGUAGE],
    component: ReplyBlock,
  });
  drawn = true;
}
