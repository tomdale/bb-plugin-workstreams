import { useMemo, useState, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  experimental_useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import { useDebugMode } from "../debug/debug.ts";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DISABLED_CLASS,
  MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
  menuSurfaceClass,
} from "../primitives/menu.ts";
import type {
  SnoozePrefs,
  SnoozeWhen,
  ThreadSnooze,
} from "../../domain/snooze.ts";
import type { Topic } from "../../domain/topics.ts";
import { topicIndex } from "../../domain/topic-path.ts";
import {
  useSharedServerState,
  useSharedServerActions,
  useSharedServerStateSelector,
  useThreadRecordSelector,
} from "../serverState.ts";
import { useCloseOnFoldLeave } from "./Fold.tsx";
import { isAutomaticTopic } from "../task/TaskIdentity.tsx";
import { SnoozeMenuItems, type MenuKit } from "../snooze/SnoozeMenuItems.tsx";

const NO_TOPICS: readonly Topic[] = [];

export type RowMenuHandlers = {
  rename: (thread: PluginSidebarThread) => void;
  openParent: (thread: PluginSidebarThread) => void;
  /** Snoozes until a time, a wake event, or whichever comes first. */
  snooze: (thread: PluginSidebarThread, when: SnoozeWhen) => void;
  /** Opens the Custom… snooze dialog. */
  customSnooze: (thread: PluginSidebarThread) => void;
  wake: (thread: PluginSidebarThread) => void;
  /**
   * Puts a failed RPC where it can be read. A menu closes on the choice it
   * makes, so the sidebar's own notice is the place to show one.
   */
  reportError: (cause: unknown) => void;
  /** The debug UI: opens the thread's model calls. */
  inspect: (thread: PluginSidebarThread) => void;
  assignIdentity?: (thread: PluginSidebarThread, entityId: string) => void;
  reclassifyIdentity?: (thread: PluginSidebarThread) => void;
};

/**
 * A thread row's right-click menu, which a touch screen opens with a long
 * press. The SDK ships no menu component; every item is a sidebar thread
 * action or a Workstreams RPC, and Delete goes through BB's own
 * confirmation.
 */
export function RowMenu({
  thread,
  handlers,
  snooze,
  snoozePrefs,
  showArchive = true,
  children,
}: {
  thread: PluginSidebarThread;
  handlers: RowMenuHandlers;
  /** The thread's snooze, while it holds. */
  snooze?: ThreadSnooze;
  /** The snooze presets to offer (the Snooze settings). */
  snoozePrefs: SnoozePrefs;
  showArchive?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useCloseOnFoldLeave(open, () => setOpen(false));
  return (
    <ContextMenu.Root open={open} onOpenChange={setOpen}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      {open ? (
        <RowMenuContent
          thread={thread}
          handlers={handlers}
          snooze={snooze}
          snoozePrefs={snoozePrefs}
          showArchive={showArchive}
        />
      ) : null}
    </ContextMenu.Root>
  );
}

/** Catalog and action hooks run only for the one menu Radix has opened. */
function RowMenuContent({
  thread,
  handlers,
  snooze,
  snoozePrefs,
  showArchive,
}: {
  thread: PluginSidebarThread;
  handlers: RowMenuHandlers;
  snooze?: ThreadSnooze;
  snoozePrefs: SnoozePrefs;
  showArchive: boolean;
}) {
  const actions = experimental_useSidebarThreadActions();
  const portalScope = usePortalScopeProps();
  const debug = useDebugMode("inspect");
  const { rpc, refresh } = useSharedServerActions();
  const entities = useSharedServerStateSelector(
    (server) => server.catalog?.entities ?? NO_TOPICS,
  );
  const index = useMemo(() => topicIndex(entities), [entities]);
  // Undefined while an archived thread's topic is read; the submenu waits.
  const record = useThreadRecordSelector(
    thread.id,
    (record) => record.assignment,
  );
  const assignment = record ?? null;

  // Topic submenu: the same choices as the composer's topic picker.
  const currentEntity = assignment?.entityId
    ? (index.byId.get(assignment.entityId) ?? null)
    : null;
  const displayTopicPath = (id: string) => index.path(id).replace(/: /g, " › ");
  const currentLabel = currentEntity
    ? displayTopicPath(currentEntity.id)
    : "No topic";
  const isFork = Boolean(assignment?.inheritedFrom);
  const automatic = isAutomaticTopic(assignment);
  const assignTopic = (entityId: string) => {
    if (handlers.assignIdentity) handlers.assignIdentity(thread, entityId);
    else
      void rpc
        .call("taskAssign", { threadId: thread.id, entityId })
        .then(() => refresh())
        .catch(handlers.reportError);
  };
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content
        {...portalScope}
        aria-label="Thread actions"
        className={menuSurfaceClass("48")}
      >
        <Item onSelect={() => actions.open(thread.id, { split: true })}>
          Open in split
        </Item>
        {thread.parentThreadId ? (
          <Item onSelect={() => handlers.openParent(thread)}>Open parent</Item>
        ) : null}
        <Separator />
        <ContextMenu.Sub>
          <SubTrigger disabled={record === undefined}>Topic</SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              {...portalScope}
              className={menuSurfaceClass("56", "max-h-96 overflow-y-auto")}
            >
              {isFork ? (
                <Item disabled onSelect={() => undefined}>
                  <span className="flex-1 truncate">
                    {currentLabel} (same as parent thread)
                  </span>
                </Item>
              ) : (
                <>
                  <Item
                    disabled={automatic}
                    onSelect={() => {
                      if (handlers.reclassifyIdentity) {
                        handlers.reclassifyIdentity(thread);
                      } else {
                        void rpc
                          .call("taskReclassify", { threadId: thread.id })
                          .then(() => refresh())
                          .catch(handlers.reportError);
                      }
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>Automatic</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {automatic ? currentLabel : "Let Workstreams choose"}
                      </span>
                    </span>
                    {automatic ? (
                      <Icon name="Check" className="ml-2 size-3.5" />
                    ) : null}
                  </Item>
                  <Separator />
                  {index.leafTopics.length ? (
                    index.leafTopics.map(({ entity }) => {
                      const isChosen =
                        !automatic && entity.id === currentEntity?.id;
                      return (
                        <Item
                          key={entity.id}
                          disabled={isChosen}
                          onSelect={() => assignTopic(entity.id)}
                        >
                          <span className="flex-1 truncate">
                            {displayTopicPath(entity.id)}
                          </span>
                          {isChosen ? (
                            <Icon name="Check" className="ml-2 size-3.5" />
                          ) : null}
                        </Item>
                      );
                    })
                  ) : (
                    // A topic tree always has a leaf, so this is an empty catalog.
                    <Item disabled onSelect={() => undefined}>
                      No topics yet
                    </Item>
                  )}
                </>
              )}
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
        <Item onSelect={() => handlers.rename(thread)}>Rename…</Item>
        <Item
          onSelect={() => void actions.setPinned(thread.id, !thread.isPinned)}
        >
          {thread.isPinned ? "Unpin" : "Pin"}
        </Item>
        <Item onSelect={() => void actions.setRead(thread.id, thread.isUnread)}>
          {thread.isUnread ? "Mark read" : "Mark unread"}
        </Item>
        {debug ? (
          <>
            <Separator />
            <Item onSelect={() => handlers.inspect(thread)}>
              Inspect model calls…
            </Item>
          </>
        ) : null}
        <Separator />
        {snooze ? (
          <Item onSelect={() => handlers.wake(thread)}>Wake now</Item>
        ) : null}
        <ContextMenu.Sub>
          <SubTrigger>{snooze ? "Change snooze" : "Snooze"}</SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              {...portalScope}
              className={menuSurfaceClass("56")}
            >
              <SnoozeMenuItems
                kit={contextMenuKit}
                now={Date.now()}
                prefs={snoozePrefs}
                snooze={snooze}
                onSnooze={(when) => handlers.snooze(thread, when)}
                onCustom={() => handlers.customSnooze(thread)}
              />
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
        {showArchive ? (
          <Item onSelect={() => actions.archive(thread.id)}>Archive</Item>
        ) : null}
        <Item destructive onSelect={() => actions.requestDelete(thread.id)}>
          Delete…
        </Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

/**
 * A workstream header's right-click menu, which a touch screen opens with a
 * long press, as a thread row's `RowMenu`: the header's hover actions, in
 * their order (see `RowActions`), for when there is no pointer to reveal
 * them. Without any action to offer, the header is drawn without a menu.
 */
export function HeaderMenu({
  onOverview,
  focus,
  onNewWork,
  snooze,
  children,
}: {
  /** Opens the workstream's Overview. */
  onOverview?: () => void;
  /** Focus on the workstream, or stop. */
  focus?: { focused: boolean; toggle: () => void };
  onNewWork?: () => void;
  /** Snoozes every thread the header lists (see `groupRoots`). */
  snooze?: {
    /** Names the batch: "Snooze 3 threads". */
    label: string;
    snooze: (when: SnoozeWhen) => void;
    custom: () => void;
  };
  children: ReactNode;
}) {
  const portalScope = usePortalScopeProps();
  const { server } = useSharedServerState();
  if (!onOverview && !focus && !onNewWork && !snooze) return children;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          {...portalScope}
          aria-label="Workstream actions"
          className={menuSurfaceClass("48")}
        >
          {onOverview ? <Item onSelect={onOverview}>Overview</Item> : null}
          {focus ? (
            <Item onSelect={focus.toggle}>
              {focus.focused ? "Stop focusing" : "Focus"}
            </Item>
          ) : null}
          {onNewWork ? <Item onSelect={onNewWork}>New work</Item> : null}
          {snooze && (onOverview || focus || onNewWork) ? <Separator /> : null}
          {snooze ? (
            <ContextMenu.Sub>
              <SubTrigger>{snooze.label}</SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent
                  {...portalScope}
                  className={menuSurfaceClass("56")}
                >
                  <SnoozeMenuItems
                    kit={contextMenuKit}
                    now={Date.now()}
                    prefs={server.snoozePrefs}
                    onSnooze={snooze.snooze}
                    onCustom={snooze.custom}
                  />
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const itemClass = cn(
  MENU_ITEM_CLASS,
  MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
  MENU_ITEM_DISABLED_CLASS,
);

function Item({
  children,
  destructive = false,
  disabled = false,
  onSelect,
}: {
  children: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(itemClass, destructive && "text-destructive")}
    >
      {children}
    </ContextMenu.Item>
  );
}

/** An item that opens a submenu, marked with a trailing chevron. */
function SubTrigger({
  children,
  disabled,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.SubTrigger
      disabled={disabled}
      className={cn(
        itemClass,
        "gap-2 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      )}
    >
      <span className="flex-1">{children}</span>
      <Icon
        name="ChevronRight"
        className="size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
    </ContextMenu.SubTrigger>
  );
}

function Separator() {
  return <ContextMenu.Separator className="my-1 h-px bg-border" />;
}

/** Snooze menu items inside this right-click menu (see `SnoozeMenuItems`). */
const contextMenuKit: MenuKit = {
  Item: ({ onSelect, children }) => <Item onSelect={onSelect}>{children}</Item>,
  Label: ({ children }) => (
    <ContextMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
      {children}
    </ContextMenu.Label>
  ),
  Separator,
};
