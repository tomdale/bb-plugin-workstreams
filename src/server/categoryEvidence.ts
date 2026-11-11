import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CategoryInput } from "../domain/categories.ts";
import { excerpt } from "../domain/analysis.ts";
import { placementRequests, requestEvidence } from "./requests.ts";

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
  const roots = [...input.roots];
  const wanted = roots
    .map((root, index) => ({ root, index }))
    .filter(({ root }) => !only || only.has(root.id));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, wanted.length) }, async () => {
      while (cursor < wanted.length) {
        signal.throwIfAborted();
        const { root, index } = wanted[cursor++]!;
        const requests = await requestEvidence(sdk, root.id);
        const pending = pendingRequest(root.id, root.workKey);
        const current = pending
          ? placementRequests([
              ...requests.filter((request) => request !== pending),
              pending,
            ])
          : requests;
        roots[index] = {
          ...root,
          work: [
            root.work ? `Desired outcome: ${excerpt(root.work, 160)}` : "",
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
  return { ...input, roots };
}
