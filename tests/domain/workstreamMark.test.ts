import { describe, expect, it } from "vitest";
import { workstreamAbbreviation } from "../../src/domain/workstreamMark.ts";

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
