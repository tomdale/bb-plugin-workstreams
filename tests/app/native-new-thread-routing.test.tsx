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

// BB keeps one root new-thread draft across projects; the harness keys its
// draft by scope. A test that changes the project can pin BB's key, and can
// hold the next project switch to stand in for BB's asynchronous one.
const draftKey = vi.hoisted(() => ({
  fixed: null as string | null,
  holdNextSelection: null as Promise<void> | null,
}));
vi.mock("@get-bb/plugin-sdk/app", async (original) => {
  const sdk = await original<typeof import("@get-bb/plugin-sdk/app")>();
  // The handle is stable, so its stand-in must be too.
  const pinned = new WeakMap<object, object>();
  return {
    ...sdk,
    useComposer: () => {
      const composer = sdk.useComposer();
      if (!draftKey.fixed) return composer;
      let proxy = pinned.get(composer);
      if (!proxy) {
        proxy = new Proxy(composer, {
          get: (target, property) => {
            if (property === "key") return draftKey.fixed;
            if (property === "setSelection")
              return async (
                selection: Parameters<typeof target.setSelection>[0],
              ) => {
                const hold = draftKey.holdNextSelection;
                draftKey.holdNextSelection = null;
                if (hold) await hold;
                return target.setSelection(selection);
              };
            return Reflect.get(target, property, target);
          },
        });
        pinned.set(composer, proxy);
      }
      return proxy as typeof composer;
    },
  };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  draftKey.fixed = null;
  draftKey.holdNextSelection = null;
});

const identityDecision: Preview = {
  id: "route-alpha",
  traceId: "trace-alpha",
  confidence: "high",
  reason: "Belongs in Alpha",
  subject: "Alpha",
  workstreamId: "ws_alpha",
  title: "Alpha parser",
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

function ComposerWithProjectPick() {
  const composer = useComposer();
  return (
    <main data-app-composer-role="primary">
      <NewThreadRouting />
      <button
        type="button"
        onClick={() =>
          void composer.setSelection({ projectId: "project-beta" })
        }
      >
        Pick Beta
      </button>
      <button
        type="button"
        onClick={() =>
          void composer.setSelection({ projectId: "proj_personal" })
        }
      >
        Pick No project
      </button>
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

/** BB remounts composer banners when the project changes. */
function RemountingComposer() {
  const composer = useComposer();
  const scope = composer.scope;
  return (
    <main data-app-composer-role="primary">
      <NewThreadRouting
        key={scope.kind === "new-thread" ? (scope.projectId ?? "") : ""}
      />
      <button
        type="button"
        onClick={() =>
          void composer.setSelection({ projectId: "project-beta" })
        }
      >
        Pick Beta
      </button>
      <form data-promptbox="" />
    </main>
  );
}

function ComposerWithNoProjectPick() {
  const composer = useComposer();
  return (
    <main data-app-composer-role="primary">
      <NewThreadRouting />
      <button
        type="button"
        onClick={() =>
          void composer.setSelection({ projectId: "proj_personal" })
        }
      >
        Pick No project
      </button>
      <form data-promptbox="" />
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

function PickerRowWithProjectPick() {
  const composer = useComposer();
  return (
    <main data-app-composer-role="primary">
      <div data-promptbox-shell="">
        <NewThreadRouting />
        <form data-promptbox="" />
        <div data-testid="picker-row">
          <div>
            <button
              type="button"
              data-promptbox-project-control=""
              onClick={() =>
                void composer.setSelection({ projectId: "project-beta" })
              }
            >
              Pick Beta
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
    workstreams?: {
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
  const metadataUpdates = vi.fn(async (input: unknown) => ({
    workstream: {
      id: (input as { workstreamId: string }).workstreamId,
      name: "Alpha",
      description: "",
      parentId: null,
      aliases: [],
    },
  }));
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
          tree: {
            workstreams: options.workstreams ?? [
              {
                id: "ws_alpha",
                name: "Alpha",
                description: "Alpha product",
                parentId: null,
                aliases: [],
                projectId: "project-alpha",
              },
            ],
            groups: {},
            assignments: {},
            revision: 1,
          },
        }),
        tree: () => ({
          workstreams: options.workstreams ?? [
            {
              id: "ws_alpha",
              name: "Alpha",
              description: "Alpha product",
              parentId: null,
              aliases: [],
              projectId: "project-alpha",
            },
          ],
          groups: {},
          assignments: {},
          revision: 1,
        }),
        preview: route,
        previewCancel: routeCancel,
        draftIdentity,
        workstreamUpdate: metadataUpdates,
      },
    },
  );

  return { slot, route, draftIdentity, projectList, metadataUpdates };
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
    name: "Workstream: Alpha",
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
        workstreamId: "ws_alpha",
        proposal: null,
        provenance: "automatic",
      },
    },
  });
});

it("places the workstream picker in the host picker row", async () => {
  mount(identityDecision, { component: RootComposerWithPickerRow });
  const picker = await screen.findByRole("button", {
    name: "Workstream: Automatic",
  });
  expect(picker).toBeTruthy();
  expect(picker.getAttribute("data-ws-identity-control")).toBe("");
  expect(screen.getAllByRole("button", { name: /Workstream:/ })).toHaveLength(
    1,
  );
});

it("leaves a preview with no workstream out of the host submit metadata", async () => {
  const unsure: Preview = {
    ...identityDecision,
    id: "route-unsure",
    confidence: "low",
    subject: null,
    workstreamId: null,
    title: null,
  };
  const { slot, route } = mount(unsure);
  await typePrompt(slot, "Something vague");
  await waitFor(() => expect(route).toHaveBeenCalledTimes(1));
  expect(
    screen.getByRole("button", { name: "Workstream: Automatic" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
    },
  });
});

it("submits a picked No workstream when selecting it", async () => {
  const { slot } = mount(identityDecision);
  await typePrompt(slot, "Some unresolvable request");
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Alpha" }),
  );
  fireEvent.click(await screen.findByRole("option", { name: "No workstream" }));
  await screen.findByRole("button", { name: "Workstream: No workstream" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        workstreamId: null,
        proposal: null,
        provenance: "manual",
      },
    },
  });
});

it("submits proposal identity when proposing a new workstream", async () => {
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
  await screen.findByRole("button", { name: "Workstream: Billing" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        workstreamId: null,
        proposal: { name: "Billing", description: "Invoices" },
        provenance: "automatic",
      },
    },
  });
});

it("does not render routing controls or intercept submits when inside a dialog", async () => {
  const { slot, route } = mount(identityDecision, {
    component: DialogComposer,
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  expect(screen.queryByRole("button", { name: /Workstream:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Workstream:/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: null,
  });
  expect(route).not.toHaveBeenCalled();
});

it("reports the draft's identity so a plain Enter gets its workstream", async () => {
  const { slot, draftIdentity } = mount(identityDecision);
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  await waitFor(() =>
    expect(draftIdentity).toHaveBeenLastCalledWith({
      draftKey: expect.any(String),
      text: "Fix the parser in Alpha",
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        workstreamId: "ws_alpha",
        proposal: null,
        provenance: "automatic",
      },
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Alpha" }),
  );
  fireEvent.click(await screen.findByRole("option", { name: "No workstream" }));
  await waitFor(() =>
    expect(draftIdentity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { workstreamId: null, proposal: null, provenance: "manual" },
      }),
    ),
  );
});

it("starts in the workstream whose ＋ opened it", async () => {
  setComposerPreset({ sectionId: "section-docs" }, "Docs");
  const { slot } = mount(identityDecision);
  await typePrompt(slot, "Add an example");
  const field = await screen.findByRole("button", { name: "Workstream: Docs" });
  expect(field.dataset.wsAuto).not.toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-alpha", source: "independent" },
      identity: {
        workstreamId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: "section-docs",
      },
    },
  });
});

const projectWorkstreams = [
  {
    id: "ws_alpha",
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

it("uses the associated project after the start call selects a workstream", async () => {
  const { slot, route, draftIdentity } = mount(identityDecision, {
    workstreams: projectWorkstreams,
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

/** Holds the next project lookup until the returned function runs. */
function holdProjects(projectList: ReturnType<typeof mount>["projectList"]) {
  let release!: () => void;
  projectList.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve([
            { id: "project-alpha", name: "Alpha", kind: "directory" },
            { id: "project-beta", name: "Beta", kind: "directory" },
          ]);
      }),
  );
  return () => release();
}

it("sends in the workstream's project when you send while it is looked up", async () => {
  const { slot, projectList } = mount(identityDecision, {
    workstreams: projectWorkstreams,
  });
  const release = holdProjects(projectList);
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  await waitFor(() => expect(projectList).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await act(async () => {});
  expect(slot.inspection.composer.submits).toHaveLength(0);
  await act(async () => release());
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]).toMatchObject({
    experimental_data: {
      projectChoice: { projectId: "project-beta", source: "workstreams" },
      identity: { workstreamId: "ws_alpha", provenance: "automatic" },
    },
  });
});

it("holds Enter while the workstream's project is looked up", async () => {
  const { slot, projectList } = mount(identityDecision, {
    workstreams: projectWorkstreams,
  });
  const form = document.querySelector("form[data-promptbox]")!;
  // With no project move pending, Enter is BB's.
  const idle = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  form.dispatchEvent(idle);
  expect(idle.defaultPrevented).toBe(false);
  const release = holdProjects(projectList);
  await typePrompt(slot, "Fix the parser in Alpha");
  await waitFor(() => expect(projectList).toHaveBeenCalledOnce());
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  form.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(true);
  // Shift+Enter is a newline.
  const newline = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  form.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  await act(async () => release());
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
});

it("keeps your project when a default requested before it lands after", async () => {
  draftKey.fixed = "root-draft";
  let release!: () => void;
  draftKey.holdNextSelection = new Promise((resolve) => {
    release = resolve;
  });
  const { slot } = mount(identityDecision, {
    component: ComposerWithNoProjectPick,
    workstreams: projectWorkstreams,
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  // Workstreams has asked BB to switch to Alpha's default, Beta.
  await waitFor(() => expect(draftKey.holdNextSelection).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Pick No project" }));
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("proj_personal"),
  );
  await act(async () => release());
  await waitFor(() =>
    expect(slot.inspection.composer.selections).toEqual([
      { projectId: "proj_personal" },
      { projectId: "project-beta" },
      { projectId: "proj_personal" },
    ]),
  );
  expect(slot.inspection.composer.selection?.projectId).toBe("proj_personal");
});

it("uses a manually selected workstream's project and moves to No project for an unassociated workstream", async () => {
  const { slot } = mount(identityDecision, { workstreams: projectWorkstreams });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Workstream: Alpha" }));
  fireEvent.click(await screen.findByText("Beta"));
  await screen.findByRole("button", { name: "Workstream: Beta" });
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("proj_personal"),
  );
  expect(slot.inspection.composer.selections).toHaveLength(2);
});

it.each(["manual", "automatic"])(
  "keeps a project picked while a %s workstream's default is loading",
  async (provenance) => {
    const { slot, projectList } = mount(identityDecision, {
      component: ComposerWithProjectPick,
      workstreams: [{ ...projectWorkstreams[0]!, projectId: "project-alpha" }],
    });
    let resolve!: (projects: Awaited<ReturnType<typeof projectList>>) => void;
    projectList.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    if (provenance === "manual") {
      fireEvent.click(
        await screen.findByRole("button", { name: "Workstream: Automatic" }),
      );
      fireEvent.click(await screen.findByText("Alpha"));
    } else {
      await typePrompt(slot, "Fix the parser in Alpha");
    }
    await waitFor(() => expect(projectList).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
    await act(async () =>
      resolve([{ id: "project-alpha", name: "Alpha", kind: "directory" }]),
    );
    await screen.findByRole("button", { name: "Workstream: Alpha" });
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
    expect(slot.inspection.composer.selections).toEqual([
      { projectId: "project-beta" },
    ]);
  },
);

it("keeps a manually chosen project when you first pick a workstream", async () => {
  const { slot } = mount(identityDecision, {
    component: ComposerWithProjectPick,
  });
  await screen.findByRole("button", { name: "Workstream: Automatic" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  await screen.findByRole("button", { name: "Save as default project" });
  expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "project-beta" },
  ]);
});

it("uses the project of a workstream whose plus button opened the composer", async () => {
  setComposerPreset({ workstreamId: "ws_alpha" }, "Alpha");
  const { slot } = mount(identityDecision, { workstreams: projectWorkstreams });
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
});

it("does not apply a stale project's lookup after selecting another workstream", async () => {
  const { slot, projectList } = mount(identityDecision, {
    workstreams: [
      projectWorkstreams[0]!,
      { ...projectWorkstreams[1]!, projectId: "project-alpha" },
    ],
  });
  let resolve!: (projects: Awaited<ReturnType<typeof projectList>>) => void;
  projectList.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await waitFor(() => expect(projectList).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Workstream: Alpha" }));
  fireEvent.click(await screen.findByText("Beta"));
  await act(async () =>
    resolve([{ id: "project-beta", name: "Beta", kind: "directory" }]),
  );
  expect(slot.inspection.composer.selection?.projectId).toBe("project-alpha");
  expect(slot.inspection.composer.selections).toEqual([]);
});

it("ignores an associated project that is no longer available", async () => {
  const { slot } = mount(identityDecision, {
    workstreams: [{ ...projectWorkstreams[0]!, projectId: "deleted" }],
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  await waitFor(() =>
    expect(
      slot.inspection.sdkCalls.some((call) => call.method === "projects.list"),
    ).toBe(true),
  );
  expect(slot.inspection.composer.selections).toEqual([]);
});

it.each([
  ["Pick Beta", "project-beta"],
  ["Pick No project", "proj_personal"],
])(
  "preserves an explicit project through automatic routing: %s",
  async (button, projectId) => {
    const { slot, route } = mount(identityDecision, {
      component: ComposerWithProjectPick,
    });
    await screen.findByRole("button", { name: "Workstream: Automatic" });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() =>
      expect(slot.inspection.composer.selection?.projectId).toBe(projectId),
    );
    await typePrompt(slot, "Fix the parser in Alpha");
    await waitFor(() => expect(route).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Workstream: Alpha" });
    expect(slot.inspection.composer.selection?.projectId).toBe(projectId);
    fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
    await waitFor(() =>
      expect(slot.inspection.composer.submits).toHaveLength(1),
    );
    expect(slot.inspection.composer.submits[0]).toMatchObject({
      experimental_data: {
        projectChoice: { projectId, source: "independent" },
        identity: {
          workstreamId: "ws_alpha",
          provenance: "automatic",
        },
      },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(slot.inspection.composer.selections).toEqual([{ projectId }]);
    expect(
      screen.queryByRole("button", { name: "Save as default project" }),
    ).toBeNull();
  },
);

it("keeps a picked workstream in a project you choose for this thread only", async () => {
  const { slot, metadataUpdates } = mount(identityDecision, {
    component: ComposerWithProjectPick,
  });
  await act(() => slot.behavior.setComposerText("Port the parser to Beta"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("project-beta"),
  );
  expect(
    await screen.findByRole("button", {
      name: "Save as default project",
    }),
  ).toBeTruthy();
  // Workstreams doesn't move the thread back to Alpha's project.
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "project-beta" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(slot.inspection.composer.submits[0]).toEqual({
    experimental_data: {
      draftKey: expect.any(String),
      projectChoice: { projectId: "project-beta", source: "independent" },
      identity: {
        workstreamId: "ws_alpha",
        proposal: null,
        provenance: "manual",
      },
    },
  });
  expect(metadataUpdates).not.toHaveBeenCalled();
});

it("keeps a picked workstream when you choose another project and BB remounts the composer", async () => {
  draftKey.fixed = "root-draft";
  const { slot } = mount(identityDecision, { component: RemountingComposer });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  await act(async () => {
    await slot.behavior.setComposerScope({
      kind: "new-thread",
      projectId: "project-beta",
    });
  });
  expect(
    screen.getByRole("button", { name: "Workstream: Alpha" }),
  ).toBeTruthy();
  expect(slot.inspection.composer.selections).toEqual([]);
});

it("keeps an explicit project after remounting and receiving a fresh automatic workstream", async () => {
  draftKey.fixed = "automatic-root-draft";
  const { slot, route } = mount(identityDecision, {
    component: RemountingComposer,
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  await act(() =>
    slot.behavior.setComposerScope({
      kind: "new-thread",
      projectId: "project-beta",
    }),
  );
  await typePrompt(slot, "Fix the parser tab handling in Alpha");
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  expect(route).toHaveBeenCalledTimes(2);
  expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "project-beta" },
  ]);
});

it("offers the workstream default under the picker row", async () => {
  mount(identityDecision, { component: PickerRowWithProjectPick });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  const offer = await screen.findByRole("button", {
    name: "Save as default project",
  });
  expect(screen.getByTestId("picker-row").nextElementSibling).toBe(
    offer.closest("[data-ws-picker-note-slot]"),
  );
});

it("changes the workstream's project to the one you chose when asked", async () => {
  const { metadataUpdates } = mount(identityDecision, {
    component: ComposerWithProjectPick,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Save as default project",
    }),
  );
  await screen.findByText("Saved");
  expect(metadataUpdates).toHaveBeenCalledWith({
    workstreamId: "ws_alpha",
    projectId: "project-beta",
  });
});

it("keeps a project you chose when you pick another workstream", async () => {
  const { slot } = mount(identityDecision, {
    component: ComposerWithProjectPick,
    workstreams: [
      { ...projectWorkstreams[0]!, projectId: "project-alpha" },
      { ...projectWorkstreams[1]!, projectId: "project-alpha" },
    ],
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Alpha"));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Pick Beta" }));
  await screen.findByRole("button", { name: "Save as default project" });
  fireEvent.click(screen.getByRole("button", { name: "Workstream: Alpha" }));
  fireEvent.click(await screen.findByText("Beta"));
  await screen.findByRole("button", { name: "Workstream: Beta" });
  expect(slot.inspection.composer.selection?.projectId).toBe("project-beta");
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "project-beta" },
  ]);
  expect(
    await screen.findByRole("button", { name: "Save as default project" }),
  ).toBeTruthy();
});

it("keeps an automatic workstream and uses its No project default", async () => {
  const { slot } = mount(identityDecision, {
    workstreams: [
      {
        id: "ws_alpha",
        name: "Alpha",
        description: "",
        parentId: null,
        aliases: [],
      },
    ],
  });
  await typePrompt(slot, "Fix the parser in Alpha");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Workstream: Alpha" }),
    ).toBeTruthy(),
  );
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.projectId).toBe("proj_personal"),
  );
  expect(slot.inspection.composer.selections).toEqual([
    { projectId: "proj_personal" },
  ]);
});
