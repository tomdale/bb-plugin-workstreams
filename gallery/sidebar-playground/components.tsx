import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Row } from "../../src/app/sidebar/Row.tsx";
import { WorkstreamName } from "../../src/app/WorkstreamName.tsx";
import type { WorkView } from "../../src/domain/status.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { installGalleryHost } from "../host.tsx";
import "../base.css";
import "./style.css";

installGalleryHost();
const runtime = (
  globalThis as typeof globalThis & {
    __bbPluginRuntime: { pluginSdkApp: Record<string, unknown> };
  }
).__bbPluginRuntime.pluginSdkApp;
const rpc = {
  call: async (method: string) => {
    if (method === "prefs")
      return { prefs: parsePrefs({ sidebar: { timestamps: "hide" } }) };
    if (method === "spinner")
      return { spinner: { shape: "dots", primary: "text", secondary: "auto" } };
    throw new Error(`Sidebar playground has no RPC method: ${method}`);
  },
};
Object.assign(runtime, {
  useRpc: () => rpc,
  ThreadTitle: ({ threadId }: { threadId: string }) =>
    createElement("span", null, threadId),
  experimental_useSidebarThreadActions: () => ({ open() {}, archive() {} }),
  experimental_useSidebarThreadSplit: () => ({ splitProps: {} }),
  useSidebarThreadDraft: () => ({ hasUnsubmittedDraft: false }),
  useSidebarThreadRowStatus: () => null,
  useSidebarThreadShortcut: () => null,
  experimental_useSidebarThreadPullRequest: () => ({ pullRequest: null }),
});

const roots = new Map<string, Root[]>();
export function clearComponents(panel: string) {
  for (const root of roots.get(panel) ?? []) root.unmount();
  roots.set(panel, []);
}
function mount(panel: string, target: HTMLElement, node: ReactNode) {
  const root = createRoot(target);
  let panelRoots = roots.get(panel);
  if (!panelRoots) {
    panelRoots = [];
    roots.set(panel, panelRoots);
  }
  panelRoots.push(root);
  flushSync(() => root.render(node));
}

export function mountThread(
  panel: string,
  target: HTMLElement,
  options: {
    title: string;
    kind: string;
    depth: number;
    categorized: boolean;
    expanded?: boolean;
    toggle?: () => void;
  },
) {
  const indicator =
    (
      {
        working: "runtime",
        unread: "unread-success",
        waiting: "waiting-for-input",
        error: "unread-error",
        draft: "draft",
      } as Record<string, string>
    )[options.kind] ?? "none";
  const state = (
    {
      review: "review",
      complete: "done",
      decision: "needs_decision",
      blocked: "blocked",
    } as const
  )[options.kind as "review" | "complete" | "decision" | "blocked"];
  const thread = {
    id: options.title,
    title: options.title,
    displayTitle: options.title,
    href: "#",
    indicator,
    indicatorLabel: null,
    hasPendingInteraction: false,
    isUnread: false,
    isPinned: false,
    latestAttentionAt: 0,
  } as PluginSidebarThread;
  const work: WorkView | undefined = state
    ? {
        kind: "current",
        reported: options.kind === "complete",
        analysis: {
          state,
          recap: "",
          needsYou: null,
          goal: null,
          revision: 0,
          at: 0,
          model: "fixture",
        },
      }
    : undefined;
  mount(
    panel,
    target,
    createElement(Row, {
      thread,
      work,
      depth: options.depth,
      categorized: options.categorized,
      inGroup: true,
      active: false,
      now: 0,
      showArchive: false,
      showPin: false,
      onNavigate() {},
      disclosure: options.toggle
        ? { expanded: options.expanded ?? true, toggle: options.toggle }
        : undefined,
    }),
  );
}

export function mountWorkstreamName(
  panel: string,
  target: HTMLElement,
  name: string,
) {
  mount(panel, target, createElement(WorkstreamName, { name, accent: true }));
}
