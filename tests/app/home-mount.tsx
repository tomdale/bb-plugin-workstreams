// Mounts the phone Home section the way BB does: a `homepageSection` slot
// inside BB's compact home scroll viewport, with a mocked thread list and
// plugin state.
import { Profiler, type ProfilerOnRenderCallback } from "react";
import {
  experimental_useSidebarThreads,
  type PluginSidebarSection,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { HomeSection } from "../../src/app/home/HomeSection.tsx";
import type { TopicState } from "../../src/domain/topics.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

export { section, sidebarThread };

export const homeSections = [
  section("sec_a", "Alpha"),
  section("sec_b", "Beta"),
  section("sec_z", "Zeta"),
];

export type SidebarPrefs = Partial<{
  showForYou: boolean;
  showRecent: boolean;
  showSnoozed: boolean;
  showArchived: boolean;
  phoneHome: boolean;
  groupSort: "alphabetical" | "activity" | "manual";
  timestamps: "show" | "hover" | "hide";
  threadCount: "always" | "collapsed" | "never";
  waitingCount: "always" | "collapsed" | "never";
}>;

export type HomeOptions = {
  threads?: PluginSidebarThread[];
  sections?: PluginSidebarSection[];
  status?: "loading" | "ready" | "error";
  prefs?: SidebarPrefs;
  analysis?: Record<string, unknown>;
  catalog?: TopicState;
  recaps?: Record<string, unknown>;
  order?: { workstreams?: string[]; prioritized?: string[] };
  snoozes?: Record<
    string,
    { until: number | null; attentionAt: number; at: number }
  >;
  /** Where the slot is mounted; BB's compact home viewport by default. */
  placement?: "compact" | "bare";
  /** Threads with an unsent draft. */
  drafts?: string[];
  /** Holds an answer back until the promise settles, as a slow server does. */
  gates?: { prefs?: Promise<unknown>; state?: Promise<unknown> };
  onRender?: ProfilerOnRenderCallback;
};

/** Everything but the `sidebar` group falls back to the plugin's defaults. */
function prefsResponse(prefs: SidebarPrefs = {}) {
  return {
    prefs: {
      sidebar: {
        showForYou: true,
        showRecent: true,
        showSnoozed: true,
        showArchived: true,
        phoneHome: true,
        recentLimit: 5,
        groupSort: "alphabetical",
        timestamps: "show",
        threadCount: "collapsed",
        waitingCount: "collapsed",
        ...prefs,
      },
    },
  };
}

export async function mountHome(options: HomeOptions = {}) {
  const Section = HomeSection;
  const compact = options.placement !== "bare";
  const threads = options.threads ?? [];
  let publishedThreads: PluginSidebarThread[] = [];
  function Mounted() {
    if (
      publishedThreads.length !== threads.length ||
      publishedThreads.some((thread, index) => thread !== threads[index])
    )
      publishedThreads = [...threads];
    const snapshot = experimental_useSidebarThreads();
    snapshot.threads = publishedThreads;
    return (
      <Profiler
        id="workstreams-home"
        onRender={options.onRender ?? (() => undefined)}
      >
        {compact ? (
          <div data-testid="root-compose-compact-scroll-viewport">
            <div data-testid="plugin-homepage-sections">
              <section>
                <h2>Workstreams</h2>
                <div data-bb-plugin-root="">
                  <Section projectId={null} />
                </div>
              </section>
            </div>
          </div>
        ) : (
          <Section projectId={null} />
        )}
      </Profiler>
    );
  }
  const slot = renderSlot(
    { component: Mounted },
    {},
    {
      sidebarThreads: {
        status: options.status ?? "ready",
        threads,
        sections: options.sections ?? homeSections,
        projects: [],
      },
      sidebarDraftThreadIds: options.drafts ?? [],
      rpc: {
        prefs: async () => {
          await options.gates?.prefs;
          return prefsResponse(options.prefs);
        },
        state: async () => {
          await options.gates?.state;
          return {
            ...emptyState(),
            ...(options.catalog ? { catalog: options.catalog } : {}),
            analysis: options.analysis ?? {},
            recaps: options.recaps ?? {},
            order: {
              workstreams: options.order?.workstreams ?? [],
              threads: {},
              prioritized: options.order?.prioritized ?? [],
            },
            snoozes: options.snoozes ?? {},
            snoozePrefs: {},
          };
        },
      },
    },
  );
  return {
    ...slot,
    rerenderHome: () => slot.rerender(<Mounted />),
    replaceThread: (
      id: string,
      change: (thread: PluginSidebarThread) => PluginSidebarThread,
    ) => {
      const index = threads.findIndex((thread) => thread.id === id);
      threads[index] = change(threads[index]!);
      slot.rerender(<Mounted />);
    },
  };
}

/** A current analysis result that asks the user to decide. */
export function decisionFor(revision: number, ask = "Decide?") {
  return {
    recap: "Asked.",
    state: "needs_decision",
    needsYou: ask,
    subject: null,
    drift: null,
    driftSectionId: null,
    revision,
    at: Date.now(),
    model: "m",
  };
}

/** A stored agent recap of the given state. */
export function recapOf(state: "complete" | "review" | "waiting") {
  return {
    id: `r-${state}`,
    turnId: "turn",
    at: Date.now(),
    state,
    goal: "Shipping",
    latest: [`Reported ${state}`],
    review: state === "review" ? ["Try it"] : [],
    links: [],
  };
}
