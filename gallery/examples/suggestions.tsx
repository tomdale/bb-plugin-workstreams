import { useMemo, useState, type ReactNode } from "react";
import { Dialog } from "../../components/ui/dialog";
import { CompactViewportOverrideProvider } from "../../components/ui/hooks/use-compact-viewport";
import { SuggestionsReview } from "../../src/app/sidebar/SuggestionsReview";
import type { SidebarView } from "../../src/app/sidebar/suggestionMiniatures";
import type {
  Feed,
  Rpc,
  Suggestion,
} from "../../src/app/sidebar/useSuggestionFeed";
import {
  changeDelta,
  changeHeadline,
  suggestionChange,
  type ChangeContext,
} from "../../src/domain/suggestion-change";
import { projectWorkstreams } from "../../src/domain/project";
import type { Split, TidyEdit } from "../../src/domain/tidy";
import type { SuggestionsStateWire } from "../../src/server/contract";
import { LiveExample, Variant, Variants } from "../ExampleFrame";
import type { GalleryExample } from "../examples";

/**
 * The sidebar the specimens draw: topics, their threads, and one color each.
 * The product, its areas and thread titles are invented for the gallery.
 */
const topics = [
  ["billing", "Billing", null],
  ["invoices", "Invoices", "billing"],
  ["payments", "Payments", "billing"],
  ["support", "Support Tools", null],
  ["docs", "Docs", null],
  ["notes", "Release Notes", null],
  ["tools", "Build Tools", null],
  ["infra", "Infra", null],
  ["research", "User Research", null],
  ["dx", "Developer Experience", null],
  ["tooling", "Developer Tooling", "dx"],
  ["observability", "Observability", null],
  ["incidents", "Incident Response", null],
  ["audits", "Component Audits", null],
  ["systems", "Design Systems", null],
  ["updates", "Product Updates", null],
  ["partners", "Partner Portal", null],
  ["admin", "Admin Console", null],
  ["mobile", "Mobile App", null],
  ["quality", "Quality Checks", null],
  ["web", "Web", null],
  ["onboarding", "Onboarding", null],
  ["legacy", "Legacy Tools", null],
] as const;
/** Threads filed in Legacy Tools that the sidebar does not list (archived). */
const ARCHIVED = ["legacy-0", "legacy-1", "legacy-2", "legacy-3", "legacy-4"];
const titles: Record<string, string[]> = {
  invoices: ["Fixing invoice totals", "Adding invoice export"],
  payments: ["Retrying failed payments", "Reviewing refund rules"],
  support: [
    "Sorting the triage queue",
    "Labeling incoming tickets",
    "Routing urgent tickets",
    "Auditing triage rules",
    "Tuning the priority score",
    "Reviewing ticket templates",
    "Drafting canned replies",
    "Testing reply shortcuts",
    "Cleaning up old macros",
    "Sharing macros across teams",
    "Building the weekly report",
    "Charting response times",
    "Exporting ticket counts",
    "Reviewing report filters",
    "Comparing team workloads",
    "Handing a ticket to a lead",
    "Escalating stuck tickets",
    "Writing the escalation policy",
    "Linking tickets to incidents",
    "Updating the help center",
    "Reviewing article drafts",
    "Fixing broken help links",
    "Tagging articles by product",
  ],
  docs: ["Rewriting the quick start", "Checking API examples"],
  notes: [
    "Writing release notes",
    "Drafting the launch post",
    "Editing changelog entries",
  ],
  tools: ["Refining build commands", "Speeding up cold builds"],
  infra: ["Caching test runs"],
  research: ["Comparing survey methods", "Coding interview notes"],
  tooling: ["Improving editor setup", "Shortening first-run setup"],
  observability: [
    "Reviewing tracing coverage",
    "Adding span attributes",
    "Tuning log sampling",
  ],
  incidents: ["Reviewing incident follow-up", "Writing the paging runbook"],
  audits: [
    "Auditing shared components",
    "Auditing button variants",
    "Checking focus rings",
  ],
  systems: [
    "Reviewing component tokens",
    "Naming color tokens",
    "Documenting spacing scale",
    "Updating type ramp",
  ],
  updates: ["Writing product updates", "Collecting shipped changes"],
  partners: ["Reviewing sign-in permissions", "Checking invite emails"],
  admin: [
    "Designing the roles page",
    "Auditing admin actions",
    "Designing role improvements",
  ],
  mobile: [
    "Checking push notification copy",
    "Aligning tab bar icons",
    "Designing offline mode",
    "Redesigning the settings screen",
  ],
  quality: ["Scoring search results", "Measuring autocomplete accuracy"],
  web: ["Checking the checkout flow"],
  onboarding: ["Orchestrating the sign-up fixes", "Reviewing the welcome tour"],
};
const colors: Record<string, { hue: number; level: -1 | 0 | 1 }> = {
  billing: { hue: 210, level: 0 },
  invoices: { hue: 215, level: 0 },
  payments: { hue: 240, level: 1 },
  support: { hue: 345, level: 0 },
  docs: { hue: 150, level: 0 },
  notes: { hue: 20, level: 0 },
  tools: { hue: 85, level: 0 },
  infra: { hue: 180, level: 0 },
  research: { hue: 280, level: 0 },
  dx: { hue: 120, level: 0 },
  tooling: { hue: 130, level: 0 },
  observability: { hue: 95, level: 0 },
  incidents: { hue: 30, level: 0 },
  audits: { hue: 260, level: 0 },
  systems: { hue: 200, level: 0 },
  updates: { hue: 60, level: 0 },
  partners: { hue: 50, level: 0 },
  admin: { hue: 225, level: 0 },
  mobile: { hue: 250, level: 0 },
  quality: { hue: 170, level: 0 },
  web: { hue: 330, level: 0 },
  onboarding: { hue: 270, level: 0 },
};

const NOW = Date.UTC(2026, 0, 15);
const threadList = Object.entries(titles).flatMap(([topic, names], at) =>
  names.map((title, index) => ({
    id: `${topic}-${index}`,
    topic,
    title,
    activeAt: NOW - (at * 7 + index) * 3_600_000,
  })),
);
const archivedFiling = Object.fromEntries(ARCHIVED.map((id) => [id, "legacy"]));
const entities = topics.map(([id, name, parentId]) => ({
  id,
  name,
  parentId,
}));
const filing = {
  ...Object.fromEntries(threadList.map((t) => [t.id, t.topic])),
  ...archivedFiling,
};

const sidebar: SidebarView = (() => {
  const sections = Object.keys(titles).map((topic) => ({
    id: `sec_${topic}`,
    name: entities.find((e) => e.id === topic)!.name,
  }));
  const projection = projectWorkstreams(
    threadList.map((t) => ({
      id: t.id,
      title: t.title,
      parentThreadId: null,
      sectionId: `sec_${t.topic}`,
      isHidden: false,
      isArchived: false,
      isPinned: false,
      hasPendingInteraction: false,
      latestAttentionAt: t.activeAt,
      createdAt: t.activeAt,
    })),
    sections,
    { now: NOW },
  );
  return {
    projection,
    catalog: {
      entities,
      groups: Object.fromEntries(
        Object.keys(titles).map((topic) => [`sec_${topic}`, topic]),
      ),
      assignments: {
        ...Object.fromEntries(
          threadList.map((t) => [t.id, { entityId: t.topic }]),
        ),
        ...Object.fromEntries(
          ARCHIVED.map((id) => [id, { entityId: "legacy" }]),
        ),
      },
      colors,
    },
    sort: "alphabetical",
    manualOrder: [],
    sections,
    now: NOW,
  };
})();

const context: ChangeContext = {
  topics: entities,
  threadTopic: filing,
  title: (id) => threadList.find((t) => t.id === id)?.title ?? id,
};

/** A suggestion as the server would send it: the change, its delta, its sentence. */
function suggest(id: string, body: TidyEdit | Split): Suggestion {
  const change = suggestionChange(body, context)!;
  return {
    id,
    kind: "subgroups" in body ? "split" : "edit",
    summary: changeHeadline(change),
    reason: "",
    status: "pending",
    at: 0,
    decidedAt: null,
    problem: null,
    change,
    delta: changeDelta(body, context),
    headline: changeHeadline(change),
    traceId: null,
    arrivals: [],
  };
}

const supportThreads = (from: number, to: number) =>
  threadList
    .filter((t) => t.topic === "support")
    .slice(from, to)
    .map((t) => t.id);
const split = suggest("split", {
  topicId: "support",
  subgroups: [
    { name: "Triage", description: "", threadIds: supportThreads(0, 6) },
    { name: "Macros", description: "", threadIds: supportThreads(6, 10) },
    {
      name: "Reporting",
      description: "",
      threadIds: supportThreads(10, 15),
    },
    {
      name: "Escalations",
      description: "",
      threadIds: supportThreads(15, 19),
    },
    {
      name: "Knowledge Base",
      description: "",
      threadIds: supportThreads(19, 23),
    },
  ],
});
const refile = suggest("refile", {
  op: "move",
  thread: "infra-0",
  topic: "tools",
});
const merge = suggest("merge", { op: "merge", from: "notes", into: "docs" });
const signIn = suggest("sign-in", {
  op: "move",
  thread: "onboarding-0",
  topic: "partners",
});
const rename = suggest("rename", {
  op: "rename",
  topic: "research",
  name: "Customer Research",
});
const reparent = suggest("reparent", {
  op: "reparent",
  topic: "tools",
  parent: "dx",
});
const retire = suggest("retire", {
  op: "rename",
  topic: "legacy",
  name: "Retired Tools",
});
const group = suggest("group", {
  op: "create",
  name: "Reliability",
  description: "",
  parent: null,
  children: ["observability", "incidents"],
});

/** A feed and RPC that decide like the server: a decision changes the state. */
function useFakeFeed(initial: Suggestion[]): { feed: Feed; rpc: Rpc } {
  const [state, setState] = useState<SuggestionsStateWire>({
    suggestions: initial,
    running: false,
    lastRunAt: null,
    error: null,
  });
  return useMemo(() => {
    let current = state;
    const set = (status: Suggestion["status"], ids: readonly string[]) => {
      current = {
        ...current,
        suggestions: current.suggestions.map((s) =>
          ids.includes(s.id) ? { ...s, status } : s,
        ),
      };
      setState(current);
      return current;
    };
    const rpc = {
      call: async (method: string, input: unknown) => {
        if (method === "suggestions") return { state: current };
        if (method === "suggestionsDecide") {
          const { ids, decision } = input as {
            ids: string[];
            decision: "accept" | "decline";
          };
          return {
            applied: ids,
            failed: [],
            entries: Object.fromEntries(ids.map((id) => [id, `entry-${id}`])),
            state: set(decision === "accept" ? "accepted" : "declined", ids),
          };
        }
        if (method === "suggestionsReopen")
          return { state: set("pending", [(input as { id: string }).id]) };
        throw new Error(`The gallery has no ${method}`);
      },
    } as unknown as Rpc;
    const feed: Feed = {
      state: current,
      setState: (next) => {
        current =
          (typeof next === "function" ? next(current) : next) ?? current;
        setState(current);
      },
      loadError: false,
      read: async () => {},
      refresh: () => {},
    };
    return { feed, rpc };
    // The fake server keeps its own state; the view follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/** The modal's frame at rest in the page, since the real one is portaled. */
function Frame({
  suggestions,
  compact = false,
  children,
}: {
  suggestions: Suggestion[];
  compact?: boolean;
  children?: ReactNode;
}) {
  const { feed, rpc } = useFakeFeed(suggestions);
  return (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <Dialog open onOpenChange={() => {}}>
        <div
          style={{
            height: compact ? 640 : 640,
            width: compact ? 390 : "min(1040px, 100%)",
          }}
          className="flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm"
        >
          <SuggestionsReview
            rpc={rpc}
            feed={feed}
            sidebar={sidebar}
            focusInitial={{ current: () => {} }}
            onClose={() => {}}
            onOpenTopics={() => {}}
          />
        </div>
        {children}
      </Dialog>
    </CompactViewportOverrideProvider>
  );
}

function SuggestionsExample() {
  return (
    <LiveExample
      name="Suggestions review"
      sources={[
        "src/app/sidebar/SuggestionsReview.tsx",
        "src/app/sidebar/SuggestionMiniatures.tsx",
        "src/app/sidebar/suggestionMiniatures.ts",
      ]}
    >
      <Variants minWidth="26rem">
        <Variant
          label="Seven suggestions"
          wide
          note="Accept or Decline with A and D, step with J and K, Undo with U. The ribbons name their threads on hover or focus."
        >
          <Frame
            suggestions={[
              split,
              signIn,
              merge,
              group,
              rename,
              reparent,
              refile,
              retire,
            ]}
          />
        </Variant>
        <Variant
          label="One suggestion"
          wide
          note="A long split: one workstream into five, with a ribbon for each."
        >
          <Frame suggestions={[split]} />
        </Variant>
        <Variant label="Compact viewport" note="The list is a drop-down.">
          <Frame suggestions={[merge, rename, group]} compact />
        </Variant>
      </Variants>
    </LiveExample>
  );
}

export const suggestionsExample: GalleryExample = {
  id: "suggestions-review",
  title: "Suggestions review",
  group: "Components",
  description:
    "The modal the Workstreams count opens: each pending change as a sentence, and the sidebar now and after accepting it.",
  source: `import { SuggestionsReview } from "../src/app/sidebar/SuggestionsReview";

<Dialog open onOpenChange={close}>
  <SuggestionsReview
    rpc={rpc}
    feed={feed}
    sidebar={sidebar}
    focusInitial={focusInitial}
    onClose={close}
    onOpenTopics={openTopics}
  />
</Dialog>`,
  render: () => <SuggestionsExample />,
};
