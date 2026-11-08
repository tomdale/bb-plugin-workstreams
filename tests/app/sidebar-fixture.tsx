import { Profiler, type ProfilerOnRenderCallback } from "react";
import {
  experimental_useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { within } from "@testing-library/react";
import { WorkstreamsThreadList } from "../../src/app/sidebar/ThreadList.tsx";
import type { CategoryGeneration } from "../../src/domain/categories.ts";
import type { LayoutNode } from "../../src/domain/layout.ts";
import type { SnoozePreset } from "../../src/domain/snooze.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

/** Snooze settings listing these presets, the first of them the default. */
export const snoozeSettings = (...presets: SnoozePreset[]) => ({
  presets,
  default: presets[0]!.id,
});
export const threeHours: SnoozePreset = {
  id: "3h",
  label: "",
  rule: { kind: "duration", amount: 3, unit: "hours" },
};
export const thirtyMinutes: SnoozePreset = {
  id: "30m",
  label: "",
  rule: { kind: "duration", amount: 30, unit: "minutes" },
};
export const untilUpdate: SnoozePreset = {
  id: "activity",
  label: "",
  rule: { kind: "activity" },
};
export const weekend: SnoozePreset = {
  id: "weekend",
  label: "This weekend",
  rule: { kind: "time", day: "saturday", hour: 9, minute: 0 },
};

const sections = [
  section("sec_a", "Alpha"),
  section("sec_b", "Beta"),
  section("sec_z", "Zeta"),
];

/** Mounts workstream rows without duplicating them in Up Next and Recent. */
export async function mount(
  threads = [
    sidebarThread("root", { sectionId: "sec_a", title: "Root task" }),
    sidebarThread("kid", {
      parentThreadId: "root",
      sectionId: "sec_b",
      title: "Kid task",
    }),
    sidebarThread("beta", { sectionId: "sec_b", title: "Beta task" }),
    sidebarThread("loose", { title: "Loose task" }),
    sidebarThread("hidden", { isHidden: true, title: "Hidden helper" }),
  ],
  options: {
    activeThreadId?: string | null;
    settings?: Record<string, boolean | string>;
    spinner?: unknown;
    onNavigate?: () => void;
    onRender?: ProfilerOnRenderCallback;
    analysis?: Record<string, unknown>;
    recaps?: Record<string, unknown>;
    lastPopulatedAt?: Record<string, number>;
    assignmentError?: string;
    moveWait?: Promise<void>;
    order?: {
      workstreams: string[];
      threads: Record<string, string[]>;
      prioritized?: string[];
    };
    snoozes?: Record<
      string,
      { until: number | null; attentionAt: number; at: number }
    >;
    snoozePrefs?: Record<string, unknown>;
    sections?: ReturnType<typeof section>[];
    /** The topic tree and section bindings that nest workstreams. */
    catalog?: {
      entities: {
        id: string;
        name: string;
        description: string;
        parentId: string | null;
        aliases: string[];
      }[];
      groups: Record<string, string>;
      colors?: Record<
        string,
        import("../../src/domain/workstreamColor.ts").TopicColor
      >;
      layout?: LayoutNode[];
      categories?: Record<string, CategoryGeneration>;
    };
    archived?: {
      status: "loading" | "ready" | "error";
      hasNextPage: boolean;
      isFetchingNextPage: boolean;
      isFetchNextPageError: boolean;
      fetchNextPage: () => Promise<void>;
    };
  } = {},
) {
  // Stateful like the server, so a refetch after a change never undoes it.
  const snoozes = { ...options.snoozes };
  const order = {
    prioritized: [] as string[],
    ...(options.order ?? { workstreams: [], threads: {} }),
  };
  // The default fixture includes recently emptied sections; expiry tests supply
  // their own history rather than relying on permanent empty rows.
  const lastPopulatedAt =
    options.lastPopulatedAt ??
    Object.fromEntries(
      (options.sections ?? sections).map((section) => [section.id, Date.now()]),
    );
  const list = { component: WorkstreamsThreadList };
  const props = {
    activeThreadId:
      options.activeThreadId === undefined ? "beta" : options.activeThreadId,
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: options.onNavigate ?? (() => undefined),
    searchQuery: "",
  };
  const Component = list.component;
  let publishedThreads: PluginSidebarThread[] = [];
  function LiveThreadList(props: PluginThreadListProps) {
    // Publish a new array only for an immutable data change, not a parent render.
    if (
      publishedThreads.length !== threads.length ||
      publishedThreads.some((thread, index) => thread !== threads[index])
    )
      publishedThreads = [...threads];
    const snapshot = experimental_useSidebarThreads();
    snapshot.threads = publishedThreads;
    return (
      <Profiler
        id="workstreams-sidebar"
        onRender={options.onRender ?? (() => undefined)}
      >
        <Component {...props} />
      </Profiler>
    );
  }
  const slot = renderSlot({ ...list, component: LiveThreadList }, props, {
    sidebarThreads: {
      status: "ready",
      threads,
      sections: options.sections ?? sections,
      projects: [],
      experimental_archived: options.archived ?? null,
    },
    settings: options.settings ?? {},
    sdk: { projects: { list: async () => [] } },
    rpc: {
      prefs: () => ({
        prefs: {
          sidebar: {
            showForYou: options.settings?.showForYou === true,
            showRecent: options.settings?.showRecent === true,
            showSnoozed: options.settings?.showSnoozed !== false,
            showArchived: options.settings?.showArchived !== false,
            recentLimit: 5,
            groupSort: options.settings?.groupSort ?? "alphabetical",
            timestamps: options.settings?.timestamps ?? "show",
            threadCount: options.settings?.threadCount ?? "collapsed",
            waitingCount: options.settings?.waitingCount ?? "collapsed",
          },
          threads: {
            autoTitle: true,
            analysisModel: {
              kind: "gateway",
              model: "google/gemini-3.1-flash-lite",
            },
            showParentLink: false,
          },
          newWork: {
            homeProjectId: "",
            suggestions: true,
            suggestionsModel: {
              kind: "gateway",
              model: "google/gemini-3.1-flash-lite",
            },
          },
          organize: {
            model: { kind: "gateway", model: "openai/gpt-6-sol-fast" },
          },
          advanced: { hostId: "", debug: false },
        },
      }),
      state: () => ({
        ...emptyState(),
        analysis: options.analysis ?? {},
        recaps: options.recaps ?? {},
        lastPopulatedAt,
        order: {
          workstreams: [...order.workstreams],
          threads: { ...order.threads },
          prioritized: [...order.prioritized],
        },
        snoozes: { ...snoozes },
        snoozePrefs: options.snoozePrefs ?? {},
        ...(options.catalog
          ? {
              catalog: {
                ...options.catalog,
                assignments: {},
                revision: 1,
              },
            }
          : {}),
      }),
      moveThread: () => ({ entry: null }),
      taskMove: async (raw: unknown) => {
        await options.moveWait;
        if (options.assignmentError) throw new Error(options.assignmentError);
        const { threadId, entityId } = raw as {
          threadId: string;
          entityId: string;
        };
        const sectionId = Object.entries(options.catalog?.groups ?? {}).find(
          ([, topic]) => topic === entityId,
        )?.[0];
        const leaf = options.catalog?.entities.find(
          (e) => e.parentId === entityId,
        );
        if (!sectionId || !leaf) throw new Error("No destination topic");
        const index = threads.findIndex((t) => t.id === threadId);
        threads[index] = { ...threads[index]!, sectionId };
        return {
          assignment: {
            threadId,
            entityId: leaf.id,
            status: "assigned",
            provenance: "manual",
            label: leaf.name,
            ancestorIds: [leaf.id, entityId],
            evidence: null,
            inheritedFrom: null,
          },
        };
      },
      taskAssign: (raw: unknown) => {
        if (options.assignmentError) throw new Error(options.assignmentError);
        const { threadId, entityId } = raw as {
          threadId: string;
          entityId: string | null;
        };
        const sectionId =
          entityId === null
            ? null
            : Object.entries(options.catalog?.groups ?? {}).find(
                ([, topic]) => topic === entityId,
              )?.[0];
        if (sectionId === undefined)
          throw new Error("Unknown destination topic");
        const index = threads.findIndex((t) => t.id === threadId);
        threads[index] = { ...threads[index]!, sectionId };
        return {
          assignment: {
            threadId,
            entityId,
            status: entityId ? "assigned" : "unresolved",
            provenance: "manual",
            label: entityId,
            ancestorIds: [],
            evidence: null,
            inheritedFrom: null,
          },
        };
      },
      snooze: (raw: unknown) => {
        const { threadIds, until } = raw as {
          threadIds: string[];
          until: number | null;
        };
        for (const threadId of threadIds)
          snoozes[threadId] = { until, attentionAt: 0, at: Date.now() };
        return {
          snoozes: Object.fromEntries(threadIds.map((id) => [id, snoozes[id]])),
        };
      },
      unsnooze: (raw: unknown) => {
        const { threadIds } = raw as { threadIds: string[] };
        const woke = threadIds.filter((id) => id in snoozes);
        for (const threadId of woke) delete snoozes[threadId];
        return { woke };
      },
      spinner: () => ({
        spinner: options.spinner ?? {
          shape: "spokes",
          primary: "subtle",
          secondary: "auto",
        },
      }),
      setPrefs: (raw: unknown) => {
        const { patch } = raw as { patch: { sidebar: { groupSort: string } } };
        return {
          prefs: {
            sidebar: {
              showForYou: options.settings?.showForYou === true,
              showRecent: options.settings?.showRecent === true,
              showSnoozed: true,
              showArchived: true,
              recentLimit: 5,
              groupSort: patch.sidebar.groupSort,
              timestamps: "show",
              threadCount: "collapsed",
              waitingCount: "collapsed",
            },
            threads: {
              autoTitle: true,
              analysisModel: {
                kind: "gateway",
                model: "google/gemini-3.1-flash-lite",
              },
              showParentLink: false,
            },
            newWork: {
              homeProjectId: "",
              suggestions: true,
              suggestionsModel: {
                kind: "gateway",
                model: "google/gemini-3.1-flash-lite",
              },
            },
            organize: {
              model: { kind: "gateway", model: "openai/gpt-6-sol-fast" },
              collapseAt: 3,
            },
            advanced: { hostId: "", debug: false },
          },
        };
      },
      reorder: (raw: unknown) => {
        const input = raw as {
          kind: string;
          groupId?: string;
          ids: string[];
        };
        if (input.kind === "workstreams") order.workstreams = input.ids;
        else if (input.kind === "prioritized") order.prioritized = input.ids;
        else order.threads[input.groupId!] = input.ids;
        return {
          order: {
            workstreams: [...order.workstreams],
            threads: { ...order.threads },
            prioritized: [...order.prioritized],
          },
        };
      },
    },
  });
  const rerender = (activeThreadId = props.activeThreadId) =>
    slot.rerender(
      <LiveThreadList {...props} activeThreadId={activeThreadId} />,
    );
  return {
    ...slot,
    rerenderList: () => rerender(),
    replaceThread: (
      id: string,
      change: (thread: PluginSidebarThread) => PluginSidebarThread,
    ) => {
      const index = threads.findIndex((thread) => thread.id === id);
      threads[index] = change(threads[index]!);
      rerender();
    },
    selectThread: rerender,
  };
}

/**
 * dnd-kit stops every click on the document until 50 ms after a drag ends,
 * so a drag test waits it out rather than swallow the next test's clicks.
 */
export const dragGuardRemoved = () =>
  new Promise((resolve) => setTimeout(resolve, 60));

export const groupRows = (
  slot: Awaited<ReturnType<typeof mount>>,
  name: string,
) =>
  within(slot.getByRole("region", { name }))
    .getAllByRole("link")
    .map((a) => a.getAttribute("aria-label"));

/** Requests both overlay bands for tests that exercise their membership or controls. */
export const mountWithBands: typeof mount = (threads, options = {}) =>
  mount(threads, {
    ...options,
    settings: { showForYou: true, showRecent: true, ...options.settings },
  });
