/**
 * The Workstreams page is the queue: one thing at a time that needs the
 * user (see `Queue`). Everything else waits behind the dim ⋯ in the corner:
 * Activity (the journal), Topics (the organizer's health, its suggestions,
 * and the topic tree), the Gallery (a specimen of every reply-block part),
 * and, with the debug UI on, the model calls. Each opens as a full view.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MENU_ITEM_HIGHLIGHT_TEXT_CLASS } from "../primitives/menu.ts";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { useWorkstreams } from "../useWorkstreams.ts";
import { useDebugMode } from "../debug/debug.ts";
import {
  menuItemClass,
  snoozeMenuContentClass,
} from "../snooze/SnoozeMenuItems.tsx";
import { Activity } from "./Activity.tsx";
import { Gallery } from "./Gallery.tsx";
import { TopicsTab } from "./topics/TopicsTab.tsx";
import { Queue } from "./queue/Queue.tsx";
import { BackButton, Overview } from "./overview/Overview.tsx";
import { setOpenOverview } from "./overview/route.ts";

type View =
  | { kind: "queue" }
  | { kind: "topics" }
  | { kind: "gallery" }
  | { kind: "overview"; id: string }
  | { kind: "activity"; focus: string | null; modelCalls: boolean };

/**
 * `subPath` deep links open a view: `activity[/<entry>]`, `debug` (model
 * calls), `gallery`, `topics`, and `overview/<group>` (a sidebar group's id,
 * or `unsorted` for Unfiled). `organization`, `catalog`, and `map` name views
 * that are now part of Topics and still open it.
 */
function viewOf(subPath: string): View {
  const [head, ...rest] = subPath.split("/");
  if (
    head === "topics" ||
    head === "catalog" ||
    head === "organization" ||
    head === "map"
  )
    return { kind: "topics" };
  if (head === "activity")
    return {
      kind: "activity",
      focus: rest.join("/") || null,
      modelCalls: false,
    };
  if (head === "gallery") return { kind: "gallery" };
  if (head === "overview" && rest.length)
    return { kind: "overview", id: decodeURIComponent(rest.join("/")) };
  if (head === "debug")
    return { kind: "activity", focus: null, modelCalls: true };
  return { kind: "queue" };
}

export function WorkstreamsPage({
  subPath = "",
}: Partial<PluginNavPanelProps>) {
  const ws = useWorkstreams();
  const [view, setView] = useState<View>(() => viewOf(subPath));
  useLayoutEffect(() => setView(viewOf(subPath)), [subPath]);
  const { projection } = ws;
  // The sidebar marks the workstream whose Overview is open.
  const overviewId = view.kind === "overview" ? view.id : null;
  useEffect(() => {
    setOpenOverview(overviewId);
    return () => setOpenOverview(null);
  }, [overviewId]);
  const workstreamOf = useCallback(
    (id: string) => projection.rowOf.get(id)?.workstreamId ?? null,
    [projection],
  );

  if (view.kind === "queue")
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <Queue ws={ws} onTopics={() => setView({ kind: "topics" })} />
        <PageMenu onOpen={setView} />
      </div>
    );
  if (view.kind === "overview")
    return (
      <Overview
        ws={ws}
        id={view.id}
        onBack={() => setView({ kind: "queue" })}
      />
    );
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-5 pb-16 pt-6 md:px-8">
        <BackButton onClick={() => setView({ kind: "queue" })} />
        <h1 className="mt-3 text-[15px] font-semibold tracking-tight">
          {VIEW_TITLES[view.kind]}
        </h1>
        {view.kind === "topics" ? (
          <TopicsTab ws={ws} query="" />
        ) : view.kind === "gallery" ? (
          <Gallery />
        ) : (
          <Activity
            rpc={ws.rpc}
            focus={view.focus}
            modelCalls={view.modelCalls}
            sections={ws.sections}
            workstreamOf={workstreamOf}
          />
        )}
      </div>
    </div>
  );
}

const VIEW_TITLES: Record<View["kind"], string> = {
  queue: "",
  topics: "Topics",
  gallery: "Gallery",
  overview: "Overview",
  activity: "Activity",
};

/** The dim ⋯ in the corner, for everything that isn't the queue. */
function PageMenu({ onOpen }: { onOpen: (view: View) => void }) {
  const portalScope = usePortalScopeProps();
  const debug = useDebugMode("activity");
  const item = cn(menuItemClass, MENU_ITEM_HIGHLIGHT_TEXT_CLASS);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="More"
        className="absolute right-5 top-4 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-hover data-[state=open]:text-foreground"
      >
        <Icon name="MoreHorizontal" className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...portalScope}
          align="end"
          sideOffset={4}
          className={snoozeMenuContentClass}
        >
          <DropdownMenu.Item
            className={item}
            onSelect={() =>
              onOpen({ kind: "activity", focus: null, modelCalls: false })
            }
          >
            Activity
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            onSelect={() => onOpen({ kind: "topics" })}
          >
            Topics
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            onSelect={() => onOpen({ kind: "gallery" })}
          >
            Gallery
          </DropdownMenu.Item>
          {debug ? (
            <DropdownMenu.Item
              className={item}
              onSelect={() =>
                onOpen({ kind: "activity", focus: null, modelCalls: true })
              }
            >
              Model calls
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
