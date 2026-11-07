import { describe, expect, it } from "vitest";
import {
  allocateChildColor,
  allocateFamilyColor,
  colorForWorkstream,
  workstreamColorStyle,
  type TopicColor,
} from "../../src/domain/workstreamColor.ts";
import { workstreamHue } from "../../src/domain/workstreamHue.ts";

describe("workstream colors", () => {
  it("chooses stable, separated family anchors and related sibling variants", () => {
    const first = allocateFamilyColor([]);
    const second = allocateFamilyColor([first]);
    expect(first).toEqual({ hue: 47, level: 0 });
    expect(second).toEqual(allocateFamilyColor([first]));
    expect(second.hue).not.toBe(first.hue);
    const siblings: TopicColor[] = [
      allocateChildColor(first, [], [first, second]),
    ];
    for (let i = 1; i < 15; i++)
      siblings.push(allocateChildColor(first, siblings, [...siblings, second]));
    expect(new Set(siblings.map((c) => JSON.stringify(c))).size).toBe(15);
    expect(
      siblings.every(
        (c) =>
          Math.min(
            Math.abs(c.hue - first.hue),
            360 - Math.abs(c.hue - first.hue),
          ) <= 24,
      ),
    ).toBe(true);
  });
  it("resolves topic identity across section recreation and gives unbound sections a fallback", () => {
    const catalog = {
      groups: { old: "topic", recreated: "topic" },
      colors: { topic: { hue: 25, level: 1 as const } },
    };
    expect(colorForWorkstream("old", catalog)).toEqual(catalog.colors.topic);
    expect(colorForWorkstream("recreated", catalog)).toEqual(
      catalog.colors.topic,
    );
    expect(colorForWorkstream("unbound", catalog)).toEqual({
      hue: workstreamHue("unbound"),
      level: 0,
    });
    expect(colorForWorkstream("topic:topic", catalog, "topic")).toEqual(
      catalog.colors.topic,
    );
  });
  it("provides both theme colors and a matching dot without changing the hue", () => {
    const style = workstreamColorStyle({ hue: 95, level: -1 });
    expect(style["--ws-hue"]).toBe("95");
    expect(style["--ws-color-light"]).toMatch(/^oklch\(42\.00% .+ 95\)$/);
    expect(style["--ws-color-dark"]).toMatch(/^oklch\(75\.00% .+ 95\)$/);
    expect(style["--ws-color-dot"]).toMatch(/^oklch\(60\.00% .+ 95\)$/);
  });
});
