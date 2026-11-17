import { afterEach, describe, expect, it } from "vitest";
import { createTestPluginHost } from "./test-host.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { WorkstreamColors } from "../../src/server/workstreamColors.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
function store() {
  const host = createTestPluginHost({
    pluginId: `topic-colors-${hosts.length}`,
  });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const workstreamStore = new WorkstreamStore(db);
  const colors = new WorkstreamColors(db);
  const read = () => {
    const state = workstreamStore.state();
    return colors.snapshot(state.workstreams, state.groups);
  };
  return { db, workstreamStore, colors, read };
}
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});
const hueDistance = (a: number, b: number) =>
  Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("workstream colors", () => {
  it("survives renaming, section recreation, restarts and new unrelated workstreams", () => {
    const { db, workstreamStore, read } = store();
    const parent = workstreamStore.create("Alpha");
    const one = workstreamStore.create("One", "", parent.id);
    const two = workstreamStore.create("Two", "", parent.id);
    workstreamStore.bindGroup("sec-one", one.id);
    workstreamStore.bindGroup("sec-two", two.id);
    const first = read();
    expect(first[parent.id]).toBeDefined();
    expect(
      hueDistance(first[one.id]!.hue, first[parent.id]!.hue),
    ).toBeLessThanOrEqual(24);
    expect(
      hueDistance(first[two.id]!.hue, first[parent.id]!.hue),
    ).toBeLessThanOrEqual(24);
    expect(first[one.id]).not.toEqual(first[two.id]);
    workstreamStore.rename(one.id, "Renamed");
    workstreamStore.unbindGroup("sec-one");
    workstreamStore.bindGroup("sec-new", one.id);
    const other = workstreamStore.create("Other");
    workstreamStore.bindGroup("sec-other", other.id);
    const after = read();
    expect(after[one.id]).toEqual(first[one.id]);
    expect(after[two.id]).toEqual(first[two.id]);
    expect(after[parent.id]).toEqual(first[parent.id]);
    const state = workstreamStore.state();
    expect(
      new WorkstreamColors(db).snapshot(state.workstreams, state.groups),
    ).toEqual(after);
  });

  it("reassigns only moved workstreams to their new family and releases deleted ones", () => {
    const { workstreamStore, read } = store();
    const a = workstreamStore.create("Alpha"),
      b = workstreamStore.create("Beta");
    const one = workstreamStore.create("One", "", a.id),
      two = workstreamStore.create("Two", "", a.id);
    const target = workstreamStore.create("Target", "", b.id);
    workstreamStore.bindGroup("sec-one", one.id);
    workstreamStore.bindGroup("sec-two", two.id);
    workstreamStore.bindGroup("sec-target", target.id);
    const first = read();
    workstreamStore.move(one.id, b.id);
    const moved = read();
    expect(moved[two.id]).toEqual(first[two.id]);
    expect(moved[target.id]).toEqual(first[target.id]);
    expect(moved[one.id]).not.toEqual(first[one.id]);
    expect(
      hueDistance(moved[one.id]!.hue, moved[b.id]!.hue),
    ).toBeLessThanOrEqual(24);
    workstreamStore.merge(one.id, target.id);
    const merged = read();
    expect(merged[one.id]).toBeUndefined();
    expect(merged[target.id]).toEqual(moved[target.id]);
    expect(merged[two.id]).toEqual(moved[two.id]);
  });

  it("allocates fifteen distinct sibling slots and degrades without failing after exhaustion", () => {
    const { workstreamStore, read } = store();
    const parent = workstreamStore.create("Many");
    const ids = Array.from({ length: 15 }, (_, i) => {
      const workstream = workstreamStore.create(
        `Workstream ${i}`,
        "",
        parent.id,
      );
      workstreamStore.bindGroup(`sec-${i}`, workstream.id);
      return workstream.id;
    });
    const first = read();
    expect(new Set(ids.map((id) => JSON.stringify(first[id]))).size).toBe(15);
    for (let i = 15; i < 24; i++) {
      const workstream = workstreamStore.create(
        `Workstream ${i}`,
        "",
        parent.id,
      );
      workstreamStore.bindGroup(`sec-${i}`, workstream.id);
      ids.push(workstream.id);
    }
    const colors = read();
    expect(
      ids
        .slice(0, 15)
        .every(
          (id) => JSON.stringify(colors[id]) === JSON.stringify(first[id]),
        ),
    ).toBe(true);
    expect(ids.every((id) => colors[id])).toBe(true);
    expect(read()).toEqual(colors);
  });

  it("does not replace a valid stored color for an invalid workstream tree", () => {
    const { workstreamStore, colors, read } = store();
    const workstream = workstreamStore.create("Kept");
    workstreamStore.bindGroup("sec", workstream.id);
    const first = read();
    const corrupt = [{ ...workstream, parentId: "missing" }];
    expect(
      colors.snapshot(corrupt, { sec: workstream.id })[workstream.id],
    ).toEqual(first[workstream.id]);
    expect(read()[workstream.id]).toEqual(first[workstream.id]);
  });
});
