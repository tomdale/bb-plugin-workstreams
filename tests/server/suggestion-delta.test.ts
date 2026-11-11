import { afterEach, describe, expect, it } from "vitest";
import {
  applyDelta,
  type DeltaTopic,
} from "../../src/domain/suggestion-change.ts";
import type { Split, TidyEdit } from "../../src/domain/tidy.ts";
import { openDatabase } from "../../src/server/db.ts";
import { Journal } from "../../src/server/journal.ts";
import { Suggestions } from "../../src/server/suggestions.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { createTestPluginHost } from "./test-host.ts";

/**
 * What the client draws from a suggestion's delta must be what accepting it
 * does. Each case builds the same small world, takes the delta the server
 * sends, accepts the suggestion through the real path, and compares the topic
 * tree and every thread's filing.
 */

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

type Ids = Record<string, string>;

/**
 * Billing holds Invoices and Payments (alias "Pay", with an archived thread);
 * Web holds Invoices; Docs and Infra hold threads; Wrap holds an empty Inner; Support
 * holds a thread beside its subtopic Triage; u1 is unfiled.
 */
function world(pluginId: string) {
  const host = createTestPluginHost({ pluginId });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const topics = new TopicStore(db);
  const id: Ids = {};
  const make = (
    key: string,
    name: string,
    parent?: string,
    aliases?: string[],
  ) =>
    (id[key] = topics.create(
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
  const file = (thread: string, topic: string) =>
    topics.assign(thread, id[topic]!);
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
  topics.assign("u1", null);
  // A thread filed beside a subtopic, which only a repair files.
  topics.assign("s1", id.infra!);
  db.prepare(
    "UPDATE ws_corpus_subject SET entity_id = ? WHERE thread_id = 's1'",
  ).run(id.support!);
  const roots = [
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
    topics,
    journal: new Journal(db),
    model: async () => null as never,
    enabled: () => false,
    roots: () => roots,
    checkout: () => null,
    coordination: () => [],
    onChange: () => {},
    log: () => {},
  });
  return { db, topics, id, suggestions };
}

type World = ReturnType<typeof world>;

const filingOf = (topics: TopicStore) =>
  Object.fromEntries(
    Object.values(topics.assignments())
      .filter((a) => !a.inheritedFrom && a.entityId)
      .map((a) => [a.threadId, a.entityId]),
  ) as Record<string, string | null>;

/**
 * The tree with every topic named by its path unless it already existed, so a
 * topic the accepted change created, under an id the store drew, equals the
 * one the delta named.
 */
function canonical(
  topics: readonly DeltaTopic[],
  filing: Record<string, string | null>,
  existing: ReadonlySet<string>,
) {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const path = (topicId: string): string => {
    const t = byId.get(topicId)!;
    return t.parentId ? `${path(t.parentId)}/${t.name}` : t.name;
  };
  const key = (topicId: string) =>
    existing.has(topicId) ? topicId : `new:${path(topicId)}`;
  return {
    topics: topics
      .map((t) => [key(t.id), t.parentId ? key(t.parentId) : null, t.name])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    filing: Object.fromEntries(
      Object.entries(filing)
        .filter(([, topicId]) => topicId)
        .map(([threadId, topicId]) => [threadId, key(topicId!)])
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
  const before = {
    topics: w.topics.list().map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
    })),
    filing: filingOf(w.topics),
  };
  const existing = new Set(before.topics.map((t) => t.id));
  const predicted = applyDelta(
    before.topics,
    before.filing,
    suggestion!.delta!,
  );
  const result = await w.suggestions.decide([suggestion!.id], "accept");
  expect(result.failed).toEqual([]);
  const actual = {
    topics: w.topics.list().map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
    })),
    filing: filingOf(w.topics),
  };
  expect(canonical(predicted.topics, predicted.filing, existing)).toEqual(
    canonical(actual.topics, actual.filing, existing),
  );
  // The accepted change did something worth drawing.
  expect(canonical(actual.topics, actual.filing, existing)).not.toEqual(
    canonical(before.topics, before.filing, existing),
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
    edit("refile", (id) => ({
      op: "move",
      thread: "d1",
      topic: id.infra!,
    })),
    edit("refile of an unfiled thread", (id) => ({
      op: "move",
      thread: "u1",
      topic: id.docs!,
    })),
    edit("rename", (id) => ({ op: "rename", topic: id.docs!, name: "Guides" })),
    edit("reparent", (id) => ({
      op: "reparent",
      topic: id.docs!,
      parent: id.billing!,
    })),
    edit("reparent to the top level with a new name", (id) => ({
      op: "reparent",
      topic: id.invoices!,
      parent: null,
      name: "Billing Invoices",
    })),
    edit("merge of leaf topics", (id) => ({
      op: "merge",
      from: id.docs!,
      into: id.infra!,
    })),
    edit("merge of a topic with an archived thread", (id) => ({
      op: "merge",
      from: id.payments!,
      into: id.invoices!,
    })),
    edit("merge joining subtopics of the same name", (id) => ({
      op: "merge",
      from: id.web!,
      into: id.billing!,
    })),
    edit("merge into a topic below the source", (id) => ({
      op: "merge",
      from: id.wrap!,
      into: id.inner!,
    })),
    edit("create adopting topics", (id) => ({
      op: "create",
      name: "Writing",
      description: "",
      parent: null,
      children: [id.docs!, id.infra!],
    })),
    edit("create with no topics to adopt", () => ({
      op: "create",
      name: "Platform",
      description: "",
      parent: null,
      children: [],
    })),
    [
      "split into new subtopics",
      "split",
      (id) => ({
        topicId: id.docs!,
        subgroups: [
          { name: "Guides", description: "", threadIds: ["d1", "d2"] },
          { name: "Reference", description: "", threadIds: ["d3"] },
        ],
      }),
    ],
    [
      "repair filing a topic's own threads beside its subtopics",
      "split",
      (id) => ({
        topicId: id.support!,
        repair: true,
        subgroups: [{ name: "triage", description: "", threadIds: ["s1"] }],
      }),
    ],
  ];
  it.each(cases)("%s", async (name, kind, body) => {
    const w = world(`delta-${name.replace(/\W+/g, "-")}`);
    await accept(w, kind, body(w.id));
  });
});
