import { expect, it } from "vitest";
import { workstreamPath } from "../../src/domain/workstream-path.ts";
it("distinguishes repeated feature names under different component scopes", () => {
  const workstreams = [
    { id: "p", name: "Lantern", parentId: null, description: "", aliases: [] },
    { id: "a", name: "Archive", parentId: "p", description: "", aliases: [] },
    { id: "b", name: "Sharing", parentId: "p", description: "", aliases: [] },
    { id: "x", name: "Settings", parentId: "a", description: "", aliases: [] },
    { id: "y", name: "Settings", parentId: "b", description: "", aliases: [] },
  ];
  expect(workstreamPath("x", workstreams)).toBe("Lantern › Archive › Settings");
  expect(workstreamPath("y", workstreams)).toBe("Lantern › Sharing › Settings");
});
