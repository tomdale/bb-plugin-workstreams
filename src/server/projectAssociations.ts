import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProjectChoice } from "../domain/projectChoice.ts";
import {
  projectLearningPlan,
  type ProjectLearningDecision,
  type ProjectRoot,
} from "../domain/projectLearning.ts";
import { topicPath } from "../domain/topic-path.ts";
import { topicAncestors, type Topic } from "../domain/topics.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { Journal, JournalEntry } from "./journal.ts";
import type { TopicStore } from "./topics.ts";
import { displayTitle } from "./inventory.ts";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
type Project = Awaited<ReturnType<Sdk["projects"]["list"]>>[number];
type Source =
  "unknown" | "historical" | "independent" | "workstreams" | "derived";
type SuggestionRow = {
  id: string;
  entity_id: string;
  association_revision: number;
  project_id: string | null;
  evidence: string;
  status: string;
};

export type ProjectSuggestion = {
  id: string;
  entityId: string;
  topic: string;
  fromProject: string;
  toProject: string | null;
  reason: string;
  threads: { id: string; name: string; project: string }[];
};

const derived = (
  thread: Pick<Thread, "parentThreadId" | "sourceThreadId"> &
    Partial<Pick<Thread, "originPluginId" | "originKind">>,
) =>
  Boolean(
    thread.parentThreadId ||
    thread.sourceThreadId ||
    thread.originPluginId ||
    thread.originKind,
  );

export class ProjectAssociations {
  private pending: Promise<void> | null = null;
  private disposed = false;
  private threads: Thread[] = [];
  private projects: Project[] = [];
  private readonly since: number;

  constructor(
    private deps: {
      db: Database;
      sdk: () => Sdk;
      topics: TopicStore;
      journal: Journal;
      exclusive: <T>(task: () => Promise<T>) => Promise<T>;
      onChange: () => void;
    },
  ) {
    const stored = getMeta(deps.db, "project-learning-since");
    this.since = stored ? Number(stored) : Date.now();
    if (!stored) setMeta(deps.db, "project-learning-since", String(this.since));
  }

  /** Keep supplied-project provenance through banner reloads for this draft. */
  draftChoice(
    key: string,
    choice: ProjectChoice | null | undefined,
  ): ProjectChoice | null {
    if (!choice) return null;
    const { db } = this.deps;
    const previous = db
      .prepare(
        "SELECT project_id, source FROM ws_project_draft WHERE draft_key = ?",
      )
      .get(key) as
      { project_id: string; source: ProjectChoice["source"] } | undefined;
    const source =
      previous?.project_id === choice.projectId &&
      previous.source === "workstreams"
        ? "workstreams"
        : choice.source;
    db.prepare(
      `INSERT INTO ws_project_draft (draft_key, project_id, source, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(draft_key) DO UPDATE SET project_id = excluded.project_id, source = excluded.source, at = excluded.at`,
    ).run(key, choice.projectId, source, Date.now());
    db.prepare(
      "DELETE FROM ws_project_draft WHERE draft_key NOT IN (SELECT draft_key FROM ws_project_draft ORDER BY at DESC LIMIT 500)",
    ).run();
    return { projectId: choice.projectId, source };
  }

  /** A late draft report may confirm an unknown root, but never rehabilitates a supplied project. */
  recordChoice(
    thread: Pick<
      Thread,
      "id" | "projectId" | "parentThreadId" | "sourceThreadId"
    >,
    choice: ProjectChoice | null | undefined,
    independentRoot = true,
  ): void {
    const source: Source =
      derived(thread) || !independentRoot
        ? "derived"
        : choice?.projectId === thread.projectId
          ? choice.source
          : "unknown";
    const current = this.deps.db
      .prepare("SELECT source FROM ws_project_thread WHERE thread_id = ?")
      .get(thread.id) as { source: Source } | undefined;
    if (
      current &&
      (current.source === "workstreams" ||
        current.source === "derived" ||
        source === "unknown")
    )
      return;
    this.deps.db
      .prepare(
        `INSERT INTO ws_project_thread (thread_id, project_id, source) VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, source = excluded.source`,
      )
      .run(thread.id, thread.projectId, source);
  }

  forget(threadId: string): void {
    this.deps.db
      .prepare("DELETE FROM ws_project_thread WHERE thread_id = ?")
      .run(threadId);
  }

  dispose(): void {
    this.disposed = true;
  }

  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.pending)
      this.pending = this.scan()
        .catch((error) => {
          if (!this.disposed) throw error;
        })
        .finally(() => {
          this.pending = null;
        });
    return this.pending;
  }

  private async scan(): Promise<void> {
    const sdk = this.deps.sdk();
    const threads: Thread[] = [];
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += 100) {
        const page = await sdk.threads.list({
          archived,
          includeHidden: true,
          limit: 100,
          offset,
        });
        if (this.disposed) return;
        threads.push(...page);
        if (page.length < 100) break;
      }
    }
    const projects = await sdk.projects.list({});
    if (this.disposed) return;
    await this.deps.exclusive(async () => {
      if (this.disposed) return;
      this.threads = threads;
      const projectsChanged =
        JSON.stringify(this.projects) !== JSON.stringify(projects);
      this.projects = projects;
      const changed = this.deps.db.transaction(() => this.apply())();
      if (changed || projectsChanged) this.deps.onChange();
    });
  }

  private roots(): ProjectRoot[] {
    const { db, topics } = this.deps;
    const entities = topics.list();
    const known = new Set(
      (
        db.prepare("SELECT thread_id FROM ws_project_thread").all() as {
          thread_id: string;
        }[]
      ).map((row) => row.thread_id),
    );
    const present = new Set(this.threads.map((thread) => thread.id));
    for (const id of known) if (!present.has(id)) this.forget(id);
    const roots: ProjectRoot[] = [];
    for (const thread of this.threads) {
      if (thread.visibility === "hidden" || thread.deletedAt || derived(thread))
        continue;
      const topicId = topics.assignment(thread.id).entityId;
      if (!known.has(thread.id)) {
        // Old composers did not report who chose the project. Only unassociated
        // historical work bootstraps learning; new unknown choices never vote.
        const configured =
          topicId &&
          topicAncestors(topicId, entities).some((id) => {
            const topic = entities.find((entity) => entity.id === id)!;
            return topic.projectId || topic.projectSource;
          });
        const source =
          thread.createdAt < this.since && !configured
            ? "historical"
            : "unknown";
        db.prepare(
          "INSERT OR IGNORE INTO ws_project_thread (thread_id, project_id, source) VALUES (?, ?, ?)",
        ).run(thread.id, thread.projectId, source);
      }
      const proof = db
        .prepare(
          "SELECT source, project_id FROM ws_project_thread WHERE thread_id = ?",
        )
        .get(thread.id) as { source: Source; project_id: string };
      if (
        topicId &&
        proof.project_id === thread.projectId &&
        (proof.source === "historical" || proof.source === "independent") &&
        thread.projectId !== "proj_personal"
      )
        roots.push({
          id: thread.id,
          name: displayTitle(thread),
          projectId: thread.projectId,
          topicId,
        });
    }
    return roots;
  }

  private plan(): ProjectLearningDecision[] {
    return projectLearningPlan(
      this.deps.topics.list(),
      this.roots(),
      new Set(
        this.projects.filter((p) => p.id !== "proj_personal").map((p) => p.id),
      ),
    );
  }

  private apply(): boolean {
    const { db, topics } = this.deps;
    let changed = false;
    const pending = new Set<string>();
    for (const decision of this.plan()) {
      const topic = topics.getById(decision.topicId)!;
      if (decision.kind === "learn") {
        const next = topics.edit(topic.id, {
          projectId: decision.projectId,
          projectSource: "learned",
        });
        this.record(topic, next, "auto", decision.roots);
        changed = true;
      } else {
        const id = createHash("sha256")
          .update(
            JSON.stringify([
              topic.id,
              topic.projectRevision,
              decision.projectId,
            ]),
          )
          .digest("hex");
        pending.add(id);
        const row = db
          .prepare("SELECT * FROM ws_project_suggestion WHERE id = ?")
          .get(id) as SuggestionRow | undefined;
        if (row?.status === "declined" || row?.status === "accepted") continue;
        const evidence = JSON.stringify(decision.roots);
        if (!row || row.status !== "pending" || row.evidence !== evidence) {
          db.prepare(
            `INSERT INTO ws_project_suggestion (id, entity_id, association_revision, project_id, evidence, status) VALUES (?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(id) DO UPDATE SET evidence = excluded.evidence, status = 'pending'`,
          ).run(
            id,
            topic.id,
            topic.projectRevision ?? 0,
            decision.projectId,
            evidence,
          );
          changed = true;
        }
      }
    }
    for (const row of db
      .prepare("SELECT id FROM ws_project_suggestion WHERE status = 'pending'")
      .all() as { id: string }[]) {
      if (pending.has(row.id)) continue;
      db.prepare(
        "UPDATE ws_project_suggestion SET status = 'stale' WHERE id = ?",
      ).run(row.id);
      changed = true;
    }
    db.prepare(
      `DELETE FROM ws_project_suggestion WHERE status = 'stale' OR NOT EXISTS
      (SELECT 1 FROM ws_corpus_entity WHERE id = entity_id AND project_revision = association_revision)`,
    ).run();
    return changed;
  }

  private projectName(id: string | null | undefined): string {
    return (
      this.projects.find((project) => project.id === id)?.name ??
      "Unavailable project"
    );
  }

  state(): ProjectSuggestion[] {
    return (
      this.deps.db
        .prepare(
          "SELECT * FROM ws_project_suggestion WHERE status = 'pending' ORDER BY entity_id, id",
        )
        .all() as SuggestionRow[]
    ).flatMap((row) => {
      const topic = this.deps.topics.getById(row.entity_id);
      if (
        !topic ||
        topic.projectSource !== "learned" ||
        topic.projectRevision !== row.association_revision
      )
        return [];
      const roots = JSON.parse(row.evidence) as ProjectRoot[];
      return [
        {
          id: row.id,
          entityId: topic.id,
          topic: topicPath(topic.id, this.deps.topics.list()),
          fromProject: this.projectName(topic.projectId),
          toProject: row.project_id ? this.projectName(row.project_id) : null,
          reason: row.project_id
            ? "Independent root threads consistently use a different project."
            : new Set(roots.map((root) => root.projectId)).size > 1
              ? "Independent root threads use different projects."
              : "The project used by these independent roots is unavailable.",
          threads: roots.map((root) => ({
            id: root.id,
            name: root.name,
            project: this.projectName(root.projectId),
          })),
        },
      ];
    });
  }

  async decide(
    id: string,
    decision: "accept" | "decline",
  ): Promise<JournalEntry> {
    if (this.pending) await this.pending;
    await this.reconcile();
    return this.deps.exclusive(async () => {
      const entry = this.deps.db.transaction(() => {
        const row = this.deps.db
          .prepare("SELECT * FROM ws_project_suggestion WHERE id = ?")
          .get(id) as SuggestionRow | undefined;
        const topic = row && this.deps.topics.getById(row.entity_id);
        if (
          !row ||
          row.status !== "pending" ||
          !topic ||
          topic.projectSource !== "learned" ||
          topic.projectRevision !== row.association_revision
        )
          throw new Error(
            "This project suggestion is out of date. Review the current history.",
          );
        this.deps.db
          .prepare(
            "UPDATE ws_project_suggestion SET status = ?, evidence = '[]' WHERE id = ?",
          )
          .run(decision === "accept" ? "accepted" : "declined", id);
        const roots = JSON.parse(row.evidence) as ProjectRoot[];
        if (decision === "accept") {
          const next = this.deps.topics.edit(topic.id, {
            projectId: row.project_id,
          });
          return this.record(topic, next, "user", roots);
        }
        return this.deps.journal.add({
          action: "project-association",
          source: "user",
          status: "dismissed",
          rationale: `Kept the project for ${topic.name}`,
          threads: roots.map(({ id, name }) => ({ id, name })),
          workstreams: [],
          undo: null,
        });
      })();
      this.deps.onChange();
      return entry;
    });
  }

  updateMetadata(
    entityId: string,
    updates: Parameters<TopicStore["updateMetadata"]>[1],
    projects?: Project[],
  ): Topic {
    if (projects) this.projects = projects;
    return this.deps.db.transaction(() => {
      const before = this.deps.topics.getById(entityId);
      const next = this.deps.topics.updateMetadata(entityId, updates);
      if (before && before.projectRevision !== next.projectRevision)
        this.record(before, next, "user", []);
      return next;
    })();
  }

  private record(
    before: Topic,
    after: Topic,
    source: "user" | "auto",
    roots: readonly ProjectRoot[],
  ): JournalEntry {
    const name = after.projectId
      ? this.projectName(after.projectId)
      : after.projectSource === "disabled"
        ? "No associated project"
        : "Automatic";
    return this.deps.journal.add({
      action: "project-association",
      source,
      rationale: `${source === "auto" ? "Learned" : "Set"} the project for ${after.name}: ${name}`,
      threads: roots.map(({ id, name }) => ({ id, name })),
      workstreams: [...this.deps.topics.groups()]
        .filter(([, id]) => id === after.id)
        .map(([id]) => ({ id, name: after.name })),
      detail: `${topicPath(after.id, this.deps.topics.list())} → ${name}${roots.length ? `; ${roots.length} independent root threads` : ""}`,
      undo: {
        kind: "project-association",
        entityId: after.id,
        from: {
          projectId: before.projectId ?? null,
          source: before.projectSource ?? null,
        },
        to: {
          projectId: after.projectId ?? null,
          source: after.projectSource ?? null,
          revision: after.projectRevision ?? 0,
        },
        disableLearning:
          source === "auto" && !before.projectId && !before.projectSource,
      },
    });
  }
}
