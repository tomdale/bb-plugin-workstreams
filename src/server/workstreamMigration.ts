import { createHash, randomUUID } from "node:crypto";
import {
  workstreamMigrationInput,
  type WorkstreamMigrationInput,
  type WorkstreamMigrationPlan,
} from "../domain/workstreamMigration.ts";
import {
  assertWorkstreamLevels,
  takesThreads,
  type Workstream,
} from "../domain/workstreams.ts";
import { pathNames, workstreamPath } from "../domain/workstream-path.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import type { Journal } from "./journal.ts";
import { UserError } from "./service.ts";

type Assignment = {
  thread_id: string;
  workstream_id: string | null;
  source: string;
  evidence: string | null;
};
const KEY = "migration_preview";

/** A workstream migration is an explicit reviewed transaction, never a schema migration. */
export class WorkstreamMigration {
  constructor(
    private readonly deps: {
      db: Database;
      workstreamStore: WorkstreamStore;
      journal: Journal;
    },
  ) {}

  private assignments(): Assignment[] {
    return this.deps.db
      .prepare(
        "SELECT thread_id, workstream_id, source, evidence FROM ws_thread_workstream ORDER BY thread_id",
      )
      .all() as Assignment[];
  }

  private fingerprint(): string {
    return createHash("sha256")
      .update(
        JSON.stringify([this.deps.workstreamStore.list(), this.assignments()]),
      )
      .digest("hex");
  }

  preview(raw: WorkstreamMigrationInput = {}): WorkstreamMigrationPlan {
    const input = workstreamMigrationInput.parse(raw);
    const workstreams = this.deps.workstreamStore.list();
    const byId = new Map(
      workstreams.map((workstream) => [workstream.id, workstream]),
    );
    const fold = new Map<string, string>();
    for (const workstream of workstreams) {
      let at = workstream;
      const seen = new Set<string>();
      while (at.parentId && byId.get(at.parentId)?.parentId) {
        if (seen.has(at.id))
          throw new UserError(
            "Fix the workstream that is inside itself before previewing a migration.",
          );
        seen.add(at.id);
        at = byId.get(at.parentId)!;
      }
      fold.set(workstream.id, at.id);
    }
    const proposed: Workstream[] = workstreams
      .filter((workstream) => fold.get(workstream.id) === workstream.id)
      .map((workstream) => ({
        ...workstream,
        aliases: [...workstream.aliases],
      }));
    const newIds = new Map<string, string>();
    for (const workstream of input.newWorkstreams) {
      if (newIds.has(workstream.key) || byId.has(workstream.key))
        throw new UserError("New workstream keys must be unique.");
      newIds.set(workstream.key, randomUUID());
    }
    for (const workstream of input.newWorkstreams)
      proposed.push({
        id: newIds.get(workstream.key)!,
        name: workstream.name,
        description: workstream.description,
        parentId: workstream.parentId
          ? (newIds.get(workstream.parentId) ?? workstream.parentId)
          : null,
        aliases: workstream.aliases,
        projectId: null,
        projectSource: null,
        projectRevision: 0,
      });
    assertWorkstreamLevels(proposed);
    const removed = workstreams
      .filter((workstream) => fold.get(workstream.id) !== workstream.id)
      .map((workstream) => ({
        id: workstream.id,
        path: workstreamPath(workstream.id, workstreams),
        targetId: fold.get(workstream.id)!,
        projectId: workstream.projectId ?? null,
        projectSource: workstream.projectSource ?? null,
      }));
    for (const workstream of removed) {
      const target = proposed.find((item) => item.id === workstream.targetId)!;
      if (!target.aliases.includes(workstream.path))
        target.aliases.push(workstream.path);
    }
    const siblings = new Map<string, string>();
    for (const workstream of proposed) {
      for (const name of [workstream.name, ...workstream.aliases]) {
        const key = `${workstream.parentId ?? ""}\u0000${name.trim().toLowerCase()}`;
        const previous = siblings.get(key);
        if (previous && previous !== workstream.id)
          throw new UserError(`Workstream name or alias conflicts: ${name}`);
        siblings.set(key, workstream.id);
      }
    }
    const assignments = this.assignments();
    const known = new Set(
      assignments.map((assignment) => assignment.thread_id),
    );
    const choices = new Map<string, string>();
    for (const choice of input.choices) {
      if (!known.has(choice.threadId) || choices.has(choice.threadId))
        throw new UserError(
          "Migration choices must name each known assignment at most once.",
        );
      choices.set(
        choice.threadId,
        newIds.get(choice.workstreamId) ?? choice.workstreamId,
      );
    }
    const resetIds = new Set(input.resetThreadIds);
    if (
      resetIds.size !== input.resetThreadIds.length ||
      input.resetThreadIds.some((id) => !known.has(id) || choices.has(id))
    )
      throw new UserError(
        "Reset choices must name known threads once and can't also move them.",
      );
    const resets: WorkstreamMigrationPlan["resets"] = [];
    const changes: WorkstreamMigrationPlan["changes"] = [];
    const blockers: WorkstreamMigrationPlan["blockers"] = [];
    for (const assignment of assignments) {
      if (resetIds.has(assignment.thread_id)) {
        if (assignment.source === "manual")
          throw new UserError("A migration reset can't undo a move you made.");
        if (!assignment.workstream_id)
          throw new UserError("That thread already has no workstream.");
        resets.push({
          threadId: assignment.thread_id,
          from: workstreamPath(assignment.workstream_id, workstreams),
          source: assignment.source,
        });
        continue;
      }
      if (!assignment.workstream_id) {
        if (choices.has(assignment.thread_id))
          throw new UserError(
            "A migration doesn't move threads that have no workstream.",
          );
        continue;
      }
      const destination =
        choices.get(assignment.thread_id) ?? fold.get(assignment.workstream_id);
      const target = proposed.find(
        (workstream) => workstream.id === destination,
      );
      if (!target)
        throw new UserError("A migration choice names an unknown destination.");
      if (!takesThreads(target.id, proposed)) {
        blockers.push({
          threadId: assignment.thread_id,
          workstreamId: target.id,
          reason: "Choose a meaningfully named workstream for this thread.",
        });
        continue;
      }
      if (target.id !== assignment.workstream_id)
        changes.push({
          threadId: assignment.thread_id,
          from: workstreamPath(assignment.workstream_id, workstreams),
          to: workstreamPath(target.id, proposed),
          workstreamId: target.id,
          source: assignment.source,
        });
    }
    for (const workstream of removed) {
      const previous = byId.get(workstream.id)!;
      if (
        previous.projectSource === "manual" ||
        previous.projectSource === "disabled"
      )
        blockers.push({
          threadId: null,
          workstreamId: workstream.id,
          reason: "Review this workstream's project before removing it.",
        });
    }
    const plan = {
      id: randomUUID(),
      fingerprint: this.fingerprint(),
      workstreams: proposed,
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
      const plan = raw ? (JSON.parse(raw) as WorkstreamMigrationPlan) : null;
      if (!plan || plan.id !== planId)
        throw new UserError("Preview this migration before applying it.");
      if (plan.fingerprint !== this.fingerprint())
        throw new UserError(
          "Workstreams or their threads changed. Review a fresh migration preview.",
        );
      if (plan.blockers.length)
        throw new UserError(
          "Resolve every migration blocker before applying the plan.",
        );
      if (
        !plan.removed.length &&
        !plan.changes.length &&
        !plan.resets.length &&
        this.deps.workstreamStore.list().length === plan.workstreams.length
      )
        throw new UserError("The migration would change nothing.");
      const backupId = randomUUID();
      setMeta(
        this.deps.db,
        `migration_backup:${backupId}`,
        JSON.stringify({
          at: Date.now(),
          workstreams: this.deps.db
            .prepare("SELECT * FROM ws_workstream")
            .all(),
          assignments: this.deps.db
            .prepare("SELECT * FROM ws_thread_workstream")
            .all(),
          sections: this.deps.db
            .prepare("SELECT * FROM ws_workstream_section")
            .all(),
          layout: getMeta(this.deps.db, "layout"),
        }),
      );
      const existing = new Set(
        this.deps.workstreamStore.list().map((workstream) => workstream.id),
      );
      const insert = this.deps.db.prepare(
        "INSERT INTO ws_workstream(id, name, description, parent_id, aliases, origin) VALUES (?, ?, ?, ?, ?, 'user')",
      );
      const pending = plan.workstreams.filter(
        (workstream) => !existing.has(workstream.id),
      );
      while (pending.length) {
        const index = pending.findIndex(
          (workstream) =>
            !workstream.parentId || existing.has(workstream.parentId),
        );
        if (index < 0)
          throw new UserError(
            "The migration puts a new workstream in an invalid group.",
          );
        const [workstream] = pending.splice(index, 1);
        insert.run(
          workstream!.id,
          workstream!.name,
          workstream!.description,
          workstream!.parentId,
          JSON.stringify(workstream!.aliases),
        );
        existing.add(workstream!.id);
      }
      for (const workstream of plan.workstreams)
        this.deps.db
          .prepare("UPDATE ws_workstream SET aliases = ? WHERE id = ?")
          .run(JSON.stringify(workstream.aliases), workstream.id);
      for (const change of plan.changes)
        this.deps.db
          .prepare(
            "UPDATE ws_thread_workstream SET workstream_id = ? WHERE thread_id = ?",
          )
          .run(change.workstreamId, change.threadId);
      for (const reset of plan.resets)
        this.deps.db
          .prepare(
            "DELETE FROM ws_thread_workstream WHERE thread_id = ? AND source <> 'manual'",
          )
          .run(reset.threadId);
      for (const workstream of [...plan.removed].sort(
        (a, b) => pathNames(b.path).length - pathNames(a.path).length,
      )) {
        this.deps.db
          .prepare("DELETE FROM ws_workstream_section WHERE workstream_id = ?")
          .run(workstream.id);
        this.deps.db
          .prepare("DELETE FROM ws_workstream WHERE id = ?")
          .run(workstream.id);
      }
      assertWorkstreamLevels(this.deps.workstreamStore.list());
      this.deps.workstreamStore.bumpRevision();
      this.deps.journal.add({
        action: "thread-moved",
        source: "you",
        rationale: "Applied a two-level migration preview",
        threads: [],
        workstreams: [],
        undo: null,
        detail: `${plan.changes.length} moved; ${plan.resets.length} automatic choices reset; backup ${backupId}`,
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
    const raw = getMeta(this.deps.db, `migration_backup:${id}`);
    if (!raw) throw new UserError("Unknown migration backup.");
    return JSON.parse(raw);
  }
}
