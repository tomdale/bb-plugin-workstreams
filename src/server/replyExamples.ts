import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  COMPONENT_EXAMPLES,
  COMPONENT_NAMES,
  componentFence,
} from "../domain/replyExamples.ts";
import {
  REPLY_COMPONENT_INSTRUCTIONS,
  REPLY_EXAMPLES_TOOL,
} from "../domain/replyInstructions.ts";

/** Read-only examples teach the typed body without spending the recap instruction's budget. */
export function registerReplyExamples(bb: BbPluginApi): void {
  bb.agents.registerTool({
    name: REPLY_EXAMPLES_TOOL,
    description:
      "Read illustrative examples for the information components you plan to compose in your final reply. Request the needed types; omit types to read all examples. The examples are not evidence about the current thread.",
    instructions: REPLY_COMPONENT_INSTRUCTIONS,
    presentation: {
      label: { pending: "Reading reply examples", completed: "Reply examples" },
      suppress: true,
    },
    parameters: z
      .object({
        types: z
          .array(z.enum(COMPONENT_NAMES))
          .min(1)
          .max(COMPONENT_NAMES.length)
          .optional(),
      })
      .strict(),
    execute: async (input) =>
      (input.types ?? [...COMPONENT_NAMES])
        .map((type) => componentFence(COMPONENT_EXAMPLES[type]))
        .join("\n\n"),
  });
}
