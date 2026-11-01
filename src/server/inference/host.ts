/**
 * Workstreams' `bb.host` entry: runs one isolated AI Gateway completion on
 * the machine, with the AI Gateway key Pi already has there. No new
 * credentials are stored, and no fallback model is tried.
 */
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./contract.ts";
import { gatewayComplete, gatewayEvaluate, gatewayKey } from "./gateway.ts";

const NO_KEY =
  "Analysis failed: no AI Gateway key on this machine. Sign Pi in to Vercel AI Gateway. No fallback model was used.";
const FAILURE =
  "Analysis failed. Check Pi's AI Gateway authentication on this machine. No fallback model was used.";
const TIMEOUT_MS = 90_000;
/** A gate answer either arrives in a few hundred milliseconds or stops mattering. */
const EVALUATE_TIMEOUT_MS = 20_000;

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
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
    evaluate: async ({ state, questions, model }, ctx) => {
      const apiKey = await gatewayKey();
      if (!apiKey) throw new Error(NO_KEY);
      const signal = AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(EVALUATE_TIMEOUT_MS),
      ]);
      try {
        return await gatewayEvaluate({
          state,
          questions,
          model,
          apiKey,
          signal,
        });
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        throw new Error(
          signal.aborted
            ? "Model request timed out after 20 seconds. No fallback model was used."
            : error instanceof Error
              ? error.message
              : FAILURE,
        );
      }
    },
  },
});
