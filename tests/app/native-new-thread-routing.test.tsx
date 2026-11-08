// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { NewThreadRouting } from "../../src/app/composer/NewThreadRouting.tsx";
import { setComposerPreset } from "../../src/app/composer/preset.ts";
import { routeDelay } from "../../src/app/composer/timing.ts";
import type { Preview } from "../../src/server/preview.ts";
import { emptyState } from "./fixtures.ts";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const identityDecision: Preview = {
  id: "route-alpha",
  traceId: "trace-alpha",
  confidence: "high",
  reason: "Belongs in Alpha",
  subject: "Alpha",
  subjectId: "ent_alpha",
  goal: "Alpha parser",
};

function RootComposer() {
  const composer = useComposer();
  return (
    <main data-app-composer-role="primary">
      <NewThreadRouting />
      <form
        data-promptbox=""
        onSubmit={(event) => {
          event.preventDefault();
          void composer.submit({ experimental_data: null });
        }}
      >
        <button type="submit">Host submit</button>
      </form>
    </main>
  );
}

function RootComposerWithPickerRow() {
  return (
    <main data-app-composer-role="primary">
      <div data-promptbox-shell="">
        <NewThreadRouting />
        <form data-promptbox="" />
        <div>
          <div>
            <button type="button" data-promptbox-project-control="">
              Project
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function DialogComposer() {
  const composer = useComposer();
  return (
    <div role="dialog">
      <main data-app-composer-role="primary">
        <NewThreadRouting />
        <form
          data-promptbox=""
          onSubmit={(event) => {
            event.preventDefault();
            void composer.submit({ experimental_data: null });
          }}
        >
          <button type="submit">Host submit</button>
        </form>
      </main>
    </div>
  );
}

function mount(
  decision: Preview,
  options: {
    component?: typeof RootComposer;
    entities?: {
      id: string;
      name: string;
      description: string;
      parentId: string | null;
      aliases: string[];
      projectId?: string | null;
    }[];
  } = {},
) {
  const Component = options.component ?? RootComposer;
  const route = vi.fn(async () => decision);
  const routeCancel = vi.fn(async () => ({ canceled: true }));
  const draftIdentity = vi.fn(async () => ({ filed: false }));
  const projectList = vi.fn(async () => [
    { id: "project-alpha", name: "Alpha", kind: "directory" },
    { id: "project-beta", name: "Beta", kind: "directory" },
  ]);

  const slot = renderSlot(
    {
      component: Component,
    },
    {},
    {
      sdk: {
        projects: {
          list: projectList,
        },
        threads: {
          get: vi.fn(async () => ({
            id: "thread-parser",
            projectId: "project-alpha",
          })),
        },
      } as never,
      composer: {
        scope: { kind: "new-thread", projectId: "project-alpha" },
        text: "",
        selection: {
          projectId: "project-alpha",
          environment: { type: "project-default" },
        },
      } as never,
      rpc: {
        prefs: () => ({
          prefs: {
            newWork: {
              suggestions: true,
            },
          },
        }),
        state: () => ({
          ...emptyState(),
          catalog: {
            entities: options.entities ?? [
              {
                id: "ent_alpha",
                name: "Alpha",
                description: "Alpha product",
                parentId: null,
                aliases: [],
              },
            ],
            groups: {},
            assignments: {},
            revision: 1,
          },
        }),
        catalog: () => ({
          entities: options.entities ?? [
            {
              id: "ent_alpha",
              name: "Alpha",
              description: "Alpha product",
              parentId: null,
              aliases: [],
            },
          ],
          groups: {},
          assignments: {},
          revision: 1,
        }),
        preview: route,
        previewCancel: routeCancel,
        draftIdentity,
      },
    },
  );

  return { slot, route, draftIdentity, projectList };
}

async function typePrompt(
  slot: ReturnType<typeof mount>["slot"],
  text: string,
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await act(() => slot.behavior.setComposerText(text));
    await act(async () => vi.advanceTimersByTimeAsync(routeDelay(text)));
  } finally {
    vi.useRealTimers();
  }
}

it("fills the field with the classified identity and submits it through host submit metadata", async () => {
  const { slot, route } = mount(identityDecision);
  await typePrompt(slot, "Fix the parser in Alpha");
  const field = await screen.findByRole("button", {
    name: "Topic: Alpha",
  });
  expect(field.dataset.wsAuto).toBe("true");
  expect(route).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        entityId: "ent_alpha",
        proposal: null,
        provenance: "automatic",
        goal: "Alpha parser",
      },
    },
  });
});

it("places the Topic picker in the host picker row", async () => {
  mount(identityDecision, { component: RootComposerWithPickerRow });
  const picker = await screen.findByRole("button", {
    name: "Topic: Automatic",
  });
  expect(picker).toBeTruthy();
  expect(picker.getAttribute("data-ws-identity-control")).toBe("");
  expect(screen.queryByRole("button", { name: /Workstream:/ })).toBeNull();
});

it("leaves a preview with no topic out of the host submit metadata", async () => {
  const unsure: Preview = {
    ...identityDecision,
    id: "route-unsure",
    confidence: "low",
    subject: null,
    subjectId: null,
    goal: null,
  };
  const { slot, route } = mount(unsure);
  await typePrompt(slot, "Something vague");
  await waitFor(() => expect(route).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Topic: Automatic" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
    },
  });
});

it("submits a picked No topic when selecting it", async () => {
  const { slot } = mount(identityDecision);
  await typePrompt(slot, "Some unresolvable request");
  fireEvent.click(await screen.findByRole("button", { name: "Topic: Alpha" }));
  fireEvent.click(await screen.findByRole("option", { name: "No topic" }));
  await screen.findByRole("button", { name: "Topic: No topic" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        entityId: null,
        proposal: null,
        provenance: "manual",
      },
    },
  });
});

it("submits proposal identity when proposing a new feature", async () => {
  const proposalDecision: Preview = {
    id: "route-billing",
    traceId: "trace-billing",
    confidence: "high",
    reason: "A new effort",
    subject: "Billing",
    proposal: { name: "Billing", description: "Invoices" },
  };
  const { slot } = mount(proposalDecision);
  await typePrompt(slot, "Add invoice billing");
  await screen.findByRole("button", { name: "Topic: Billing" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        entityId: null,
        proposal: { name: "Billing", description: "Invoices" },
        provenance: "automatic",
        goal: null,
      },
    },
  });
});

it("does not render routing controls or intercept submits when inside a dialog", async () => {
  const { slot, route } = mount(identityDecision, {
    component: DialogComposer,
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  expect(screen.queryByRole("button", { name: /Topic:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Workstream:/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: null,
  });
  expect(route).not.toHaveBeenCalled();
});

it("reports the draft's identity so a plain Enter can be filed", async () => {
  const { slot, draftIdentity } = mount(identityDecision);
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Topic: Alpha" });
  await waitFor(() =>
    expect(draftIdentity).toHaveBeenLastCalledWith({
      clientId: expect.any(String),
      draftKey: expect.any(String),
      text: "Fix the parser in Alpha",
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        entityId: "ent_alpha",
        proposal: null,
        provenance: "automatic",
        goal: "Alpha parser",
      },
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Topic: Alpha" }));
  fireEvent.click(await screen.findByRole("option", { name: "No topic" }));
  await waitFor(() =>
    expect(draftIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { entityId: null, proposal: null, provenance: "manual" },
      }),
    ),
  );
});

it("starts with the topic of the workstream whose ＋ opened it", async () => {
  setComposerPreset({ sectionId: "section-docs" }, "Docs");
  const { slot } = mount(identityDecision);
  await typePrompt(slot, "Add an example");
  const field = await screen.findByRole("button", { name: "Topic: Docs" });
  expect(field.dataset.wsAuto).not.toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        entityId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: "section-docs",
      },
    },
  });
});

const projectTopics = [
  {
    id: "ent_alpha",
    name: "Alpha",
    description: "",
    parentId: null,
    aliases: [],
    projectId: "project-beta",
  },
  {
    id: "ent_beta",
    name: "Beta",
    description: "",
    parentId: null,
    aliases: [],
  },
];

it("uses the associated project after Quick analysis selects a topic", async () => {
  const { slot, route, draftIdentity } = mount(identityDecision, {
    entities: projectTopics,
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
  expect(slot.inspection.composer.text).toBe("Fix the parser in Alpha");
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "project-beta" },
  ]);
  expect(route).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(draftIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectChoice: { projectId: "project-beta", source: "workstreams" },
      }),
    ),
  );
});

it("uses a manually selected topic's project and leaves it unchanged for an unassociated topic", async () => {
  const { slot } = mount(identityDecision, { entities: projectTopics });
  fireEvent.click(
    await screen.findByRole("button", { name: "Topic: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Topic: Alpha" }));
  fireEvent.click(await screen.findByText("Beta"));
  await screen.findByRole("button", { name: "Topic: Beta" });
  expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
  expect(slot.inspection.composer.selections).toHaveLength(1);
});

it("uses the project of a workstream whose plus button opened the composer", async () => {
  setComposerPreset({ topicId: "ent_alpha" }, "Alpha");
  const { slot } = mount(identityDecision, { entities: projectTopics });
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
});

it("does not apply a stale project's lookup after selecting another topic", async () => {
  const { slot, projectList } = mount(identityDecision, {
    entities: projectTopics,
  });
  let resolve!: (projects: Awaited<ReturnType<typeof projectList>>) => void;
  projectList.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Topic: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() => expect(projectList).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Topic: Alpha" }));
  fireEvent.click(await screen.findByText("Beta"));
  await act(async () =>
    resolve([{ id: "project-beta", name: "Beta", kind: "directory" }]),
  );
  expect(slot.inspection.composer.selection?.projectId).toBe("project-alpha");
  expect(slot.inspection.composer.selections).toEqual([]);
});

it("ignores an associated project that is no longer available", async () => {
  const { slot } = mount(identityDecision, {
    entities: [{ ...projectTopics[0]!, projectId: "deleted" }],
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Topic: Alpha" });
  await waitFor(() =>
    expect(
      slot.inspection.sdkCalls.some((call) => call.method === "projects.list"),
    ).toBe(true),
  );
  expect(slot.inspection.composer.selections).toEqual([]);
});
