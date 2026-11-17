import { afterEach, describe, expect, it } from "vitest";
import {
  applyDelta,
  changeDelta,
  type DeltaWorkstream,
} from "../../src/domain/suggestion-change.ts";
import type { Split, TidyEdit } from "../../src/domain/tidy.ts";
import { openDatabase } from "../../src/server/db.ts";
import { Journal } from "../../src/server/journal.ts";
import { Suggestions } from "../../src/server/suggestions.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { createTestPluginHost } from "./test-host.ts";

/**
 * What the client draws from a suggestion's delta must be what accepting it
 * does. Each case builds the same small world, takes the delta the server
 * sends, accepts the suggestion through the real path, and compares the
 * workstream tree and every thread's workstream.
 */

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

type Ids = Record<string, string>;

/**
 * Billing holds Invoices and Payments (alias "Pay", with an archived thread);
 * Web holds Invoices; Docs and Infra hold threads; Wrap holds an empty Inner; Support
 * holds a thread beside its child workstream Triage; u1 has no workstream.
 */
function world(pluginId: string) {
  const host = createTestPluginHost({ pluginId });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const workstreamStore = new WorkstreamStore(db);
  const id: Ids = {};
  const make = (
    key: string,
    name: string,
    parent?: string,
    aliases?: string[],
  ) =>
    (id[key] = workstreamStore.create(
      name,
      "",
      parent ? id[parent]! : null,
      aliases,
    ).id);
  make("billing", "Billing");
  make("invoices", "Invoices", "billing");
  make("payments", "Payments", "billing", ["Pay"]);
  make("web", "Web");
  make("webInvoices", "Invoices", "web");
  make("docs", "Docs");
  make("infra", "Infra");
  make("support", "Support");
  make("triage", "Triage", "support");
  make("wrap", "Wrap");
  make("inner", "Inner", "wrap");
  const file = (thread: string, workstream: string) =>
    workstreamStore.assign(thread, id[workstream]!);
  file("i1", "invoices");
  file("p1", "payments");
  file("p2", "payments");
  file("archived", "payments");
  file("w1", "webInvoices");
  file("d1", "docs");
  file("d2", "docs");
  file("d3", "docs");
  file("f1", "infra");
  file("tr1", "triage");
  workstreamStore.assign("u1", null);
  // A thread beside a child workstream, which only a repair moves.
  workstreamStore.assign("s1", id.infra!);
  db.prepare(
    "UPDATE ws_thread_workstream SET workstream_id = ? WHERE thread_id = 's1'",
  ).run(id.support!);
  const threads = [
    "i1",
    "p1",
    "p2",
    "w1",
    "d1",
    "d2",
    "d3",
    "f1",
    "tr1",
    "s1",
    "u1",
  ].map((threadId) => ({ id: threadId, title: `Thread ${threadId}` }));
  const suggestions = new Suggestions({
    db,
    inference: null as never,
    workstreamStore,
    journal: new Journal(db),
    model: async () => null as never,
    enabled: () => false,
    threads: () => threads,
    checkout: () => null,
    coordination: () => [],
    onChange: () => {},
    log: () => {},
  });
  return { db, workstreamStore, id, suggestions };
}

type World = ReturnType<typeof world>;

const filingOf = (workstreamStore: WorkstreamStore) =>
  Object.fromEntries(
    Object.values(workstreamStore.assignments())
      .filter((a) => !a.inheritedFrom && a.workstreamId)
      .map((a) => [a.threadId, a.workstreamId]),
  ) as Record<string, string | null>;

/**
 * The tree with every workstream named by its path unless it already existed,
 * so a workstream the accepted change created, under an id the store drew,
 * equals the one the delta named.
 */
function canonical(
  workstreams: readonly DeltaWorkstream[],
  placed: Record<string, string | null>,
  existing: ReadonlySet<string>,
) {
  const byId = new Map(workstreams.map((t) => [t.id, t]));
  const path = (workstreamId: string): string => {
    const t = byId.get(workstreamId)!;
    return t.parentId ? `${path(t.parentId)}/${t.name}` : t.name;
  };
  const key = (workstreamId: string) =>
    existing.has(workstreamId) ? workstreamId : `new:${path(workstreamId)}`;
  return {
    workstreams: workstreams
      .map((t) => [key(t.id), t.parentId ? key(t.parentId) : null, t.name])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    placed: Object.fromEntries(
      Object.entries(placed)
        .filter(([, workstreamId]) => workstreamId)
        .map(([threadId, workstreamId]) => [threadId, key(workstreamId!)])
        .sort(([a], [b]) => a!.localeCompare(b!)),
    ),
  };
}

async function accept(
  w: World,
  kind: "edit" | "split",
  body: TidyEdit | Split,
) {
  (
    w.suggestions as unknown as {
      propose: (...args: unknown[]) => void;
    }
  ).propose("pass", kind, body, "Because", null);
  const [suggestion] = w.suggestions.state().suggestions;
  expect(suggestion?.problem).toBeNull();
  expect(suggestion?.delta).not.toBeNull();
  // The wire omits archived threads' workstreams, so the comparison uses the
  // whole delta, which the server derives from the same tree.
  const whole = changeDelta(body, {
    workstreams: w.workstreamStore.list(),
    threadWorkstream: Object.fromEntries(
      Object.values(w.workstreamStore.assignments())
        .filter((a) => !a.inheritedFrom)
        .map((a) => [a.threadId, a.workstreamId]),
    ),
    title: (id) => id,
  })!;
  const before = {
    workstreams: w.workstreamStore.list().map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
    })),
    placed: filingOf(w.workstreamStore),
  };
  const existing = new Set(before.workstreams.map((t) => t.id));
  const predicted = applyDelta(before.workstreams, before.placed, whole);
  const result = await w.suggestions.decide([suggestion!.id], "accept");
  expect(result.failed).toEqual([]);
  const actual = {
    workstreams: w.workstreamStore.list().map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
    })),
    placed: filingOf(w.workstreamStore),
  };
  expect(canonical(predicted.workstreams, predicted.placed, existing)).toEqual(
    canonical(actual.workstreams, actual.placed, existing),
  );
  // The accepted change did something worth drawing.
  expect(canonical(actual.workstreams, actual.placed, existing)).not.toEqual(
    canonical(before.workstreams, before.placed, existing),
  );
}

describe("a suggestion's delta equals accepting it", () => {
  const edit = (
    name: string,
    make: (id: Ids) => TidyEdit,
  ): [string, "edit" | "split", (id: Ids) => TidyEdit | Split] => [
    name,
    "edit",
    make,
  ];
  const cases: [string, "edit" | "split", (id: Ids) => TidyEdit | Split][] = [
    edit("move-thread", (id) => ({
      op: "move-thread",
      thread: "d1",
      workstream: id.infra!,
    })),
    edit("move of a thread with no workstream", (id) => ({
      op: "move-thread",
      thread: "u1",
      workstream: id.docs!,
    })),
    edit("rename", (id) => ({
      op: "rename",
      workstream: id.docs!,
      name: "Guides",
    })),
    edit("move-workstream", (id) => ({
      op: "move-workstream",
      workstream: id.docs!,
      parent: id.billing!,
    })),
    edit("reparent to the top level with a new name", (id) => ({
      op: "move-workstream",
      workstream: id.invoices!,
      parent: null,
      name: "Billing Invoices",
    })),
    edit("merge of leaf workstreams", (id) => ({
      op: "merge",
      from: id.docs!,
      into: id.infra!,
    })),
    edit("merge of a workstream with an archived thread", (id) => ({
      op: "merge",
      from: id.payments!,
      into: id.invoices!,
    })),
    edit("merge joining child workstreams of the same name", (id) => ({
      op: "merge",
      from: id.web!,
      into: id.billing!,
    })),
    edit("merge into a workstream below the source", (id) => ({
      op: "merge",
      from: id.wrap!,
      into: id.inner!,
    })),
    edit("create adopting workstreams", (id) => ({
      op: "group",
      name: "Writing",
      description: "",
      parent: null,
      children: [id.docs!, id.infra!],
    })),
    edit("create with no workstreams to adopt", () => ({
      op: "group",
      name: "Platform",
      description: "",
      parent: null,
      children: [],
    })),
    [
      "split into new workstreams",
      "split",
      (id) => ({
        workstreamId: id.docs!,
        workstreams: [
          { name: "Guides", description: "", threadIds: ["d1", "d2"] },
          { name: "Reference", description: "", threadIds: ["d3"] },
        ],
      }),
    ],
    [
      "repair moving a group's threads beside its workstreams",
      "split",
      (id) => ({
        workstreamId: id.support!,
        repair: true,
        workstreams: [{ name: "triage", description: "", threadIds: ["s1"] }],
      }),
    ],
  ];
  it.each(cases)("%s", async (name, kind, body) => {
    const w = world(`delta-${name.replace(/\W+/g, "-")}`);
    await accept(w, kind, body(w.id));
  });
});

describe("threads the sidebar does not list", () => {
  it("are left out of the delta when archived, and counted when they move", async () => {
    const w = world("delta-held");
    const propose = (body: unknown) =>
      (
        w.suggestions as unknown as { propose: (...args: unknown[]) => void }
      ).propose("pass", "edit", body, "Because", null);
    // "archived" is in Payments but is not among the visible threads.
    propose({ op: "rename", workstream: w.id.payments!, name: "Pay" });
    const [rename] = w.suggestions.state().suggestions;
    expect(rename!.delta!.held.map((h) => h.threadId).sort()).toEqual([
      "p1",
      "p2",
    ]);
    expect(rename!.delta!.touched).toContain(w.id.payments);
    propose({ op: "merge", from: w.id.payments!, into: w.id.invoices! });
    const merge = w.suggestions.state().suggestions[1]!;
    expect(merge.delta!.archived).toBe(1);
    // Only the two listed threads have a workstream on the wire.
    expect(merge.delta!.assignments.map((a) => a.threadId).sort()).toEqual([
      "p1",
      "p2",
    ]);
    expect(merge.delta!.held.some((h) => h.threadId === "archived")).toBe(
      false,
    );
  });
});
