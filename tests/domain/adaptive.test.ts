import { describe, expect, it } from "vitest";
import type { Entity } from "../../src/domain/classify.ts";
import { activeHome } from "../../src/domain/regroup.ts";

const entities: Entity[] = [
  { id: "p", name: "Lantern", description: "", parentId: null, aliases: [] },
  { id: "f", name: "Shelves", description: "", parentId: "p", aliases: [] },
  { id: "leaf", name: "Sync", description: "", parentId: "f", aliases: [] },
  { id: "g", name: "Sharing", description: "", parentId: "p", aliases: [] },
];

describe("activeHome", () => {
  it("homes a topic at its nearest active ancestor", () => {
    expect(activeHome("leaf", ["p"], entities)).toBe("p");
    expect(activeHome("leaf", ["p", "f"], entities)).toBe("f");
    expect(activeHome("leaf", ["g"], entities)).toBeNull();
  });
});
