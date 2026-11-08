/** Question and recap tools, the reply block, and their per-session instructions. */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isWorkstreamsWorker } from "../domain/worker.ts";
import type { AgentRecaps } from "./recap.ts";
import { questionConfig } from "./questions/tool.ts";
import { registerReplyExamples } from "./replyExamples.ts";
import { REPLY_EXAMPLES_TOOL } from "../domain/replyInstructions.ts";

/**
 * Internal inference workers receive no tools or instructions. Side chats
 * receive question support; other threads also receive recap configuration.
 */
export function registerAgentInstructions(
  bb: BbPluginApi,
  recaps: AgentRecaps,
): void {
  registerReplyExamples(bb);
  bb.agents.configure((context) => {
    if (isWorkstreamsWorker(context.pluginMetadata))
      return { tools: [], skills: [] };
    const sideChat =
      context.origin.kind === "fork" && context.origin.pluginId === "side-chat";
    const mode = recaps.configure(context.thread.id, !sideChat);
    const questions = questionConfig(
      context.provider.capabilities.supportsNativeUserQuestion,
    );
    // The recap instructions travel with the recap tool. This text holds the
    // question guidance and, in a session that draws reply blocks, the reply
    // contract last: bb appends it after every tool section, and a rule about
    // where the reply goes is followed when it sits closest to the reply.
    return {
      tools: [
        ...questions.tools,
        ...mode.tools,
        ...(mode.structuredReplies ? [REPLY_EXAMPLES_TOOL] : []),
      ],
      skills: [],
      instructions: [questions.instructions, mode.replyInstructions]
        .filter((text): text is string => text !== null)
        .join("\n\n"),
    };
  });
}
