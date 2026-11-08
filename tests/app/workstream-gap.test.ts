import { describe, expect, it } from "vitest";
import { workstreamGap } from "../../src/app/sidebar/workstreamGap.ts";

describe("workstreamGap", () => {
  it("leaves the first workstream unspaced", () => {
    expect(workstreamGap(null, { id: "sec_a", name: "Alpha" }, false)).toBe(0);
  });

  it("separates siblings of one parent by the item gap, none when collapsed", () => {
    const app = { id: "sec_app", name: "Studio: App", label: "Studio: App" };
    const workstreams = {
      id: "sec_ws",
      name: "Studio: Workstreams",
      label: "Studio: Workstreams",
    };
    expect(workstreamGap(app, workstreams, false)).toBe(9);
    expect(workstreamGap(app, workstreams, true)).toBe(0);
  });

  it("widens an inline owner boundary, shrinking when the previous group collapses", () => {
    const app = { id: "sec_app", name: "Studio: App", label: "Studio: App" };
    const cli = { id: "sec_cli", name: "Tools: CLI", label: "Tools: CLI" };
    expect(workstreamGap(app, cli, false)).toBe(22);
    expect(workstreamGap(app, cli, true)).toBe(4);
  });

  it("spaces standalone workstreams without an owner like siblings", () => {
    const prompting = { id: "sec_prompting", name: "Prompting" };
    const quality = { id: "sec_quality", name: "Quality" };
    expect(workstreamGap(prompting, quality, false)).toBe(9);
    expect(workstreamGap(prompting, quality, true)).toBe(0);
  });

  it("treats a single inline owner next to a standalone name as a boundary", () => {
    const app = { id: "sec_app", name: "Studio: App", label: "Studio: App" };
    const quality = { id: "sec_quality", name: "Quality" };
    expect(workstreamGap(app, quality, false)).toBe(22);
    expect(workstreamGap(app, quality, true)).toBe(4);
  });
});
