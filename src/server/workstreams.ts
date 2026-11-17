import { PATH_MARK, workstreamPath } from "../domain/workstream-path.ts";
import {
  workstreamAncestors,
  assertWorkstreamLevels,
  assertProposalLevels,
  resolveProposal,
  type AssignmentProvenance,
  type WorkstreamAssignment,
  type WorkstreamState,
  type Workstream,
  type DraftWorkstreamProposal,
} from "../domain/workstreams.ts";
import { createHash, randomUUID } from "node:crypto";
import { getMeta, setMeta, type Database } from "./db.ts";

/**
 * Bump to choose every thread's workstream again under changed rules. Stored
 * bases hash this value, so its text stays as first written.
 */
const CLASSIFICATION_VERSION = "topics-v6";

/**
 * The basis of an automatic workstream: what it was placed from. Only the user's
 * requests and the project decide a workstream, so a retitle, a workstream edit, or a
 * model change never makes one stale; a new request does.
 */
export function workstreamBasis(input: {
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
  source === "manual" || source === "inherited" || source === "composer"
    ? source
    : "automatic";

const normalize = (value: string) => value.trim().toLowerCase();
const cleanAliases = (aliases: readonly string[]) => [
  ...new Set(aliases.map((alias) => alias.trim()).filter(Boolean)),
];

type Row = Record<string, unknown>;

const WORKSTREAM_COLUMNS =
  "id, name, description, parent_id, aliases, project_id, project_source, project_revision";

type WorkstreamRow = {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;
  aliases: string;
  project_id: string | null;
  project_source: Workstream["projectSource"];
  project_revision: number;
};

const toWorkstream = (row: WorkstreamRow): Workstream => ({
  id: row.id,
  name: row.name,
  description: row.description,
  parentId: row.parent_id,
  aliases: JSON.parse(row.aliases) as string[],
  projectId: row.project_id,
  projectSource: row.project_source,
  projectRevision: row.project_revision,
});

type AssignmentRow = {
  workstream_id: string | null;
  evidence: string | null;
  source: string;
};

/**
 * The workstream `threadId` has through the assignment row of the thread at the
 * top of its tree. `workstreams` holds at least that workstream and its ancestors.
 */
function resolveAssignment(
  threadId: string,
  topId: string,
  row: AssignmentRow | undefined,
  workstreams: readonly Workstream[],
): WorkstreamAssignment {
  const inheritedFrom = topId !== threadId ? topId : null;
  const workstream = row?.workstream_id
    ? workstreams.find((e) => e.id === row.workstream_id)
    : undefined;
  if (!row || !workstream)
    return {
      threadId,
      workstreamId: null,
      status: "none",
      provenance: row ? readSource(row.source) : null,
      label: null,
      ancestorIds: [],
      evidence: row?.evidence ?? null,
      inheritedFrom,
    };
  return {
    threadId,
    workstreamId: workstream.id,
    status: "assigned",
    provenance: readSource(row.source),
    label: workstreamPath(workstream.id, workstreams),
    ancestorIds: workstreamAncestors(workstream.id, workstreams),
    evidence: row.evidence ?? null,
    inheritedFrom,
  };
}

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
 * Records the workstreams and groups and every thread's workstream, so an
 * accepted suggestion can be undone. The latest 50 are kept.
 */
export function snapshotWorkstreams(db: Database, at: number): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO ws_backup(id, at, workstreams, assignments) VALUES (?, ?, ?, ?)",
  ).run(
    id,
    at,
    JSON.stringify(db.prepare("SELECT * FROM ws_workstream").all()),
    JSON.stringify(db.prepare("SELECT * FROM ws_thread_workstream").all()),
  );
  db.prepare(
    "DELETE FROM ws_backup WHERE id NOT IN (SELECT id FROM ws_backup ORDER BY at DESC LIMIT 50)",
  ).run();
  return id;
}

/**
 * The workstreams and groups, manual project choices, and every thread's
 * workstream, hashed. Workstream bindings, the workstream tree revision, and
 * learned project choices are left out so automatic organization cannot
 * immediately invalidate Undo.
 */
export function workstreamsFingerprint(db: Database): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        (
          db.prepare("SELECT * FROM ws_workstream ORDER BY id").all() as Row[]
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
        db
          .prepare("SELECT * FROM ws_thread_workstream ORDER BY thread_id")
          .all(),
      ]),
    )
    .digest("hex");
}

/**
 * Puts back the workstreams and groups and threads' workstreams a snapshot
 * recorded, while they still match `fingerprint`: any later change to a
 * workstream or a thread's workstream means undoing would discard it, so
 * nothing is restored. Sections bound to workstreams the snapshot lacks are
 * unbound. Returns whether it restored.
 *
 * Rows are updated in place rather than replaced, so foreign keys from
 * workstream bindings and parent links hold at every step, and every workstream
 * takes a placeholder name first so no intermediate state repeats a name
 * within one parent.
 */
export function restoreWorkstreams(
  db: Database,
  snapshotId: string,
  fingerprint: string,
): boolean {
  return db.transaction(() => {
    const row = db
      .prepare("SELECT workstreams, assignments FROM ws_backup WHERE id = ?")
      .get(snapshotId) as
      { workstreams: string; assignments: string } | undefined;
    if (!row || workstreamsFingerprint(db) !== fingerprint) return false;
    const current = parseInt(getMeta(db, "tree_revision") ?? "1", 10) || 1;
    const workstreams = JSON.parse(row.workstreams) as Row[];
    try {
      assertWorkstreamLevels(
        workstreams.map((workstream) => ({
          id: workstream.id as string,
          parentId: workstream.parent_id as string | null,
        })),
      );
    } catch {
      return false;
    }
    const kept = new Set(
      workstreams.map((workstream) => workstream.id as string),
    );
    const now = new Map(
      (
        db.prepare("SELECT id, parent_id FROM ws_workstream").all() as {
          id: string;
          parent_id: string | null;
        }[]
      ).map((r) => [r.id, r.parent_id]),
    );
    db.prepare("UPDATE ws_workstream SET name = char(0) || id").run();
    db.prepare("DELETE FROM ws_thread_workstream").run();
    for (const group of db
      .prepare("SELECT section_id, workstream_id FROM ws_workstream_section")
      .all() as { section_id: string; workstream_id: string }[])
      if (!kept.has(group.workstream_id))
        db.prepare(
          "DELETE FROM ws_workstream_section WHERE section_id = ?",
        ).run(group.section_id);
    // Missing workstreams come back unattached; the next step attaches them.
    insertRows(
      db,
      "ws_workstream",
      workstreams
        .filter((workstream) => !now.has(workstream.id as string))
        .map((workstream) => ({
          ...workstream,
          name: `\u0000${String(workstream.id)}`,
          parent_id: null,
        })),
    );
    for (const workstream of workstreams) {
      const live = db
        .prepare(
          "SELECT project_id, project_source, project_revision FROM ws_workstream WHERE id = ?",
        )
        .get(workstream.id) as Row;
      // Automatic project learning does not prevent undoing a workstream edit.
      // Keep learned choices on surviving workstreams; manual changes are guarded
      // by the fingerprint, and recreated workstreams get a fresh association epoch.
      if (
        live.project_source === "learned" &&
        (workstream.project_source === null ||
          workstream.project_source === "learned")
      ) {
        workstream.project_id = live.project_id;
        workstream.project_source = live.project_source;
      }
      if ("project_revision" in workstream)
        workstream.project_revision =
          now.has(workstream.id as string) &&
          live.project_id === workstream.project_id &&
          live.project_source === workstream.project_source
            ? live.project_revision
            : current + 1;
      const columns = Object.keys(workstream).filter(
        (column) => column !== "id",
      );
      db.prepare(
        `UPDATE ws_workstream SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      ).run(...columns.map((c) => workstream[c]), workstream.id);
    }
    // Workstreams the snapshot lacks go, children first; no kept workstream points at
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
      db.prepare("DELETE FROM ws_workstream WHERE id = ?").run(id);
    insertRows(
      db,
      "ws_thread_workstream",
      JSON.parse(row.assignments) as Row[],
    );
    setMeta(db, "tree_revision", String(current + 1));
    return true;
  })();
}

export class WorkstreamStore {
  constructor(private readonly db: Database) {}

  revision(): number {
    const raw = getMeta(this.db, "tree_revision");
    return raw ? parseInt(raw, 10) || 1 : 1;
  }

  /** Unchanged by moving threads or by native-section projection changes. */
  definitionKey(): string {
    return createHash("sha256")
      .update(JSON.stringify(this.list()))
      .digest("hex");
  }

  bumpRevision(): number {
    const next = this.revision() + 1;
    setMeta(this.db, "tree_revision", String(next));
    return next;
  }

  list(): Workstream[] {
    return (
      this.db
        .prepare(`SELECT ${WORKSTREAM_COLUMNS} FROM ws_workstream ORDER BY id`)
        .all() as WorkstreamRow[]
    ).map(toWorkstream);
  }

  /**
   * A workstream and its ancestors, read by id rather than with the whole tree:
   * enough for its path and ancestry. Empty when the workstream is gone.
   */
  private lineage(workstreamId: string): Workstream[] {
    const lookup = this.db.prepare(
      `SELECT ${WORKSTREAM_COLUMNS} FROM ws_workstream WHERE id = ?`,
    );
    const out: Workstream[] = [];
    const seen = new Set<string>();
    let id: string | null = workstreamId;
    while (id !== null && !seen.has(id)) {
      seen.add(id);
      const row = lookup.get(id) as WorkstreamRow | undefined;
      if (!row) break;
      const workstream = toWorkstream(row);
      out.push(workstream);
      id = workstream.parentId;
    }
    return out;
  }

  /** How many workstreams sit directly beneath `workstreamId`. */
  workstreams(workstreamId: string): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM ws_workstream WHERE parent_id = ?")
        .get(workstreamId) as { n: number }
    ).n;
  }

  /** Stored threads keep a workstream in use, including archived work. */
  heldThreads(workstreamId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ws_thread_workstream WHERE workstream_id = ?`,
        )
        .get(workstreamId) as { n: number }
    ).n;
  }

  /**
   * Only a workstream holds threads, and only a group holds workstreams
   * (docs/organization.md).
   * Refuses to give `parentId` a workstream while it holds threads.
   */
  private assertTakesWorkstreams(parentId: string | null): void {
    if (parentId === null) return;
    const held = this.heldThreads(parentId);
    if (held > 0)
      throw new Error(
        `${this.pathOf(parentId)} holds ${held === 1 ? "a thread" : `${held} threads`}, and a workstream can't also hold workstreams. Move its threads first, or accept a suggestion that splits it.`,
      );
  }

  /**
   * Refuses to move a thread into a group.
   */
  private assertTakesThreads(workstreamId: string): void {
    if (this.workstreams(workstreamId) > 0)
      throw new Error(
        `${this.pathOf(workstreamId)} is a group, and a group holds workstreams, never threads. Choose one of its workstreams.`,
      );
  }

  private pathOf(workstreamId: string): string {
    return workstreamPath(workstreamId, this.list());
  }

  getById(id: string): Workstream | null {
    return this.list().find((workstream) => workstream.id === id) ?? null;
  }

  resolve(name: string, parentId: string | null = null): Workstream | null {
    const target = normalize(name);
    for (const workstream of this.list()) {
      if (workstream.parentId !== parentId) continue;
      if (
        normalize(workstream.name) === target ||
        workstream.aliases.some((alias) => normalize(alias) === target)
      )
        return workstream;
    }
    return null;
  }

  /**
   * Inserts a workstream Workstreams discovered. `rememberProposal` resolves a
   * proposal against the tree first, so only names the tree lacks reach here.
   */
  private insertDiscovered(
    name: string,
    description: string,
    parentId: string | null = null,
    aliases: readonly string[] = [],
  ): Workstream {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("A workstream needs a name");
    if (parentId !== null && !this.getById(parentId))
      throw new Error(`Unknown group: ${parentId}`);
    this.assertParentChainAcyclic(parentId);
    assertProposalLevels({ name, description, parentId }, this.list());

    const cleanDescription = description.trim();
    const cleanAliasList = cleanAliases(aliases);
    if (
      cleanAliasList.some((alias) => normalize(alias) === normalize(cleanName))
    )
      throw new Error("An alias must differ from the name");
    if (cleanAliasList.some((alias) => this.resolve(alias, parentId)))
      throw new Error("That alias already names a workstream in this group");

    const workstream: Workstream = {
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
        "INSERT INTO ws_workstream(id, name, description, parent_id, aliases, origin) VALUES (?, ?, ?, ?, ?, 'discovered')",
      )
      .run(
        workstream.id,
        workstream.name,
        workstream.description,
        workstream.parentId,
        JSON.stringify(workstream.aliases),
      );
    return workstream;
  }

  create(
    name: string,
    description: string = "",
    parentId: string | null = null,
    aliases: readonly string[] = [],
  ): Workstream {
    return this.db.transaction(() => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("A workstream needs a name");
      if (parentId !== null && !this.getById(parentId))
        throw new Error(`Unknown group: ${parentId}`);
      this.assertParentChainAcyclic(parentId);
      assertProposalLevels({ name, description, parentId }, this.list());
      this.assertTakesWorkstreams(parentId);

      const existing = this.resolve(cleanName, parentId);
      if (existing) {
        throw new Error(
          `A workstream named '${cleanName}' already exists in this group`,
        );
      }

      const cleanDescription = description.trim();
      const cleanAliasList = cleanAliases(aliases);
      if (
        cleanAliasList.some(
          (alias) => normalize(alias) === normalize(cleanName),
        )
      )
        throw new Error("An alias must differ from the name");

      for (const alias of cleanAliasList) {
        if (this.resolve(alias, parentId))
          throw new Error(
            `The alias '${alias}' already names a workstream in this group`,
          );
      }

      const workstream: Workstream = {
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
          "INSERT INTO ws_workstream(id, name, description, parent_id, aliases) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          workstream.id,
          workstream.name,
          workstream.description,
          workstream.parentId,
          JSON.stringify(workstream.aliases),
        );

      this.bumpRevision();
      return workstream;
    })();
  }

  /**
   * Records a discovered workstream under its deepest existing ancestor,
   * resolved against the workstreams as they are now: it may have changed since
   * the proposal was classified. A proposal that names an existing workstream
   * returns it unchanged.
   */
  rememberProposal(draft: DraftWorkstreamProposal): Workstream {
    return this.db.transaction(() => {
      if (draft.parentId && !this.getById(draft.parentId))
        throw new Error(`Unknown group: ${draft.parentId}`);
      const resolved = resolveProposal(draft, this.list());
      if (resolved.workstreamId !== null)
        return this.getById(resolved.workstreamId)!;
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
          setMeta(this.db, "split_requests", JSON.stringify(requests));
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
      const workstream = this.insertDiscovered(
        proposal.name,
        proposal.description,
        parent,
      );
      this.bumpRevision();
      return workstream;
    })();
  }

  private bindSectionWithoutRevision(
    sectionId: string,
    workstreamId: string,
  ): void {
    if (!this.getById(workstreamId))
      throw new Error(`Unknown workstream: ${workstreamId}`);
    this.db
      .prepare(
        "INSERT INTO ws_workstream_section(section_id, workstream_id) VALUES (?, ?) ON CONFLICT(section_id) DO UPDATE SET workstream_id = excluded.workstream_id",
      )
      .run(sectionId, workstreamId);
  }

  bindSection(sectionId: string, workstreamId: string): void {
    if (!this.getById(workstreamId))
      throw new Error(`Unknown workstream: ${workstreamId}`);
    const existing = this.sectionBindings().get(sectionId);
    if (existing === workstreamId) return;
    this.bindSectionWithoutRevision(sectionId, workstreamId);
    this.bumpRevision();
  }

  unbindSection(sectionId: string): void {
    const res = this.db
      .prepare("DELETE FROM ws_workstream_section WHERE section_id = ?")
      .run(sectionId);
    if (res.changes > 0) {
      this.bumpRevision();
    }
  }

  sectionBindings(): Map<string, string> {
    const rows = this.db
      .prepare(
        "SELECT section_id, workstream_id FROM ws_workstream_section ORDER BY section_id",
      )
      .all() as { section_id: string; workstream_id: string }[];
    return new Map(
      rows.map(({ section_id, workstream_id }) => [section_id, workstream_id]),
    );
  }

  topThreadOf(threadId: string): string {
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

  private row(threadId: string): AssignmentRow | undefined {
    return this.db
      .prepare(
        "SELECT workstream_id, evidence, source FROM ws_thread_workstream WHERE thread_id = ?",
      )
      .get(threadId) as AssignmentRow | undefined;
  }

  /**
   * One thread's workstream. It reads only the thread at the top of its tree,
   * its assignment row, and the workstream's lineage, so callers may use it per
   * thread; a caller resolving many threads at once uses `assignmentsOf`.
   */
  assignment(threadId: string): WorkstreamAssignment {
    const topId = this.topThreadOf(threadId);
    const row = this.row(topId);
    return resolveAssignment(
      threadId,
      topId,
      row,
      row?.workstream_id ? this.lineage(row.workstream_id) : [],
    );
  }

  /**
   * The workstreams of `threadIds`, from one read of the workstreams and
   * groups.
   */
  assignmentsOf(
    threadIds: Iterable<string>,
  ): Map<string, WorkstreamAssignment> {
    const workstreams = this.list();
    const out = new Map<string, WorkstreamAssignment>();
    for (const threadId of threadIds) {
      const topId = this.topThreadOf(threadId);
      out.set(
        threadId,
        resolveAssignment(threadId, topId, this.row(topId), workstreams),
      );
    }
    return out;
  }

  /** Every seen thread's and every stored assignment's workstream. */
  assignments(): Record<string, WorkstreamAssignment> {
    const workstreams = this.list();
    const rows = new Map(
      (
        this.db
          .prepare(
            "SELECT thread_id, workstream_id, evidence, source FROM ws_thread_workstream",
          )
          .all() as (AssignmentRow & { thread_id: string })[]
      ).map((row) => [row.thread_id, row]),
    );

    const seenRows = this.db
      .prepare("SELECT thread_id, parent_thread_id FROM ws_seen_thread")
      .all() as { thread_id: string; parent_thread_id: string | null }[];
    const parentMap = new Map<string, string | null>();
    for (const row of seenRows) {
      parentMap.set(row.thread_id, row.parent_thread_id);
    }

    const resolveTop = (id: string) => {
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

    const threadIds = new Set<string>([...parentMap.keys(), ...rows.keys()]);

    const result: Record<string, WorkstreamAssignment> = {};
    for (const threadId of threadIds) {
      const topId = resolveTop(threadId);
      result[threadId] = resolveAssignment(
        threadId,
        topId,
        rows.get(topId),
        workstreams,
      );
    }
    return result;
  }

  assign(
    threadId: string,
    workstreamId: string | null,
    options?: { provenance?: AssignmentProvenance; evidence?: string | null },
  ): WorkstreamAssignment {
    return this.db.transaction(() => {
      if (workstreamId !== null && !this.getById(workstreamId))
        throw new Error(`Unknown workstream: ${workstreamId}`);
      if (!threadId.trim()) throw new Error("Thread ID must not be empty");

      const topId = this.topThreadOf(threadId);

      const provenance: AssignmentProvenance = options?.provenance ?? "manual";
      const evidence: string | null = options?.evidence ?? null;

      const existing = this.db
        .prepare(
          "SELECT workstream_id, evidence, source FROM ws_thread_workstream WHERE thread_id = ?",
        )
        .get(topId) as
        | {
            workstream_id: string | null;
            evidence: string | null;
            source: string;
          }
        | undefined;

      if (
        existing &&
        existing.workstream_id === workstreamId &&
        existing.source === provenance &&
        (existing.evidence ?? null) === evidence
      ) {
        return this.assignment(threadId);
      }
      if (
        workstreamId !== null &&
        workstreamAncestors(workstreamId, this.list()).length > 2
      )
        throw new Error("Workstreams go at most two levels deep.");
      if (workstreamId !== null && existing?.workstream_id !== workstreamId)
        this.assertTakesThreads(workstreamId);

      const isInitialClear =
        !existing && workstreamId === null && provenance === "manual";

      this.db
        .prepare(
          `INSERT INTO ws_thread_workstream(thread_id, workstream_id, evidence, source)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             workstream_id = excluded.workstream_id,
             evidence = excluded.evidence,
             source = excluded.source`,
        )
        .run(topId, workstreamId, evidence, provenance);

      if (!isInitialClear) {
        this.bumpRevision();
      }
      return this.assignment(threadId);
    })();
  }

  clear(threadId: string): WorkstreamAssignment {
    return this.assign(threadId, null, {
      provenance: "manual",
      evidence: null,
    });
  }

  /**
   * Applies an analysis's workstream under the source priority (see
   * `AssignmentProvenance`): your workstream is never replaced, an inherited
   * one only by an automatic choice on a scope shift or with a more specific
   * workstream beneath it, and the composer's guess (`composer`) only fills a
   * thread that has no workstream yet or replaces its own earlier guess. Returns whether the thread's workstream changed.
   */
  applyAnalysis(
    threadId: string,
    answer: {
      workstreamId: string | null;
      proposed: DraftWorkstreamProposal | null;
      scopeShift?: boolean;
    },
    kind: "automatic" | "composer",
    basis: string | null,
  ): boolean {
    return this.db.transaction(() => {
      const topId = this.topThreadOf(threadId);
      const row = this.db
        .prepare(
          "SELECT workstream_id, evidence, source FROM ws_thread_workstream WHERE thread_id = ?",
        )
        .get(topId) as
        | {
            workstream_id: string | null;
            evidence: string | null;
            source: string;
          }
        | undefined;
      const current = row ? readSource(row.source) : null;
      if (current === "manual") return false;
      if (
        current === "inherited" &&
        !(
          kind === "automatic" &&
          (answer.scopeShift ||
            this.narrows(answer, row?.workstream_id ?? null))
        )
      ) {
        // Settled from these requests: a later turn without a new request
        // has nothing to reconsider.
        if (kind === "automatic" && basis && row?.evidence !== basis)
          this.db
            .prepare(
              "UPDATE ws_thread_workstream SET evidence = ? WHERE thread_id = ?",
            )
            .run(basis, topId);
        return false;
      }
      if (kind === "composer" && current !== null && current !== "composer")
        return false;
      const workstream = answer.workstreamId
        ? this.getById(answer.workstreamId)
        : answer.proposed
          ? this.rememberProposal(answer.proposed)
          : null;
      // A workstream that is unavailable or can't hold threads preserves the
      // current one. Retain the request basis so unrelated turns do not repeat
      // the same call.
      if (
        (answer.workstreamId && !workstream) ||
        (workstream &&
          (this.workstreams(workstream.id) > 0 ||
            workstreamAncestors(workstream.id, this.list()).length > 2))
      ) {
        if (kind === "automatic" && basis)
          this.db
            .prepare(
              `INSERT INTO ws_thread_workstream(thread_id, workstream_id, evidence, source)
               VALUES (?, NULL, ?, 'automatic')
               ON CONFLICT(thread_id) DO UPDATE SET evidence = excluded.evidence`,
            )
            .run(topId, basis);
        return false;
      }
      const workstreamId = workstream?.id ?? null;
      if (
        row &&
        current === "inherited" &&
        row.workstream_id === workstreamId &&
        !answer.scopeShift
      ) {
        if (kind === "automatic" && basis && row.evidence !== basis)
          this.db
            .prepare(
              "UPDATE ws_thread_workstream SET evidence = ? WHERE thread_id = ?",
            )
            .run(basis, topId);
        return false;
      }
      if (
        row &&
        row.workstream_id === workstreamId &&
        readSource(row.source) === kind &&
        (row.evidence ?? null) === basis
      )
        return false;
      const changed =
        !row ||
        row.workstream_id !== workstreamId ||
        readSource(row.source) !== kind;
      this.db
        .prepare(
          `INSERT INTO ws_thread_workstream(thread_id, workstream_id, evidence, source)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             workstream_id = excluded.workstream_id,
             evidence = excluded.evidence,
             source = excluded.source`,
        )
        .run(topId, workstreamId, basis, kind);
      if (changed) this.bumpRevision();
      return changed;
    })();
  }

  /**
   * Whether an answer names a workstream strictly beneath `workstreamId`: an existing
   * descendant, or a proposal anchored at it or below it.
   */
  private narrows(
    answer: {
      workstreamId: string | null;
      proposed: DraftWorkstreamProposal | null;
    },
    workstreamId: string | null,
  ): boolean {
    if (!workstreamId) return false;
    const workstreams = this.list();
    const known = new Set(workstreams.map((workstream) => workstream.id));
    if (answer.workstreamId)
      return (
        answer.workstreamId !== workstreamId &&
        known.has(answer.workstreamId) &&
        workstreamAncestors(answer.workstreamId, workstreams).includes(
          workstreamId,
        )
      );
    const anchor = answer.proposed?.parentId;
    return (
      !!anchor &&
      known.has(anchor) &&
      workstreamAncestors(anchor, workstreams).includes(workstreamId)
    );
  }

  /**
   * Gives a thread that has no workstream of its own the workstream of the thread it
   * was started from. Returns whether it changed anything.
   */
  inherit(threadId: string, fromThreadId: string): boolean {
    const source = this.assignment(fromThreadId);
    if (!source.workstreamId) return false;
    return this.inheritWorkstream(threadId, source.workstreamId);
  }

  /**
   * Gives a thread that has no workstream of its own, or only the composer's
   * guess, the workstream `workstreamId` as inherited.
   */
  inheritWorkstream(threadId: string, workstreamId: string): boolean {
    // A group holds no threads; the workstream
    // choice settles the thread with this workstream as its hint.
    if (
      !this.getById(workstreamId) ||
      this.workstreams(workstreamId) > 0 ||
      workstreamAncestors(workstreamId, this.list()).length > 2
    )
      return false;
    const current = this.assignment(threadId);
    if (current.provenance !== null && current.provenance !== "composer")
      return false;
    this.assign(threadId, workstreamId, { provenance: "inherited" });
    return true;
  }

  /**
   * Applies a reviewed division of a top-level workstream into lasting child
   * workstreams. Every stored thread, including archived work, appears exactly
   * once and retains its provenance and basis. Matching children are reused.
   */
  split(
    workstreamId: string,
    workstreams: readonly {
      name: string;
      description: string;
      threadIds: readonly string[];
    }[],
  ): Workstream[] {
    return this.db.transaction(() => {
      const workstream = this.getById(workstreamId);
      if (!workstream) throw new Error(`Unknown workstream: ${workstreamId}`);
      if (workstream.parentId !== null)
        throw new Error("Only a top-level workstream can be split.");
      if (workstreams.length === 0)
        throw new Error("A split needs at least one workstream.");
      const held = (
        this.db
          .prepare(
            `SELECT thread_id FROM ws_thread_workstream WHERE workstream_id = ?`,
          )
          .all(workstreamId) as { thread_id: string }[]
      ).map((row) => row.thread_id);
      const listed = workstreams.flatMap((child) => child.threadIds);
      if (
        listed.length !== new Set(listed).size ||
        listed.length !== held.length ||
        held.some((id) => !listed.includes(id))
      )
        throw new Error(
          `A split of ${this.pathOf(workstreamId)} must put each of its threads in exactly one workstream.`,
        );
      const names = workstreams.map((group) => normalize(group.name));
      if (
        names.some((name) => !name || name.includes(PATH_MARK)) ||
        new Set(names).size !== names.length
      )
        throw new Error(
          `Workstreams need distinct names without “${PATH_MARK}”.`,
        );
      const result: Workstream[] = [];
      for (const group of workstreams) {
        const existing = this.resolve(group.name, workstreamId);
        if (existing) this.assertTakesThreads(existing.id);
        const workstream =
          existing ??
          this.insertDiscovered(group.name, group.description, workstreamId);
        for (const threadId of group.threadIds)
          this.db
            .prepare(
              "UPDATE ws_thread_workstream SET workstream_id = ? WHERE thread_id = ?",
            )
            .run(workstream.id, threadId);
        result.push(workstream);
      }
      this.consumeDivisionRequest(workstreamId);
      this.bumpRevision();
      return result;
    })();
  }

  divisionRequests(): Record<string, { name: string; description: string }> {
    try {
      const parsed = JSON.parse(getMeta(this.db, "split_requests") ?? "{}");
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

  consumeDivisionRequest(workstreamId: string): void {
    const requests = this.divisionRequests();
    delete requests[workstreamId];
    setMeta(this.db, "split_requests", JSON.stringify(requests));
  }

  /**
   * Puts back a request `consumeDivisionRequest` took for a split that was
   * never asked. A request made meanwhile stands.
   */
  restoreDivisionRequest(
    workstreamId: string,
    scope: { name: string; description: string },
  ): void {
    const requests = this.divisionRequests();
    if (requests[workstreamId]) return;
    requests[workstreamId] = scope;
    setMeta(this.db, "split_requests", JSON.stringify(requests));
  }

  /** The basis the thread's automatic workstream was settled from, if any. */
  basis(threadId: string): string | null {
    const row = this.db
      .prepare("SELECT evidence FROM ws_thread_workstream WHERE thread_id = ?")
      .get(this.topThreadOf(threadId)) as
      { evidence: string | null } | undefined;
    return row?.evidence ?? null;
  }

  /** Forgets a deleted thread's workstream, so it no longer keeps a workstream in use. */
  forget(threadId: string): void {
    const removed = this.db
      .prepare("DELETE FROM ws_thread_workstream WHERE thread_id = ?")
      .run(threadId);
    if (removed.changes > 0) this.bumpRevision();
  }

  /**
   * Removes discovered workstreams that no thread has, no workstream uses, and
   * that aren't groups, deepest first. Workstreams you created or configured
   * with a project choice or learning opt-out are kept.
   */
  prune(): Workstream[] {
    return this.db.transaction(() => {
      const removed: Workstream[] = [];
      for (;;) {
        const row = this.db
          .prepare(
            `SELECT e.id FROM ws_workstream e
             WHERE e.origin = 'discovered'
               AND e.project_id IS NULL
               AND e.project_source IS NULL
               AND NOT EXISTS (SELECT 1 FROM ws_thread_workstream s WHERE s.workstream_id = e.id)
               AND NOT EXISTS (SELECT 1 FROM ws_workstream_section g WHERE g.workstream_id = e.id)
               AND NOT EXISTS (SELECT 1 FROM ws_workstream c WHERE c.parent_id = e.id)
             LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        if (!row) break;
        removed.push(this.getById(row.id)!);
        this.db.prepare("DELETE FROM ws_workstream WHERE id = ?").run(row.id);
      }
      if (removed.length) this.bumpRevision();
      return removed;
    })();
  }

  edit(
    workstreamId: string,
    updates: {
      name?: string;
      description?: string;
      aliases?: readonly string[];
      projectId?: string | null;
      projectSource?: Workstream["projectSource"];
    },
  ): Workstream {
    return this.db.transaction(() => {
      const workstream = this.getById(workstreamId);
      if (!workstream) throw new Error(`Unknown workstream: ${workstreamId}`);

      let cleanName = workstream.name;
      if (updates.name !== undefined) {
        cleanName = updates.name.trim();
        if (!cleanName) throw new Error("Workstream name must not be empty");
        if (normalize(workstream.name) !== normalize(cleanName)) {
          const conflict = this.resolve(cleanName, workstream.parentId);
          if (conflict && conflict.id !== workstreamId) {
            throw new Error(
              `A workstream in this group is already named ${cleanName}`,
            );
          }
        }
      }

      let nextDescription = workstream.description;
      if (updates.description !== undefined) {
        nextDescription = updates.description.trim();
      }

      let nextAliases = workstream.aliases;
      if (updates.aliases !== undefined) {
        const cleanAliasList = cleanAliases(updates.aliases);
        if (
          cleanAliasList.some(
            (alias) => normalize(alias) === normalize(cleanName),
          )
        ) {
          throw new Error("An alias must differ from the name");
        }
        if (
          cleanAliasList.some((alias) => {
            const other = this.resolve(alias, workstream.parentId);
            return other && other.id !== workstream.id;
          })
        ) {
          throw new Error(
            "That alias already names a workstream in this group",
          );
        }
        nextAliases = cleanAliasList;
      } else if (updates.name !== undefined) {
        nextAliases = cleanAliases(
          workstream.aliases.filter(
            (a) => normalize(a) !== normalize(cleanName),
          ),
        );
      }

      const nameChanged = cleanName !== workstream.name;
      const descriptionChanged = nextDescription !== workstream.description;
      const aliasesChanged =
        nextAliases.length !== workstream.aliases.length ||
        nextAliases.some((a, i) => a !== workstream.aliases[i]);

      const projectId =
        updates.projectId === undefined
          ? (workstream.projectId ?? null)
          : updates.projectId;
      const projectSource =
        updates.projectSource !== undefined
          ? updates.projectSource
          : updates.projectId === undefined
            ? (workstream.projectSource ?? null)
            : projectId
              ? "manual"
              : "disabled";
      const projectChanged =
        projectId !== (workstream.projectId ?? null) ||
        projectSource !== (workstream.projectSource ?? null);
      const projectRevision = projectChanged
        ? this.revision() + 1
        : (workstream.projectRevision ?? 0);
      if (
        !nameChanged &&
        !descriptionChanged &&
        !aliasesChanged &&
        !projectChanged
      ) {
        return workstream;
      }

      this.db
        .prepare(
          "UPDATE ws_workstream SET name = ?, description = ?, aliases = ?, project_id = ?, project_source = ?, project_revision = ? WHERE id = ?",
        )
        .run(
          cleanName,
          nextDescription,
          JSON.stringify(nextAliases),
          projectId,
          projectSource,
          projectRevision,
          workstream.id,
        );

      this.bumpRevision();
      return {
        ...workstream,
        name: cleanName,
        description: nextDescription,
        aliases: nextAliases,
        projectId,
        projectSource,
        projectRevision,
      };
    })();
  }

  rename(workstreamId: string, newName: string): Workstream {
    return this.edit(workstreamId, { name: newName });
  }

  move(workstreamId: string, newParentId: string | null): Workstream {
    return this.db.transaction(() => {
      const workstream = this.getById(workstreamId);
      if (!workstream) throw new Error(`Unknown workstream: ${workstreamId}`);
      if (workstream.parentId === newParentId) return workstream;
      if (newParentId === workstreamId)
        throw new Error("A workstream can't move into itself");

      if (newParentId !== null) {
        const parent = this.getById(newParentId);
        if (!parent) throw new Error(`Unknown group: ${newParentId}`);
        this.assertTakesWorkstreams(newParentId);
        const parentAncestors = workstreamAncestors(newParentId, this.list());
        if (parentAncestors.includes(workstreamId)) {
          throw new Error(
            `Can't move ${workstreamId} into ${newParentId}, which is inside it`,
          );
        }
      }

      const conflict = this.resolve(workstream.name, newParentId);
      if (conflict && conflict.id !== workstreamId) {
        throw new Error(
          `A workstream in the target group is already named ${workstream.name}`,
        );
      }

      for (const alias of workstream.aliases) {
        const other = this.resolve(alias, newParentId);
        if (other && other.id !== workstreamId) {
          throw new Error(
            `The alias '${alias}' already names a workstream in the target group`,
          );
        }
      }

      this.db
        .prepare("UPDATE ws_workstream SET parent_id = ? WHERE id = ?")
        .run(newParentId, workstream.id);
      assertWorkstreamLevels(this.list());

      this.bumpRevision();
      return { ...workstream, parentId: newParentId };
    })();
  }

  updateMetadata(
    workstreamId: string,
    updates: {
      description?: string;
      aliases?: readonly string[];
      projectId?: string | null;
      projectAutomatic?: boolean;
    },
  ): Workstream {
    if (updates.projectAutomatic && updates.projectId)
      throw new Error(
        "Choose automatic learning or an explicit project, not both.",
      );
    return this.edit(workstreamId, {
      ...updates,
      ...(updates.projectAutomatic
        ? { projectId: null, projectSource: null }
        : {}),
    });
  }

  merge(sourceWorkstreamId: string, targetWorkstreamId: string): Workstream {
    if (sourceWorkstreamId === targetWorkstreamId) {
      throw new Error("Cannot merge a workstream into itself");
    }

    return this.db.transaction(() => {
      const source = this.getById(sourceWorkstreamId);
      if (!source)
        throw new Error(`Unknown source workstream: ${sourceWorkstreamId}`);
      const target = this.getById(targetWorkstreamId);
      if (!target)
        throw new Error(`Unknown target workstream: ${targetWorkstreamId}`);

      const workstreams = this.list();
      const targetAncestors = workstreamAncestors(target.id, workstreams);
      const targetIsDescendantOfSource = targetAncestors.includes(source.id);

      // The merged result holds both sides' threads and workstreams, so one
      // side's threads can't land in the other side's group.
      const mergedWorkstreams = workstreams.filter(
        (e) =>
          (e.parentId === target.id || e.parentId === source.id) &&
          e.id !== target.id &&
          e.id !== source.id,
      ).length;
      const mergedThreads =
        this.heldThreads(source.id) + this.heldThreads(target.id);
      if (mergedWorkstreams > 0 && mergedThreads > 0)
        throw new Error(
          `Merging ${this.pathOf(source.id)} into ${this.pathOf(target.id)} would put threads beside workstreams, and a group holds workstreams, never threads.`,
        );

      const newTargetParentId = targetIsDescendantOfSource
        ? source.parentId
        : target.parentId;

      // Validate newTargetParentId
      if (newTargetParentId !== null) {
        const newParent = this.getById(newTargetParentId);
        if (!newParent) throw new Error(`Unknown group: ${newTargetParentId}`);
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
            `A workstream in the target group is already named ${target.name}`,
          );
        }
        if (
          sibling.aliases.some((a) => normalize(a) === normalize(target.name))
        ) {
          throw new Error(
            `An alias in the target group already names ${target.name}`,
          );
        }
        for (const alias of combinedAliases) {
          if (
            normalize(sibling.name) === normalize(alias) ||
            sibling.aliases.some((a) => normalize(a) === normalize(alias))
          ) {
            throw new Error(
              `The alias '${alias}' already names a workstream in the target group`,
            );
          }
        }
      }

      // If target is descendant of source, reparent target to source.parentId before processing source's subtree
      if (targetIsDescendantOfSource) {
        this.db
          .prepare("UPDATE ws_workstream SET parent_id = ? WHERE id = ?")
          .run(source.parentId, target.id);
      }

      const mergeSubtree = (src: Workstream, dst: Workstream) => {
        // 1. Move rows assigned to src -> dst
        this.db
          .prepare(
            "UPDATE ws_thread_workstream SET workstream_id = ? WHERE workstream_id = ?",
          )
          .run(dst.id, src.id);

        // 2. Handle group bindings
        const dstGroup = this.db
          .prepare(
            "SELECT section_id FROM ws_workstream_section WHERE workstream_id = ?",
          )
          .get(dst.id) as { section_id: string } | undefined;
        if (dstGroup) {
          this.db
            .prepare(
              "DELETE FROM ws_workstream_section WHERE workstream_id = ?",
            )
            .run(src.id);
        } else {
          this.db
            .prepare(
              "UPDATE ws_workstream_section SET workstream_id = ? WHERE workstream_id = ?",
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
                `The alias '${alias}' already names a workstream in the target group`,
              );
            }
          }
        }

        this.db
          .prepare("UPDATE ws_workstream SET aliases = ? WHERE id = ?")
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
                  `A workstream in the target group is already named ${child.name}`,
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
                    `The alias '${alias}' already names a workstream in the target group`,
                  );
                }
              }
            }

            // Reparent child under dst
            this.db
              .prepare("UPDATE ws_workstream SET parent_id = ? WHERE id = ?")
              .run(dst.id, child.id);
          }
        }

        // 5. Delete src
        this.db.prepare("DELETE FROM ws_workstream WHERE id = ?").run(src.id);
      };

      mergeSubtree(source, target);

      assertWorkstreamLevels(this.list());

      this.bumpRevision();

      return this.getById(target.id)!;
    })();
  }

  state(): WorkstreamState {
    const workstreams = this.list();
    const groups: Record<string, string> = {};
    for (const [sectionId, workstreamId] of this.sectionBindings()) {
      groups[sectionId] = workstreamId;
    }
    return {
      workstreams,
      groups,
      assignments: this.assignments(),
      revision: this.revision(),
    };
  }

  /**
   * The workstreams of visible, non-archived threads (`ws_seen_thread`), one
   * for each, for client snapshots. Plans that move threads and checks of
   * stored workstreams use `assignments()`, which also covers archived
   * rows; clients read an archived thread's workstream on demand.
   */
  visibleAssignments(): Record<string, WorkstreamAssignment> {
    const workstreams = this.list();
    const parents = new Map(
      (
        this.db
          .prepare("SELECT thread_id, parent_thread_id FROM ws_seen_thread")
          .all() as { thread_id: string; parent_thread_id: string | null }[]
      ).map((row) => [row.thread_id, row.parent_thread_id]),
    );
    // A top-level thread is a seen thread or the unseen parent a seen chain
    // stops at.
    const rows = new Map(
      (
        this.db
          .prepare(
            `SELECT thread_id, workstream_id, evidence, source FROM ws_thread_workstream
             WHERE thread_id IN (SELECT thread_id FROM ws_seen_thread
               UNION SELECT parent_thread_id FROM ws_seen_thread)`,
          )
          .all() as (AssignmentRow & { thread_id: string })[]
      ).map((row) => [row.thread_id, row]),
    );
    const result: Record<string, WorkstreamAssignment> = {};
    for (const threadId of parents.keys()) {
      let topId = threadId;
      const visited = new Set<string>();
      while (!visited.has(topId)) {
        visited.add(topId);
        const parent = parents.get(topId);
        if (!parent) break;
        topId = parent;
      }
      result[threadId] = resolveAssignment(
        threadId,
        topId,
        rows.get(topId),
        workstreams,
      );
    }
    return result;
  }

  private assertParentChainAcyclic(parentId: string | null): void {
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId !== null) {
      if (visited.has(currentId))
        throw new Error(`A workstream is inside itself at: ${currentId}`);
      visited.add(currentId);
      const current = this.getById(currentId);
      if (!current) throw new Error(`Unknown group: ${currentId}`);
      currentId = current.parentId;
    }
  }
}
