import { describe, expect, it } from "vitest";
import type {
  StreamDeckSnapshot,
  StreamDeckThread,
} from "../../src/domain/streamDeck.ts";
import {
  dialStrip,
  nextKey,
  noticeKey,
  textWidth,
  threadKey,
  waitingCount,
  workstreamArea,
  wrap,
} from "../src/render.ts";

const thread = (
  overrides: Partial<StreamDeckThread> = {},
): StreamDeckThread => ({
  id: "thr_1",
  title: "Adding Stream Deck support",
  workstream: { name: "bb: Workstreams Plugin", color: "#9ec5ff" },
  mark: "needs-you",
  unread: true,
  onYou: true,
  ...overrides,
});

const snapshot = (
  rows: StreamDeckThread[],
  more: StreamDeckThread[] = [],
): StreamDeckSnapshot => ({ protocol: 1, rows, more });

/** The text each `<text>` element draws, in order. */
const texts = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);

describe("wrap", () => {
  it("breaks at spaces and keeps every line inside the width", () => {
    const lines = wrap("Adding Stream Deck support to Workstreams", 20, 124, 6);
    expect(lines.join(" ")).toBe("Adding Stream Deck support to Workstreams");
    for (const line of lines)
      expect(textWidth(line, 20)).toBeLessThanOrEqual(124);
  });

  it("ends the last line with an ellipsis when the text runs past it", () => {
    const lines = wrap("one two three four five six seven eight", 24, 80, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(textWidth(lines[1]!, 24)).toBeLessThanOrEqual(80);
  });

  it("splits a word too long for a line", () => {
    const lines = wrap("Supercalifragilisticexpialidocious", 20, 80, 4);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("Supercalifragilisticexpialidocious");
  });
});

describe("thread key", () => {
  it("draws the mark, the workstream's area, and the title in escaped text", () => {
    const svg = threadKey(thread({ title: "Fixing <script> & 'quotes'" }));
    expect(svg).toContain('fill="#f5a524"');
    // The whole name doesn't fit a key, so it shows the area, cut short.
    expect(texts(svg)[0]).toMatch(/^Works.*…$/);
    expect(texts(svg).slice(1).join(" ")).toBe(
      "Fixing &lt;script&gt; &amp; &#39;quotes&#39;",
    );
  });

  it("draws a read thread's mark as a ring and its title in regular weight", () => {
    const svg = threadKey(thread({ unread: false, mark: "review" }));
    expect(svg).toMatch(/<circle[^>]*fill="none"[^>]*stroke="#4c9aff"/);
    expect(svg).toContain('font-weight="400"');
  });

  it("starts the title at the same height without a mark or workstream", () => {
    const y = (svg: string) =>
      svg.match(/<text x="10" y="(\d+)"[^>]*>Adding/)?.[1];
    const bare = threadKey(thread({ mark: null, workstream: null }));
    expect(bare).not.toContain("<circle");
    expect(texts(bare).join(" ")).toBe("Adding Stream Deck support");
    expect(y(bare)).toBeDefined();
    expect(y(bare)).toBe(y(threadKey(thread())));
  });
});

it("names a workstream's area without its owner", () => {
  expect(workstreamArea("Vercel Agent: Code Review")).toBe("Code Review");
  expect(workstreamArea("Inside Vercel")).toBe("Inside Vercel");
});

it("counts Up Next threads that are unread or wait on you", () => {
  const value = snapshot(
    [thread(), thread({ unread: false, onYou: false, mark: null })],
    [thread({ unread: true, onYou: false, mark: "done" })],
  );
  expect(waitingCount(value)).toBe(2);
  expect(texts(nextKey(value))).toEqual(["2", "Up Next"]);
  expect(nextKey(value)).toContain('fill="#f5a524"');
  expect(texts(nextKey(snapshot([])))).toEqual(["0", "Up Next"]);
  expect(texts(nextKey(null))).toEqual(["–", "Up Next"]);
});

it("marks the dial's place among the Up Next threads", () => {
  const threads = [thread({ id: "a" }), thread({ id: "b", title: "Second" })];
  const svg = dialStrip(threads, 1);
  expect(texts(svg)).toEqual(["Workstreams Plugin", "Second"]);
  expect(
    texts(
      dialStrip(
        [thread({ workstream: { name: "bb: App", color: "#ffffff" } })],
        0,
      ),
    )[0],
  ).toBe("bb: App");
  expect(svg.match(/<circle cx="[\d.]+" cy="91"/g)).toHaveLength(2);
  expect(texts(dialStrip([], 0))).toEqual(["Nothing up next"]);
});

it("says why a key can't show Up Next", () => {
  expect(texts(noticeKey("offline")).join(" ")).toBe("Can&#39;t reach BB");
});
