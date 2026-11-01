import { createHash, randomUUID } from "node:crypto";
import {
  topicMigrationInput,
  type TopicMigrationInput,
  type TopicMigrationPlan,
} from "../domain/topicMigration.ts";
import {
  assertTopicLevels,
  takesThreads,
  type Topic,
} from "../domain/topics.ts";
import { topicPath } from "../domain/topic-path.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { TopicStore } from "./topics.ts";
import type { Journal } from "./journal.ts";
import { UserError } from "./service.ts";

type Subject = {
  thread_id: string;
  entity_id: string | null;
  source: string;
  evidence: string | null;
};
const KEY = "topic_migration_preview";

/** A topic migration is an explicit reviewed transaction, never a schema migration. */
export class TopicMigration {
  constructor(
    private readonly deps: {
      db: Database;
      topics: TopicStore;
      journal: Journal;
    },
  ) {}

  private subjects(): Subject[] {
    return this.deps.db
      .prepare(
        "SELECT thread_id, entity_id, source, evidence FROM ws_corpus_subject ORDER BY thread_id",
      )
      .all() as Subject[];
  }

  private fingerprint(): string {
    return createHash("sha256")
      .update(JSON.stringify([this.deps.topics.list(), this.subjects()]))
      .digest("hex");
  }

  preview(raw: TopicMigrationInput = {}): TopicMigrationPlan {
    const input = topicMigrationInput.parse(raw);
    const topics = this.deps.topics.list();
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    const fold = new Map<string, string>();
    for (const topic of topics) {
      let at = topic;
      const seen = new Set<string>();
      while (at.parentId && byId.get(at.parentId)?.parentId) {
        if (seen.has(at.id))
          throw new UserError(
            "Repair the topic cycle before previewing a migration.",
          );
        seen.add(at.id);
        at = byId.get(at.parentId)!;
      }
      fold.set(topic.id, at.id);
    }
    const proposed: Topic[] = topics
      .filter((topic) => fold.get(topic.id) === topic.id)
      .map((topic) => ({ ...topic, aliases: [...topic.aliases] }));
    const newIds = new Map<string, string>();
    for (const topic of input.newTopics) {
      if (newIds.has(topic.key) || byId.has(topic.key))
        throw new UserError("New topic keys must be unique.");
      newIds.set(topic.key, randomUUID());
    }
    for (const topic of input.newTopics)
      proposed.push({
        id: newIds.get(topic.key)!,
        name: topic.name,
        description: topic.description,
        parentId: topic.parentId
          ? (newIds.get(topic.parentId) ?? topic.parentId)
          : null,
        aliases: topic.aliases,
        projectId: null,
        projectSource: null,
        projectRevision: 0,
      });
    assertTopicLevels(proposed);
    const removed = topics
      .filter((topic) => fold.get(topic.id) !== topic.id)
      .map((topic) => ({
        id: topic.id,
        path: topicPath(topic.id, topics),
        targetId: fold.get(topic.id)!,
        projectId: topic.projectId ?? null,
        projectSource: topic.projectSource ?? null,
      }));
    for (const topic of removed) {
      const target = proposed.find((item) => item.id === topic.targetId)!;
      if (!target.aliases.includes(topic.path)) target.aliases.push(topic.path);
    }
    const siblings = new Map<string, string>();
    for (const topic of proposed) {
      for (const name of [topic.name, ...topic.aliases]) {
        const key = `${topic.parentId ?? ""}\u0000${name.trim().toLowerCase()}`;
        const previous = siblings.get(key);
        if (previous && previous !== topic.id)
          throw new UserError(`Topic name or alias conflicts: ${name}`);
        siblings.set(key, topic.id);
      }
    }
    const subjects = this.subjects();
    const known = new Set(subjects.map((subject) => subject.thread_id));
    const choices = new Map<string, string>();
    for (const choice of input.choices) {
      if (!known.has(choice.threadId) || choices.has(choice.threadId))
        throw new UserError(
          "Migration choices must name each known assignment at most once.",
        );
      choices.set(
        choice.threadId,
        newIds.get(choice.topicId) ?? choice.topicId,
      );
    }
    const resetIds = new Set(input.resetThreadIds);
    if (
      resetIds.size !== input.resetThreadIds.length ||
      input.resetThreadIds.some((id) => !known.has(id) || choices.has(id))
    )
      throw new UserError(
        "Reset choices must name known assignments once and cannot also refile them.",
      );
    const resets: TopicMigrationPlan["resets"] = [];
    const changes: TopicMigrationPlan["changes"] = [];
    const blockers: TopicMigrationPlan["blockers"] = [];
    for (const subject of subjects) {
      if (resetIds.has(subject.thread_id)) {
        if (subject.source === "manual")
          throw new UserError(
            "A migration reset cannot discard a manual filing choice.",
          );
        if (!subject.entity_id)
          throw new UserError("The assignment is already Unfiled.");
        resets.push({
          threadId: subject.thread_id,
          from: topicPath(subject.entity_id, topics),
          source: subject.source,
        });
        continue;
      }
      if (!subject.entity_id) {
        if (choices.has(subject.thread_id))
          throw new UserError(
            "A topic migration does not file Unfiled threads.",
          );
        continue;
      }
      const destination =
        choices.get(subject.thread_id) ?? fold.get(subject.entity_id);
      const target = proposed.find((topic) => topic.id === destination);
      if (!target)
        throw new UserError("A migration choice names an unknown destination.");
      if (!takesThreads(target.id, proposed)) {
        blockers.push({
          threadId: subject.thread_id,
          topicId: target.id,
          reason:
            "Choose a meaningfully named leaf topic for this stored assignment.",
        });
        continue;
      }
      if (target.id !== subject.entity_id)
        changes.push({
          threadId: subject.thread_id,
          from: topicPath(subject.entity_id, topics),
          to: topicPath(target.id, proposed),
          topicId: target.id,
          source: subject.source,
        });
    }
    for (const topic of removed) {
      const previous = byId.get(topic.id)!;
      if (
        previous.projectSource === "manual" ||
        previous.projectSource === "disabled"
      )
        blockers.push({
          threadId: null,
          topicId: topic.id,
          reason:
            "Review this topic's explicit project association before removing it.",
        });
    }
    const plan = {
      id: randomUUID(),
      fingerprint: this.fingerprint(),
      topics: proposed,
      removed,
      changes,
      resets,
      blockers,
    };
    setMeta(this.deps.db, KEY, JSON.stringify(plan));
    return plan;
  }

  apply(planId: string): { backupId: string; changed: number; reset: number } {
    return this.deps.db.transaction(() => {
      const raw = getMeta(this.deps.db, KEY);
      const plan = raw ? (JSON.parse(raw) as TopicMigrationPlan) : null;
      if (!plan || plan.id !== planId)
        throw new UserError("Preview this topic migration before applying it.");
      if (plan.fingerprint !== this.fingerprint())
        throw new UserError(
          "Topics or assignments changed. Review a fresh migration preview.",
        );
      if (plan.blockers.length)
        throw new UserError(
          "Resolve every migration blocker before applying the plan.",
        );
      if (
        !plan.removed.length &&
        !plan.changes.length &&
        !plan.resets.length &&
        this.deps.topics.list().length === plan.topics.length
      )
        throw new UserError("The migration would change nothing.");
      const backupId = randomUUID();
      setMeta(
        this.deps.db,
        `topic_migration_backup:${backupId}`,
        JSON.stringify({
          at: Date.now(),
          entities: this.deps.db
            .prepare("SELECT * FROM ws_corpus_entity")
            .all(),
          subjects: this.deps.db
            .prepare("SELECT * FROM ws_corpus_subject")
            .all(),
          groups: this.deps.db.prepare("SELECT * FROM ws_corpus_group").all(),
          layout: getMeta(this.deps.db, "layout"),
        }),
      );
      const existing = new Set(
        this.deps.topics.list().map((topic) => topic.id),
      );
      const insert = this.deps.db.prepare(
        "INSERT INTO ws_corpus_entity(id, name, description, parent_id, aliases, origin) VALUES (?, ?, ?, ?, ?, 'user')",
      );
      const pending = plan.topics.filter((topic) => !existing.has(topic.id));
      while (pending.length) {
        const index = pending.findIndex(
          (topic) => !topic.parentId || existing.has(topic.parentId),
        );
        if (index < 0)
          throw new UserError("The migration has invalid new topic ancestry.");
        const [topic] = pending.splice(index, 1);
        insert.run(
          topic!.id,
          topic!.name,
          topic!.description,
          topic!.parentId,
          JSON.stringify(topic!.aliases),
        );
        existing.add(topic!.id);
      }
      for (const topic of plan.topics)
        this.deps.db
          .prepare("UPDATE ws_corpus_entity SET aliases = ? WHERE id = ?")
          .run(JSON.stringify(topic.aliases), topic.id);
      for (const change of plan.changes)
        this.deps.db
          .prepare(
            "UPDATE ws_corpus_subject SET entity_id = ? WHERE thread_id = ?",
          )
          .run(change.topicId, change.threadId);
      for (const reset of plan.resets)
        this.deps.db
          .prepare(
            "DELETE FROM ws_corpus_subject WHERE thread_id = ? AND source <> 'manual'",
          )
          .run(reset.threadId);
      for (const topic of [...plan.removed].sort(
        (a, b) => b.path.split(":").length - a.path.split(":").length,
      )) {
        this.deps.db
          .prepare("DELETE FROM ws_corpus_group WHERE entity_id = ?")
          .run(topic.id);
        this.deps.db
          .prepare("DELETE FROM ws_corpus_entity WHERE id = ?")
          .run(topic.id);
      }
      assertTopicLevels(this.deps.topics.list());
      this.deps.topics.bumpRevision();
      this.deps.journal.add({
        action: "batch",
        source: "user",
        rationale: "Applied reviewed two-level topic migration",
        threads: [],
        workstreams: [],
        undo: null,
        detail: `${plan.changes.length} refiled; ${plan.resets.length} classifications reset; recovery snapshot ${backupId}`,
      });
      this.deps.db.prepare("DELETE FROM ws_meta WHERE key = ?").run(KEY);
      return {
        backupId,
        changed: plan.changes.length,
        reset: plan.resets.length,
      };
    })();
  }

  backup(id: string): unknown {
    const raw = getMeta(this.deps.db, `topic_migration_backup:${id}`);
    if (!raw) throw new UserError("Unknown topic migration backup.");
    return JSON.parse(raw);
  }
}
