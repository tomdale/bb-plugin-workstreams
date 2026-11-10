import { memo } from "react";
import { type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { type ServerState } from "../useWorkstreams.ts";
import { workView } from "../../domain/status.ts";
import { useClock } from "../clock.ts";
import { Row, type RowSnoozeAction } from "./Row.tsx";
import {
  foldKey,
  foldDefault,
  PLACEMENT_TRAITS,
  type Placement,
  sameThread,
} from "./rows.ts";
import { RowMenu, type RowMenuHandlers } from "./RowMenu.tsx";
import { type DragHandle } from "./dnd.tsx";
import {
  describeWake,
  shortWake,
  type SnoozeWhen,
  type ThreadSnooze,
} from "../../domain/snooze.ts";
import {
  CurrentSnoozeMenuItems,
  plainMenuKit,
} from "../snooze/SnoozeMenuItems.tsx";

export type SidebarThreadRowProps = {
  handleRef?: DragHandle["ref"];
  handleListeners?: DragHandle["listeners"];
  thread: PluginSidebarThread;
  depth: number;
  active: boolean;
  context?: string;
  placement: Placement;
  analysis?: ServerState["analysis"][string];
  recap?: ServerState["recaps"][string];
  slotWidth: number;
  snooze?: ThreadSnooze;
  snoozePrefs: ServerState["snoozePrefs"];
  defaultWake: () => SnoozeWhen;
  handlers: RowMenuHandlers;
  disclosureExpanded?: boolean;
  categorized: boolean;
  onNavigate: () => void;
  toggleDisclosure: (id: string, byDefault?: boolean) => void;
};

/**
 * A list row with stable action identities. Its memo compares every prop,
 * including callbacks, so an unrelated thread update skips the SDK hooks and
 * presentation work in `Row` without retaining stale actions.
 */
export const SidebarThreadRow = memo(function SidebarThreadRow({
  thread,
  depth,
  active,
  context,
  placement,
  analysis,
  recap,
  slotWidth,
  snooze,
  snoozePrefs,
  defaultWake,
  handlers,
  disclosureExpanded,
  categorized,
  onNavigate,
  toggleDisclosure,
  handleRef,
  handleListeners,
}: SidebarThreadRowProps) {
  const work = workView(thread, analysis, recap);
  // A snoozed row's wake time follows the clock, so the row reads it itself.
  const wakeTime = useClock((now) =>
    snooze ? shortWake(snooze.until, now) : undefined,
  );
  const wakeTitle = useClock((now) =>
    snooze ? describeWake(snooze.until, now, snooze.events) : "",
  );
  const traits = PLACEMENT_TRAITS[placement];
  let snoozeAction: RowSnoozeAction | undefined;
  if (traits.snooze && (traits.snooze !== "wake" || snooze !== undefined)) {
    const wake = defaultWake();
    const menu = (
      <CurrentSnoozeMenuItems
        kit={plainMenuKit}
        prefs={snoozePrefs}
        snooze={snooze}
        onSnooze={(when) => handlers.snooze(thread, when)}
        onWake={() => handlers.wake(thread)}
        onCustom={() => handlers.customSnooze(thread)}
      />
    );
    snoozeAction =
      traits.snooze === "wake"
        ? {
            kind: "wake",
            title: `Wake now (snoozed ${wakeTitle})`,
            run: () => handlers.wake(thread),
            menu,
          }
        : {
            kind: "snooze",
            title: `Snooze ${describeWake(wake.until, Date.now(), wake.events)}`,
            run: () => handlers.snooze(thread, defaultWake()),
            menu,
          };
  }
  return (
    <RowMenu
      thread={thread}
      handlers={handlers}
      snooze={snooze}
      snoozePrefs={snoozePrefs}
      showArchive={traits.showArchive}
    >
      <li ref={handleRef} {...handleListeners} className="list-none">
        <Row
          thread={thread}
          depth={depth}
          active={active}
          context={placement === "snoozed" ? wakeTime : context}
          placement={placement}
          work={work}
          slotWidth={slotWidth}
          subtitle={
            traits.subtitle && work.kind === "current"
              ? work.analysis.needsYou
              : null
          }
          snoozeAction={snoozeAction}
          disclosure={
            disclosureExpanded === undefined
              ? undefined
              : {
                  expanded: disclosureExpanded,
                  toggle: () =>
                    toggleDisclosure(
                      foldKey(placement, thread.id),
                      foldDefault(placement),
                    ),
                }
          }
          categorized={categorized}
          onNavigate={onNavigate}
        />
      </li>
    </RowMenu>
  );
}, sameSidebarThreadRow);

export function sameSidebarThreadRow(
  before: SidebarThreadRowProps,
  after: SidebarThreadRowProps,
) {
  return (
    sameThread(before.thread, after.thread) &&
    before.depth === after.depth &&
    before.active === after.active &&
    before.context === after.context &&
    before.placement === after.placement &&
    before.analysis === after.analysis &&
    before.recap === after.recap &&
    before.slotWidth === after.slotWidth &&
    before.snooze === after.snooze &&
    before.snoozePrefs === after.snoozePrefs &&
    before.defaultWake === after.defaultWake &&
    before.handlers === after.handlers &&
    before.disclosureExpanded === after.disclosureExpanded &&
    before.categorized === after.categorized &&
    before.onNavigate === after.onNavigate &&
    before.toggleDisclosure === after.toggleDisclosure &&
    before.handleRef === after.handleRef &&
    before.handleListeners === after.handleListeners
  );
}
