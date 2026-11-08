import {
  createContext,
  createElement,
  Fragment,
  useContext,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Row } from "../../src/app/sidebar/Row.tsx";
import { WorkstreamName } from "../../src/app/WorkstreamName.tsx";
import type { WorkView } from "../../src/domain/status.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { DEFAULT_SPINNER } from "../../src/domain/spinner.ts";
import {
  DEFAULT_SNOOZE_PREFS,
  defaultPreset,
  describeWake,
  presetWhen,
} from "../../src/domain/snooze.ts";
import {
  SnoozeMenuItems,
  plainMenuKit,
} from "../../src/app/snooze/SnoozeMenuItems.tsx";
import { installGalleryHost } from "../host.tsx";
import "../base.css";
import "./style.css";

installGalleryHost();
const runtime = (
  globalThis as typeof globalThis & {
    __bbPluginRuntime: { pluginSdkApp: Record<string, unknown> };
  }
).__bbPluginRuntime.pluginSdkApp;
const LegacyPreview = createContext(false);
const sdk = {};
const legacySdk = {};
const rpc = (legacy: boolean) => ({
  call: async (method: string) => {
    if (method === "prefs")
      return {
        prefs: parsePrefs(legacy ? { sidebar: { timestamps: "hide" } } : {}),
      };
    if (method === "spinner")
      return {
        spinner: legacy
          ? { shape: "dots", primary: "text", secondary: "auto" }
          : DEFAULT_SPINNER,
      };
    throw new Error(`Sidebar playground has no RPC method: ${method}`);
  },
});
const currentRpc = rpc(false);
const legacyRpc = rpc(true);
function previewAction(action: string, title: string) {
  const message = document.getElementById("previewAction");
  if (message) {
    message.hidden = false;
    message.textContent = `Preview only: ${action} ${title}`;
  }
}
Object.assign(runtime, {
  useSdk: () => (useContext(LegacyPreview) ? legacySdk : sdk),
  useRpc: () => (useContext(LegacyPreview) ? legacyRpc : currentRpc),
  ThreadTitle: ({ threadId }: { threadId: string }) =>
    createElement("span", null, threadId),
  experimental_useSidebarThreadActions: () => ({
    open: (title: string) => previewAction("open", title),
    archive: (title: string) => previewAction("archive", title),
  }),
  experimental_useSidebarThreadSplit: () => ({ splitProps: {} }),
  useSidebarThreadDraft: () => ({ hasUnsubmittedDraft: false }),
  useSidebarThreadRowStatus: () => null,
  useSidebarThreadShortcut: () => null,
  experimental_useSidebarThreadPullRequest: () => ({ pullRequest: null }),
});

const roots = new Map<string, Root>();
const immediateRoots = new Map<string, Root[]>();
const batching = new Set<string>();
const portals = new Map<string, ReactNode[]>();
const afterMount = new Map<string, Array<() => void>>();
const rootContainers = new Map<string, HTMLElement>();
export function clearComponents(panel: string) {
  batching.delete(panel);
  portals.delete(panel);
  afterMount.delete(panel);
  const root = roots.get(panel);
  if (root) {
    flushSync(() => root.unmount());
    roots.delete(panel);
    rootContainers.delete(panel);
  }
  for (const immediateRoot of immediateRoots.get(panel) ?? [])
    flushSync(() => immediateRoot.unmount());
  immediateRoots.delete(panel);
}
export function beginComponents(panel: string) {
  batching.add(panel);
  portals.set(panel, []);
  afterMount.set(panel, []);
}
function mount(
  panel: string,
  target: HTMLElement,
  node: ReactNode,
  legacy = false,
) {
  const element = createElement(
    LegacyPreview.Provider,
    { value: legacy },
    node,
  );
  if (!batching.has(panel)) {
    const root = createRoot(target);
    const panelRoots = immediateRoots.get(panel) ?? [];
    panelRoots.push(root);
    immediateRoots.set(panel, panelRoots);
    flushSync(() => root.render(element));
    return;
  }
  const panelPortals = portals.get(panel) ?? [];
  panelPortals.push(createPortal(element, target, String(panelPortals.length)));
  portals.set(panel, panelPortals);
}
export function afterComponentsMounted(panel: string, callback: () => void) {
  const callbacks = afterMount.get(panel) ?? [];
  callbacks.push(callback);
  afterMount.set(panel, callbacks);
}
export function flushComponents(panel: string) {
  let root = roots.get(panel);
  if (!root) {
    let container = rootContainers.get(panel);
    if (!container) {
      container = document.createElement("div");
      rootContainers.set(panel, container);
    }
    root = createRoot(container);
    roots.set(panel, root);
  }
  const panelPortals = portals.get(panel) ?? [];
  flushSync(() => root?.render(createElement(Fragment, null, ...panelPortals)));
  portals.set(panel, []);
  const callbacks = afterMount.get(panel) ?? [];
  afterMount.set(panel, []);
  batching.delete(panel);
  for (const callback of callbacks) callback();
}

const hot = (
  import.meta as ImportMeta & { hot?: { dispose(fn: () => void): void } }
).hot;
if (hot) {
  hot.dispose(() => {
    for (const root of roots.values()) flushSync(() => root.unmount());
    for (const panelRoots of immediateRoots.values())
      for (const root of panelRoots) flushSync(() => root.unmount());
    roots.clear();
    immediateRoots.clear();
    portals.clear();
    afterMount.clear();
    rootContainers.clear();
    batching.clear();
  });
}

export function mountThread(
  panel: string,
  target: HTMLElement,
  options: {
    title: string;
    kind: string;
    depth: number;
    categorized: boolean;
    legacy?: boolean;
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
    isUnread: options.kind === "unread" && !options.legacy,
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
  const now = Date.now();
  const wake = presetWhen(defaultPreset(DEFAULT_SNOOZE_PREFS), now);
  const snoozeAction = options.legacy
    ? undefined
    : {
        kind: "snooze" as const,
        title: `Snooze ${describeWake(wake.until, now, wake.events)}`,
        run: () => previewAction("snooze", options.title),
        menu: createElement(SnoozeMenuItems, {
          now,
          prefs: DEFAULT_SNOOZE_PREFS,
          kit: plainMenuKit,
          onSnooze: () => previewAction("snooze", options.title),
          onCustom: () => previewAction("custom snooze", options.title),
        }),
      };
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
      showArchive: !options.legacy,
      snoozeAction,
      onNavigate() {},
      disclosure: options.toggle
        ? { expanded: options.expanded ?? true, toggle: options.toggle }
        : undefined,
    }),
    options.legacy,
  );
}

export function mountWorkstreamName(
  panel: string,
  target: HTMLElement,
  name: string,
) {
  mount(panel, target, createElement(WorkstreamName, { name, accent: true }));
}
