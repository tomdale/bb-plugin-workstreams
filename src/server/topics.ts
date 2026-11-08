import { topicPath } from "../domain/topic-path.ts";
import {
  topicAncestors,
  assertTopicLevels,
  assertProposalLevels,
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
const CLASSIFICATION_VERSION = "topics-v6";

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
 * The topic tree, manual project choices, and every topic assignment, hashed.
 * Workstream bindings, the catalog revision, and learned project choices are
 * left out so automatic organization cannot immediately invalidate Undo.
 */
export function topicsFingerprint(db: Database): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        (
          db
            .prepare("SELECT * FROM ws_corpus_entity ORDER BY id")
            .all() as Row[]
        ).map((row) =>
          row.project_source === "learned" || row.project_source === null
            ? {
                ...row,
                project_id: null,
                project_source: null,
                project_revision: 0,
              }
            : row,
        ),
        db.prepare("SELECT * FROM ws_corpus_subject ORDER BY thread_id").all(),
      ]),
    )
    .digest("hex");
}

/**
 * Puts back the topic tree and assignments a snapshot recorded, while they
 * still match `fingerprint`: any later topic or assignment change means
 * undoing would discard it, so nothing is restored. Workstreams bound to
 * topics the snapshot lacks are unbound. Returns whether it restored.
 *
 * Rows are updated in place rather than replaced, so foreign keys from
 * workstream bindings and parent links hold at every step, and every topic
 * takes a placeholder name first so no intermediate state repeats a name
 * within one parent.
 */
export function restoreTopics(
  db: Database,
  snapshotId: string,
  fingerprint: string,
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT entities, subjects FROM ws_topic_snapshot WHERE id = ?")
      .get(snapshotId) as { entities: string; subjects: string } | undefined;
    if (!row || topicsFingerprint(db) !== fingerprint) return false;
    const current = parseInt(getMeta(db, "catalog_revision") ?? "1", 10) || 1;
    const entities = JSON.parse(row.entities) as Row[];
    try {
      assertTopicLevels(
        entities.map((entity) => ({
          id: entity.id as string,
          parentId: entity.parent_id as string | null,
        })),
      );
    } catch {
      return false;
    }
    const kept = new Set(entities.map((entity) => entity.id as string));
    const now = new Map(
      (
        db.prepare("SELECT id, parent_id FROM ws_corpus_entity").all() as {
          id: string;
          parent_id: string | null;
        }[]
      ).map((r) => [r.id, r.parent_id]),
    );
    db.prepare("UPDATE ws_corpus_entity SET name = char(0) || id").run();
    db.prepare("DELETE FROM ws_corpus_subject").run();
    for (const group of db
      .prepare("SELECT section_id, entity_id FROM ws_corpus_group")
      .all() as { section_id: string; entity_id: string }[])
      if (!kept.has(group.entity_id))
        db.prepare("DELETE FROM ws_corpus_group WHERE section_id = ?").run(
          group.section_id,
        );
    // Missing topics come back unattached; the next step attaches them.
    insertRows(
      db,
      "ws_corpus_entity",
      entities
        .filter((entity) => !now.has(entity.id as string))
        .map((entity) => ({
          ...entity,
          name: `\u0000${String(entity.id)}`,
          parent_id: null,
        })),
    );
    for (const entity of entities) {
      const live = db
        .prepare(
          "SELECT project_id, project_source, project_revision FROM ws_corpus_entity WHERE id = ?",
        )
        .get(entity.id) as Row;
      // Automatic project learning does not prevent undoing a topic edit.
      // Keep learned choices on surviving topics; manual changes are guarded
      // by the fingerprint, and recreated topics get a fresh association epoch.
      if (
        live.project_source === "learned" &&
        (entity.project_source === null || entity.project_source === "learned")
      ) {
        entity.project_id = live.project_id;
        entity.project_source = live.project_source;
      }
      if ("project_revision" in entity)
        entity.project_revision =
          now.has(entity.id as string) &&
          live.project_id === entity.project_id &&
          live.project_source === entity.project_source
            ? live.project_revision
            : current + 1;
      const columns = Object.keys(entity).filter((column) => column !== "id");
      db.prepare(
        `UPDATE ws_corpus_entity SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      ).run(...columns.map((c) => entity[c]), entity.id);
    }
    // Topics the snapshot lacks go, children first; no kept topic points at
    // them any more.
    const depth = (id: string) => {
      let n = 0;
      for (
        let at = now.get(id) ?? null;
        at && n < 100;
        at = now.get(at) ?? null
      )
        n++;
      return n;
    };
    for (const id of [...now.keys()]
      .filter((id) => !kept.has(id))
      .sort((a, b) => depth(b) - depth(a)))
      db.prepare("DELETE FROM ws_corpus_entity WHERE id = ?").run(id);
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
        "SELECT id, name, description, parent_id, aliases, project_id, project_source, project_revision FROM ws_corpus_entity ORDER BY id",
      )
      .all() as {
      id: string;
      name: string;
      description: string;
      parent_id: string | null;
      aliases: string;
      project_id: string | null;
      project_source: Topic["projectSource"];
      project_revision: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      parentId: row.parent_id,
      aliases: JSON.parse(row.aliases) as string[],
      projectId: row.project_id,
      projectSource: row.project_source,
      projectRevision: row.project_revision,
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

  /** Stored assignments keep a topic in use, including archived work. */
  heldThreads(entityId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ws_corpus_subject WHERE entity_id = ?`,
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
    assertProposalLevels({ name, description, parentId }, this.list());

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
      projectId: null,
      projectSource: null,
      projectRevision: 0,
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
      assertProposalLevels({ name, description, parentId }, this.list());
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
        projectId: null,
        projectSource: null,
        projectRevision: 0,
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
      assertProposalLevels(proposal, this.list());
      let parent = proposal.parentId ?? null;
      // Adding the first child needs a reviewed plan for the whole collection.
      if (parent !== null && this.heldThreads(parent) > 0) {
        const requests = this.divisionRequests();
        const scope = {
          name: proposal.name,
          description: proposal.description,
        };
        if (JSON.stringify(requests[parent]) !== JSON.stringify(scope)) {
          requests[parent] = scope;
          setMeta(this.db, "topic_division_requests", JSON.stringify(requests));
          this.bumpRevision();
        }
        return this.getById(parent)!;
      }
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
      if (entityId !== null && topicAncestors(entityId, this.list()).length > 2)
        throw new Error("Topic identity has at most two levels.");
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
   * `AssignmentProvenance`): your topic is never replaced, and a settled
   * topic — inherited or Full analysis's own — only by Full analysis on a
   * scope shift or with a more specific topic beneath it. A thread settled
   * to no topic stays open to any filing, and Quick analysis only fills a
   * thread that has no topic yet or replaces its own earlier guess.
   * Returns whether the assignment changed.
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
      // A settled topic holds unless the work moved (a scope shift) or the
      // answer narrows beneath it; without a topic the thread stays open.
      const settled =
        current === "inherited" ||
        (current === "full" && row?.entity_id != null);
      if (
        settled &&
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
      const entity = answer.subjectId
        ? this.getById(answer.subjectId)
        : answer.proposed
          ? this.rememberProposal(answer.proposed)
          : null;
      // An unavailable or non-fileable topic preserves the current assignment.
      // Retain the request basis so unrelated turns do not repeat the same call.
      if (
        (answer.subjectId && !entity) ||
        (entity &&
          (this.subtopics(entity.id) > 0 ||
            topicAncestors(entity.id, this.list()).length > 2))
      ) {
        if (kind === "full" && basis)
          this.db
            .prepare(
              `INSERT INTO ws_corpus_subject(thread_id, entity_id, evidence, source)
               VALUES (?, NULL, ?, 'full')
               ON CONFLICT(thread_id) DO UPDATE SET evidence = excluded.evidence`,
            )
            .run(rootId, basis);
        return false;
      }
      const entityId = entity?.id ?? null;
      if (
        row &&
        current === "inherited" &&
        row.entity_id === entityId &&
        !answer.scopeShift
      ) {
        if (kind === "full" && basis && row.evidence !== basis)
          this.db
            .prepare(
              "UPDATE ws_corpus_subject SET evidence = ? WHERE thread_id = ?",
            )
            .run(basis, rootId);
        return false;
      }
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
    if (
      !this.getById(entityId) ||
      this.subtopics(entityId) > 0 ||
      topicAncestors(entityId, this.list()).length > 2
    )
      return false;
    const current = this.assignment(threadId);
    if (current.provenance !== null && current.provenance !== "quick")
      return false;
    this.assign(threadId, entityId, { provenance: "inherited" });
    return true;
  }

  /**
   * Applies a reviewed division of a first-level topic into lasting child
   * topics. Every stored assignment, including archived work, appears exactly
   * once and retains its provenance and basis. Matching children are reused.
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
      if (entity.parentId !== null)
        throw new Error("Only a first-level topic can gain child topics.");
      if (subgroups.length === 0)
        throw new Error("A split needs at least one subgroup.");
      const held = (
        this.db
          .prepare(
            `SELECT thread_id FROM ws_corpus_subject WHERE entity_id = ?`,
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
        const existing = this.resolve(group.name, entityId);
        if (existing) this.assertTakesThreads(existing.id);
        const topic =
          existing ??
          this.insertDiscovered(group.name, group.description, entityId);
        for (const threadId of group.threadIds)
          this.db
            .prepare(
              "UPDATE ws_corpus_subject SET entity_id = ? WHERE thread_id = ?",
            )
            .run(topic.id, threadId);
        result.push(topic);
      }
      this.consumeDivisionRequest(entityId);
      this.bumpRevision();
      return result;
    })();
  }

  divisionRequests(): Record<string, { name: string; description: string }> {
    try {
      const parsed = JSON.parse(
        getMeta(this.db, "topic_division_requests") ?? "{}",
      );
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => {
          const scope = value as {
            name?: unknown;
            description?: unknown;
          } | null;
          return (
            scope &&
            typeof scope.name === "string" &&
            typeof scope.description === "string"
          );
        }),
      ) as Record<string, { name: string; description: string }>;
    } catch {
      return {};
    }
  }

  consumeDivisionRequest(topicId: string): void {
    const requests = this.divisionRequests();
    delete requests[topicId];
    setMeta(this.db, "topic_division_requests", JSON.stringify(requests));
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
   * that have no subtopics, deepest first. Topics you created or configured
   * with a project choice or learning opt-out are kept.
   */
  prune(): Topic[] {
    return this.db.transaction(() => {
      const removed: Topic[] = [];
      for (;;) {
        const row = this.db
          .prepare(
            `SELECT e.id FROM ws_corpus_entity e
             WHERE e.origin = 'discovered'
               AND e.project_id IS NULL
               AND e.project_source IS NULL
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
      projectId?: string | null;
      projectSource?: Topic["projectSource"];
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

      const projectId =
        updates.projectId === undefined
          ? (entity.projectId ?? null)
          : updates.projectId;
      const projectSource =
        updates.projectSource !== undefined
          ? updates.projectSource
          : updates.projectId === undefined
            ? (entity.projectSource ?? null)
            : projectId
              ? "manual"
              : "disabled";
      const projectChanged =
        projectId !== (entity.projectId ?? null) ||
        projectSource !== (entity.projectSource ?? null);
      const projectRevision = projectChanged
        ? this.revision() + 1
        : (entity.projectRevision ?? 0);
      if (
        !nameChanged &&
        !descriptionChanged &&
        !aliasesChanged &&
        !projectChanged
      ) {
        return entity;
      }

      this.db
        .prepare(
          "UPDATE ws_corpus_entity SET name = ?, description = ?, aliases = ?, project_id = ?, project_source = ?, project_revision = ? WHERE id = ?",
        )
        .run(
          cleanName,
          nextDescription,
          JSON.stringify(nextAliases),
          projectId,
          projectSource,
          projectRevision,
          entity.id,
        );

      this.bumpRevision();
      return {
        ...entity,
        name: cleanName,
        description: nextDescription,
        aliases: nextAliases,
        projectId,
        projectSource,
        projectRevision,
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
      assertTopicLevels(this.list());

      this.bumpRevision();
      return { ...entity, parentId: newParentId };
    })();
  }

  updateMetadata(
    entityId: string,
    updates: {
      description?: string;
      aliases?: readonly string[];
      projectId?: string | null;
      projectAutomatic?: boolean;
    },
  ): Topic {
    if (updates.projectAutomatic && updates.projectId)
      throw new Error(
        "Choose automatic learning or an explicit project, not both.",
      );
    return this.edit(entityId, {
      ...updates,
      ...(updates.projectAutomatic
        ? { projectId: null, projectSource: null }
        : {}),
    });
  }

  merge(sourceEntityId: string, targetEntityId: string): Topic {
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
          e.id !== target.id &&
          e.id !== source.id,
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

      // If target is descendant of source, reparent target to source.parentId before processing source's subtree
      if (targetIsDescendantOfSource) {
        this.db
          .prepare("UPDATE ws_corpus_entity SET parent_id = ? WHERE id = ?")
          .run(source.parentId, target.id);
      }

      const mergeSubtree = (src: Topic, dst: Topic) => {
        // 1. Move subjects assigned to src -> dst
        this.db
          .prepare(
            "UPDATE ws_corpus_subject SET entity_id = ? WHERE entity_id = ?",
          )
          .run(dst.id, src.id);

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
          }
        }

        // 5. Delete src
        this.db
          .prepare("DELETE FROM ws_corpus_entity WHERE id = ?")
          .run(src.id);
      };

      mergeSubtree(source, target);

      assertTopicLevels(this.list());

      this.bumpRevision();

      return this.getById(target.id)!;
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
