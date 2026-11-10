// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { NewThreadRouting } from "../../src/app/composer/NewThreadRouting.tsx";
import { fakeWorld } from "../server/fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { TopicStore } from "../../src/server/topics.ts";

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
  vi.useRealTimers();
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

async function mount() {
  let seededAlphaId = "";
  world = await fakeWorld({
    complete: ({ prompt }) =>
      prompt.includes("You name one new agent thread")
        ? JSON.stringify({
            goal: "Fix Alpha parser",
            subjectId: seededAlphaId,
            proposed: null,
          })
        : JSON.stringify({ recap: "r", state: "done" }),
  });
  const w = world;
  const alpha = w.addSection("Alpha");
  const corpus = new TopicStore(openDatabase(w.bb));
  seededAlphaId = corpus.create("Alpha", "Alpha effort").id;
  corpus.edit(seededAlphaId, { projectId: "proj_1", projectSource: "manual" });
  corpus.bindGroup(alpha.id, seededAlphaId);
  w.addThread("a1", { sectionId: alpha.id, title: "Alpha task" });
  await w.harness.behavior.callRpc("refresh", null);
  const methods = ["prefs", "state", "catalog", "preview", "previewCancel"];
  const rpc = Object.fromEntries(
    methods.map((method) => [
      method,
      (input: unknown) => w.harness.behavior.callRpc(method, input),
    ]),
  );
  const options = {
    composer: {
      text: "",
      attachments: [],
      scope: { kind: "new-thread" as const, projectId: "proj_1" },
      selection: { projectId: "proj_1" },
    },
    sdk: {
      projects: { list: (input: never) => w.bb.sdk.projects.list(input) },
      threads: { get: (input: never) => w.bb.sdk.threads.get(input) },
    } as never,
    rpc: rpc as never,
  };
  const slot = renderSlot({ component: RootComposer }, {}, options);
  return { w, slot, options };
}

it("resolves the chip after typing stops, even with a mid-flight remount", async () => {
  const { slot } = await mount();
  await act(() =>
    slot.behavior.setComposerText("Fix the parser in Alpha so it handles tabs"),
  );
  await screen.findByRole("button", { name: "Topic: Alpha" });

  // Remount the banner mid-flight, as the host's scopeKey remount does when
  // the composer project changes: the fresh model must still resolve.
  await act(() =>
    slot.behavior.setComposerText(
      "Fix the parser in Alpha so it handles all tabs",
    ),
  );
  slot.rerender(<RootComposer key="remounted" />);
  await screen.findByRole("button", { name: "Topic: Alpha" });
});

it("stops previewing once the text settles (no classify loop)", async () => {
  const { slot } = await mount();
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  await act(() =>
    slot.behavior.setComposerText("Fix the parser in Alpha so it handles tabs"),
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("button", { name: "Topic: Alpha" })).toBeTruthy();
  const previewCalls = () =>
    slot.inspection.rpcCalls.filter((call) => call.method === "preview").length;
  const before = previewCalls();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(previewCalls()).toBe(before);
});

it("shares one routing model across banners for the same draft", async () => {
  const { slot, options } = await mount();
  // A second, kept-alive composer view of the same draft, as the host keeps
  // around: it must not start a second, racing classifier.
  const slot2 = renderSlot({ component: RootComposer }, {}, options);
  const previewCalls = () =>
    [...slot.inspection.rpcCalls, ...slot2.inspection.rpcCalls].filter(
      (call) => call.method === "preview",
    ).length;

  await act(() =>
    slot.behavior.setComposerText("Fix the parser in Alpha so it handles tabs"),
  );
  await screen.findAllByRole("button", { name: "Topic: Alpha" });
  expect(previewCalls()).toBe(1);
  // Both views show the one model's resolved identity.
  expect(screen.getAllByRole("button", { name: "Topic: Alpha" })).toHaveLength(
    2,
  );

  // A keystroke in the other view settles with exactly one more preview.
  await act(() =>
    slot2.behavior.setComposerText(
      "Fix the parser in Alpha so it handles all tabs",
    ),
  );
  await waitFor(() => expect(previewCalls()).toBe(2));
  await screen.findAllByRole("button", { name: "Topic: Alpha" });
});
