import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import type { Row } from "../../domain/project.ts";
import type { TopicColor } from "../../domain/workstreamColor.ts";
import type { ServerState, WorkView } from "../useWorkstreams.ts";
import { hasStatusMark } from "../sidebar/presentation.ts";
import { HIDDEN_NOW, HomeThreadRow } from "./HomeRow.tsx";

/**
 * Pinned on Home: the roots the user keeps in reach, directly under Up Next
 * as in the sidebar, each row naming its workstream in the workstream's hue.
 * It lists the pinned roots only; their child threads stay in the workstream
 * groups below, where the tree shows them.
 */
export function PinnedBlock({
  rows,
  work,
  analysis,
  recaps,
  workstreamOf,
  now,
  showAge,
}: {
  rows: readonly Row<PluginSidebarThread>[];
  work: (thread: PluginSidebarThread) => WorkView;
  analysis: ServerState["analysis"];
  recaps: ServerState["recaps"];
  workstreamOf: (row: Row<PluginSidebarThread>) => {
    name: string;
    color: TopicColor;
  } | null;
  now: number;
  showAge: boolean;
}) {
  const marks = rows.some((row) => hasStatusMark(row.thread, work(row.thread)));
  return (
    <section aria-label="Pinned" className="ws-home-pinned">
      <h2 className="ws-home-pinned-head">
        <Icon name="Pin" className="ws-home-pinned-icon" aria-hidden />
        <span>Pinned</span>
      </h2>
      <ul className="ws-home-rows" role="list">
        {rows.map((row) => {
          const workstream = workstreamOf(row);
          return (
            <HomeThreadRow
              key={row.thread.id}
              thread={row.thread}
              analysis={analysis[row.thread.id]}
              recap={recaps[row.thread.id]}
              now={showAge ? now : HIDDEN_NOW}
              variant="group"
              showPin={false}
              showMarkSlot={marks}
              showAge={showAge}
              workstreamName={workstream?.name}
              workstreamHue={workstream?.color.hue}
              workstreamLevel={workstream?.color.level}
            />
          );
        })}
      </ul>
    </section>
  );
}
