// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerStateRealtime } from "../../src/app/serverState.ts";
import { useDockedTurn } from "../../src/app/reply/useDockedTurn.ts";
import {
  useServerState,
  type ServerState,
} from "../../src/app/useWorkstreams.ts";
import {
  STATE_SLICES,
  type ChangeStamp,
  type StateSlice,
} from "../../src/domain/changes.ts";
import { DEFAULT_SNOOZE_PREFS } from "../../src/domain/snooze.ts";
import type { TopicAssignment } from "../../src/domain/topics.ts";

afterEach(cleanup);

type Revisions = ChangeStamp["revisions"];

function stamp(revisions: Partial<Revisions> = {}, epoch = "e1"): ChangeStamp {
  return {
    epoch,
    revisions: {
      ...(Object.fromEntries(STATE_SLICES.map((s) => [s, 0])) as Revisions),
      ...revisions,
    },
  };
}

const assignment = (threadId: string): TopicAssignment => ({
  threadId,
  entityId: null,
  status: "unresolved",
  provenance: null,
  label: null,
  ancestorIds: [],
  evidence: null,
  inheritedFrom: null,
});

/** A server whose slices and revisions the test moves. */
function server() {
  const world = {
    changes: stamp(),
    state: {
      analysis: {},
      recaps: {},
      dismissedRecaps: [],
      pendingSuggestions: 1,
      order: { workstreams: [], threads: {}, prioritized: [] },
      snoozes: {},
      snoozePrefs: DEFAULT_SNOOZE_PREFS,
      catalog: {
        entities: [],
        groups: {},
        assignments: { live: assignment("live") },
        revision: 1,
      },
    } as Required<
      Omit<ServerState, "ready" | "loaded" | "catalog" | "dismissedRecaps">
    > &
      Pick<ServerState, "dismissedRecaps"> & {
        catalog: NonNullable<ServerState["catalog"]>;
      },
  };
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const fields: Record<StateSlice, (keyof typeof world.state)[]> = {
    analysis: ["analysis"],
    recaps: ["recaps", "dismissedRecaps"],
    order: ["order"],
    snoozes: ["snoozes", "snoozePrefs"],
    catalog: ["catalog"],
    suggestions: ["pendingSuggestions"],
  };
  const state = vi.fn(async () =>
    copy({ ...world.state, changes: world.changes }),
  );
  const stateSlices = vi.fn(async (input: unknown) => {
    const { slices } = input as { slices: StateSlice[] };
    return copy({
      changes: world.changes,
      ...Object.fromEntries(
        slices.flatMap((slice) =>
          fields[slice].map((field) => [field, world.state[field]]),
        ),
      ),
    });
  });
  const bump = (...slices: StateSlice[]) => {
    const revisions = { ...world.changes.revisions };
    for (const slice of slices) revisions[slice] += 1;
    world.changes = { epoch: world.changes.epoch, revisions };
  };
  return { world, state, stateSlices, bump };
}

describe("slice-scoped state reads", () => {
  function mount(rpc: Record<string, (input: unknown) => unknown>) {
    const seen: ServerState[] = [];
    function Consumer() {
      const { server } = useServerState();
      seen.push(server);
      return (
        <output data-testid="suggestions">
          {server.pendingSuggestions ?? 0}
        </output>
      );
    }
    function Suite() {
      return (
        <>
          <ServerStateRealtime />
          <Consumer />
        </>
      );
    }
    const slot = renderSlot({ component: Suite }, {}, { rpc });
    return { slot, seen };
  }

  it("reads only the slices whose revision moved", async () => {
    const s = server();
    const { slot, seen } = mount({
      state: s.state,
      stateSlices: s.stateSlices,
    });
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        within(slot.container).getByTestId("suggestions").textContent,
      ).toBe("1"),
    );
    const before = seen.at(-1)!;

    s.world.state.pendingSuggestions = 4;
    s.bump("suggestions");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() =>
      expect(
        within(slot.container).getByTestId("suggestions").textContent,
      ).toBe("4"),
    );
    expect(s.stateSlices).toHaveBeenCalledTimes(1);
    expect(s.stateSlices).toHaveBeenLastCalledWith({ slices: ["suggestions"] });
    expect(s.state).toHaveBeenCalledTimes(1);
    // Slices it did not read keep their identity.
    const after = seen.at(-1)!;
    expect(after.catalog).toBe(before.catalog);
    expect(after.order).toBe(before.order);

    // A signal whose revisions the client already holds reads nothing.
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.stateSlices).toHaveBeenCalledTimes(1);
    expect(s.state).toHaveBeenCalledTimes(1);
  });

  it("heals a missed signal from the next one's revisions", async () => {
    const s = server();
    const { slot } = mount({ state: s.state, stateSlices: s.stateSlices });
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(1));
    // This signal never reaches the client.
    s.world.state.pendingSuggestions = 7;
    s.bump("suggestions");
    s.bump("order");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() => expect(s.stateSlices).toHaveBeenCalledTimes(1));
    expect(s.stateSlices).toHaveBeenLastCalledWith({
      slices: ["order", "suggestions"],
    });
    await waitFor(() =>
      expect(
        within(slot.container).getByTestId("suggestions").textContent,
      ).toBe("7"),
    );
  });

  it("reads everything after a restart or a signal without revisions", async () => {
    const s = server();
    const { slot } = mount({ state: s.state, stateSlices: s.stateSlices });
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(1));
    s.world.changes = stamp({ suggestions: 1 }, "e2");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(2));
    await slot.behavior.emitRealtime("changed", {});
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(3));
    expect(s.stateSlices).not.toHaveBeenCalled();
  });

  it("re-reads everything when a slice read meets a restarted server", async () => {
    const s = server();
    const { slot } = mount({ state: s.state, stateSlices: s.stateSlices });
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(1));
    s.bump("recaps");
    const signal = s.world.changes;
    s.world.changes = stamp({}, "e2");
    await slot.behavior.emitRealtime("changed", signal);
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(2));
    expect(s.stateSlices).toHaveBeenCalledTimes(1);
  });

  it("keeps an optimistic reorder through a slice read during the write", async () => {
    const s = server();
    let finish!: () => void;
    const reorder = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              order: { workstreams: ["a"], threads: {}, prioritized: [] },
            });
        }),
    );
    let actions!: ReturnType<typeof useServerState>;
    function Suite() {
      actions = useServerState();
      return (
        <>
          <ServerStateRealtime />
          <output data-testid="order">
            {actions.server.order.workstreams.join(",")}
          </output>
        </>
      );
    }
    const slot = renderSlot(
      { component: Suite },
      {},
      { rpc: { state: s.state, stateSlices: s.stateSlices, reorder } },
    );
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(1));
    const write = actions.reorder({ kind: "workstreams", ids: ["a"] });
    await waitFor(() =>
      expect(within(slot.container).getByTestId("order").textContent).toBe("a"),
    );
    s.bump("order");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    // A read during a write is never published, so it reads everything.
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(within(slot.container).getByTestId("order").textContent).toBe("a");
    s.world.state.order = { workstreams: ["a"], threads: {}, prioritized: [] };
    finish();
    await write;
    // The write's end reads everything again, which acknowledges it.
    await waitFor(() => expect(s.state).toHaveBeenCalledTimes(3));
    expect(within(slot.container).getByTestId("order").textContent).toBe("a");
  });
});

describe("records of threads outside the snapshot", () => {
  it("reads an archived thread's record once for all its blocks", async () => {
    const s = server();
    s.world.state.recaps = { live: { id: "r-live", turnId: "turn" } as never };
    const recapGet = vi.fn(async (input: unknown) => ({
      recap: { id: "r-old", turnId: "turn-old" },
      dismissed: false,
      waitingCancelled: false,
      capped: false,
      corrections: 0,
      assignment: assignment((input as { threadId: string }).threadId),
      files: null,
    }));
    function Block({ turnId }: { turnId: string }) {
      const docked = useDockedTurn("archived", turnId);
      return <output data-testid={`block-${turnId}`}>{String(docked)}</output>;
    }
    function Suite() {
      return (
        <>
          <ServerStateRealtime />
          <Block turnId="turn-old" />
          <Block turnId="turn-older" />
          <Block turnId="turn-oldest" />
        </>
      );
    }
    const slot = renderSlot(
      { component: Suite },
      {},
      {
        rpc: {
          state: s.state,
          stateSlices: s.stateSlices,
          recap_get: recapGet,
        },
      },
    );
    const text = (turnId: string) =>
      within(slot.container).getByTestId(`block-${turnId}`).textContent;
    // Withheld while it loads, then decided by the thread's own record.
    expect(text("turn-old")).toBe("null");
    await waitFor(() => expect(text("turn-old")).toBe("true"));
    expect(text("turn-older")).toBe("false");
    expect(recapGet).toHaveBeenCalledTimes(1);

    // Another thread's turn leaves the record alone.
    s.bump("recaps");
    await slot.behavior.emitRealtime("changed", {
      ...s.world.changes,
      threadIds: ["live"],
    });
    await waitFor(() => expect(s.stateSlices).toHaveBeenCalledTimes(1));
    // So does a change that names no threads and leaves topics alone.
    s.bump("analysis", "recaps", "order", "snoozes", "suggestions");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() => expect(s.stateSlices).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(recapGet).toHaveBeenCalledTimes(1);

    // A write to this thread's recap reads it again.
    recapGet.mockImplementation(async (input) => ({
      recap: { id: "r-old", turnId: "turn-old" },
      dismissed: true,
      waitingCancelled: false,
      capped: false,
      corrections: 0,
      assignment: assignment((input as { threadId: string }).threadId),
      files: null,
    }));
    s.bump("recaps");
    await slot.behavior.emitRealtime("changed", {
      ...s.world.changes,
      threadIds: ["archived"],
    });
    await waitFor(() => expect(text("turn-old")).toBe("false"));
    expect(recapGet).toHaveBeenCalledTimes(2);

    // A topic change moves the catalog revision, which may relabel it.
    s.world.state.catalog = { ...s.world.state.catalog, revision: 2 };
    s.bump("catalog");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() => expect(recapGet).toHaveBeenCalledTimes(3));
  });

  it("keeps a thread's last value while it moves out of the snapshot", async () => {
    const s = server();
    s.world.state.recaps = { live: { id: "r1", turnId: "turn" } as never };
    let release!: () => void;
    const recapGet = vi.fn(
      (_input: unknown) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              recap: { id: "r1", turnId: "turn" },
              dismissed: false,
              waitingCancelled: false,
              capped: false,
              corrections: 0,
              assignment: assignment("live"),
              files: null,
            });
        }),
    );
    const values: (boolean | null)[] = [];
    function Block() {
      const docked = useDockedTurn("live", "turn");
      values.push(docked);
      return <output data-testid="block">{String(docked)}</output>;
    }
    const slot = renderSlot(
      {
        component: () => (
          <>
            <ServerStateRealtime />
            <Block />
          </>
        ),
      },
      {},
      {
        rpc: {
          state: s.state,
          stateSlices: s.stateSlices,
          recap_get: recapGet,
        },
      },
    );
    await waitFor(() =>
      expect(within(slot.container).getByTestId("block").textContent).toBe(
        "true",
      ),
    );
    // Archived: the snapshot no longer carries it.
    s.world.state.recaps = {};
    s.world.state.catalog = { ...s.world.state.catalog, assignments: {} };
    s.bump("recaps", "catalog");
    await slot.behavior.emitRealtime("changed", s.world.changes);
    await waitFor(() => expect(recapGet).toHaveBeenCalledTimes(1));
    expect(within(slot.container).getByTestId("block").textContent).toBe(
      "true",
    );
    release();
    await waitFor(() => expect(values.length).toBeGreaterThan(2));
    expect(values.filter((value) => value !== true)).toEqual([null]);
  });
});
