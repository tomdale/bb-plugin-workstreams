import { describe, expect, it } from "vitest";
import {
  allocateChildColor,
  allocateFamilyColor,
  colorForWorkstream,
  workstreamColorStyle,
  type WorkstreamColor,
} from "../../src/domain/workstreamColor.ts";
import { workstreamHue } from "../../src/domain/workstreamHue.ts";

describe("workstream colors", () => {
  it("chooses stable, separated family anchors and related sibling variants", () => {
    const first = allocateFamilyColor([]);
    const second = allocateFamilyColor([first]);
    expect(first).toEqual({ hue: 47, level: 0 });
    expect(second).toEqual(allocateFamilyColor([first]));
    expect(second.hue).not.toBe(first.hue);
    const siblings: WorkstreamColor[] = [
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
  it("resolves workstream identity across section recreation and gives unbound sections a fallback", () => {
    const tree = {
      groups: { old: "workstream", recreated: "workstream" },
      colors: { workstream: { hue: 25, level: 1 as const } },
    };
    expect(colorForWorkstream("old", tree)).toEqual(tree.colors.workstream);
    expect(colorForWorkstream("recreated", tree)).toEqual(
      tree.colors.workstream,
    );
    expect(colorForWorkstream("unbound", tree)).toEqual({
      hue: workstreamHue("unbound"),
      level: 0,
    });
    expect(colorForWorkstream("section:section", tree, "workstream")).toEqual(
      tree.colors.workstream,
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
