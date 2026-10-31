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
    // The recap instructions travel with the recap tool, so `configure`'s
    // instruction budget holds only the question instructions.
    return {
      tools: [
        ...questions.tools,
        ...mode.tools,
        ...(mode.structuredReplies ? [REPLY_EXAMPLES_TOOL] : []),
      ],
      skills: [],
      instructions: questions.instructions,
    };
  });
  bb.agents.contributeInstructions(({ threadId }) =>
    recaps.replyInstructions(threadId),
  );
}
