import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { subagentEnvelope } from "../domain/subagentDelivery.ts";

const runsSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      ownerThreadId: z.string(),
      threadId: z.string().nullable(),
      title: z.string(),
      output: z.string(),
    }),
  ),
});

type Sdk = BbPluginApi["sdk"];

/** Keeps unverified messages: a matching envelope alone is not provenance. */
export async function withoutSubagentDeliveries(
  sdk: Sdk,
  ownerThreadId: string,
  requests: readonly string[],
): Promise<string[]> {
  const envelopes = requests.map(subagentEnvelope);
  if (!envelopes.some(Boolean)) return [...requests];
  try {
    const { runs } = await sdk.plugins.callRpc({
      pluginId: "subagents",
      method: "list",
      input: { threadId: ownerThreadId },
      outputSchema: runsSchema,
      signal: AbortSignal.timeout(2_000),
    });
    return requests.filter((_, i) => {
      const envelope = envelopes[i];
      return (
        !envelope ||
        !runs.some(
          (run) =>
            run.id === envelope.runId &&
            run.ownerThreadId === ownerThreadId &&
            run.threadId === envelope.threadId &&
            run.title === envelope.title &&
            run.output === envelope.output,
        )
      );
    });
  } catch {
    return [...requests];
  }
}

/** A source relationship wins; otherwise only an explicit continuation is one. */
export function continuationThreadId(
  sourceThreadId: string | null | undefined,
  requests: readonly string[],
): string | null {
  if (sourceThreadId) return sourceThreadId;
  for (const request of [...requests].reverse()) {
    if (subagentEnvelope(request)) continue;
    const match = request.match(
      /\b(?:continue|continuing|resume)\s+from\s+@thread:([\w-]+)/i,
    );
    if (match) return match[1]!;
  }
  return null;
}
