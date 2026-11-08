// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foldState,
  mergePresence,
  settleFold,
  type FoldState,
  usePresence,
  type PresenceEntry,
} from "../../src/app/sidebar/motion.ts";

const id = (s: string) => s;
const view = (entries: PresenceEntry<string>[]) =>
  entries.map((e) => `${e.key}:${e.phase}`);

describe("mergePresence", () => {
  it("keeps a leaving item in its place and enters new ones", () => {
    const first = mergePresence([], ["a", "b", "c"], id, true);
    expect(view(first)).toEqual(["a:enter", "b:enter", "c:enter"]);
    const settled = first.map((e) => ({ ...e, phase: "idle" as const }));
    expect(view(mergePresence(settled, ["n", "a", "c"], id, true))).toEqual([
      "n:enter",
      "a:idle",
      "b:leave",
      "c:idle",
    ]);
  });

  it("puts a leaver first when nothing before it remains", () => {
    const before = ["a", "b"].map((key) => ({
      key,
      item: key,
      phase: "idle" as const,
    }));
    expect(view(mergePresence(before, ["b"], id, true))).toEqual([
      "a:leave",
      "b:idle",
    ]);
  });

  it("re-enters an item that returns while leaving", () => {
    const before = [{ key: "a", item: "a", phase: "leave" as const }];
    expect(view(mergePresence(before, ["a"], id, true))).toEqual(["a:enter"]);
  });

  it("is the list exactly without motion", () => {
    const before = [{ key: "a", item: "a", phase: "idle" as const }];
    expect(view(mergePresence(before, ["b"], id, false))).toEqual(["b:idle"]);
  });
});

const closed: FoldState = { render: false, phase: "idle", open: false };
const open: FoldState = { render: true, phase: "idle", open: true };

/** A state's shape, so phase tests read as what is on screen. */
const shape = (state: FoldState) =>
  `${state.render ? "shown" : "unmounted"}:${state.phase}`;

describe("foldState", () => {
  it("enters when it opens, keeping the contents mounted", () => {
    expect(shape(foldState(closed, true, true))).toBe("shown:enter");
  });

  it("leaves when it closes, so the contents can close their height", () => {
    expect(shape(foldState(open, false, true))).toBe("shown:leave");
  });

  it("keeps a running phase while the fold holds still", () => {
    const leaving: FoldState = { render: true, phase: "leave", open: false };
    expect(foldState(leaving, false, true)).toBe(leaving);
    const entering: FoldState = { render: true, phase: "enter", open: true };
    expect(foldState(entering, true, true)).toBe(entering);
  });

  it("re-enters contents that turn back while leaving", () => {
    const leaving: FoldState = { render: true, phase: "leave", open: false };
    expect(shape(foldState(leaving, true, true))).toBe("shown:enter");
  });

  it("is simply open or closed without motion", () => {
    expect(shape(foldState(open, false, false))).toBe("unmounted:idle");
    expect(shape(foldState(closed, true, false))).toBe("shown:idle");
  });
});

describe("settleFold", () => {
  it("idles an open fold and unmounts a closed one", () => {
    expect(
      shape(settleFold({ render: true, phase: "enter", open: true })),
    ).toBe("shown:idle");
    expect(
      shape(settleFold({ render: true, phase: "leave", open: false })),
    ).toBe("unmounted:idle");
  });
});

describe("usePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: () => ({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  it("settles entries with the same deadline in one timeout and commit", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    let commits = 0;
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => {
        commits++;
        return usePresence(items, String);
      },
      { initialProps: { items: ["a", "b"] } },
    );
    timeout.mockClear();
    rerender({ items: ["c", "d"] });
    expect(view(result.current)).toEqual([
      "a:leave",
      "b:leave",
      "c:enter",
      "d:enter",
    ]);
    expect(
      timeout.mock.calls.filter(([, delay]) => delay === 260),
    ).toHaveLength(1);
    commits = 0;
    await act(async () => vi.advanceTimersByTimeAsync(259));
    expect(view(result.current)).toEqual([
      "a:leave",
      "b:leave",
      "c:enter",
      "d:enter",
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(view(result.current)).toEqual(["c:idle", "d:idle"]);
    expect(commits).toBe(1);
  });

  it("keeps a later leave's full duration when replacing an enter", async () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: string[] }) => usePresence(items, String),
      { initialProps: { items: ["a", "b"] } },
    );
    rerender({ items: ["a", "b", "c"] });
    await act(async () => vi.advanceTimersByTimeAsync(100));
    rerender({ items: ["a", "b"] });
    expect(view(result.current)).toEqual(["a:idle", "b:idle", "c:leave"]);
    await act(async () => vi.advanceTimersByTimeAsync(259));
    expect(view(result.current)).toEqual(["a:idle", "b:idle", "c:leave"]);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(view(result.current)).toEqual(["a:idle", "b:idle"]);
  });
});
