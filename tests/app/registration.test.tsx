// @vitest-environment jsdom
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import { ServerStateRealtime } from "../../src/app/serverState.ts";

afterEach(cleanup);

it("binds UI surfaces to the components exercised by the SDK harness", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const { WorkstreamsThreadList } =
    await import("../../src/app/sidebar/ThreadList.tsx");
  const { HomeSection } = await import("../../src/app/home/HomeSection.tsx");
  const { WorkstreamsPage } = await import("../../src/app/page/Page.tsx");
  const { RecapCard } = await import("../../src/app/composer/RecapCard.tsx");
  const { QuestionInteraction, QuestionAnchor } =
    await import("../../src/app/question/QuestionCard.tsx");
  const { DeliveredQuestionCards } =
    await import("../../src/app/question/DeliveredQuestion.tsx");
  const { AssistantReplyDebug } =
    await import("../../src/app/reply/ReplyDebug.tsx");
  const { QuestionHistoryInline } =
    await import("../../src/app/question/QuestionHistory.tsx");
  const { StickyGoalHeader } =
    await import("../../src/app/StickyGoalHeader.tsx");
  const { ArchiveHeaderAction } =
    await import("../../src/app/header/ArchiveHeaderAction.tsx");
  const { ParentThreadLink } =
    await import("../../src/app/header/ParentLink.tsx");
  const { TaskIdentityHeader } =
    await import("../../src/app/header/TaskIdentityHeader.tsx");
  const { SnoozeHeaderAction } =
    await import("../../src/app/snooze/SnoozeHeaderAction.tsx");
  const { ColorTokenStyle } =
    await import("../../src/app/theme/ColorTokenStyle.tsx");
  const { NewThreadRouting } =
    await import("../../src/app/composer/NewThreadRouting.tsx");
  const features = await import("../../src/app/settings/FeatureSettings.tsx");
  const { ColorSettings } =
    await import("../../src/app/settings/ColorSettings.tsx");
  const { RecapSettings } =
    await import("../../src/app/recap/RecapSettings.tsx");
  const { SnoozeSettings } =
    await import("../../src/app/snooze/SnoozeSettings.tsx");
  expect(
    app.threadLists.find((entry) => entry.id === "sidebar")?.component,
  ).toBe(WorkstreamsThreadList);
  expect(
    app.homepageSections.find((entry) => entry.id === "home")?.component,
  ).toBe(HomeSection);
  expect(app.navPanels.find((entry) => entry.id === "home")?.component).toBe(
    WorkstreamsPage,
  );
  const recap = app.composerCustomizations.find(
    (entry) => entry.id === "recap",
  );
  expect(recap?.banners?.find((entry) => entry.id === "recap")?.component).toBe(
    RecapCard,
  );
  expect(
    recap?.banners?.find((entry) => entry.id === "question")?.component,
  ).toBe(QuestionAnchor);
  expect(app.pendingInteractions[0]?.component).toBe(QuestionInteraction);
  expect(
    app.composerCustomizations
      .find((entry) => entry.id === "new-work")
      ?.banners?.find((entry) => entry.id === "routing")?.component,
  ).toBe(NewThreadRouting);
  for (const [id, component] of [
    ["sidebar", features.SidebarSettings],
    ["working-indicator", features.WorkingIndicatorSettings],
    ["colors", ColorSettings],
    ["threads", features.ThreadsSettings],
    ["recap", RecapSettings],
    ["snooze", SnoozeSettings],
    ["new-work", features.NewWorkSettings],
    ["organize", features.OrganizeSettings],
    ["advanced", features.AdvancedSettings],
  ] as const) {
    expect(
      app.settingsSections.find((entry) => entry.id === id)?.component,
    ).toBe(component);
  }
  expect(
    app.timelineRenderers.find(
      (entry) => entry.kind === "workstreams/ask-user-question",
    )?.component,
  ).toBe(QuestionHistoryInline);
  for (const [id, component] of [
    ["delivered-questions", DeliveredQuestionCards],
    ["assistant-reply-debug", AssistantReplyDebug],
    ["sticky-thread-goal", StickyGoalHeader],
    ["color-tokens", ColorTokenStyle],
  ] as const) {
    expect(app.appOverlays.find((entry) => entry.id === id)?.component).toBe(
      component,
    );
  }
  for (const [id, component] of [
    ["archive", ArchiveHeaderAction],
    ["parent-thread", ParentThreadLink],
    ["task-identity", TaskIdentityHeader],
    ["snooze", SnoozeHeaderAction],
  ] as const) {
    expect(
      app.threadHeaderActions.find((entry) => entry.id === id)?.component,
    ).toBe(component);
  }
});

it("registers an Archive action in the thread header", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(
    app.threadHeaderActions.find((action) => action.id === "archive")?.title,
  ).toBe("Archive");
});

it("registers settings in feature order", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(app.settingsSections.map(({ id, title }) => [id, title])).toEqual([
    ["sidebar", "Sidebar"],
    ["working-indicator", "Working indicator"],
    ["colors", "Colors"],
    ["threads", "Threads"],
    ["recap", "Recap"],
    ["snooze", "Snooze"],
    ["new-work", "New threads"],
    ["organize", "Organization"],
    ["advanced", "Advanced"],
  ]);
});

it("registers one homepage section titled Workstreams", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(app.homepageSections.map(({ id, title }) => ({ id, title }))).toEqual([
    { id: "home", title: "Workstreams" },
  ]);
});

it("registers one app-wide realtime bridge", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(
    app.appOverlays.filter((entry) => entry.id === "server-state"),
  ).toEqual([{ id: "server-state", component: ServerStateRealtime }]);
});

it("leaves vanilla New thread empty of Workstreams controls and side effects", async () => {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const route = vi.fn();
  const customizations = app.composerCustomizations.filter(
    (c) => !c.scopes || c.scopes.includes("new-thread"),
  );
  const slot = renderSlot(
    {
      component: function NativeSlots() {
        return customizations.flatMap((c) =>
          [...(c.banners ?? []), ...(c.actions ?? [])].map((item) => {
            const Component = item.component;
            return <Component key={`${c.id}:${item.id}`} />;
          }),
        );
      },
    },
    {},
    {
      composer: {
        text: "Fix the parser in my selected project",
        scope: { kind: "new-thread", projectId: "proj_selected" },
      },
      rpc: { route },
    },
  );
  await slot.behavior.setComposerText("Changed vanilla draft");
  expect(slot.container.innerHTML).toBe("");
  expect(slot.inspection.rpcCalls).toEqual([]);
  expect(slot.inspection.sdkCalls).toEqual([]);
  expect(slot.inspection.composer.selections).toEqual([]);
  expect(slot.inspection.composer.submits).toEqual([]);
  expect(route).not.toHaveBeenCalled();
});

it("preserves upstream registration without a message-block slot", async () => {
  expect(() =>
    registerReplyBlock({ slots: {} } as PluginAppBuilder),
  ).not.toThrow();
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(app.composerCustomizations.map((c) => c.id)).toContain("recap");
});
