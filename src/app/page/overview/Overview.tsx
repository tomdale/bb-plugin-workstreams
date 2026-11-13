/**
 * A workstream's Overview: its open root threads as a table of status,
 * summary, and next steps (see `domain/overview.ts` for what each row
 * holds). The Next steps cell carries the control its status calls for: the
 * question to answer, a review's steps, the recap's follow-ups, a waiting
 * recap's status check, or Archive.
 *
 * A follow-up sent from the table waits behind a receipt with Undo, as on
 * the queue (`useQueueActions`); Shift-click opens the thread instead, where
 * the recap card offers the same follow-up to edit.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usePortalScopeProps } from "@/lib/portal-scope";
import {
  nextActionParts,
  overviewCounts,
  overviewRow,
  sortOverviewRows,
  type OverviewRow,
} from "../../../domain/overview.ts";
import {
  relativeAge,
  relativeAgeLabel,
  type SlotMark,
} from "../../../domain/presentation.ts";
import { nestGroups, type WorkstreamNode } from "../../../domain/groups.ts";
import {
  UNSORTED_ID,
  type Group,
  type Row as ProjectedRow,
} from "../../../domain/project.ts";
import type { Recap } from "../../../domain/recap.ts";
import type { SnoozeWhen } from "../../../domain/snooze.ts";
import { isRunning } from "../../../domain/upNext.ts";
import {
  colorForWorkstream,
  workstreamColorStyle,
} from "../../../domain/workstreamColor.ts";
import { Hint } from "../../Hint.tsx";
import { WorkstreamName } from "../../WorkstreamName.tsx";
import { RecapText, useWaitingCountdown } from "../../composer/RecapCard.tsx";
import { setComposerPreset } from "../../composer/preset.ts";
import {
  MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
  menuSurfaceClass,
} from "../../primitives/menu.ts";
import { usePendingQuestion } from "../../question/pending.ts";
import { HoverAction, RowActions } from "../../sidebar/HoverActions.tsx";
import { SnoozeAction } from "../../sidebar/SnoozeAction.tsx";
import { StatusMark } from "../../sidebar/StatusMark.tsx";
import { groupSnoozeRequest } from "../../sidebar/rows.ts";
import { CustomSnoozeDialog } from "../../snooze/CustomSnoozeDialog.tsx";
import {
  CurrentSnoozeMenuItems,
  SnoozeMenuItems,
  menuItemClass,
  plainMenuKit,
  snoozeMenuContentClass,
} from "../../snooze/SnoozeMenuItems.tsx";
import { snoozeThreads } from "../../snooze/actions.ts";
import type { useWorkstreams } from "../../useWorkstreams.ts";
import { useQueueActions, type Receipt } from "../queue/useQueueActions.ts";

type Workstreams = ReturnType<typeof useWorkstreams>;
type Row = OverviewRow<PluginSidebarThread>;
type SnoozeRequest = {
  threads: readonly PluginSidebarThread[];
  subject?: string;
};

const TEXT = "text-[13px] leading-[1.45]";
const BUTTON =
  "cursor-pointer whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[12px] leading-[1.4] text-foreground transition-colors hover:bg-state-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** What an Overview lists: a sidebar group, or Unfiled, which nests nothing. */
type Listed = Group<PluginSidebarThread> &
  Partial<
    Pick<
      WorkstreamNode<PluginSidebarThread>,
      "subgroups" | "topicId" | "hasSection" | "sectionIds"
    >
  >;

/**
 * The group an Overview id names: a group as the sidebar nests them (a
 * workstream, or a header that gathers several), or Unfiled.
 */
export function overviewGroup(
  ws: Pick<Workstreams, "projection" | "topics">,
  id: string,
): Listed | null {
  if (id === UNSORTED_ID || id === "unfiled") return ws.projection.unsorted;
  const find = (
    nodes: readonly WorkstreamNode<PluginSidebarThread>[],
  ): WorkstreamNode<PluginSidebarThread> | null => {
    for (const node of nodes) {
      const found = node.id === id ? node : find(node.subgroups);
      if (found) return found;
    }
    return null;
  };
  return find(nestGroups(ws.projection.all, ws.topics));
}

/** The root rows a group lists, its subgroups' included. */
const rootRows = (group: Listed): ProjectedRow<PluginSidebarThread>[] => [
  ...group.rows.filter((row) => row.depth === 0),
  ...(group.subgroups ?? []).flatMap(rootRows),
];

export function Overview({
  ws,
  id,
  onBack,
}: {
  ws: Workstreams;
  /** A sidebar group's id, or `unsorted` for Unfiled. */
  id: string;
  onBack: () => void;
}) {
  const navigate = useBbNavigate();
  const actions = useQueueActions();
  const { receipt, sent } = actions;
  const [customSnooze, setCustomSnooze] = useState<SnoozeRequest | null>(null);
  const { projection, topics } = ws;
  const group = useMemo(
    () => overviewGroup({ projection, topics }, id),
    [projection, topics, id],
  );
  const roots = useMemo(() => (group ? rootRows(group) : []), [group]);
  const unfiled = group?.id === UNSORTED_ID;
  const { recaps } = ws.server;
  const work = ws.work;

  const rows = useMemo(
    () =>
      sortOverviewRows(
        roots.map((row) =>
          overviewRow(
            row.thread,
            work(row.thread),
            recaps[row.thread.id],
            sent.get(row.thread.id)?.text,
          ),
        ),
      ),
    // `work` reads the analysis and recaps the projection was derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, recaps, ws.server.analysis, sent],
  );
  // An archived row leaves at once; its thread leaves the list when BB reports it.
  const shown = rows.filter(
    (row) =>
      !(receipt?.kind === "archived" && receipt.itemId === row.thread.id),
  );

  // A sent message shows until the turn it started has ended.
  useEffect(() => {
    for (const [threadId, message] of sent) {
      if (receipt?.itemId === threadId && receipt.holding) continue;
      const thread = roots.find((row) => row.thread.id === threadId);
      if (
        thread &&
        !isRunning(thread.thread) &&
        thread.thread.latestAttentionAt > message.at
      )
        actions.finishSent(threadId);
    }
  }, [sent, roots, receipt, actions]);

  const snooze = (request: SnoozeRequest, when: SnoozeWhen) =>
    snoozeThreads(ws.setSnoozes, request.threads, when, {
      previous: ws.snoozeOf,
      subject: request.subject,
    });
  const send = (row: Row, message: string) => {
    const { id: threadId, displayTitle: title } = row.thread;
    const recapId = row.recapId;
    actions.send({ id: threadId, title }, message, () =>
      recapId
        ? ws.rpc.call("recap_send", { threadId, recapId, action: message })
        : ws.rpc.call("threadSend", { threadId, text: message }),
    );
  };
  const archive = (thread: PluginSidebarThread) =>
    actions.apply(
      {
        itemId: thread.id,
        kind: "archived",
        title: thread.displayTitle,
        detail: "",
      },
      () => ws.rpc.call("threadArchive", { threadId: thread.id }),
      () => ws.rpc.call("threadUnarchive", { threadId: thread.id }),
    );
  const newWork =
    group && !unfiled
      ? () => {
          setComposerPreset(
            group.hasSection === false && group.topicId
              ? { topicId: group.topicId }
              : { sectionId: group.id },
            group.name,
          );
          navigate.toCompose({ focusPrompt: true });
        }
      : undefined;

  if (!group)
    return (
      <Frame onBack={onBack}>
        <h1 className="mt-3 text-[15px] font-semibold tracking-tight">
          Overview
        </h1>
        <p className={cn("mt-10", TEXT)}>This workstream no longer exists.</p>
      </Frame>
    );

  const color = unfiled
    ? undefined
    : (workstreamColorStyle(
        colorForWorkstream(group.id, ws.server.catalog, group.topicId),
      ) as CSSProperties);
  return (
    <Frame onBack={onBack}>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0" style={color}>
          <h1 className="m-0 flex text-[15px] tracking-tight">
            <WorkstreamName
              name={group.name}
              accent={!unfiled}
              muted={unfiled}
              className="font-semibold"
            />
          </h1>
          {/* A receipt takes the counts' line while Undo is possible, so the
              table never moves under the pointer that just pressed a button
              in it. */}
          {receipt?.undoable ? (
            <ReceiptLine receipt={receipt} onUndo={actions.undo} />
          ) : shown.length ? (
            <p className={cn("m-0 mt-0.5 text-muted-foreground", TEXT)}>
              {overviewCounts(shown)}
            </p>
          ) : null}
        </div>
        {shown.length ? (
          <div className="flex shrink-0 items-center gap-1">
            {newWork ? (
              <button
                type="button"
                onClick={newWork}
                className={cn(BUTTON, "py-1 text-[13px]")}
              >
                New work
              </button>
            ) : null}
            <HeaderMenu
              ws={ws}
              group={group}
              onSnooze={snooze}
              onCustomSnooze={setCustomSnooze}
            />
          </div>
        ) : null}
      </div>
      {shown.length ? (
        <div
          role="table"
          aria-label={`Threads in ${group.name}`}
          className="ws-overview mt-3"
        >
          <div role="row" className="ws-overview-row ws-overview-head">
            <span role="columnheader" className="ws-overview-status">
              Status
            </span>
            <span role="presentation" className="ws-overview-main">
              <span role="columnheader" className="ws-overview-thread">
                Thread
              </span>
              <span role="columnheader" className="ws-overview-summary">
                Summary
              </span>
            </span>
            <span role="columnheader" className="ws-overview-next">
              Next steps
            </span>
            <span role="columnheader" className="ws-overview-age">
              Updated
            </span>
          </div>
          {shown.map((row) => (
            <OverviewTableRow
              key={row.thread.id}
              row={row}
              now={ws.now}
              ws={ws}
              onOpen={() => navigate.toThread(row.thread.id)}
              onSend={(message) => send(row, message)}
              onArchive={() => archive(row.thread)}
              onSnooze={(when) => snooze({ threads: [row.thread] }, when)}
              onCustomSnooze={() => setCustomSnooze({ threads: [row.thread] })}
            />
          ))}
        </div>
      ) : (
        <div className="mt-10">
          <p className={cn("m-0", TEXT)}>No open threads in this workstream.</p>
          {newWork ? (
            <button
              type="button"
              onClick={newWork}
              className={cn(BUTTON, "mt-3 py-1 text-[13px]")}
            >
              New work
            </button>
          ) : null}
        </div>
      )}
      <CustomSnoozeDialog
        open={customSnooze !== null}
        onClose={() => setCustomSnooze(null)}
        onSubmit={(when) => {
          if (customSnooze) snooze(customSnooze, when);
          setCustomSnooze(null);
        }}
      />
    </Frame>
  );
}

function Frame({
  onBack,
  children,
}: {
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="@container/overview mx-auto box-border w-full max-w-[70rem] px-5 pb-16 pt-6 md:px-8">
        <BackButton onClick={onBack} />
        {children}
      </div>
    </div>
  );
}

/** Back to the queue, on every view of the page that is not the queue. */
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1.5 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name="ChevronLeft" className="size-3.5" />
      Back
    </button>
  );
}

/** The latest send or archive, while Undo can still take it back. */
function ReceiptLine({
  receipt,
  onUndo,
}: {
  receipt: Receipt;
  onUndo: () => void;
}) {
  const title = <span className="text-foreground">{receipt.title}</span>;
  return (
    <div
      role="status"
      className={cn(
        "mt-0.5 flex min-w-0 items-center gap-3 text-muted-foreground",
        TEXT,
      )}
    >
      <span className="min-w-0 truncate">
        {receipt.kind === "sent" ? (
          <>Sending to {title}</>
        ) : (
          <>Archived {title}</>
        )}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 cursor-pointer text-foreground hover:underline"
      >
        Undo
      </button>
    </div>
  );
}

/** Focus and Snooze for the whole workstream, as on its sidebar header. */
function HeaderMenu({
  ws,
  group,
  onSnooze,
  onCustomSnooze,
}: {
  ws: Workstreams;
  group: Listed;
  onSnooze: (request: SnoozeRequest, when: SnoozeWhen) => void;
  onCustomSnooze: (request: SnoozeRequest) => void;
}) {
  const portalScope = usePortalScopeProps();
  const request = groupSnoozeRequest(group);
  const canFocus = group.id !== UNSORTED_ID;
  if (!request && !canFocus) return null;
  const item = cn(menuItemClass, MENU_ITEM_HIGHLIGHT_TEXT_CLASS);
  const toggleFocus = () => {
    const focused = ws.server.order.prioritized;
    const sections = group.sectionIds ?? [group.id];
    const ids = group.prioritized
      ? focused.filter((id) => !sections.includes(id))
      : [...focused, ...sections.filter((id) => !focused.includes(id))];
    ws.reorder({ kind: "prioritized", ids }).catch((cause: unknown) =>
      toast.error(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="More"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-hover data-[state=open]:text-foreground"
      >
        <Icon name="MoreHorizontal" className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...portalScope}
          align="end"
          sideOffset={4}
          className={menuSurfaceClass("48")}
        >
          {canFocus ? (
            <DropdownMenu.Item className={item} onSelect={toggleFocus}>
              {group.prioritized ? "Stop focusing" : "Focus"}
            </DropdownMenu.Item>
          ) : null}
          {request ? (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={item}>
                {request.label}
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  {...portalScope}
                  className={snoozeMenuContentClass}
                >
                  <SnoozeMenuItems
                    now={Date.now()}
                    prefs={ws.snoozePrefs}
                    onSnooze={(when) => onSnooze(request, when)}
                    onCustom={() => onCustomSnooze(request)}
                  />
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The sidebar's mark for a row's status; a read Complete thread carries none. */
function markOf(row: Row): SlotMark | null {
  switch (row.status) {
    case "needs-you":
      return { kind: "needs-you", label: row.label };
    case "review":
      return { kind: "review", label: row.label };
    case "failed":
      return { kind: "error", label: row.label };
    case "working":
      return { kind: "working", label: row.label };
    case "waiting":
      return { kind: "waiting", label: row.label };
    case "complete":
      return row.thread.isUnread ? { kind: "done", label: row.label } : null;
    case "other":
      return null;
  }
}

function OverviewTableRow({
  row,
  now,
  ws,
  onOpen,
  onSend,
  onArchive,
  onSnooze,
  onCustomSnooze,
}: {
  row: Row;
  now: number;
  ws: Workstreams;
  onOpen: () => void;
  onSend: (message: string) => void;
  onArchive: () => void;
  onSnooze: (when: SnoozeWhen) => void;
  onCustomSnooze: () => void;
}) {
  const { thread, next } = row;
  const mark = markOf(row);
  const settled = row.status === "complete" && !thread.isUnread;
  return (
    <div
      role="row"
      data-status={row.status}
      className="ws-overview-row group/row"
    >
      <span
        role="cell"
        className={cn("ws-overview-status", settled && "text-muted-foreground")}
      >
        <span
          className="ws-overview-mark"
          aria-hidden={mark ? undefined : true}
        >
          {/* The word beside the mark names the status. */}
          {mark ? (
            <span aria-hidden className="contents">
              <StatusMark mark={mark} isUnread={thread.isUnread} />
            </span>
          ) : null}
        </span>
        {row.label}
      </span>
      <span role="presentation" className="ws-overview-main">
        <span role="cell" className="ws-overview-thread">
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "cursor-pointer rounded-sm text-left hover:underline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring",
              thread.isUnread && "font-medium",
            )}
          >
            {thread.displayTitle}
          </button>
        </span>
        <span role="cell" className="ws-overview-summary">
          {row.summary ? (
            <RecapText text={row.summary} typeClass={TEXT} />
          ) : null}
        </span>
      </span>
      <span role="cell" className="ws-overview-next">
        {next.prompt || thread.hasPendingInteraction ? (
          <Prompt
            threadId={thread.hasPendingInteraction ? thread.id : null}
            fallback={next.prompt}
          />
        ) : null}
        {next.steps.length ? (
          <ol className="m-0 grid list-none gap-0.5 p-0">
            {next.steps.map((step, index) => (
              <li key={index} className="grid grid-cols-[14px_1fr] gap-1">
                <span className="tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <RecapText text={step.text} typeClass={TEXT} />
                  {step.detail ? (
                    <RecapText
                      text={step.detail}
                      typeClass={TEXT}
                      className="text-muted-foreground"
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {next.waiting ? (
          <Waiting
            recap={next.waiting}
            cancelled={
              ws.server.dismissedRecaps?.includes(next.waiting.id) ?? false
            }
          />
        ) : null}
        {next.actions.length || next.archive ? (
          <span className="flex flex-wrap gap-1.5">
            {next.actions.map((action, index) => {
              const { title, message, description } = nextActionParts(action);
              const button = (
                <button
                  key={index}
                  type="button"
                  className={BUTTON}
                  onClick={(event) =>
                    event.shiftKey ? onOpen() : onSend(message)
                  }
                >
                  {title}
                </button>
              );
              return description || message !== title ? (
                <Hint key={index} label={description ?? message}>
                  {button}
                </Hint>
              ) : (
                button
              );
            })}
            {next.archive ? (
              <button type="button" className={BUTTON} onClick={onArchive}>
                Archive
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      <span role="cell" className="ws-overview-age">
        <RowActions>
          <HoverAction compact label="Archive" onClick={onArchive}>
            <Icon name="Archive" className="size-3.5" />
          </HoverAction>
          <SnoozeAction
            compact
            kind="snooze"
            action="Snooze"
            prefs={ws.snoozePrefs}
            onSnooze={onSnooze}
            menu={
              <CurrentSnoozeMenuItems
                kit={plainMenuKit}
                prefs={ws.snoozePrefs}
                onSnooze={onSnooze}
                onCustom={onCustomSnooze}
              />
            }
          />
        </RowActions>
        <span
          className="ws-overview-updated"
          aria-label={relativeAgeLabel(thread.latestAttentionAt, now)}
        >
          {relativeAge(thread.latestAttentionAt, now)}
        </span>
      </span>
    </div>
  );
}

/**
 * What a thread asks of the user: its pending question card's first
 * question, or the prompt analysis wrote for a turn that ended needing a
 * decision.
 */
function Prompt({
  threadId,
  fallback,
}: {
  /** The thread to read a pending question card from, when it has one. */
  threadId: string | null;
  fallback: string | null;
}) {
  const pending = usePendingQuestion(threadId);
  const text = pending?.payload.questions[0]?.prompt ?? fallback;
  return text ? <RecapText text={text} typeClass={TEXT} /> : null;
}

/** A waiting recap's awaited agents and when the thread next checks on them. */
function Waiting({ recap, cancelled }: { recap: Recap; cancelled: boolean }) {
  const remaining = useWaitingCountdown(recap, cancelled);
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <>
      {(recap.waitingAgents ?? []).map((agent) => (
        <RecapText key={agent.threadId} text={agent.task} typeClass={TEXT} />
      ))}
      <p className={cn("m-0 text-muted-foreground", TEXT)}>
        {cancelled ? (
          "Check cancelled"
        ) : remaining > 0 ? (
          <>
            Next check in <span className="tabular-nums">{clock}</span>
          </>
        ) : (
          "Checking now"
        )}
      </p>
    </>
  );
}
