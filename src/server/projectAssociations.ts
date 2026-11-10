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
import { displayTitle, type InventoryThread } from "./inventory.ts";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
type Project = Awaited<ReturnType<Sdk["projects"]["list"]>>[number];
/** The facts about a thread that decide whether and how it votes. */
type Observed = Pick<
  Thread,
  | "id"
  | "projectId"
  | "title"
  | "visibility"
  | "deletedAt"
  | "parentThreadId"
  | "sourceThreadId"
> &
  Partial<Pick<Thread, "titleFallback" | "originPluginId" | "originKind">>;
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

/** A full sweep of BB's threads catches project moves and missed deletes. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** How long the project list is trusted before it is read again. */
const PROJECTS_EVERY_MS = 10 * 60_000;
const SWEPT_KEY = "project-learning-swept-at";

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

/**
 * Learns topic projects from the threads stored in `ws_project_thread` (who
 * chose each project) and `ws_project_root` (what BB last reported about each
 * thread that may vote), joined with topic assignments. Archived roots keep their rows and
 * keep voting. The rows follow dispatches, deletions, and the reconciler's
 * active threads; a full sweep of BB's threads runs once to bootstrap
 * historical work and daily after that, because BB has no event for a
 * project move and deletions can be missed while the plugin is down.
 */
export class ProjectAssociations {
  private pending: Promise<void> | null = null;
  private disposed = false;
  private projects: Project[] = [];
  /** When `projects` was read; null forces a read before the next plan. */
  private projectsAt: number | null = null;
  /** The inputs of the last plan applied, serialized. */
  private planned: string | null = null;
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

  /**
   * Records what BB reports about a thread: its project and title while it
   * is a visible, undeleted root that nothing derived, and nothing otherwise.
   */
  observe(thread: Observed): void {
    if (
      this.projectsAt !== null &&
      !this.projects.some((project) => project.id === thread.projectId)
    )
      this.projectsAt = null;
    if (thread.visibility === "hidden" || thread.deletedAt || derived(thread))
      this.deps.db
        .prepare("DELETE FROM ws_project_root WHERE thread_id = ?")
        .run(thread.id);
    else
      this.deps.db
        .prepare(
          `INSERT INTO ws_project_root (thread_id, project_id, name) VALUES (?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name`,
        )
        .run(thread.id, thread.projectId, displayTitle(thread));
  }

  /**
   * Refreshes the project and title of observed threads from the
   * reconciler's visible, non-archived threads, without another listing.
   */
  observeActive(threads: readonly InventoryThread[]): void {
    const update = this.deps.db.prepare(
      `UPDATE ws_project_root SET project_id = ?, name = ?
      WHERE thread_id = ? AND (project_id <> ? OR name <> ?)`,
    );
    this.deps.db.transaction(() => {
      for (const thread of threads)
        update.run(
          thread.projectId,
          thread.title,
          thread.id,
          thread.projectId,
          thread.title,
        );
    })();
  }

  /** A late draft report may confirm an unknown root, but never rehabilitates a supplied project. */
  recordChoice(
    thread: Observed,
    choice: ProjectChoice | null | undefined,
    independentRoot = true,
  ): void {
    this.observe(thread);
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
    this.deps.db
      .prepare("DELETE FROM ws_project_root WHERE thread_id = ?")
      .run(threadId);
  }

  dispose(): void {
    this.disposed = true;
  }

  /**
   * Applies what the stored history now supports. It sweeps BB's threads
   * first when `sweep` asks, when no sweep has completed, or when the last is
   * a day old; otherwise it reads no threads from BB.
   */
  reconcile(options: { sweep?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.pending)
      this.pending = this.learn(options.sweep ?? false)
        .catch((error) => {
          if (!this.disposed) throw error;
        })
        .finally(() => {
          this.pending = null;
        });
    return this.pending;
  }

  private async learn(force: boolean): Promise<void> {
    const sdk = this.deps.sdk();
    const now = Date.now();
    const sweptAt = Number(getMeta(this.deps.db, SWEPT_KEY) ?? 0);
    const sweep = force || !(now - sweptAt < SWEEP_EVERY_MS);
    const refresh =
      sweep ||
      this.projectsAt === null ||
      !(now - this.projectsAt < PROJECTS_EVERY_MS);
    if (!refresh && this.inputs(this.projects) === this.planned) return;
    let threads: Thread[] | null = null;
    if (sweep) {
      threads = [];
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
    }
    const projects = refresh ? await sdk.projects.list({}) : this.projects;
    if (this.disposed) return;
    await this.deps.exclusive(async () => {
      if (this.disposed) return;
      const projectsChanged =
        JSON.stringify(this.projects) !== JSON.stringify(projects);
      this.projects = projects;
      if (refresh) this.projectsAt = now;
      const changed = this.deps.db.transaction(() => {
        if (threads) {
          this.sweep(threads);
          setMeta(this.deps.db, SWEPT_KEY, String(now));
        }
        const inputs = this.inputs(projects);
        if (inputs === this.planned) return false;
        const changed = this.apply();
        this.planned = inputs;
        return changed;
      })();
      if (changed || projectsChanged) this.deps.onChange();
    });
  }

  /** Everything a plan depends on, serialized. */
  private inputs(projects: readonly Project[]): string {
    return JSON.stringify([
      this.deps.topics.list(),
      this.roots(),
      projects.map((project) => project.id),
    ]);
  }

  /**
   * Records every thread BB lists, forgets the ones it no longer has, and
   * gives eligible threads seen for the first time their provenance: work
   * created before learning began is historical evidence unless its topic
   * already had a project setting; anything newer is unknown and never votes.
   */
  private sweep(threads: readonly Thread[]): void {
    const { db, topics } = this.deps;
    const present = new Set(threads.map((thread) => thread.id));
    for (const { thread_id } of db
      .prepare(
        "SELECT thread_id FROM ws_project_thread UNION SELECT thread_id FROM ws_project_root",
      )
      .all() as { thread_id: string }[])
      if (!present.has(thread_id)) this.forget(thread_id);
    const known = new Set(
      (
        db.prepare("SELECT thread_id FROM ws_project_thread").all() as {
          thread_id: string;
        }[]
      ).map((row) => row.thread_id),
    );
    const entities = topics.list();
    const assigned = new Map(
      (
        db
          .prepare(
            "SELECT thread_id, entity_id FROM ws_corpus_subject WHERE entity_id IS NOT NULL",
          )
          .all() as { thread_id: string; entity_id: string }[]
      ).map((row) => [row.thread_id, row.entity_id]),
    );
    const insert = db.prepare(
      "INSERT OR IGNORE INTO ws_project_thread (thread_id, project_id, source) VALUES (?, ?, ?)",
    );
    for (const thread of threads) {
      this.observe(thread);
      if (
        known.has(thread.id) ||
        thread.visibility === "hidden" ||
        thread.deletedAt ||
        derived(thread)
      )
        continue;
      const topicId = assigned.get(thread.id);
      // Old composers did not report who chose the project. Only unassociated
      // historical work bootstraps learning; new unknown choices never vote.
      const configured =
        topicId &&
        topicAncestors(topicId, entities).some((id) => {
          const topic = entities.find((entity) => entity.id === id)!;
          return topic.projectId || topic.projectSource;
        });
      insert.run(
        thread.id,
        thread.projectId,
        thread.createdAt < this.since && !configured ? "historical" : "unknown",
      );
    }
  }

  /**
   * Independent roots that vote: observed as eligible, outside Personal,
   * still in the project their choice recorded, and filed in a topic.
   * Archived roots count.
   */
  private roots(): ProjectRoot[] {
    return this.deps.db
      .prepare(
        `SELECT r.thread_id AS id, r.name, r.project_id AS projectId, s.entity_id AS topicId
        FROM ws_project_root r
        JOIN ws_project_thread p ON p.thread_id = r.thread_id
        JOIN ws_corpus_subject s ON s.thread_id = r.thread_id
        WHERE p.project_id = r.project_id
          AND p.source IN ('historical', 'independent')
          AND r.project_id <> 'proj_personal'
          AND s.entity_id IS NOT NULL
        ORDER BY r.thread_id`,
      )
      .all() as ProjectRoot[];
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
    while (this.pending) await this.pending;
    await this.reconcile({ sweep: true });
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
