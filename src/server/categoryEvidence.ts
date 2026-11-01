import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CategoryInput } from "../domain/categories.ts";
import { excerpt } from "../domain/analysis.ts";
import { placementRequests, requestEvidence } from "./requests.ts";

/** Fetch requests only for an assessment, not for every sidebar refresh. */
export async function categoryEvidence(
  sdk: BbPluginApi["sdk"],
  input: CategoryInput,
  signal: AbortSignal,
  pendingRequest: (threadId: string, basis: string) => string | undefined,
): Promise<CategoryInput> {
  const roots = [...input.roots];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, roots.length) }, async () => {
      while (cursor < roots.length) {
        signal.throwIfAborted();
        const index = cursor++;
        const root = roots[index]!;
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
