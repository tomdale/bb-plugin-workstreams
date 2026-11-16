/**
 * Workstreams' `bb.host` entry: isolated AI Gateway work on the machine, with
 * the AI Gateway key Pi already has there. `complete` runs one tool-free
 * completion; `present` runs one bounded enhanced-response composition (see
 * `presentation/`). No new credentials are stored, and no fallback model is
 * tried.
 */
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./contract.ts";
import { gatewayComplete, gatewayKey } from "./gateway.ts";
import { presentOnHost } from "./presentation/host.ts";

const NO_KEY =
  "Analysis failed: no AI Gateway key on this machine. Sign Pi in to Vercel AI Gateway. No fallback model was used.";
const FAILURE =
  "Analysis failed. Check Pi's AI Gateway authentication on this machine. No fallback model was used.";
const TIMEOUT_MS = 90_000;

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    present: async ({ model, response, title, topic, theme }, ctx) => {
      const outcome = await presentOnHost({
        input: { response, title, topic },
        model,
        theme,
        signal: ctx.signal,
      });
      return {
        kind: outcome.kind,
        ...(outcome.kind === "document" ? { document: outcome.document } : {}),
        reason: outcome.kind === "document" ? null : outcome.reason,
        previews: outcome.previews,
        modelCalls: outcome.modelCalls,
        usage: outcome.usage,
      };
    },
    complete: async (
      { prompt, model, maxTokens, reasoningLevel, serviceTier, outputSchema },
      ctx,
    ) => {
      const apiKey = await gatewayKey();
      if (!apiKey) throw new Error(NO_KEY);
      // The server aborts a call whose answer no longer matters (the draft
      // changed); that closes the gateway request instead of waiting on it.
      const signal = AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(TIMEOUT_MS),
      ]);
      try {
        return await gatewayComplete({
          prompt,
          model,
          maxTokens,
          reasoningLevel,
          outputSchema,
          serviceTier,
          apiKey,
          signal,
        });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        throw new Error(
          signal.aborted
            ? "Model request timed out after 90 seconds. No fallback model was used."
            : error instanceof Error
              ? error.message
              : FAILURE,
        );
      }
    },
  },
});
