/** Question and recap tools, the reply block, and their per-session instructions. */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isWorkstreamsWorker } from "../domain/worker.ts";
import type { AgentRecaps } from "./recap.ts";
import { questionConfig } from "./questions/tool.ts";
import { registerReplyExamples } from "./replyExamples.ts";
import { REPLY_EXAMPLES_TOOL } from "../domain/replyInstructions.ts";
import { RESPONSE_INSTRUCTIONS } from "../domain/postTurn/instructions.ts";

/**
 * Internal inference workers receive no tools or instructions. Side chats
 * receive question support; other threads also receive recap configuration. A
 * top-level thread in the Enhanced responses experiment gets the plain response
 * contract in place of the reply-block one, so its agent never writes a reply
 * block that would be drawn beside the enhanced document.
 */
export function registerAgentInstructions(
  bb: BbPluginApi,
  recaps: AgentRecaps,
  presentation: {
    appliesTo(thread: { parentThreadId: string | null }): boolean;
  },
): void {
  registerReplyExamples(bb);
  bb.agents.configure((context) => {
    if (isWorkstreamsWorker(context.pluginMetadata))
      return { tools: [], skills: [] };
    const sideChat =
      context.origin.kind === "fork" && context.origin.pluginId === "side-chat";
    const mode = recaps.configure(context.thread.id, !sideChat);
    const presenting = !sideChat && presentation.appliesTo(context.thread);
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
        ...(mode.structuredReplies && !presenting ? [REPLY_EXAMPLES_TOOL] : []),
      ],
      skills: [],
      instructions: [
        questions.instructions,
        !sideChat
          ? "Always track PRs you open or work on while open: bb workstreams pr track <url>. PRs appear in this thread’s workstream; GitHub reads use its machine. Retracking updates the machine. Inspect: bb workstreams pr list --json. Untrack: bb workstreams pr untrack <url>."
          : null,
        presenting ? RESPONSE_INSTRUCTIONS : mode.replyInstructions,
      ]
        .filter((text): text is string => text !== null)
        .join("\n\n"),
    };
  });
}
