/**
 * The sidebar page: the production thread list (`WorkstreamsThreadList`) over
 * `size` threads dealt across eight workstreams, with its default settings,
 * so the Up Next and Recent bands, workstream headers, folds, hover actions,
 * and row marks are the ones BB draws. Each workstream cycles through the
 * statuses below. A working or waiting thread shows a spinner, so 64 threads
 * keep sixteen turning.
 *
 * The host is a stub: thread data and plugin state are fixed, every write
 * RPC is refused, and nothing reaches a BB server.
 */
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { WorkstreamsThreadList } from "../../src/app/sidebar/ThreadList.tsx";
import type { StoredAnalysis } from "../../src/domain/analysis.ts";
import { STATE_SLICES } from "../../src/domain/changes.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { DEFAULT_SPINNER } from "../../src/domain/spinner.ts";
// The tests' thread builder fills every field the SDK type requires.
import { section, sidebarThread } from "../../tests/app/fixtures.ts";
import type { PerfPage } from "./main.tsx";

const workstreams = [
  "Studio: App",
  "Studio: Workstreams",
  "Agent: Automations",
  "Agent: Code review",
  "Agent: Research",
  "Tools: CLI",
  "Prompting",
  "Quality",
];
const titles = [
  "Planning keyboard shortcuts",
  "Reviewing sidebar navigation",
  "Improving focus management",
  "Checking responsive layout",
  "Refining workstream grouping",
  "Optimizing test runtime",
  "Profiling sidebar startup",
  "Reducing rendering work",
];
/** What BB reports for a thread, or the state its last turn ended in. */
const statuses: {
  thread?: Parameters<typeof sidebarThread>[1];
  state?: StoredAnalysis["state"];
}[] = [
  {},
  { thread: { status: "active", indicator: "runtime" } },
  { state: "review" },
  { state: "complete" },
  { thread: { indicator: "waiting-for-input", hasPendingInteraction: true } },
  { thread: { status: "error", indicator: "unread-error" } },
  { state: "waiting" },
  { state: "blocked" },
];

export const sidebarPage: PerfPage = (size) => {
  const now = Date.now();
  const analysis: Record<string, StoredAnalysis> = {};
  const threads = Array.from({ length: size }, (_, index) => {
    const workstream = index % workstreams.length;
    const row = Math.floor(index / workstreams.length);
    const { thread, state } = statuses[row % statuses.length]!;
    const id = `thread-${index}`;
    const at = now - index * 90_000;
    if (state)
      analysis[id] = {
        state,
        recap: "",
        ask: null,
        title: null,
        revision: at,
        at,
        model: "fixture",
      };
    return sidebarThread(id, {
      sectionId: `sec_${workstream}`,
      title: `${titles[row % titles.length]} ${index + 1}`,
      latestAttentionAt: at,
      updatedAt: at,
      ...thread,
    });
  });
  const titleOf = new Map(threads.map((thread) => [thread.id, thread.title]));
  const sidebarThreads = {
    status: "ready",
    threads,
    sections: workstreams.map((name, index) => section(`sec_${index}`, name)),
    projects: [],
    experimental_archived: null,
  };
  const state = {
    analysis,
    recaps: {},
    order: { workstreams: [], threads: {}, focused: [] },
    snoozes: {},
    snoozePrefs: {},
    changes: {
      epoch: "fixture",
      revisions: Object.fromEntries(STATE_SLICES.map((slice) => [slice, 1])),
    },
  };
  const answers: Record<string, unknown> = {
    prefs: { prefs: parsePrefs({}) },
    spinner: { spinner: DEFAULT_SPINNER },
    state,
  };
  const sdk = { projects: { list: async () => [] } };
  const rpc = {
    call: async (method: string) => {
      if (method in answers) return answers[method];
      throw new Error(`The sidebar fixture has no RPC method: ${method}`);
    },
  };
  const runtime = (
    globalThis as typeof globalThis & {
      __bbPluginRuntime: { pluginSdkApp: Record<string, unknown> };
    }
  ).__bbPluginRuntime.pluginSdkApp;
  Object.assign(runtime, {
    useSdk: () => sdk,
    useRpc: () => rpc,
    ThreadTitle: ({ threadId }: { threadId: string }) => (
      <span>{titleOf.get(threadId)}</span>
    ),
    experimental_useSidebarThreads: () => sidebarThreads,
    experimental_useSidebarThreadActions: () => ({
      open: () => {},
      archive: () => {},
    }),
    experimental_useSidebarThreadSplit: () => ({ splitProps: {} }),
    useSidebarThreadDraft: () => ({ hasUnsubmittedDraft: false }),
    useSidebarThreadRowStatus: () => null,
    useSidebarThreadShortcut: () => null,
    experimental_useSidebarThreadPullRequest: () => ({ pullRequest: null }),
  });
  const props: PluginThreadListProps = {
    activeThreadId: null,
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: () => {},
    searchQuery: "",
  };
  return () => (
    <main className="perf-sidebar" data-bb-plugin="workstreams">
      <WorkstreamsThreadList {...props} />
    </main>
  );
};
