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
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { NewThreadRouting } from "../../src/app/composer/NewThreadRouting.tsx";
import { fakeWorld } from "../server/fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { setComposerPreset } from "../../src/app/composer/preset.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | null = null;
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(async () => {
  cleanup();
  await world?.harness.lifecycle.dispose();
  world = null;
});

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

async function mount(
  answer: Record<string, unknown>,
  options: { inherited?: boolean; deferReports?: boolean } = {},
) {
  let seededAlphaId = "";
  world = await fakeWorld({
    // The composer's preview is the start call's answer for the text sent,
    // so sending it moves and titles the thread with no second call.
    complete: ({ prompt }) =>
      JSON.stringify(
        prompt.includes("You name one new agent thread")
          ? answer.name === "Billing"
            ? {
                title: { verb: "Exporting", subject: "invoices" },
                workstream: null,
                propose: { name: "Billing", description: "", parent: null },
                scopeShift: false,
              }
            : {
                title: { verb: "Fixing", subject: "parser tabs" },
                workstream: seededAlphaId && "alpha",
                propose: null,
                scopeShift: false,
              }
          : { recap: "r", state: "complete" },
      ),
  });
  const w = world;
  const alpha = w.addSection("Alpha");
  const beta = w.addSection("Beta");
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const alphaWorkstream = workstreamStore.create("Alpha", "Alpha effort");
  workstreamStore.edit(alphaWorkstream.id, {
    projectId: "proj_1",
    projectSource: "manual",
  });
  workstreamStore.bindGroup(alpha.id, alphaWorkstream.id);
  const betaWorkstream = workstreamStore.create("Beta", "Beta effort");
  workstreamStore.edit(betaWorkstream.id, {
    projectId: "proj_1",
    projectSource: "manual",
  });
  workstreamStore.bindGroup(beta.id, betaWorkstream.id);
  seededAlphaId = alphaWorkstream.id;
  w.addThread("a1", { sectionId: alpha.id, title: "Alpha task" });
  await w.harness.behavior.callRpc("refresh", null);
  const methods = ["prefs", "state", "tree", "preview", "previewCancel"];
  const deferredReports: (() => Promise<void>)[] = [];
  const rpc = Object.fromEntries(
    methods.map((method) => [
      method,
      (input: unknown) => w.harness.behavior.callRpc(method, input),
    ]),
  );
  rpc.draftIdentity = (input: unknown) => {
    if (!options.deferReports || !(input as { text?: string }).text)
      return w.harness.behavior.callRpc("draftIdentity", input);
    return new Promise((resolve, reject) => {
      deferredReports.push(async () => {
        try {
          resolve(await w.harness.behavior.callRpc("draftIdentity", input));
        } catch (error) {
          reject(error);
        }
      });
    });
  };
  if (options.inherited)
    setComposerPreset({ workstreamId: alphaWorkstream.id }, "Alpha");
  const slot = renderSlot(
    { component: RootComposer },
    {},
    {
      composer: {
        text: "",
        attachments: [],
        scope: { kind: "new-thread", projectId: "proj_1" },
        selection: { projectId: "proj_1" },
      },
      sdk: {
        projects: { list: (input: never) => w.bb.sdk.projects.list(input) },
        threads: { get: (input: never) => w.bb.sdk.threads.get(input) },
      } as never,
      rpc: rpc as never,
    },
  );
  const dispatch = async (prompt: string, repeat = false, native = false) => {
    if (!native) expect(slot.inspection.composer.submits).toHaveLength(1);
    const submission = slot.inspection.composer.submits[0];
    const thread = w.addThread("composed", {
      createdAt: Date.now(),
      title: null,
    });
    const context = makeMessageDispatchHookContext({
      thread,
      input: { text: prompt },
      origin: "app",
      experimental_submission: native
        ? null
        : {
            pluginId: "workstreams",
            data: submission!.experimental_data ?? null,
          },
    });
    const hook = w.harness.registrations.hooks["message.dispatch"]!;
    vi.useFakeTimers();
    try {
      expect(await hook(context)).toEqual({ action: "proceed" });
      if (repeat) expect(await hook(context)).toEqual({ action: "proceed" });
      await act(() => vi.advanceTimersByTimeAsync(0));
    } finally {
      vi.useRealTimers();
    }
  };
  const journal = async () => {
    const result = (await w.harness.behavior.callRpc("journal", null)) as {
      entries: { action: string; source: string; threads: { id: string }[] }[];
    };
    return result.entries.filter((entry) =>
      entry.threads.some((thread) => thread.id === "composed"),
    );
  };
  return {
    w,
    alpha,
    beta,
    alphaWorkstream,
    betaWorkstream,
    workstreamStore: workstreamStore,
    slot,
    dispatch,
    journal,
    dispatchNative: (prompt: string) => dispatch(prompt, false, true),
    releaseReports: async () => {
      for (const report of deferredReports.splice(0)) await report();
    },
  };
}

it.each(["Beta", "No workstream"] as const)(
  "applies the displayed %s choice when native dispatch has no submit metadata",
  async (choice) => {
    const {
      slot,
      workstreamStore: workstreamStore,
      betaWorkstream,
      dispatchNative,
    } = await mount({});
    fireEvent.click(
      await screen.findByRole("button", { name: "Workstream: Automatic" }),
    );
    fireEvent.click(await screen.findByText(choice));
    await screen.findByRole("button", { name: `Workstream: ${choice}` });
    const prompt = "Improve the parser diagnostics for this request";
    await act(() => slot.behavior.setComposerText(prompt));
    await dispatchNative(prompt);
    expect(slot.inspection.composer.submits).toHaveLength(0);
    expect(workstreamStore.assignment("composed")).toMatchObject({
      workstreamId: choice === "Beta" ? betaWorkstream.id : null,
      provenance: "manual",
    });
  },
);

it("applies an inherited workstream when native dispatch has no submit metadata", async () => {
  const {
    slot,
    workstreamStore: workstreamStore,
    alphaWorkstream,
    dispatchNative,
  } = await mount({}, { inherited: true });
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  const prompt = "Improve parser diagnostics in this workstream";
  await act(() => slot.behavior.setComposerText(prompt));
  await dispatchNative(prompt);
  expect(workstreamStore.assignment("composed")).toMatchObject({
    workstreamId: alphaWorkstream.id,
    provenance: "inherited",
  });
});

it("applies an automatic workstream and title when native dispatch has no submit metadata", async () => {
  const {
    w,
    slot,
    workstreamStore: workstreamStore,
    alphaWorkstream,
    dispatchNative,
  } = await mount({});
  const prompt = "Fix the parser in Alpha so it handles tabs";
  await act(() => slot.behavior.setComposerText(prompt));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  const calls = w.completions.length;
  await dispatchNative(prompt);
  await waitFor(() =>
    expect(workstreamStore.assignment("composed")).toMatchObject({
      workstreamId: alphaWorkstream.id,
      provenance: "automatic",
    }),
  );
  await waitFor(() =>
    expect(w.threads.get("composed")?.title).toBe("Fixing parser tabs"),
  );
  expect(w.completions).toHaveLength(calls);
});

it("applies a manually proposed workstream without submit metadata", async () => {
  const {
    slot,
    workstreamStore: workstreamStore,
    dispatchNative,
  } = await mount({});
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.change(screen.getByPlaceholderText("Find a workstream"), {
    target: { value: "Billing" },
  });
  fireEvent.click(
    await screen.findByRole("option", { name: /New workstream “Billing”/ }),
  );
  await screen.findByRole("button", { name: "Workstream: Billing" });
  const prompt = "Add invoice exports for Billing";
  await act(() => slot.behavior.setComposerText(prompt));
  await dispatchNative(prompt);
  expect(workstreamStore.assignment("composed").workstreamId).toBe(
    workstreamStore.list().find((workstream) => workstream.name === "Billing")
      ?.id,
  );
});

it("does not wait for identity reporting before native dispatch and applies a late report", async () => {
  const {
    slot,
    workstreamStore: workstreamStore,
    betaWorkstream,
    dispatchNative,
    releaseReports,
  } = await mount({}, { deferReports: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Workstream: Automatic" }),
  );
  fireEvent.click(await screen.findByText("Beta"));
  await screen.findByRole("button", { name: "Workstream: Beta" });
  const prompt = "Improve parser diagnostics before the preview completes";
  await act(() => slot.behavior.setComposerText(prompt));
  await dispatchNative(prompt);
  // Until the report arrives, the start call chooses the workstream alone.
  expect(workstreamStore.assignment("composed").provenance).not.toBe("manual");
  expect(slot.inspection.composer.submits).toHaveLength(0);
  await act(() => releaseReports());
  expect(workstreamStore.assignment("composed")).toMatchObject({
    workstreamId: betaWorkstream.id,
    provenance: "manual",
  });
});

it("submits classified automatic identity through host metadata and assigns on server", async () => {
  const { w, slot, dispatch } = await mount({
    outcome: "new-thread",
    subject: "Alpha",
    title: "Fix tabs",
  });
  const prompt = "Fix the parser in Alpha so it handles tabs";
  await act(() => slot.behavior.setComposerText(prompt));
  await screen.findByRole("button", { name: "Workstream: Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]!.experimental_data).toMatchObject({
    identity: {
      workstreamId: expect.any(String),
      provenance: "automatic",
    },
  });
  await dispatch(prompt);
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const assignment = workstreamStore.assignment("composed");
  expect(assignment).toMatchObject({
    status: "assigned",
    provenance: "automatic",
  });
  // The composer's preview titles the thread, with no second call.
  await waitFor(() =>
    expect(w.threads.get("composed")?.title).toBe("Fixing parser tabs"),
  );
  expect(w.spawned).toEqual([]);
  expect(w.sent).toEqual([]);
});

it("submits a picked workstream through host metadata", async () => {
  const { w, slot, dispatch } = await mount({
    outcome: "new-thread",
    subject: "Alpha",
    title: "Write docs",
  });
  const prompt = "Write docs for Alpha";
  await act(() => slot.behavior.setComposerText(prompt));
  fireEvent.click(await screen.findByRole("button", { name: /Workstream:/ }));
  fireEvent.click(await screen.findByText("Beta"));
  await screen.findByRole("button", { name: "Workstream: Beta" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]!.experimental_data).toMatchObject({
    identity: {
      workstreamId: expect.any(String),
      provenance: "manual",
    },
  });
  await dispatch(prompt);
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  expect(workstreamStore.assignment("composed").status).toBe("assigned");
  expect(w.spawned).toEqual([]);
});

it("submits a new workstream picked in the UI through host metadata", async () => {
  const { w, slot, dispatch } = await mount({
    outcome: "new-thread",
    title: "Invoice export",
  });
  const prompt = "Add invoice export";
  await act(() => slot.behavior.setComposerText(prompt));
  fireEvent.click(await screen.findByRole("button", { name: /Workstream:/ }));
  const searchInput = screen.getByPlaceholderText("Find a workstream");
  fireEvent.change(searchInput, { target: { value: "Billing" } });
  fireEvent.click(
    await screen.findByRole("option", { name: /New workstream “Billing”/ }),
  );
  await screen.findByRole("button", { name: "Workstream: Billing" });
  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]!.experimental_data).toMatchObject({
    identity: {
      proposal: { name: "Billing", description: "" },
      provenance: "manual",
    },
  });
  await dispatch(prompt);
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const created = workstreamStore.list().find((e) => e.name === "Billing");
  expect(created).toBeDefined();
  expect(workstreamStore.assignment("composed").workstreamId).toBe(created!.id);
});

it("submits a picked No workstream through native submission and leaves the thread without one", async () => {
  const { w, slot, dispatch } = await mount({
    outcome: "new-thread",
    workstream: "Alpha",
    title: "Write docs",
  });
  const prompt = "Task without identity";
  await act(() => slot.behavior.setComposerText(prompt));

  const identityButton = await screen.findByRole("button", {
    name: /Workstream:/,
  });
  fireEvent.click(identityButton);
  const unresolvedOption = await screen.findByRole("option", {
    name: "No workstream",
  });
  fireEvent.click(unresolvedOption);
  await screen.findByRole("button", {
    name: "Workstream: No workstream",
  });

  fireEvent.click(screen.getByRole("button", { name: "Host submit" }));
  await waitFor(() => expect(slot.inspection.composer.submits).toHaveLength(1));
  expect(slot.inspection.composer.submits[0]!.experimental_data).toMatchObject({
    identity: {
      workstreamId: null,
      proposal: null,
      provenance: "manual",
    },
  });
  await dispatch(prompt);
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const assignment = workstreamStore.assignment("composed");
  expect(assignment.status).toBe("none");
});
