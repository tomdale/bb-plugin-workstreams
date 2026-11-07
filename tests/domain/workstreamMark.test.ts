import { describe, expect, it } from "vitest";
import {
  MARK_HUE_STEP,
  MARK_SHAPES,
  markHue,
  markHueOffset,
  markShape,
  workstreamAbbreviation,
} from "../../src/domain/workstreamMark.ts";

describe("category markers", () => {
  it("hands out the silhouettes in order and repeats them", () => {
    expect(MARK_SHAPES.map((_, index) => markShape(index))).toEqual([
      ...MARK_SHAPES,
    ]);
    expect(markShape(MARK_SHAPES.length)).toBe(MARK_SHAPES[0]);
    expect(markShape(MARK_SHAPES.length + 2)).toBe(MARK_SHAPES[2]);
  });

  it("steps each category further around the workstream hue", () => {
    expect([0, 1, 2, 5].map(markHueOffset)).toEqual([0, 12, 24, 60]);
    expect(markHueOffset(MARK_SHAPES.length)).toBe(0);
    expect(MARK_HUE_STEP).toBe(12);
  });

  it("resolves a marker's hue from its workstream's own", () => {
    expect([0, 1, 6].map((index) => markHue(47, index))).toEqual([47, 59, 119]);
    expect(markHue(350, 2)).toBe(14);
    expect(markHue(0, 0)).toBe(0);
    expect(markHue(Number.NaN, 1)).toBe(markHueOffset(1));
  });

  it("draws something for an index it would never be given", () => {
    expect(MARK_SHAPES).toContain(markShape(-1));
    expect(markHueOffset(-1)).toBe(0);
    expect(MARK_SHAPES).toContain(markShape(1.5));
    expect(markHueOffset(Number.NaN)).toBe(0);
  });
});

describe("workstream tile characters", () => {
  it("takes the initials of a multi-word name", () => {
    expect(workstreamAbbreviation("Workstreams Plugin")).toBe("WP");
    expect(workstreamAbbreviation("Code Review")).toBe("CR");
    expect(workstreamAbbreviation("Inside Vercel")).toBe("IV");
  });

  it("takes the first two letters of a one-word name", () => {
    expect(workstreamAbbreviation("Vertex")).toBe("VE");
    expect(workstreamAbbreviation("Sandbox")).toBe("SA");
  });

  it("keeps a name with nothing to take from out of the header", () => {
    expect(workstreamAbbreviation("")).toBe("");
    expect(workstreamAbbreviation("   ")).toBe("");
    expect(workstreamAbbreviation("—")).toBe("");
  });

  it("takes a short or non-ASCII name whole", () => {
    expect(workstreamAbbreviation("Q")).toBe("Q");
    expect(workstreamAbbreviation("Édition")).toBe("ÉD");
    expect(workstreamAbbreviation("Ünïcode Stuff")).toBe("ÜS");
  });

  it("separates words on anything that is not a letter or a digit", () => {
    expect(workstreamAbbreviation("bb-plugins 2")).toBe("BP");
    expect(workstreamAbbreviation("Pull Request Reviews")).toBe("PR");
  });
});
