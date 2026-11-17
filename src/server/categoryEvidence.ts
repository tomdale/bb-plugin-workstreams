import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CategoryInput } from "../domain/categories.ts";
import { excerpt } from "../domain/analysis.ts";
import { choiceRequests, requestEvidence } from "./requests.ts";

/**
 * Fetch requests only for an assessment, not for every sidebar refresh. A fit
 * check reads only its changed threads' work (`only`); the rest are titles.
 */
export async function categoryEvidence<T extends CategoryInput>(
  sdk: BbPluginApi["sdk"],
  input: T,
  signal: AbortSignal,
  pendingRequest: (threadId: string, basis: string) => string | undefined,
  only?: ReadonlySet<string>,
): Promise<T> {
  const threads = [...input.threads];
  const wanted = threads
    .map((thread, index) => ({ root: thread, index }))
    .filter(({ root: thread }) => !only || only.has(thread.id));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, wanted.length) }, async () => {
      while (cursor < wanted.length) {
        signal.throwIfAborted();
        const { root: thread, index } = wanted[cursor++]!;
        const requests = await requestEvidence(sdk, thread.id);
        const pending = pendingRequest(thread.id, thread.workKey);
        const current = pending
          ? choiceRequests([
              ...requests.filter((request) => request !== pending),
              pending,
            ])
          : requests;
        threads[index] = {
          ...thread,
          work: [
            thread.work ? `Desired outcome: ${excerpt(thread.work, 160)}` : "",
            ...current
              .reverse()
              .map(
                (request, i) =>
                  `${i === 0 ? "Latest" : "Earlier"} request: ${excerpt(request, 320)}`,
              ),
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
    }),
  );
  signal.throwIfAborted();
  return { ...input, threads };
}
