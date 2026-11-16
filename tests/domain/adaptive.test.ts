import { describe, expect, it } from "vitest";
import type { Workstream } from "../../src/domain/classify.ts";
import { activeHome } from "../../src/domain/regroup.ts";

const workstreams: Workstream[] = [
  { id: "p", name: "Lantern", description: "", parentId: null, aliases: [] },
  { id: "f", name: "Shelves", description: "", parentId: "p", aliases: [] },
  { id: "leaf", name: "Sync", description: "", parentId: "f", aliases: [] },
  { id: "g", name: "Sharing", description: "", parentId: "p", aliases: [] },
];

describe("activeHome", () => {
  it("homes a topic at its nearest active ancestor", () => {
    expect(activeHome("leaf", ["p"], workstreams)).toBe("p");
    expect(activeHome("leaf", ["p", "f"], workstreams)).toBe("f");
    expect(activeHome("leaf", ["g"], workstreams)).toBeNull();
  });
});
