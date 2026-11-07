// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useGoalContext } from "../../src/app/goalContext.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

afterEach(cleanup);

/** The heading's data, as the sticky heading receives it. */
function Heading() {
  const { threadId } = useBbContext();
  const context = useGoalContext(threadId);
  if (!context) return <p>no heading</p>;
  return (
    <div>
      <h2>{context.title}</h2>
      <p aria-label="goal">{context.goal ?? "none"}</p>
      <p aria-label="workstream">{context.workstream?.name ?? "unfiled"}</p>
      <p aria-label="workstream color">
        {context.workstream?.color.hue ?? "none"}
      </p>
    </div>
  );
}

async function mount(
  thread: PluginSidebarThread,
  server: Record<string, unknown> = {},
  otherThreads: PluginSidebarThread[] = [],
) {
  // Loading the app registers its slots, as BB does before rendering any.
  await loadPluginApp(() => import("../../src/app/index.tsx"));
  return renderSlot({ id: "heading", component: Heading } as never, {}, {
    settings: {},
    context: { threadId: thread.id, projectId: "proj_1" },
    rpc: { state: () => ({ ...emptyState(), ...server }) },
    sidebarThreads: {
      status: "ready",
      threads: [thread, ...otherThreads],
      sections: [section("sec_1", "Lumen"), section("sec_2", "Other")],
      projects: [],
      experimental_archived: null,
    },
  } as never);
}

const analysis = (goal: string) => ({
  recap: "r",
  state: "in_progress",
  needsYou: null,
  subject: null,
  goal,
  drift: null,
  driftSectionId: null,
  revision: 1,
  at: 1,
  model: "m",
});

it("names the thread exactly as BB lists it, whatever the analysis inferred", async () => {
  const slot = await mount(
    sidebarThread("t1", { title: "Fix stale build cache", sectionId: "sec_1" }),
    // An analysis that predates the title, or one the user overrode.
    { analysis: { t1: analysis("Speed up the monorepo build") } },
  );
  expect(await slot.findByRole("heading", { level: 2 })).toHaveProperty(
    "textContent",
    "Fix stale build cache",
  );
  expect(slot.getByLabelText("workstream").textContent).toBe("Lumen");
  slot.lifecycle.unmount();
});

it("uses the root topic's color for a delegate in a different native section", async () => {
  const child = sidebarThread("child", {
    title: "Delegate",
    parentThreadId: "root",
    sectionId: "sec_2",
  });
  const root = sidebarThread("root", { title: "Root", sectionId: "sec_1" });
  const slot = await mount(
    child,
    {
      catalog: {
        entities: [
          {
            id: "topic",
            name: "Lumen",
            description: "",
            parentId: null,
            aliases: [],
          },
        ],
        groups: { sec_1: "topic" },
        colors: { topic: { hue: 211, level: 1 } },
        assignments: {},
        revision: 1,
      },
    },
    [root],
  );
  await slot.findByRole("heading", { level: 2 });
  await waitFor(() =>
    expect(slot.getByLabelText("workstream color").textContent).toBe("211"),
  );
  expect(slot.getByLabelText("workstream").textContent).toBe("Lumen");
  slot.lifecycle.unmount();
});

it("shows BB's placeholder for an untitled thread, not a placeholder of its own", async () => {
  const thread = sidebarThread("t1", {
    title: null,
    titleFallback: "fix the cache thing…",
    displayTitle: "fix the cache thing…",
  });
  const slot = await mount(thread, {
    analysis: { t1: analysis("Fix stale build cache") },
  });
  const heading = await slot.findByRole("heading", { level: 2 });
  expect(heading.textContent).toBe("fix the cache thing…");
  expect(slot.queryByText(/Building a clear thread goal/)).toBeNull();
  slot.lifecycle.unmount();
});

it("shows the analyzed outcome even while running, never the latest recap headline", async () => {
  const thread = sidebarThread("t1", {
    title: "Fix stale build cache",
    status: "active",
  });
  const goal = "Keep builds fresh without clearing the cache manually.";
  const slot = await mount(thread, {
    analysis: {
      t1: { ...analysis("Fix stale build cache"), threadGoal: goal },
    },
    recaps: { t1: { goal: "Changed directories", state: "review", at: 2 } },
  });
  await slot.findByRole("heading", { level: 2 });
  expect(slot.getByLabelText("goal").textContent).toBe(goal);
  expect(slot.queryByText("Changed directories")).toBeNull();
  slot.lifecycle.unmount();
});

it("omits an unknown or repeated outcome rather than falling back to recaps", async () => {
  const thread = sidebarThread("t1", { title: "Fix stale build cache" });
  for (const threadGoal of [undefined, null, "Fix stale build cache"]) {
    const slot = await mount(thread, {
      analysis: { t1: { ...analysis("Fix stale build cache"), threadGoal } },
      recaps: { t1: { goal: "Changed directories", state: "review", at: 2 } },
    });
    await slot.findByRole("heading", { level: 2 });
    expect(slot.getByLabelText("goal").textContent).toBe("none");
    slot.lifecycle.unmount();
  }
});

it("renders nothing for a thread BB doesn't list", async () => {
  await loadPluginApp(() => import("../../src/app/index.tsx"));
  const slot = renderSlot({ id: "heading", component: Heading } as never, {}, {
    settings: {},
    context: { threadId: "gone", projectId: "proj_1" },
    rpc: { state: () => emptyState() },
    sidebarThreads: {
      status: "ready",
      threads: [],
      sections: [],
      projects: [],
      experimental_archived: null,
    },
  } as never);
  expect(slot.getByText("no heading")).toBeTruthy();
  slot.lifecycle.unmount();
});
