// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRecapPrefs } from "../../../src/app/recap/prefs.ts";
import type { RecapPrefs } from "../../../src/domain/recapPrefs.ts";

afterEach(cleanup);

type Save = ReturnType<typeof useRecapPrefs>["save"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function text(prefs: RecapPrefs | null): string {
  return prefs
    ? `${prefs.layout}:${prefs.replies}:${prefs.required}`
    : "loading";
}

it("shares one snapshot and ignores semantically identical broadcasts", async () => {
  const renders = [0, 0];
  const snapshots: (RecapPrefs | null)[] = [];
  function Consumer({ id }: { id: number }) {
    const { prefs } = useRecapPrefs();
    renders[id]! += 1;
    snapshots[id] = prefs;
    return <output data-testid={`prefs-${id}`}>{text(prefs)}</output>;
  }
  function Suite() {
    return (
      <>
        <Consumer id={0} />
        <Consumer id={1} />
      </>
    );
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    { rpc: { recapPrefs: async () => ({ prefs: { layout: "full" } }) } },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs-1").textContent).toBe("full:false:true"),
  );
  expect(snapshots[0]).toBe(snapshots[1]);
  renders.fill(0);

  await slot.behavior.emitRealtime("recapPrefs", {
    prefs: { layout: "full", required: true },
  });
  await slot.behavior.emitRealtime("recapPrefs", {
    prefs: { layout: "full", corrections: 3 },
  });
  expect(renders).toEqual([0, 0]);

  await slot.behavior.emitRealtime("recapPrefs", {
    prefs: { layout: "minimal" },
  });
  await waitFor(() =>
    expect(slot.getByTestId("prefs-1").textContent).toBe("minimal:false:true"),
  );
  expect(renders).toEqual([1, 1]);
  slot.lifecycle.unmount();
});

it("revalidates the shared snapshot on a fresh mounted lifetime", async () => {
  let stored = { layout: "full" };
  const read = async () => ({ prefs: stored });
  let mounted = true;
  function Current() {
    const { prefs } = useRecapPrefs();
    return <output data-testid="prefs">{text(prefs)}</output>;
  }
  function Host() {
    return mounted ? <Current /> : null;
  }
  const slot = renderSlot(
    { component: Host },
    {},
    { rpc: { recapPrefs: read } },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );

  mounted = false;
  slot.rerender(<Host />);
  stored = { layout: "minimal" };
  mounted = true;
  slot.rerender(<Host />);
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("minimal:false:true"),
  );
  slot.lifecycle.unmount();
});

it("does not let an earlier read replace a later save response", async () => {
  const initial = deferred<{ prefs: unknown }>();
  const saved = deferred<{ prefs: unknown }>();
  let reads = 0;
  const stored = { layout: "minimal", replies: true };
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: () =>
          ++reads === 1 ? initial.promise : Promise.resolve({ prefs: stored }),
        setRecapPrefs: () => saved.promise,
      },
    },
  );
  await act(async () => {});
  expect(reads).toBe(1);
  let saving!: Promise<void>;
  act(() => {
    saving = save({ layout: "minimal" });
  });
  await act(async () => {
    saved.resolve({ prefs: stored });
    await saving;
  });
  await act(async () => {
    initial.resolve({ prefs: { layout: "full", replies: false } });
    await initial.promise;
  });
  await waitFor(() => {
    expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
    expect(reads).toBe(2);
  });
  slot.lifecycle.unmount();
});

it("keeps a save overlaid on a read that began while the save was pending", async () => {
  const olderRead = deferred<{ prefs: unknown }>();
  const finalRead = deferred<{ prefs: unknown }>();
  const saved = deferred<{ prefs: unknown }>();
  let reads = 0;
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: () => {
          reads += 1;
          if (reads === 1)
            return Promise.resolve({
              prefs: { layout: "full", replies: false },
            });
          return reads === 2 ? olderRead.promise : finalRead.promise;
        },
        setRecapPrefs: () => saved.promise,
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );
  let saving!: Promise<void>;
  act(() => {
    saving = save({ layout: "minimal" });
  });
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await act(async () => {});
  expect(reads).toBe(2);

  await act(async () => {
    saved.resolve({ prefs: { layout: "minimal", replies: true } });
    await saving;
  });
  await act(async () => {
    olderRead.resolve({ prefs: { layout: "full", replies: false } });
    await olderRead.promise;
  });
  await waitFor(() => expect(reads).toBe(3));
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  await act(async () => {
    finalRead.resolve({ prefs: { layout: "minimal", replies: true } });
    await finalRead.promise;
  });
  slot.lifecycle.unmount();
});

it("drops settled overlays when a broadcast arrives during a later save", async () => {
  const laterSave = deferred<{ prefs: unknown }>();
  let stored = { layout: "full", replies: false };
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: async () => ({ prefs: stored }),
        setRecapPrefs: (input: unknown) => {
          const { patch } = input as { patch: Partial<RecapPrefs> };
          return patch.layout
            ? Promise.resolve({
                prefs: { layout: "minimal", replies: false },
              })
            : laterSave.promise;
        },
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );
  await act(async () => {
    await save({ layout: "minimal" });
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:false:true");

  let saving!: Promise<void>;
  act(() => {
    saving = save({ replies: true });
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  stored = { layout: "full", replies: true };
  await slot.behavior.emitRealtime("recapPrefs", { prefs: stored });
  expect(slot.getByTestId("prefs").textContent).toBe("full:true:true");
  await act(async () => {
    laterSave.resolve({ prefs: { layout: "minimal", replies: true } });
    await saving;
  });
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:true:true"),
  );
  slot.lifecycle.unmount();
});

it("updates every consumer optimistically and restores the snapshot on failure", async () => {
  const request = deferred<{ prefs: unknown }>();
  let save!: Save;
  function Consumer({ id }: { id: number }) {
    const current = useRecapPrefs();
    if (id === 0) save = current.save;
    return <output data-testid={`prefs-${id}`}>{text(current.prefs)}</output>;
  }
  function Suite() {
    return (
      <>
        <Consumer id={0} />
        <Consumer id={1} />
      </>
    );
  }
  const read = async () => ({ prefs: { layout: "full" } });
  const slot = renderSlot(
    { component: Suite },
    {},
    {
      rpc: {
        recapPrefs: read,
        setRecapPrefs: () => request.promise,
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs-1").textContent).toBe("full:false:true"),
  );
  let saving!: Promise<void>;
  act(() => {
    saving = save({ layout: "minimal" });
  });
  expect(slot.getByTestId("prefs-0").textContent).toBe("minimal:false:true");
  expect(slot.getByTestId("prefs-1").textContent).toBe("minimal:false:true");

  await act(async () => {
    request.reject(new Error("Save failed"));
    await expect(saving).rejects.toThrow("Save failed");
  });
  expect(slot.getByTestId("prefs-0").textContent).toBe("full:false:true");
  expect(slot.getByTestId("prefs-1").textContent).toBe("full:false:true");
  slot.lifecycle.unmount();
});

it("keeps disjoint concurrent writes when their responses arrive out of order", async () => {
  const first = deferred<{ prefs: unknown }>();
  const second = deferred<{ prefs: unknown }>();
  let serverPrefs: Record<string, unknown> = { layout: "full", replies: false };
  const read = async () => ({ prefs: serverPrefs });
  let writes = 0;
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: read,
        setRecapPrefs: () => (++writes === 1 ? first.promise : second.promise),
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );

  let layoutSave!: Promise<void>;
  let repliesSave!: Promise<void>;
  act(() => {
    layoutSave = save({ layout: "minimal" });
    repliesSave = save({ replies: true });
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  serverPrefs = { layout: "minimal", replies: true };

  await act(async () => {
    second.resolve({ prefs: { layout: "full", replies: true } });
    await second.promise;
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  await act(async () => {
    first.resolve({ prefs: { layout: "minimal", replies: false } });
    await first.promise;
    await Promise.all([layoutSave, repliesSave]);
  });
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true"),
  );
  slot.lifecycle.unmount();
});

it("rolls back one failed write without discarding another pending write", async () => {
  const first = deferred<{ prefs: unknown }>();
  const second = deferred<{ prefs: unknown }>();
  let stored = { layout: "full", replies: false };
  let writes = 0;
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: async () => ({ prefs: stored }),
        setRecapPrefs: () => (++writes === 1 ? first.promise : second.promise),
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );

  let layoutSave!: Promise<void>;
  let repliesSave!: Promise<void>;
  act(() => {
    layoutSave = save({ layout: "minimal" });
    repliesSave = save({ replies: true });
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  await act(async () => {
    first.reject(new Error("Layout failed"));
    await expect(layoutSave).rejects.toThrow("Layout failed");
  });
  expect(slot.getByTestId("prefs").textContent).toBe("full:true:true");

  stored = { layout: "full", replies: true };
  await act(async () => {
    second.resolve({ prefs: { layout: "full", replies: true } });
    await repliesSave;
  });
  expect(slot.getByTestId("prefs").textContent).toBe("full:true:true");
  slot.lifecycle.unmount();
});

it("overlays a pending save on live broadcasts and refreshes after reconnecting", async () => {
  const request = deferred<{ prefs: unknown }>();
  let stored = { layout: "full", replies: false };
  const read = async () => ({ prefs: stored });
  let save!: Save;
  function Current() {
    const current = useRecapPrefs();
    save = current.save;
    return <output data-testid="prefs">{text(current.prefs)}</output>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    {
      rpc: {
        recapPrefs: read,
        setRecapPrefs: () => request.promise,
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:false:true"),
  );
  let saving!: Promise<void>;
  act(() => {
    saving = save({ layout: "minimal" });
  });
  await slot.behavior.emitRealtime("recapPrefs", {
    prefs: { layout: "full", replies: true },
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");
  stored = { layout: "minimal", replies: true };
  await act(async () => {
    request.resolve({ prefs: { layout: "minimal", replies: true } });
    await saving;
  });
  expect(slot.getByTestId("prefs").textContent).toBe("minimal:true:true");

  stored = { layout: "full", replies: true };
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await waitFor(() =>
    expect(slot.getByTestId("prefs").textContent).toBe("full:true:true"),
  );
  slot.lifecycle.unmount();
});
