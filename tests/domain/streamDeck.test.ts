import { expect, it } from "vitest";
import {
  isStreamDeckCommand,
  parseStreamDeckSnapshot,
} from "../../src/domain/streamDeck.ts";
import { workstreamColorHex } from "../../src/domain/workstreamColor.ts";

const thread = {
  id: "thr_1",
  title: "Choosing key layout",
  workstream: { name: "Workstreams: Stream Deck", color: "#7fb4ff" },
  mark: "review",
  unread: false,
  onYou: true,
};

it("reads a snapshot and refuses one this protocol doesn't describe", () => {
  const snapshot = { protocol: 1, rows: [thread], more: [] };
  expect(parseStreamDeckSnapshot(snapshot)).toEqual(snapshot);
  expect(
    parseStreamDeckSnapshot({
      ...snapshot,
      rows: [{ ...thread, workstream: null, mark: null }],
    }),
  ).not.toBeNull();
  for (const bad of [
    null,
    "rows",
    { ...snapshot, protocol: 2 },
    { ...snapshot, more: undefined },
    { ...snapshot, rows: [{ ...thread, mark: "working" }] },
    { ...snapshot, rows: [{ ...thread, title: 4 }] },
    {
      ...snapshot,
      rows: [{ ...thread, workstream: { name: "x", color: "blue" } }],
    },
    // One bad thread would move every thread after it to another key.
    { ...snapshot, rows: [thread, { id: "thr_2" }, thread] },
  ])
    expect(parseStreamDeckSnapshot(bad)).toBeNull();
});

it("recognizes only the Next key's relay", () => {
  expect(isStreamDeckCommand({ command: "next-up-thread" })).toBe(true);
  expect(isStreamDeckCommand({ command: "open" })).toBe(false);
  expect(isStreamDeckCommand(null)).toBe(false);
});

it("gives a workstream color as dark-surface hex", () => {
  const hex = workstreamColorHex({ hue: 47, level: 0 });
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  // A light text color: every channel well above black.
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  expect(Math.max(...channels)).toBeGreaterThan(180);
  expect(workstreamColorHex({ hue: 47, level: 1 })).not.toBe(hex);
});
