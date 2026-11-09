import {
  Profiler,
  useState,
  type CSSProperties,
  type ProfilerOnRenderCallback,
} from "react";
import { createRoot, flushSync } from "react-dom/profiling";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon.tsx";
import { installGalleryHost } from "../host.tsx";
import { Row } from "../../src/app/sidebar/Row.tsx";
import { FocusIcon } from "../../src/app/sidebar/FocusIcon.tsx";
import { rowActionClass } from "../../src/app/sidebar/HoverActions.tsx";
import { cn } from "../../lib/utils.ts";
import {
  HoverAction,
  RowActions,
} from "../../src/app/sidebar/HoverActions.tsx";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { WorkstreamName } from "../../src/app/WorkstreamName.tsx";
import type { WorkView } from "../../src/domain/status.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { DEFAULT_SPINNER } from "../../src/domain/spinner.ts";
import "../base.css";
import "./style.css";

installGalleryHost();
const runtime = (
  globalThis as typeof globalThis & {
    __bbPluginRuntime: { pluginSdkApp: Record<string, unknown> };
  }
).__bbPluginRuntime.pluginSdkApp;
const sdk = {};
const rpc = {
  call: async (method: string) => {
    if (method === "prefs") return { prefs: parsePrefs({}) };
    if (method === "spinner") return { spinner: DEFAULT_SPINNER };
    throw new Error(`Sidebar profile has no RPC method: ${method}`);
  },
};
Object.assign(runtime, {
  useSdk: () => sdk,
  useRpc: () => rpc,
  ThreadTitle: ({ threadId }: { threadId: string }) => <span>{threadId}</span>,
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

type Commit = {
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};
type ProfileWindow = Window & {
  __sidebarProfile: {
    ready: boolean;
    commits: Commit[];
    reset: () => void;
    rerender: () => void;
  };
};
const profileWindow = window as unknown as ProfileWindow;
profileWindow.__sidebarProfile = {
  ready: false,
  commits: [],
  reset: () => {
    profileWindow.__sidebarProfile.commits = [];
  },
  rerender: () => {},
};

const groupNames = [
  "Studio: App",
  "Studio: Workstreams",
  "Agent: Automations",
  "Agent: Code review",
  "Agent: Research",
  "Tools: CLI",
  "Prompting",
  "Quality",
];
const accents = [
  "blue",
  "blue",
  "orange",
  "orange",
  "orange",
  "teal",
  "green",
  "blue",
];
const kinds = [
  "none",
  "working",
  "review",
  "complete",
  "waiting",
  "error",
  "draft",
  "blocked",
] as const;
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

function fixture(groupIndex: number, rowIndex: number) {
  const kind = kinds[rowIndex]!;
  const id = `thread-${groupIndex}-${rowIndex}`;
  const indicator =
    (
      {
        working: "runtime",
        waiting: "waiting-for-input",
        error: "unread-error",
        draft: "draft",
      } as Record<string, string>
    )[kind] ?? "none";
  const state = (
    {
      review: "review",
      complete: "done",
      blocked: "blocked",
    } as const
  )[kind as "review" | "complete" | "blocked"];
  const thread = {
    id,
    title: `${groupNames[groupIndex]} ${titles[rowIndex]}`,
    displayTitle: `${titles[rowIndex]} ${groupIndex + 1}`,
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
        reported: kind === "complete",
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
  return { thread, work };
}
const rows = groupNames.map((_, groupIndex) =>
  titles.map((__, rowIndex) => fixture(groupIndex, rowIndex)),
);

function ProfileWorkstream({ groupIndex }: { groupIndex: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const name = groupNames[groupIndex]!;
  const accent = accents[groupIndex]!;
  return (
    <section
      aria-label={name}
      data-profile-workstream={groupIndex}
      className="rounded-md"
      style={
        {
          "--ws-color-light": `var(--${accent})`,
          "--ws-color-dark": `var(--${accent})`,
        } as CSSProperties
      }
    >
      <div
        className="group/row relative flex items-center gap-1.5 rounded-md pr-2"
        style={{
          height: SIDEBAR_GEOMETRY.workstreamHeader.height,
          paddingLeft: SIDEBAR_GEOMETRY.workstreamHeader.indent,
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <WorkstreamName name={name} accent className="ws-text-workstream" />
          <button
            type="button"
            aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
            aria-expanded={!collapsed}
            data-profile-heading=""
            onClick={() => setCollapsed((value) => !value)}
            className={cn(rowActionClass, "size-5")}
          >
            <Icon
              name={collapsed ? "ChevronRight" : "ChevronDown"}
              className="size-3"
            />
          </button>
        </span>
        <RowActions>
          <HoverAction
            compact
            label={`Focus on ${name}`}
            hint="Focus"
            onClick={() => {}}
          >
            <FocusIcon className="size-3.5" />
          </HoverAction>
        </RowActions>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {rows[groupIndex]!.length}
        </span>
      </div>
      {collapsed ? null : (
        <ul className="list-none">
          {rows[groupIndex]!.map(({ thread, work }) => (
            <li key={thread.id}>
              <Row
                thread={thread}
                work={work}
                depth={0}
                inGroup
                active={false}
                now={0}
                snoozeAction={{
                  kind: "snooze",
                  title: "Snooze until later",
                  run: () => {},
                }}
                onNavigate={() => {}}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SidebarProfile() {
  const [, setRevision] = useState(0);
  profileWindow.__sidebarProfile.rerender = () =>
    flushSync(() => setRevision((revision) => revision + 1));
  const onRender: ProfilerOnRenderCallback = (
    _id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    profileWindow.__sidebarProfile.commits.push({
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    });
  };
  return (
    <Profiler id="workstreams-sidebar-profile" onRender={onRender}>
      <main
        className="sidebar-profile"
        data-bb-plugin="workstreams"
        aria-label="Sidebar performance fixture"
      >
        <div
          className="flex items-center gap-1"
          style={{
            height: SIDEBAR_GEOMETRY.sectionHeading.height,
            marginTop: SIDEBAR_GEOMETRY.sectionHeading.topMargin,
            marginBottom: SIDEBAR_GEOMETRY.sectionHeading.bottomMargin,
            paddingLeft: SIDEBAR_GEOMETRY.sectionHeading.leftInset,
          }}
        >
          <h2 className="ws-text-section flex min-w-0 items-center text-muted-foreground">
            Workstreams
          </h2>
        </div>
        {groupNames.map((name, groupIndex) => (
          <ProfileWorkstream key={name} groupIndex={groupIndex} />
        ))}
      </main>
    </Profiler>
  );
}

createRoot(document.getElementById("root")!).render(<SidebarProfile />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    profileWindow.__sidebarProfile.ready = true;
  });
});
