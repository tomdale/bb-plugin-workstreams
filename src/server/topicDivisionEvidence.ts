import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SuggestThread } from "../domain/tidy.ts";
import { requestEvidence } from "./requests.ts";
import type { TopicStore } from "./topics.ts";

/** A topic division reviews archived filing choices as well as current roots. */
export async function topicDivisionEvidence(
  sdk: BbPluginApi["sdk"],
  topics: TopicStore,
  topicId: string,
  checkout: (threadId: string) => string | null,
): Promise<SuggestThread[]> {
  const assignments = Object.values(topics.assignments()).filter(
    (assignment) =>
      assignment.entityId === topicId && !assignment.inheritedFrom,
  );
  const result: SuggestThread[] = new Array(assignments.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, assignments.length) }, async () => {
      while (cursor < assignments.length) {
        const index = cursor++;
        const assignment = assignments[index]!;
        const [thread, requests] = await Promise.all([
          sdk.threads.get({ threadId: assignment.threadId }),
          requestEvidence(sdk, assignment.threadId),
        ]);
        result[index] = {
          id: thread.id,
          title: thread.title ?? "Untitled thread",
          work: requests.join("\n\n"),
          checkout: checkout(thread.id),
          topicId,
        };
      }
    }),
  );
  return result;
}
