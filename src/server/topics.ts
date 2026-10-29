import { topicPath } from "../domain/topic-path.ts";
import {
  topicAncestors,
  resolveProposal,
  type AssignmentProvenance,
  type TopicAssignment,
  type TopicState,
  type Topic,
  type DraftSubjectProposal,
} from "../domain/topics.ts";
import { createHash, randomUUID } from "node:crypto";
import { getMeta, setMeta, type Database } from "./db.ts";

/** Bump to settle every thread's topic again with changed classification rules. */
export const CLASSIFICATION_VERSION = "topics-v6";

/**
 * The basis of an automatic topic: what it was placed from. Only the user's
 * requests and the project decide a topic, so a retitle, a topic edit, or a
 * model change never makes one stale; a new request does.
 */
export function topicBasis(input: {
  version?: string;
  requests?: readonly unknown[];
  project?: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: input.version ?? CLASSIFICATION_VERSION,
        requests: input.requests ?? [],
        project: input.project ?? null,
      }),
    )
    .digest("hex");
}

const readSource = (source: string): AssignmentProvenance =>
  source === "manual" || source === "inherited" || source === "quick"
    ? source
    : "full";

const normalize = (value: string) => value.trim().toLowerCase();
const cleanAliases = (aliases: readonly string[]) => [
  ...new Set(aliases.map((alias) => alias.trim()).filter(Boolean)),
];

type Row = Record<string, unknown>;

/** Inserts rows as they were read, by column name. */
function insertRows(db: Database, table: string, rows: readonly Row[]) {
  for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...columns.map((column) => row[column]));
  }
}

/**
 * Records the topic tree and every topic assignment, so an accepted
 * suggestion can be undone. The latest 50 are kept.
 */
export function snapshotTopics(db: Database, at: number): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO ws_topic_snapshot(id, at, entities, subjects) VALUES (?, ?, ?, ?)",
  ).run(
    id,
    at,
    JSON.stringify(db.prepare("SELECT * FROM ws_corpus_entity").all()),
    JSON.stringify(db.prepare("SELECT * FROM ws_corpus_subject").all()),
  );
  db.prepare(
    "DELETE FROM ws_topic_snapshot WHERE id NOT IN (SELECT id FROM ws_topic_snapshot ORDER BY at DESC LIMIT 50)",
  ).run();
  return id;
}

/**
 * Puts back the topic tree and assignments a snapshot recorded, while the
 * catalog is still at `revision`: any later topic or assignment change means
 * undoing would discard it, so nothing is restored. Workstreams bound to
 * topics the snapshot lacks are unbound. Returns whether it restored.
 */
export function restoreTopics(
  db: Database,
  snapshotId: string,
  revision: number,
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT entities, subjects FROM ws_topic_snapshot WHERE id = ?")
      .get(snapshotId) as { entities: string; subjects: string } | undefined;
    const current = parseInt(getMeta(db, "catalog_revision") ?? "1", 10) || 1;
    if (!row || current !== revision) return false;
    const entities = JSON.parse(row.entities) as Row[];
    const kept = new Set(entities.map((entity) => entity.id));
    for (const group of db
      .prepare("SELECT section_id, entity_id FROM ws_corpus_group")
      .all() as { section_id: string; entity_id: string }[])
      if (!kept.has(group.entity_id))
        db.prepare("DELETE FROM ws_corpus_group WHERE section_id = ?").run(
          group.section_id,
        );
    db.prepare("DELETE FROM ws_corpus_subject").run();
    db.prepare("DELETE FROM ws_corpus_entity").run();
    // Parents first, so every parent reference resolves as it is written.
    const placed = new Set<unknown>([null]);
    let pending = entities;
    while (pending.length) {
      const ready = pending.filter(
        (entity) => placed.has(entity.parent_id) || !kept.has(entity.parent_id),
      );
      if (!ready.length)
        throw new Error("The snapshot's topic tree has a cycle.");
      insertRows(db, "ws_corpus_entity", ready);
      for (const entity of ready) placed.add(entity.id);
      pending = pending.filter((entity) => !ready.includes(entity));
    }
    insertRows(db, "ws_corpus_subject", JSON.parse(row.subjects) as Row[]);
    setMeta(db, "catalog_revision", String(current + 1));
    return true;
  })();
}

export class TopicStore {
  constructor(private readonly db: Database) {}

  revision(): number {
    const raw = getMeta(this.db, "catalog_revision");
    return raw ? parseInt(raw, 10) || 1 : 1;
  }

  /** Independent of assignment and native-section projection changes. */
  definitionKey(): string {
    return createHash("sha256")
      .update(JSON.stringify(this.list()))
      .digest("hex");
  }

  bumpRevision(): number {
    const next = this.revision() + 1;
    setMeta(this.db, "catalog_revision", String(next));
    return next;
  }

  list(): Topic[] {
    const rows = this.db
      .prepare(
        "SELECT id, name, description, parent_id, aliases, partitioned FROM ws_corpus_entity ORDER BY id",
      )
      .all() as {
      id: string;
      name: string;
      description: string;
      parent_id: string | null;
      aliases: string;
      partitioned: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      parentId: row.parent_id,
      aliases: JSON.parse(row.aliases) as string[],
      partitioned: row.partitioned === 1,
    }));
  }

  /** How many topics sit directly beneath `entityId`. */
  subtopics(entityId: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM ws_corpus_entity WHERE parent_id = ?",
        )
        .get(entityId) as { n: number }
    ).n;
  }

  /** Visible, non-archived roots assigned to `entityId` itself. */
  heldThreads(entityId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ws_corpus_subject s
           JOIN ws_seen_thread t ON t.thread_id = s.thread_id
           WHERE s.entity_id = ?`,
        )
        .get(entityId) as { n: number }
    ).n;
  }

  /**
   * A topic holds threads or subtopics, never both (docs/organization.md).
   * Refuses to give `parentId` a subtopic while it holds threads.
   */
  private assertTakesSubtopics(parentId: string | null): void {
    if (parentId === null) return;
    const held = this.heldThreads(parentId);
    if (held > 0)
      throw new Error(
        `${this.pathOf(parentId)} holds ${held === 1 ? "a thread" : `${held} threads`}, and a topic holds threads or subtopics, never both. Move its threads first, or accept a suggestion that splits it.`,
      );
  }

  /** Refuses to file a thread in a topic that has subtopics. */
  private assertTakesThreads(entityId: string): void {
    if (this.subtopics(entityId) > 0)
      throw new Error(
        `${this.pathOf(entityId)} has subtopics, and a topic holds threads or subtopics, never both. Choose one of its subtopics.`,
      );
  }

  private pathOf(entityId: string): string {
    return topicPath(entityId, this.list());
  }

  getById(id: string): Topic | null {
    return this.list().find((entity) => entity.id === id) ?? null;
  }

  resolve(name: string, parentId: string | null = null): Topic | null {
    const target = normalize(name);
    for (const entity of this.list()) {
      if (entity.parentId !== parentId) continue;
      if (
        normalize(entity.name) === target ||
        entity.aliases.some((alias) => normalize(alias) === target)
      )
        return entity;
    }
    return null;
  }

  /**
   * Inserts a topic Workstreams discovered. `rememberProposal` resolves a
   * proposal against the tree first, so only names the tree lacks reach here.
   */
  private insertDiscovered(
    name: string,
    description: string,
    parentId: string | null = null,
    aliases: readonly string[] = [],
  ): Topic {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Topic name must not be empty");
    if (parentId !== null && !this.getById(parentId))
      throw new Error(`Unknown topic parent: ${parentId}`);
    this.assertParentChainAcyclic(parentId);

    const cleanDescription = description.trim();
    const cleanAliasList = cleanAliases(aliases);
    if (
      cleanAliasList.some((alias) => normalize(alias) === normalize(cleanName))
    )
      throw new Error("Topic alias must differ from its name");
    if (cleanAliasList.some((alias) => this.resolve(alias, parentId)))
      throw new Error(
        "Topic alias already resolves to an entity in this parent scope",
      );

    const entity: Topic = {
      id: randomUUID(),
      name: cleanName,
      description: cleanDescription,
      parentId,
      aliases: cleanAliasList,
      partitioned: false,
    };
    this.db
      .prepare(
        "INSERT INTO ws_corpus_entity(id, name, description, parent_id, aliases, origin) VALUES (?, ?, ?, ?, ?, 'discovered')",
      )
      .run(
        entity.id,
        entity.name,
        entity.description,
        entity.parentId,
        JSON.stringify(entity.aliases),
      );
    return entity;
  }

  create(
    name: string,
    description: string = "",
    parentId: string | null = null,
    aliases: readonly string[] = [],
  ): Topic {
    return this.db.transaction(() => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Topic name must not be empty");
      if (parentId !== null && !this.getById(parentId))
        throw new Error(`Unknown topic parent: ${parentId}`);
      this.assertParentChainAcyclic(parentId);
      this.assertTakesSubtopics(parentId);

      const existing = this.resolve(cleanName, parentId);
      if (existing) {
        throw new Error(
          `Topic '${cleanName}' already exists in this parent scope`,
        );
      }

      const cleanDescription = description.trim();
      const cleanAliasList = cleanAliases(aliases);
      if (
        cleanAliasList.some(
          (alias) => normalize(alias) === normalize(cleanName),
        )
      )
        throw new Error("Topic alias must differ from its name");

      for (const alias of cleanAliasList) {
        if (this.resolve(alias, parentId))
          throw new Error(
            `Topic alias '${alias}' already resolves to an entity in this parent scope`,
          );
      }

      const entity: Topic = {
        id: randomUUID(),
        name: cleanName,
        description: cleanDescription,
        parentId,
        aliases: cleanAliasList,
        partitioned: false,
      };

      this.db
        .prepare(
          "INSERT INTO ws_corpus_entity(id, name, description, parent_id, aliases) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          entity.id,
          entity.name,
          entity.description,
          entity.parentId,
          JSON.stringify(entity.aliases),
        );

      this.bumpRevision();
      return entity;
    })();
  }

  /**
   * Records a discovered topic under its deepest existing ancestor, resolved
   * against the Catalog as it is now: it may have changed since the proposal
   * was classified. A proposal that names an existing topic returns it
   * unchanged.
   */
  rememberProposal(draft: DraftSubjectProposal): Topic {
    return this.db.transaction(() => {
      if (draft.parentId && !this.getById(draft.parentId))
        throw new Error(`Unknown topic parent: ${draft.parentId}`);
      const resolved = resolveProposal(draft, this.list());
      if (resolved.subjectId !== null) return this.getById(resolved.subjectId)!;
      const proposal = resolved.proposed;
      let parent = proposal.parentId ?? null;
      // Subgroups come only from splits, so a new topic beneath one that
      // holds threads files the thread in that topic instead.
      if (parent !== null && this.heldThreads(parent) > 0)
        return this.getById(parent)!;
      for (const ancestor of proposal.ancestors ?? [])
        parent = this.insertDiscovered(
          ancestor.name,
          ancestor.description,
          parent,
        ).id;
      const entity = this.insertDiscovered(
        proposal.name,
        proposal.description,
        parent,
      );
      this.bumpRevision();
      return entity;
    })();
  }

  private bindGroupWithoutRevision(sectionId: string, entityId: string): void {
    if (!this.getById(entityId)) throw new Error(`Unknown topic: ${entityId}`);
    this.db
      .prepare(
        "INSERT INTO ws_corpus_group(section_id, entity_id) VALUES (?, ?) ON CONFLICT(section_id) DO UPDATE SET entity_id = excluded.entity_id",
      )
      .run(sectionId, entityId);
  }

  bindGroup(sectionId: string, entityId: string): void {
    if (!this.getById(entityId)) throw new Error(`Unknown topic: ${entityId}`);
    const existing = this.groups().get(sectionId);
    if (existing === entityId) return;
    this.bindGroupWithoutRevision(sectionId, entityId);
    this.bumpRevision();
  }

  unbindGroup(sectionId: string): void {
    const res = this.db
      .prepare("DELETE FROM ws_corpus_group WHERE section_id = ?")
      .run(sectionId);
    if (res.changes > 0) {
      this.bumpRevision();
    }
  }

  groups(): Map<string, string> {
    const rows = this.db
      .prepare(
        "SELECT section_id, entity_id FROM ws_corpus_group ORDER BY section_id",
      )
      .all() as { section_id: string; entity_id: string }[];
    return new Map(
      rows.map(({ section_id, entity_id }) => [section_id, entity_id]),
    );
  }

  findRootThread(threadId: string): string {
    const lookup = this.db.prepare(
      "SELECT parent_thread_id FROM ws_seen_thread WHERE thread_id = ?",
    );
    let currentId = threadId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const row = lookup.get(currentId) as
        { parent_thread_id: string | null } | undefined;
      if (!row || !row.parent_thread_id) break;
      currentId = row.parent_thread_id;
    }
    return currentId;
  }

  assignment(threadId: string): TopicAssignment {
    const rootId = this.findRootThread(threadId);
    const isChild = rootId !== threadId;
    const row = this.db
      .prepare(
        "SELECT entity_id, evidence, source FROM ws_corpus_subject WHERE thread_id = ?",
      )
      .get(rootId) as
      | { entity_id: string | null; evidence: string | null; source: string }
      | undefined;

    if (!row) {
      return {
        threadId,
        entityId: null,
        status: "unresolved",
        provenance: null,
        label: null,
        ancestorIds: [],
        evidence: null,
        inheritedFrom: isChild ? rootId : null,
      };
    }

    const provenance = readSource(row.source);

    const entities = this.list();
    const entity = row.entity_id
      ? entities.find((e) => e.id === row.entity_id)
      : null;
    if (!entity) {
      return {
        threadId,
        entityId: null,
        status: "unresolved",
        provenance,
        label: null,
        ancestorIds: [],
        evidence: row.evidence ?? null,
        inheritedFrom: isChild ? rootId : null,
      };
    }

    return {
      threadId,
      entityId: entity.id,
      status: "assigned",
      provenance,
      label: topicPath(entity.id, entities),
      ancestorIds: topicAncestors(entity.id, entities),
      evidence: row.evidence ?? null,
      inheritedFrom: isChild ? rootId : null,
    };
  }

  assignments(): Record<string, TopicAssignment> {
    const entities = this.list();
    const byId = new Map(entities.map((e) => [e.id, e]));

    const subjects = new Map<
      string,
      { entityId: string | null; evidence: string | null; source: string }
    >();
    const subjectRows = this.db
      .prepare(
        "SELECT thread_id, entity_id, evidence, source FROM ws_corpus_subject",
      )
      .all() as {
      thread_id: string;
      entity_id: string | null;
      evidence: string | null;
      source: string;
    }[];
    for (const row of subjectRows) {
      subjects.set(row.thread_id, {
        entityId: row.entity_id,
        evidence: row.evidence,
        source: row.source,
      });
    }

    const seenRows = this.db
      .prepare("SELECT thread_id, parent_thread_id FROM ws_seen_thread")
      .all() as { thread_id: string; parent_thread_id: string | null }[];
    const parentMap = new Map<string, string | null>();
    for (const row of seenRows) {
      parentMap.set(row.thread_id, row.parent_thread_id);
    }

    const resolveRoot = (id: string) => {
      let current = id;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const parent = parentMap.get(current);
        if (!parent) break;
        current = parent;
      }
      return current;
    };

    const threadIds = new Set<string>([
      ...parentMap.keys(),
      ...subjects.keys(),
    ]);

    const result: Record<string, TopicAssignment> = {};
    for (const threadId of threadIds) {
      const rootId = resolveRoot(threadId);
      const isChild = rootId !== threadId;
      const subject = subjects.get(rootId);
      if (!subject) {
        result[threadId] = {
          threadId,
          entityId: null,
          status: "unresolved",
          provenance: null,
          label: null,
          ancestorIds: [],
          evidence: null,
          inheritedFrom: isChild ? rootId : null,
        };
        continue;
      }
      const entity = subject.entityId ? byId.get(subject.entityId) : null;
      const provenance = readSource(subject.source);
      if (!entity) {
        result[threadId] = {
          threadId,
          entityId: null,
          status: "unresolved",
          provenance,
          label: null,
          ancestorIds: [],
          evidence: subject.evidence ?? null,
          inheritedFrom: isChild ? rootId : null,
        };
        continue;
      }
      result[threadId] = {
        threadId,
        entityId: entity.id,
        status: "assigned",
        provenance,
        label: topicPath(entity.id, entities),
        ancestorIds: topicAncestors(entity.id, entities),
        evidence: subject.evidence ?? null,
        inheritedFrom: isChild ? rootId : null,
      };
    }
    return result;
  }

  assign(
    threadId: string,
    entityId: string | null,
    options?: { provenance?: AssignmentProvenance; evidence?: string | null },
  ): TopicAssignment {
    return this.db.transaction(() => {
      if (entityId !== null && !this.getById(entityId))
        throw new Error(`Unknown topic: ${entityId}`);
      if (!threadId.trim()) throw new Error("Thread ID must not be empty");

      const rootId = this.findRootThread(threadId);

      const provenance: AssignmentProvenance = options?.provenance ?? "manual";
      const evidence: string | null = options?.evidence ?? null;

      const existing = this.db
        .prepare(
          "SELECT entity_id, evidence, source FROM ws_corpus_subject WHERE thread_id = ?",
        )
        .get(rootId) as
        | { entity_id: string | null; evidence: string | null; source: string }
        | undefined;

      if (
        existing &&
        existing.entity_id === entityId &&
        existing.source === provenance &&
        (existing.evidence ?? null) === evidence
      ) {
        return this.assignment(threadId);
      }
      if (entityId !== null && existing?.entity_id !== entityId)
        this.assertTakesThreads(entityId);

      const isInitialClear =
        !existing && entityId === null && provenance === "manual";

      this.db
        .prepare(
          `INSERT INTO ws_corpus_subject(thread_id, entity_id, evidence, source)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             entity_id = excluded.entity_id,
             evidence = excluded.evidence,
             source = excluded.source`,
        )
        .run(rootId, entityId, evidence, provenance);

      if (!isInitialClear) {
        this.bumpRevision();
      }
      return this.assignment(threadId);
    })();
  }

  clear(threadId: string): TopicAssignment {
    return this.assign(threadId, null, {
      provenance: "manual",
      evidence: null,
    });
  }

  /**
   * Applies an analysis's topic under the source priority (see
   * `AssignmentProvenance`): your topic is never replaced, an inherited one
   * only by Full analysis on a scope shift or with a more specific topic
   * beneath it, and Quick analysis only fills a thread that has no topic yet
   * or replaces its own earlier guess. Returns whether the assignment
   * changed.
   */
  applyAnalysis(
    threadId: string,
    answer: {
      subjectId: string | null;
      proposed: DraftSubjectProposal | null;
      scopeShift?: boolean;
    },
    kind: "full" | "quick",
    basis: string | null,
  ): boolean {
    return this.db.transaction(() => {
      const rootId = this.findRootThread(threadId);
      const row = this.db
        .prepare(
          "SELECT entity_id, evidence, source FROM ws_corpus_subject WHERE thread_id = ?",
        )
        .get(rootId) as
        | { entity_id: string | null; evidence: string | null; source: string }
        | undefined;
      const current = row ? readSource(row.source) : null;
      if (current === "manual") return false;
      if (
        current === "inherited" &&
        !(
          kind === "full" &&
          (answer.scopeShift || this.narrows(answer, row?.entity_id ?? null))
        )
      ) {
        // Settled from these requests: a later turn without a new request
        // has nothing to reconsider.
        if (kind === "full" && basis && row?.evidence !== basis)
          this.db
            .prepare(
              "UPDATE ws_corpus_subject SET evidence = ? WHERE thread_id = ?",
            )
            .run(basis, rootId);
        return false;
      }
      if (kind === "quick" && current !== null && current !== "quick")
        return false;
      // Only a topic without subtopics holds threads.
      if (answer.subjectId && this.subtopics(answer.subjectId) > 0)
        return false;
      const entity = answer.subjectId
        ? this.getById(answer.subjectId)
        : answer.proposed
          ? this.rememberProposal(answer.proposed)
          : null;
      // A proposal can resolve to a topic that already has subtopics.
      if (entity && this.subtopics(entity.id) > 0) return false;
      const entityId = entity?.id ?? null;
      if (
        row &&
        row.entity_id === entityId &&
        readSource(row.source) === kind &&
        (row.evidence ?? null) === basis
      )
        return false;
      const changed =
        !row || row.entity_id !== entityId || readSource(row.source) !== kind;
      this.db
        .prepare(
          `INSERT INTO ws_corpus_subject(thread_id, entity_id, evidence, source)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             entity_id = excluded.entity_id,
             evidence = excluded.evidence,
             source = excluded.source`,
        )
        .run(rootId, entityId, basis, kind);
      if (changed) this.bumpRevision();
      return changed;
    })();
  }

  /**
   * Whether an answer names a topic strictly beneath `entityId`: an existing
   * descendant, or a proposal anchored at it or below it.
   */
  private narrows(
    answer: { subjectId: string | null; proposed: DraftSubjectProposal | null },
    entityId: string | null,
  ): boolean {
    if (!entityId) return false;
    const entities = this.list();
    const known = new Set(entities.map((entity) => entity.id));
    if (answer.subjectId)
      return (
        answer.subjectId !== entityId &&
        known.has(answer.subjectId) &&
        topicAncestors(answer.subjectId, entities).includes(entityId)
      );
    const anchor = answer.proposed?.parentId;
    return (
      !!anchor &&
      known.has(anchor) &&
      topicAncestors(anchor, entities).includes(entityId)
    );
  }

  /**
   * Gives a thread that has no topic of its own the topic of the thread it
   * was started from. Returns whether it changed anything.
   */
  inherit(threadId: string, fromThreadId: string): boolean {
    const source = this.assignment(fromThreadId);
    if (!source.entityId) return false;
    return this.inheritTopic(threadId, source.entityId);
  }

  /**
   * Gives a thread that has no topic of its own, or only Quick analysis's
   * guess, the topic `entityId` as inherited.
   */
  inheritTopic(threadId: string, entityId: string): boolean {
    // A topic with subtopics holds no threads; placement settles the thread
    // with this topic as its hint.
    if (!this.getById(entityId) || this.subtopics(entityId) > 0) return false;
    const current = this.assignment(threadId);
    if (current.provenance !== null && current.provenance !== "quick")
      return false;
    this.assign(threadId, entityId, { provenance: "inherited" });
    return true;
  }

  /**
   * Splits a topic into subgroups: files each of its visible threads in one
   * of `subgroups`, creating the ones it lacks beneath it (a name that
   * matches an existing subtopic reuses it), and marks it partitioned so it
   * keeps its header. Every visible thread it holds must be listed exactly
   * once; threads keep their provenance. Returns the subgroups in order.
   */
  split(
    entityId: string,
    subgroups: readonly {
      name: string;
      description: string;
      threadIds: readonly string[];
    }[],
  ): Topic[] {
    return this.db.transaction(() => {
      const entity = this.getById(entityId);
      if (!entity) throw new Error(`Unknown topic: ${entityId}`);
      if (subgroups.length === 0)
        throw new Error("A split needs at least one subgroup.");
      const held = (
        this.db
          .prepare(
            `SELECT s.thread_id FROM ws_corpus_subject s
             JOIN ws_seen_thread t ON t.thread_id = s.thread_id
             WHERE s.entity_id = ?`,
          )
          .all(entityId) as { thread_id: string }[]
      ).map((row) => row.thread_id);
      const listed = subgroups.flatMap((group) => group.threadIds);
      if (
        listed.length !== new Set(listed).size ||
        listed.length !== held.length ||
        held.some((id) => !listed.includes(id))
      )
        throw new Error(
          `A split of ${this.pathOf(entityId)} must file each of its threads in exactly one subgroup.`,
        );
      const names = subgroups.map((group) => normalize(group.name));
      if (
        names.some((name) => !name || name.includes(":")) ||
        new Set(names).size !== names.length
      )
        throw new Error("Subgroups need distinct names without colons.");
      const result: Topic[] = [];
      for (const group of subgroups) {
        const topic =
          this.resolve(group.name, entityId) ??
          this.insertDiscovered(group.name, group.description, entityId);
        for (const threadId of group.threadIds)
          this.db
            .prepare(
              "UPDATE ws_corpus_subject SET entity_id = ? WHERE thread_id = ?",
            )
            .run(topic.id, threadId);
        result.push(topic);
      }
      this.db
        .prepare("UPDATE ws_corpus_entity SET partitioned = 1 WHERE id = ?")
        .run(entityId);
      this.bumpRevision();
      return result;
    })();
  }

  /** The basis the thread's automatic topic was settled from, if any. */
  basis(threadId: string): string | null {
    const row = this.db
      .prepare("SELECT evidence FROM ws_corpus_subject WHERE thread_id = ?")
      .get(this.findRootThread(threadId)) as
      { evidence: string | null } | undefined;
    return row?.evidence ?? null;
  }

  /** Forgets a deleted thread's topic, so it no longer keeps a topic in use. */
  forget(threadId: string): void {
    this.db
      .prepare("DELETE FROM ws_corpus_subject WHERE thread_id = ?")
      .run(threadId);
  }

  /**
   * Removes discovered topics that no thread has, no workstream uses, and
   * that have no subtopics, deepest first. Topics you created are kept.
   */
  prune(): Topic[] {
    return this.db.transaction(() => {
      const removed: Topic[] = [];
      for (;;) {
        const row = this.db
          .prepare(
            `SELECT e.id FROM ws_corpus_entity e
             WHERE e.origin = 'discovered'
               AND NOT EXISTS (SELECT 1 FROM ws_corpus_subject s WHERE s.entity_id = e.id)
               AND NOT EXISTS (SELECT 1 FROM ws_corpus_group g WHERE g.entity_id = e.id)
               AND NOT EXISTS (SELECT 1 FROM ws_corpus_entity c WHERE c.parent_id = e.id)
             LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        if (!row) break;
        removed.push(this.getById(row.id)!);
        this.db
          .prepare("DELETE FROM ws_corpus_entity WHERE id = ?")
          .run(row.id);
      }
      if (removed.length) this.bumpRevision();
      return removed;
    })();
  }

  edit(
    entityId: string,
    updates: {
      name?: string;
      description?: string;
      aliases?: readonly string[];
    },
  ): Topic {
    return this.db.transaction(() => {
      const entity = this.getById(entityId);
      if (!entity) throw new Error(`Unknown topic: ${entityId}`);

      let cleanName = entity.name;
      if (updates.name !== undefined) {
        cleanName = updates.name.trim();
        if (!cleanName) throw new Error("Entity name must not be empty");
        if (normalize(entity.name) !== normalize(cleanName)) {
          const conflict = this.resolve(cleanName, entity.parentId);
          if (conflict && conflict.id !== entityId) {
            throw new Error(
              `Topic name conflicts with an existing topic in this parent scope: ${cleanName}`,
            );
          }
        }
      }

      let nextDescription = entity.description;
      if (updates.description !== undefined) {
        nextDescription = updates.description.trim();
      }

      let nextAliases = entity.aliases;
      if (updates.aliases !== undefined) {
        const cleanAliasList = cleanAliases(updates.aliases);
        if (
          cleanAliasList.some(
            (alias) => normalize(alias) === normalize(cleanName),
          )
        ) {
          throw new Error("Topic alias must differ from its name");
        }
        if (
          cleanAliasList.some((alias) => {
            const other = this.resolve(alias, entity.parentId);
            return other && other.id !== entity.id;
          })
        ) {
          throw new Error(
            "Topic alias already resolves to an entity in this parent scope",
          );
        }
        nextAliases = cleanAliasList;
      } else if (updates.name !== undefined) {
        nextAliases = cleanAliases(
          entity.aliases.filter((a) => normalize(a) !== normalize(cleanName)),
        );
      }

      const nameChanged = cleanName !== entity.name;
      const descriptionChanged = nextDescription !== entity.description;
      const aliasesChanged =
        nextAliases.length !== entity.aliases.length ||
        nextAliases.some((a, i) => a !== entity.aliases[i]);

      if (!nameChanged && !descriptionChanged && !aliasesChanged) {
        return entity;
      }

      this.db
        .prepare(
          "UPDATE ws_corpus_entity SET name = ?, description = ?, aliases = ? WHERE id = ?",
        )
        .run(
          cleanName,
          nextDescription,
          JSON.stringify(nextAliases),
          entity.id,
        );

      this.bumpRevision();
      return {
        ...entity,
        name: cleanName,
        description: nextDescription,
        aliases: nextAliases,
      };
    })();
  }

  rename(entityId: string, newName: string): Topic {
    return this.edit(entityId, { name: newName });
  }

  reparent(entityId: string, newParentId: string | null): Topic {
    return this.db.transaction(() => {
      const entity = this.getById(entityId);
      if (!entity) throw new Error(`Unknown topic: ${entityId}`);
      if (entity.parentId === newParentId) return entity;
      if (newParentId === entityId)
        throw new Error("Cannot reparent an entity under itself");

      if (newParentId !== null) {
        const parent = this.getById(newParentId);
        if (!parent) throw new Error(`Unknown topic parent: ${newParentId}`);
        this.assertTakesSubtopics(newParentId);
        const parentAncestors = topicAncestors(newParentId, this.list());
        if (parentAncestors.includes(entityId)) {
          throw new Error(
            `Cannot reparent: entity ${entityId} is an ancestor of ${newParentId} (cycle detected)`,
          );
        }
      }

      const conflict = this.resolve(entity.name, newParentId);
      if (conflict && conflict.id !== entityId) {
        throw new Error(
          `Topic name conflicts with an existing topic in target parent scope: ${entity.name}`,
        );
      }

      for (const alias of entity.aliases) {
        const other = this.resolve(alias, newParentId);
        if (other && other.id !== entityId) {
          throw new Error(
            `Topic alias '${alias}' conflicts with an existing topic in target parent scope`,
          );
        }
      }

      this.db
        .prepare("UPDATE ws_corpus_entity SET parent_id = ? WHERE id = ?")
        .run(newParentId, entity.id);

      this.bumpRevision();
      return { ...entity, parentId: newParentId };
    })();
  }

  updateMetadata(
    entityId: string,
    updates: { description?: string; aliases?: readonly string[] },
  ): Topic {
    return this.edit(entityId, updates);
  }

  merge(
    sourceEntityId: string,
    targetEntityId: string,
  ): {
    target: Topic;
    affectedThreads: number;
    reparentedChildren: number;
  } {
    if (sourceEntityId === targetEntityId) {
      throw new Error("Cannot merge an entity into itself");
    }

    return this.db.transaction(() => {
      const source = this.getById(sourceEntityId);
      if (!source) throw new Error(`Unknown source entity: ${sourceEntityId}`);
      const target = this.getById(targetEntityId);
      if (!target) throw new Error(`Unknown target entity: ${targetEntityId}`);

      const entities = this.list();
      const targetAncestors = topicAncestors(target.id, entities);
      const targetIsDescendantOfSource = targetAncestors.includes(source.id);

      // The merged topic holds both topics' threads and subtopics, so one
      // side's threads can't land beside the other's subtopics.
      const mergedSubtopics = entities.filter(
        (e) =>
          (e.parentId === target.id || e.parentId === source.id) &&
          e.id !== target.id,
      ).length;
      const mergedThreads =
        this.heldThreads(source.id) + this.heldThreads(target.id);
      if (mergedSubtopics > 0 && mergedThreads > 0)
        throw new Error(
          `Merging ${this.pathOf(source.id)} into ${this.pathOf(target.id)} would put threads beside subtopics, and a topic holds threads or subtopics, never both.`,
        );

      const newTargetParentId = targetIsDescendantOfSource
        ? source.parentId
        : target.parentId;

      // Validate newTargetParentId
      if (newTargetParentId !== null) {
        const newParent = this.getById(newTargetParentId);
        if (!newParent)
          throw new Error(`Unknown topic parent: ${newTargetParentId}`);
      }

      const combinedAliases = cleanAliases([
        ...target.aliases,
        source.name,
        ...source.aliases,
      ]).filter((a) => normalize(a) !== normalize(target.name));

      // Sibling validation in target's final parent scope:
      // None of target's final aliases or target.name may conflict with other siblings in that scope.
      const targetSiblings = this.list().filter(
        (e) =>
          e.parentId === newTargetParentId &&
          e.id !== target.id &&
          e.id !== source.id,
      );

      for (const sibling of targetSiblings) {
        if (normalize(sibling.name) === normalize(target.name)) {
          throw new Error(
            `Topic name conflicts with an existing topic in target parent scope: ${target.name}`,
          );
        }
        if (
          sibling.aliases.some((a) => normalize(a) === normalize(target.name))
        ) {
          throw new Error(
            `Topic name conflicts with an existing alias in target parent scope: ${target.name}`,
          );
        }
        for (const alias of combinedAliases) {
          if (
            normalize(sibling.name) === normalize(alias) ||
            sibling.aliases.some((a) => normalize(a) === normalize(alias))
          ) {
            throw new Error(
              `Topic alias '${alias}' conflicts with an existing topic in target parent scope`,
            );
          }
        }
      }

      let totalAffectedThreads = 0;
      let totalReparentedChildren = 0;

      // If target is descendant of source, reparent target to source.parentId before processing source's subtree
      if (targetIsDescendantOfSource) {
        this.db
          .prepare("UPDATE ws_corpus_entity SET parent_id = ? WHERE id = ?")
          .run(source.parentId, target.id);
      }

      const mergeSubtree = (src: Topic, dst: Topic) => {
        // 1. Move subjects assigned to src -> dst
        const subjectUpdate = this.db
          .prepare(
            "UPDATE ws_corpus_subject SET entity_id = ? WHERE entity_id = ?",
          )
          .run(dst.id, src.id);
        totalAffectedThreads += subjectUpdate.changes;

        // 2. Handle group bindings
        const dstGroup = this.db
          .prepare("SELECT section_id FROM ws_corpus_group WHERE entity_id = ?")
          .get(dst.id) as { section_id: string } | undefined;
        if (dstGroup) {
          this.db
            .prepare("DELETE FROM ws_corpus_group WHERE entity_id = ?")
            .run(src.id);
        } else {
          this.db
            .prepare(
              "UPDATE ws_corpus_group SET entity_id = ? WHERE entity_id = ?",
            )
            .run(dst.id, src.id);
        }

        // 3. Merge aliases
        const mergedDstAliases = cleanAliases([
          ...dst.aliases,
          src.name,
          ...src.aliases,
        ]).filter((a) => normalize(a) !== normalize(dst.name));

        // Validate mergedDstAliases against siblings in dst.parentId scope
        const siblings = this.list().filter(
          (e) =>
            e.parentId === dst.parentId && e.id !== dst.id && e.id !== src.id,
        );
        for (const sibling of siblings) {
          for (const alias of mergedDstAliases) {
            if (
              normalize(sibling.name) === normalize(alias) ||
              sibling.aliases.some((a) => normalize(a) === normalize(alias))
            ) {
              throw new Error(
                `Topic alias '${alias}' conflicts with an existing topic in target parent scope`,
              );
            }
          }
        }

        this.db
          .prepare("UPDATE ws_corpus_entity SET aliases = ? WHERE id = ?")
          .run(JSON.stringify(mergedDstAliases), dst.id);

        // 4. Process children of src
        const srcChildren = this.list().filter((e) => e.parentId === src.id);
        for (const child of srcChildren) {
          if (child.id === dst.id) continue;

          const dstChildren = this.list().filter((e) => e.parentId === dst.id);
          const matchingDstChild = dstChildren.find(
            (e) =>
              normalize(e.name) === normalize(child.name) && e.id !== child.id,
          );

          if (matchingDstChild) {
            // Recursively merge child into matchingDstChild!
            mergeSubtree(child, matchingDstChild);
          } else {
            // Validate child name and aliases against existing dst children
            for (const existingDstChild of dstChildren) {
              if (
                normalize(existingDstChild.name) === normalize(child.name) ||
                existingDstChild.aliases.some(
                  (a) => normalize(a) === normalize(child.name),
                )
              ) {
                throw new Error(
                  `Topic name conflicts with an existing topic in target parent scope: ${child.name}`,
                );
              }
              for (const alias of child.aliases) {
                if (
                  normalize(existingDstChild.name) === normalize(alias) ||
                  existingDstChild.aliases.some(
                    (a) => normalize(a) === normalize(alias),
                  )
                ) {
                  throw new Error(
                    `Topic alias '${alias}' conflicts with an existing topic in target parent scope`,
                  );
                }
              }
            }

            // Reparent child under dst
            this.db
              .prepare("UPDATE ws_corpus_entity SET parent_id = ? WHERE id = ?")
              .run(dst.id, child.id);
            totalReparentedChildren++;
          }
        }

        // 5. Delete src
        this.db
          .prepare("DELETE FROM ws_corpus_entity WHERE id = ?")
          .run(src.id);
      };

      mergeSubtree(source, target);

      // Verify acyclic invariant across all entities
      for (const e of this.list()) {
        this.assertParentChainAcyclic(e.id);
      }

      this.bumpRevision();

      const updatedTarget = this.getById(target.id)!;
      return {
        target: updatedTarget,
        affectedThreads: totalAffectedThreads,
        reparentedChildren: totalReparentedChildren,
      };
    })();
  }

  state(): TopicState {
    const entities = this.list();
    const groups: Record<string, string> = {};
    for (const [sectionId, entityId] of this.groups()) {
      groups[sectionId] = entityId;
    }
    return {
      entities,
      groups,
      assignments: this.assignments(),
      revision: this.revision(),
    };
  }

  private assertParentChainAcyclic(parentId: string | null): void {
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId !== null) {
      if (visited.has(currentId))
        throw new Error(`Topic parent cycle detected at: ${currentId}`);
      visited.add(currentId);
      const current = this.getById(currentId);
      if (!current) throw new Error(`Unknown topic parent: ${currentId}`);
      currentId = current.parentId;
    }
  }
}
