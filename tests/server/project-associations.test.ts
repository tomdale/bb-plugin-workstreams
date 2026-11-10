import { createTestPluginHost } from "./test-host.ts";
import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { setMeta } from "../../src/server/db.ts";
import { openDatabase } from "../../src/server/db.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { Journal } from "../../src/server/journal.ts";
import { WorkstreamService } from "../../src/server/service.ts";
import { ProjectAssociations } from "../../src/server/projectAssociations.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function world() {
  const threads: ReturnType<typeof makeThreadResponse>[] = [];
  const listings = { threads: 0, projects: 0 };
  const projects = [
    { id: "p1", name: "One", sources: [] },
    { id: "p2", name: "Two", sources: [] },
  ];
  const { bb, harness } = createTestPluginHost({
    sdk: {
      threads: {
        list: async (args) => {
          listings.threads++;
          return threads
            .filter((t) => Boolean(t.archivedAt) === Boolean(args?.archived))
            .slice(
              args?.offset ?? 0,
              (args?.offset ?? 0) + (args?.limit ?? 100),
            );
        },
      },
      projects: {
        list: async () => {
          listings.projects++;
          return [...projects] as never;
        },
      },
    },
  });
  const db = openDatabase(bb);
  const topics = new TopicStore(db);
  const journal = new Journal(db);
  const service = new WorkstreamService(
    () => bb.sdk,
    db,
    journal,
    () => {},
  );
  const deps = {
    db,
    sdk: () => bb.sdk,
    topics,
    journal,
    exclusive: <T>(task: () => Promise<T>) => service.exclusive(task),
    onChange: () => {},
  };
  let learning = new ProjectAssociations(deps);
  cleanup.push(async () => {
    learning.dispose();
    await harness.lifecycle.dispose();
  });
  const topic = topics.create("Parser");
  function add(
    id: string,
    patch: Partial<ReturnType<typeof makeThreadResponse>> = {},
  ) {
    const thread = makeThreadResponse({
      id,
      projectId: "p1",
      createdAt: 1,
      ...patch,
    });
    threads.push(thread);
    if (!thread.parentThreadId)
      topics.assign(id, topic.id, { provenance: "manual" });
    return thread;
  }
  function history() {
    for (let i = 0; i < 3; i++)
      add(`root-${i}`, i === 0 ? { archivedAt: 2 } : {});
  }
  return {
    db,
    listings,
    topics,
    journal,
    service,
    topic,
    threads,
    projects,
    add,
    addIndependent(id: string, projectId: string) {
      const thread = add(id, { projectId, createdAt: Date.now() + 1000 });
      learning.recordChoice(thread, { projectId, source: "independent" });
      return thread;
    },
    history,
    get learning() {
      return learning;
    },
    restart() {
      learning.dispose();
      learning = new ProjectAssociations(deps);
    },
    current: () => topics.getById(topic.id)!,
  };
}

it("learns from three independent historical roots, including archived work, and journals supporting threads once", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  expect(w.current()).toMatchObject({
    projectId: "p1",
    projectSource: "learned",
  });
  const entry = w.journal.list()[0]!;
  expect(entry).toMatchObject({
    action: "project-association",
    source: "auto",
  });
  expect(entry.threads).toHaveLength(3);
  await w.learning.reconcile();
  w.restart();
  await w.learning.reconcile();
  expect(w.journal.list()).toHaveLength(1);
});

it("does not count delegates, forks, plugin-created roots, hidden work, or Personal", async () => {
  const w = world();
  w.add("one");
  for (let i = 0; i < 3; i++) {
    w.add(`child-${i}`, { parentThreadId: "one" });
    w.add(`fork-${i}`, { sourceThreadId: "one" });
    w.add(`plugin-${i}`, { originPluginId: "plugin" });
    w.add(`hidden-${i}`, { visibility: "hidden" });
    w.add(`personal-${i}`, { projectId: "proj_personal" });
  }
  await w.learning.reconcile();
  expect(w.current().projectId).toBeNull();
  w.add("two");
  w.add("three");
  // Historical roots arrive only with a sweep of BB's threads.
  await w.learning.reconcile({ sweep: true });
  expect(w.current().projectId).toBe("p1");
});

it("requires provenance for new roots and never lets supplied projects reinforce learning", async () => {
  const w = world();
  const fresh = Array.from({ length: 3 }, (_, i) =>
    w.add(`new-${i}`, { createdAt: Date.now() + 1000 }),
  );
  await w.learning.reconcile();
  expect(w.current().projectId).toBeNull();
  for (const thread of fresh)
    w.learning.recordChoice(thread, { projectId: "p1", source: "workstreams" });
  w.restart();
  for (const thread of fresh)
    w.learning.recordChoice(thread, { projectId: "p1", source: "independent" });
  await w.learning.reconcile();
  expect(w.current().projectId).toBeNull();
  for (let i = 0; i < 3; i++) {
    const thread = w.add(`chosen-${i}`, { createdAt: Date.now() + 1000 });
    w.learning.recordChoice(thread, { projectId: "p1", source: "independent" });
  }
  await w.learning.reconcile();
  expect(w.current().projectId).toBe("p1");
});

it("preserves draft provenance through reloads and distinguishes a later user project change", () => {
  const w = world();
  expect(
    w.learning.draftChoice("draft", { projectId: "p1", source: "workstreams" })
      ?.source,
  ).toBe("workstreams");
  w.restart();
  expect(
    w.learning.draftChoice("draft", { projectId: "p1", source: "independent" })
      ?.source,
  ).toBe("workstreams");
  expect(
    w.learning.draftChoice("draft", { projectId: "p2", source: "independent" })
      ?.source,
  ).toBe("independent");
});

it("suggests removing a learned association for mixed history, without changing it until acceptance", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  w.addIndependent("other", "p2");
  await w.learning.reconcile();
  expect(w.current().projectId).toBe("p1");
  const suggestion = w.learning.state()[0]!;
  expect(suggestion).toMatchObject({ fromProject: "One", toProject: null });
  expect(suggestion.threads).toHaveLength(4);
  const entry = await w.learning.decide(suggestion.id, "accept");
  expect(w.current()).toMatchObject({
    projectId: null,
    projectSource: "disabled",
  });
  await w.service.undo(entry.id);
  expect(w.current()).toMatchObject({
    projectId: "p1",
    projectSource: "learned",
  });
});

it("keeps declined corrections declined as more evidence arrives and after restart", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  w.addIndependent("other", "p2");
  await w.learning.reconcile();
  const suggestion = w.learning.state()[0]!;
  await w.learning.decide(suggestion.id, "decline");
  w.addIndependent("more", "p2");
  w.restart();
  await w.learning.reconcile();
  expect(w.learning.state()).toEqual([]);
  expect(w.current().projectId).toBe("p1");
  expect(w.journal.list()[0]).toMatchObject({ status: "dismissed" });
});

it("remembers manual opt-out and can explicitly return to automatic learning", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  w.learning.updateMetadata(w.topic.id, { projectId: null });
  w.restart();
  await w.learning.reconcile();
  expect(w.current()).toMatchObject({
    projectId: null,
    projectSource: "disabled",
  });
  w.learning.updateMetadata(w.topic.id, { projectAutomatic: true });
  await w.learning.reconcile();
  expect(w.current()).toMatchObject({
    projectId: "p1",
    projectSource: "learned",
  });
});

it("undoing an automatic association opts out instead of immediately learning it again", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  await w.service.undo(w.journal.list()[0]!.id);
  w.restart();
  await w.learning.reconcile();
  expect(w.current()).toMatchObject({
    projectId: null,
    projectSource: "disabled",
  });
});

it("lets a user pin a learned project and refuses stale suggestions and stale undo", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  const learned = w.journal.list()[0]!;
  w.addIndependent("other", "p2");
  await w.learning.reconcile();
  const suggestion = w.learning.state()[0]!;
  w.learning.updateMetadata(w.topic.id, { projectId: "p1" });
  await expect(w.learning.decide(suggestion.id, "accept")).rejects.toThrow(
    /out of date/,
  );
  await expect(w.service.undo(learned.id)).rejects.toThrow(/Nothing to undo/);
  expect(w.current()).toMatchObject({
    projectId: "p1",
    projectSource: "manual",
  });
  expect(w.learning.state()).toEqual([]);
});

it("revalidates supporting history before accepting and never applies a vanished correction", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  w.addIndependent("other", "p2");
  await w.learning.reconcile();
  const suggestion = w.learning.state()[0]!;
  w.threads.splice(
    w.threads.findIndex((thread) => thread.id === "other"),
    1,
  );
  await expect(w.learning.decide(suggestion.id, "accept")).rejects.toThrow(
    /out of date/,
  );
  expect(w.current().projectId).toBe("p1");
});

it("paginates archived history and declines unavailable project candidates", async () => {
  const w = world();
  for (let i = 0; i < 101; i++) w.add(`archived-${i}`, { archivedAt: 2 });
  w.projects.splice(0, 1);
  await w.learning.reconcile();
  expect(w.current().projectId).toBeNull();
  w.projects.push({ id: "p1", name: "One", sources: [] });
  await w.learning.reconcile();
  expect(w.current().projectId).toBe("p1");
  expect(w.journal.list()[0]?.threads).toHaveLength(101);
});

it("plans from stored history after its first sweep, counting archived roots, and sweeps again after a day", async () => {
  const w = world();
  w.add("archived-1", { archivedAt: 2 });
  w.add("archived-2", { archivedAt: 2 });
  await w.learning.reconcile();
  expect(w.listings.threads).toBe(2);
  expect(w.current().projectId).toBeNull();

  // A restart reads no threads, and a new independent root joins the
  // archived ones without another listing.
  w.restart();
  w.addIndependent("fresh", "p1");
  await w.learning.reconcile();
  await w.learning.reconcile();
  expect(w.listings.threads).toBe(2);
  expect(w.current().projectId).toBe("p1");
  expect(
    w.journal
      .list()[0]!
      .threads.map((t) => t.id)
      .sort(),
  ).toEqual(["archived-1", "archived-2", "fresh"]);

  setMeta(w.db, "project-learning-swept-at", String(Date.now() - 86_400_000));
  await w.learning.reconcile();
  expect(w.listings.threads).toBe(4);
});

it("reads projects again only when stale or when a thread uses one it has not seen", async () => {
  const w = world();
  w.history();
  await w.learning.reconcile();
  await w.learning.reconcile();
  expect(w.listings.projects).toBe(1);
  w.projects.push({ id: "p3", name: "Three", sources: [] });
  w.addIndependent("elsewhere", "p3");
  await w.learning.reconcile();
  expect(w.listings.projects).toBe(2);
});

it("stops counting a root whose project moved, and forgets one the sweep no longer finds", async () => {
  const w = world();
  w.history();
  w.add("root-3");
  await w.learning.reconcile();
  w.addIndependent("other", "p2");
  await w.learning.reconcile();
  expect(w.learning.state()).toHaveLength(1);

  // The reconciler sees the active root move to the learned project.
  const moved = w.threads.find((thread) => thread.id === "other")!;
  w.learning.observeActive([
    {
      id: moved.id,
      title: "Moved",
      projectId: "p1",
    } as Parameters<typeof w.learning.observeActive>[0][number],
  ]);
  await w.learning.reconcile();
  expect(w.learning.state()).toEqual([]);

  // A deletion missed while the plugin was down waits for the sweep.
  w.threads.splice(
    w.threads.findIndex((thread) => thread.id === "root-3"),
    1,
  );
  const rows = () =>
    w.db
      .prepare(
        "SELECT COUNT(*) AS n FROM ws_project_root WHERE thread_id = 'root-3'",
      )
      .get() as { n: number };
  await w.learning.reconcile();
  expect(rows().n).toBe(1);
  await w.learning.reconcile({ sweep: true });
  expect(rows().n).toBe(0);
});
