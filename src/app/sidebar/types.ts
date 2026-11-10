import { type ReactNode } from "react";
import { type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { type Row as RowModel } from "../../domain/project.ts";
import { type WorkstreamNode } from "../../domain/groups.ts";
import { type Placement, type RowEntry } from "./rows.ts";
import { type DragHandle } from "./dnd.tsx";
import { type SnoozeWhen } from "../../domain/snooze.ts";

/** Types the sidebar thread list shares across its parts. */
export type ThreadNode = WorkstreamNode<PluginSidebarThread>;

export type ThreadRow = RowModel<PluginSidebarThread>;
export type RowRenderOptions = {
  placement: Placement;
  /**
   * The projection's clock, which decides whether a stored snooze still
   * holds. Passed per call, not captured, so a new projection does not
   * remake every row's renderer.
   */
  projectionNow: number;
  /** The drag handle, for a root row that drags its tree. */
  handle?: DragHandle;
  /** The width its rows reserve for the status slot (see `slotWidthOf`). */
  slotWidth?: number;
  /** Its group's name, for a row listed outside that group's header. */
  label?: string;
  categorized?: boolean;
};
export type RenderRow = (
  entry: RowEntry,
  options: RowRenderOptions,
) => ReactNode;

/**
 * Threads to snooze together, from a thread row or a workstream row.
 * `subject` names them in the toast ("4 threads in Alpha").
 */
export type SnoozeRequest = {
  readonly threads: readonly PluginSidebarThread[];
  readonly subject?: string;
};
/** A workstream row's snooze button (see `WorkstreamGroup`). */
export type GroupSnooze = {
  /** Names the batch: "Snooze 3 threads". */
  label: string;
  /** What a click does: "Snooze 3 threads in Alpha until …". */
  title: string;
  run: () => void;
  /** The hover menu's choices. */
  menu: ReactNode;
  /** Snoozes the batch until a time, a wake event, or whichever is first. */
  snooze: (when: SnoozeWhen) => void;
  /** Opens the Custom… snooze dialog for the batch. */
  custom: () => void;
};
