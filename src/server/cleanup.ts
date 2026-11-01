import type { BbPluginApi } from "@get-bb/plugin-sdk";

export type CleanupMember = {
  id: string;
  archivedAt: number | null;
  sectionId: string | null;
};
/** Read both lifecycles and hidden threads: sidebar visibility is not deletion eligibility. */
export async function sectionMembers(
  sdk: BbPluginApi["sdk"],
  sectionId: string,
): Promise<CleanupMember[]> {
  const members = new Map<string, CleanupMember>();
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += 100) {
      const page = await sdk.threads.list({
        sectionId,
        archived,
        includeHidden: true,
        limit: 100,
        offset,
      });
      for (const thread of page) {
        if (thread.sectionId === sectionId)
          members.set(thread.id, {
            id: thread.id,
            archivedAt: thread.archivedAt,
            sectionId,
          });
      }
      if (page.length < 100) break;
    }
  }
  return [...members.values()];
}
