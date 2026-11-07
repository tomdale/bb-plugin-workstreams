import { afterEach, describe, expect, it } from "vitest";
import { createTestPluginHost } from "./test-host.ts";
import { openDatabase } from "../../src/server/db.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { TopicColors } from "../../src/server/topicColors.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
function store() {
  const host = createTestPluginHost({
    pluginId: `topic-colors-${hosts.length}`,
  });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const topics = new TopicStore(db);
  const colors = new TopicColors(db);
  const read = () => {
    const state = topics.state();
    return colors.snapshot(state.entities, state.groups);
  };
  return { db, topics, colors, read };
}
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});
const hueDistance = (a: number, b: number) =>
  Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("topic colors", () => {
  it("survives renaming, section recreation, restarts and new unrelated workstreams", () => {
    const { db, topics, read } = store();
    const parent = topics.create("Alpha");
    const one = topics.create("One", "", parent.id);
    const two = topics.create("Two", "", parent.id);
    topics.bindGroup("sec-one", one.id);
    topics.bindGroup("sec-two", two.id);
    const first = read();
    expect(first[parent.id]).toBeDefined();
    expect(
      hueDistance(first[one.id]!.hue, first[parent.id]!.hue),
    ).toBeLessThanOrEqual(24);
    expect(
      hueDistance(first[two.id]!.hue, first[parent.id]!.hue),
    ).toBeLessThanOrEqual(24);
    expect(first[one.id]).not.toEqual(first[two.id]);
    topics.rename(one.id, "Renamed");
    topics.unbindGroup("sec-one");
    topics.bindGroup("sec-new", one.id);
    const other = topics.create("Other");
    topics.bindGroup("sec-other", other.id);
    const after = read();
    expect(after[one.id]).toEqual(first[one.id]);
    expect(after[two.id]).toEqual(first[two.id]);
    expect(after[parent.id]).toEqual(first[parent.id]);
    const state = topics.state();
    expect(new TopicColors(db).snapshot(state.entities, state.groups)).toEqual(
      after,
    );
  });

  it("reassigns only moved topics to their new family and releases deleted topics", () => {
    const { topics, read } = store();
    const a = topics.create("Alpha"),
      b = topics.create("Beta");
    const one = topics.create("One", "", a.id),
      two = topics.create("Two", "", a.id);
    const target = topics.create("Target", "", b.id);
    topics.bindGroup("sec-one", one.id);
    topics.bindGroup("sec-two", two.id);
    topics.bindGroup("sec-target", target.id);
    const first = read();
    topics.reparent(one.id, b.id);
    const moved = read();
    expect(moved[two.id]).toEqual(first[two.id]);
    expect(moved[target.id]).toEqual(first[target.id]);
    expect(moved[one.id]).not.toEqual(first[one.id]);
    expect(
      hueDistance(moved[one.id]!.hue, moved[b.id]!.hue),
    ).toBeLessThanOrEqual(24);
    topics.merge(one.id, target.id);
    const merged = read();
    expect(merged[one.id]).toBeUndefined();
    expect(merged[target.id]).toEqual(moved[target.id]);
    expect(merged[two.id]).toEqual(moved[two.id]);
  });

  it("allocates fifteen distinct sibling slots and degrades without failing after exhaustion", () => {
    const { topics, read } = store();
    const parent = topics.create("Many");
    const ids = Array.from({ length: 15 }, (_, i) => {
      const topic = topics.create(`Topic ${i}`, "", parent.id);
      topics.bindGroup(`sec-${i}`, topic.id);
      return topic.id;
    });
    const first = read();
    expect(new Set(ids.map((id) => JSON.stringify(first[id]))).size).toBe(15);
    for (let i = 15; i < 24; i++) {
      const topic = topics.create(`Topic ${i}`, "", parent.id);
      topics.bindGroup(`sec-${i}`, topic.id);
      ids.push(topic.id);
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

  it("does not replace a valid stored color for an invalid topic tree", () => {
    const { topics, colors, read } = store();
    const topic = topics.create("Kept");
    topics.bindGroup("sec", topic.id);
    const first = read();
    const corrupt = [{ ...topic, parentId: "missing" }];
    expect(colors.snapshot(corrupt, { sec: topic.id })[topic.id]).toEqual(
      first[topic.id],
    );
    expect(read()[topic.id]).toEqual(first[topic.id]);
  });
});
