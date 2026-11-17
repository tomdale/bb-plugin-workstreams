/*
 * Reviewed changes to durable workstream identity. The workstream choice can
 * identify a lasting area within a populated top-level workstream; its division
 * request asks for a complete plan of where every thread moves rather than
 * adding a workstream around existing threads. Asking for suggestions also considers
 * divisions explicitly. Volume-based categories have their own lifecycle and
 * never change this tree.
 *
 * Tidy tracks changes to the workstreams and groups and each thread's
 * workstream, and remembers accepted and declined suggestions. Every accepted
 * edit passes the workstream store's two-level and leaf-only guards and records
 * a guarded snapshot for Undo.
 */
import { randomUUID } from "node:crypto";
import type { ModelChoice } from "../domain/prefs.ts";
import type { Workstream } from "../domain/workstreams.ts";
import {
  describeEdit,
  editKey,
  mootEdit,
  prefixMoves,
  refusal,
  splitNow,
  type Held,
  type Split,
  type SplitOutput,
  type SuggestThread,
  type TidyEdit,
  type TreeState,
} from "../domain/tidy.ts";
import {
  changeDelta,
  changeHeadline,
  suggestionChange,
  type ChangeContext,
  type ChangeDelta,
  type SuggestionChange,
} from "../domain/suggestion-change.ts";
import { workstreamPath } from "../domain/workstream-path.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { Journal } from "./journal.ts";
import { UserError } from "./service.ts";
import type { Inference } from "./model.ts";
import {
  snapshotWorkstreams,
  workstreamsFingerprint,
  type WorkstreamStore,
} from "./workstreams.ts";

/** How long an automatic check waits for changes to settle. */
const CHECK_DEBOUNCE_MS = 2_000;

type SuggestionStatus = "pending" | "accepted" | "declined" | "stale";

/** A suggestion as review shows it. */
type SuggestionView = {
  id: string;
  kind: "split" | "edit";
  summary: string;
  reason: string;
  status: SuggestionStatus;
  at: number;
  decidedAt: number | null;
  /** Why it can't apply now, or why it stopped applying. */
  problem: string | null;
  /**
   * What accepting it would move, while it waits and everything it names
   * still exists.
   */
  change: SuggestionChange | null;
  /**
   * Accepting it as data, for drawing the sidebar after. Null when `change` is,
   * and when it can't be drawn: it needs a workstream another suggestion
   * creates, or threads that joined its group are still to be moved.
   */
  delta: ChangeDelta | null;
  /** What it does in a sentence, while `change` is known; else `summary`. */
  headline: string;
  /** The model call that proposed it, while that trace is still stored. */
  traceId: string | null;
  /**
   * Threads that joined a split's workstream since it was made; accepting asks
   * the model which workstream each goes in.
   */
  arrivals: { id: string; title: string }[];
};

export type SuggestionsState = {
  suggestions: SuggestionView[];
  running: boolean;
  lastRunAt: number | null;
  error: string | null;
};

type Row = {
  id: string;
  pass_id: string;
  kind: "split" | "edit";
  body: string;
  reason: string;
  summary: string;
  key: string;
  status: SuggestionStatus;
  at: number;
  decided_at: number | null;
  detail: string | null;
  trace_id: string | null;
};

/** What the last tidy pass saw, for its triggers. */
type TidyMemo = {
  at: number | null;
  fingerprint?: string;
};

/** A visible top-level thread as suggestions read it. */
type TitledThread = { id: string; title: string };

/** An edit that needs a workstream another suggestion of its pass creates. */
class NotYet extends Error {}

const refs = (edit: TidyEdit): (string | null)[] => {
  switch (edit.op) {
    case "merge":
      return [edit.from, edit.into];
    case "move-workstream":
      return [edit.workstream, edit.parent];
    case "rename":
      return [edit.workstream];
    case "group":
      return [edit.parent, ...edit.children];
    case "move-thread":
      return [edit.workstream];
  }
};

/**
 * The delta as the client receives it: the archived threads it moves are
 * counted (`archived`) but not listed, since a workstream can hold thousands
 * and a drawing never shows them.
 */
function wireDelta(
  delta: ChangeDelta | null,
  context: ChangeContext,
): ChangeDelta | null {
  return delta
    ? {
        ...delta,
        assignments: delta.assignments.filter(
          ({ threadId }) => context.visible?.(threadId) ?? true,
        ),
      }
    : null;
}

const TIDY_KEY = "suggestions_tidy";

export class Suggestions {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private error: string | null = null;
  private failedFingerprint: string | null = null;
  /** What the last `check` saw; see `checkIfChanged`. */
  private checked: string | null = null;

  constructor(
    private readonly deps: {
      db: Database;
      inference: Inference;
      workstreamStore: WorkstreamStore;
      journal: Journal;
      model: () => Promise<ModelChoice>;
      /** Whether automatic suggestions are on. */
      enabled: () => boolean;
      /** Visible, non-archived top-level threads. */
      threads: () => readonly TitledThread[];
      splitThreads?: (workstreamId: string) => Promise<SuggestThread[]>;
      checkout: (threadId: string) => string | null;
      coordination: () => string[];
      /** Suggestions or the workstreams and groups changed. */
      onChange: (workstreamsChanged: boolean) => void;
      log: (message: string) => void;
      now?: () => number;
    },
  ) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  state(): SuggestionsState {
    const memo = this.memo();
    return {
      suggestions: this.list(),
      running: this.running !== null,
      lastRunAt: memo.at,
      error: this.error,
    };
  }

  /** Suggestions waiting for a decision, then the latest 20 decided. */
  list(): SuggestionView[] {
    const rows = [
      ...(this.deps.db
        .prepare(
          "SELECT * FROM ws_suggestion WHERE status = 'pending' ORDER BY at, rowid",
        )
        .all() as Row[]),
      ...(this.deps.db
        .prepare(
          "SELECT * FROM ws_suggestion WHERE status != 'pending' ORDER BY decided_at DESC, at DESC LIMIT 20",
        )
        .all() as Row[]),
    ];
    const tree = this.tree();
    const known = {
      workstreams: this.deps.workstreamStore.list(),
      titles: new Map(this.deps.threads().map((r) => [r.id, r.title])),
    };
    return rows.map((row) => {
      const review =
        row.status === "pending" ? this.review(row, tree, known) : null;
      return {
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        reason: row.reason,
        status: row.status,
        at: row.at,
        decidedAt: row.decided_at,
        problem:
          row.status === "pending"
            ? this.problem(row, tree)
            : row.status === "stale"
              ? row.detail
              : null,
        change: review?.change ?? null,
        delta: review?.delta ?? null,
        arrivals: review?.arrivals ?? [],
        headline: review?.change ? changeHeadline(review.change) : row.summary,
        traceId: row.trace_id,
      };
    });
  }

  pendingCount(): number {
    return (
      this.deps.db
        .prepare(
          "SELECT COUNT(*) AS n FROM ws_suggestion WHERE status = 'pending'",
        )
        .get() as { n: number }
    ).n;
  }

  /**
   * Something changed: retires waiting suggestions that would no longer
   * change anything, then sees whether a suggestion is due, shortly.
   */
  check(): void {
    if (this.disposed) return;
    this.checked = this.inputs();
    this.retire();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.deps.enabled()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.deps.enabled()) void this.run({ manual: false }).catch(() => {});
    }, CHECK_DEBOUNCE_MS);
  }

  /**
   * `check`, unless nothing it reads changed since the last one. Besides the
   * suggestions it keeps itself, it reads the workstreams and groups and each
   * thread's workstream, which move the workstream tree revision whenever they
   * change, and the visible threads and the preference.
   */
  checkIfChanged(): void {
    if (this.inputs() !== this.checked) this.check();
  }

  private inputs(): string {
    return JSON.stringify([
      this.deps.workstreamStore.revision(),
      this.deps.enabled(),
      this.deps
        .threads()
        .map((thread) => thread.id)
        .sort(),
    ]);
  }

  /**
   * Asks for whatever suggestions are due, or, when you ask, for splits and
   * a tidy pass now. One run at a time; a request during a run runs after it.
   */
  async run(options: { manual: boolean }): Promise<void> {
    if (this.running) {
      if (!options.manual) {
        this.again = true;
        return this.running;
      }
      await this.running.catch(() => {});
    }
    this.retire();
    const before = this.pendingCount();
    const hadError = this.error !== null;
    const run = (async () => {
      try {
        this.error = null;
        try {
          await this.splits(options.manual);
          await this.tidy(options.manual);
        } finally {
          // After tidy, whose fresh pass replaces the edits still waiting.
          this.prefixes();
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.deps.log(`Organizing suggestions failed: ${this.error}`);
        if (options.manual) throw error;
      } finally {
        this.running = null;
        // A check that found nothing due changes nothing anyone sees.
        if (
          options.manual ||
          this.pendingCount() !== before ||
          hadError !== (this.error !== null)
        )
          this.deps.onChange(false);
        if (this.again && !this.disposed) {
          this.again = false;
          this.check();
        }
      }
    })();
    this.running = run;
    if (options.manual) this.deps.onChange(false);
    return run;
  }

  /** Applies suggestions in the order they were made; declines the rest. */
  async decide(
    ids: readonly string[],
    decision: "accept" | "decline",
  ): Promise<{
    applied: string[];
    failed: { id: string; reason: string }[];
    /** Each accepted suggestion's Activity entry, whose Undo reverts it. */
    entries: Record<string, string>;
  }> {
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM ws_suggestion WHERE status = 'pending' AND id IN (${ids.map(() => "?").join(", ") || "NULL"}) ORDER BY at, rowid`,
      )
      .all(...ids) as Row[];
    const applied: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    const entries: Record<string, string> = {};
    if (decision === "decline") {
      for (const row of rows) this.settle(row.id, "declined", null);
      // An edit needing a workstream a declined one would create is moot now.
      this.retire();
      this.deps.onChange(false);
      this.check();
      return { applied: rows.map((row) => row.id), failed, entries };
    }
    for (const row of rows) {
      try {
        entries[row.id] = this.apply(row, await this.withArrivals(row));
        applied.push(row.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // It can still apply once the workstream it needs exists.
        if (!(error instanceof NotYet)) this.settle(row.id, "stale", reason);
        failed.push({ id: row.id, reason });
      }
    }
    // What was accepted may leave others with nothing left to change.
    this.retire();
    this.deps.onChange(applied.length > 0);
    return { applied, failed, entries };
  }

  /**
   * Puts a decided suggestion back up for review, for Undo right after the
   * decision. The caller first undoes an accepted one's Activity entry, which
   * restores the workstreams as they were; a suggestion that no longer applies is
   * then retired as usual.
   */
  reopen(id: string): void {
    const result = this.deps.db
      .prepare(
        "UPDATE ws_suggestion SET status = 'pending', decided_at = NULL, detail = NULL WHERE id = ? AND status IN ('accepted', 'declined')",
      )
      .run(id);
    if (result.changes === 0)
      throw new UserError("That suggestion can't be reopened.");
    this.retire();
    this.deps.onChange(false);
  }

  // Splits ----------------------------------------------------------------

  private async splits(manual: boolean): Promise<void> {
    const workstreams = this.deps.workstreamStore.list();
    const held = this.held();
    const pending = new Set(
      (
        this.deps.db
          .prepare(
            "SELECT body FROM ws_suggestion WHERE status = 'pending' AND kind = 'split'",
          )
          .all() as { body: string }[]
      ).map((row) => (JSON.parse(row.body) as Split).workstreamId),
    );
    const requests = this.deps.workstreamStore.divisionRequests();
    for (const workstream of workstreams) {
      const count = held[workstream.id] ?? 0;
      const hasChildren = workstreams.some(
        (child) => child.parentId === workstream.id,
      );
      if (
        workstream.parentId !== null ||
        count === 0 ||
        (count < 2 && !hasChildren) ||
        pending.has(workstream.id)
      )
        continue;
      if (!manual && !requests[workstream.id]) continue;
      const threads = this.deps.splitThreads
        ? await this.deps.splitThreads(workstream.id)
        : this.threads().filter((t) => t.workstreamId === workstream.id);
      if (this.declinedSplit(workstream.id, threads)) continue;
      this.deps.workstreamStore.consumeDivisionRequest(workstream.id);
      const { value, traceId } = await this.deps.inference.run(
        "split",
        {
          workstreams,
          held,
          workstreamId: workstream.id,
          proposedScope: requests[workstream.id],
          threads,
          decisions: this.decisions(),
        },
        {
          model: await this.deps.model(),
          label: workstreamPath(workstream.id, workstreams),
          links: threads.map((t) => ({ kind: "thread" as const, ref: t.id })),
        },
      );
      if (value.split.workstreams.length > 0)
        this.propose(
          randomUUID(),
          "split",
          {
            ...value.split,
            threadTitles: Object.fromEntries(
              threads.map((thread) => [thread.id, thread.title]),
            ),
          },
          value.reason,
          traceId,
        );
    }
  }

  /** You declined a split of these same threads; asking again changes nothing. */
  private declinedSplit(
    workstreamId: string,
    threads: readonly { id: string }[],
  ): boolean {
    const members = JSON.stringify(threads.map((t) => t.id).sort());
    return (
      this.deps.db
        .prepare(
          "SELECT body FROM ws_suggestion WHERE kind = 'split' AND status = 'declined'",
        )
        .all() as { body: string }[]
    ).some((row) => {
      const split = JSON.parse(row.body) as Split;
      return (
        split.workstreamId === workstreamId &&
        JSON.stringify(split.workstreams.flatMap((g) => g.threadIds).sort()) ===
          members
      );
    });
  }

  // Tidy ------------------------------------------------------------------

  private memo(): TidyMemo {
    try {
      const raw = getMeta(this.deps.db, TIDY_KEY);
      if (raw) return JSON.parse(raw) as TidyMemo;
    } catch {
      // A damaged record starts the triggers over.
    }
    return { at: null };
  }

  /**
   * Workstream definitions and visible threads' workstreams, excluding titles
   * and status.
   */
  private fingerprint(): string {
    const workstreams = this.deps.workstreamStore.list();
    const assignments = this.deps.workstreamStore.assignments();
    return JSON.stringify([
      workstreams
        .map((t) => [
          t.id,
          t.name,
          t.description,
          t.parentId,
          [...t.aliases].sort(),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      this.deps
        .threads()
        .map((thread) => [
          thread.id,
          assignments[thread.id]?.workstreamId ?? null,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]);
  }

  private async tidy(manual: boolean): Promise<void> {
    const memo = this.memo();
    const workstreams = this.deps.workstreamStore.list();
    const threads = this.deps.threads();
    const fingerprint = this.fingerprint();
    if (!manual) {
      // Older installations have no fingerprint. Adopt the current snapshot
      // as the baseline instead of turning an upgrade into a model call.
      if (memo.fingerprint === undefined) {
        setMeta(
          this.deps.db,
          TIDY_KEY,
          JSON.stringify({ ...memo, fingerprint }),
        );
        return;
      }
      // Edits that stopped fitting the tree don't hold up a new pass.
      const tree = this.tree();
      const waiting = (
        this.deps.db
          .prepare(
            "SELECT * FROM ws_suggestion WHERE status = 'pending' AND kind = 'edit'",
          )
          .all() as Row[]
      ).some((row) => !this.problem(row, tree));
      if (
        waiting ||
        fingerprint === memo.fingerprint ||
        fingerprint === this.failedFingerprint
      )
        return;
    } else
      // A fresh pass replaces the edits still waiting from an older one.
      for (const row of this.deps.db
        .prepare(
          "SELECT id FROM ws_suggestion WHERE status = 'pending' AND kind = 'edit'",
        )
        .all() as { id: string }[])
        this.settle(row.id, "stale", "A newer pass replaced it.");
    setMeta(
      this.deps.db,
      TIDY_KEY,
      JSON.stringify({
        at: this.now(),
        fingerprint: memo.fingerprint ?? fingerprint,
      } satisfies TidyMemo),
    );
    const input = {
      workstreams,
      held: this.held(),
      threads: this.threads(),
      coordination: this.deps.coordination(),
      decisions: this.decisions(),
      declined: this.declined(),
    };
    let value: Awaited<ReturnType<Inference["run"]>>["value"];
    let traceId: string | null = null;
    try {
      ({ value, traceId } = await this.deps.inference.run("tidy", input, {
        model: await this.deps.model(),
        label: `${threads.length} threads, ${workstreams.length} workstreams`,
      }));
    } catch (error) {
      this.failedFingerprint = fingerprint;
      throw error;
    }
    if (this.fingerprint() !== fingerprint) {
      this.again = true;
      return;
    }
    this.deps.db.transaction(() => {
      const pass = randomUUID();
      const tree = this.tree();
      for (const { edit, reason } of value)
        if (!refusal(edit, tree))
          this.propose(pass, "edit", edit, reason, traceId);
      setMeta(
        this.deps.db,
        TIDY_KEY,
        JSON.stringify({ at: this.now(), fingerprint } satisfies TidyMemo),
      );
    })();
    this.failedFingerprint = null;
  }

  /** Proposes the moves workstream names imply (see `prefixMoves`). */
  private prefixes(): void {
    const pass = randomUUID();
    for (const { edit, reason } of prefixMoves(this.tree()))
      this.propose(pass, "edit", edit, reason, null);
  }

  // Shared ----------------------------------------------------------------

  /**
   * Stores a suggestion unless it waits already or you declined it before.
   * `traceId` is the model call that proposed it, so the debug UI can show what
   * the model was asked and answered.
   */
  private propose(
    pass: string,
    kind: "split" | "edit",
    body: TidyEdit | Split,
    reason: string,
    traceId: string | null,
  ): void {
    const key = editKey(body);
    const known = this.deps.db
      .prepare(
        "SELECT 1 FROM ws_suggestion WHERE key = ? AND status IN ('declined', 'pending') LIMIT 1",
      )
      .get(key);
    if (known) return;
    this.deps.db
      .prepare(
        `INSERT INTO ws_suggestion(id, pass_id, kind, body, reason, summary, key, status, at, trace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        randomUUID(),
        pass,
        kind,
        JSON.stringify(body),
        reason,
        describeEdit(body, this.names()),
        key,
        this.now(),
        traceId,
      );
  }

  private settle(
    id: string,
    status: SuggestionStatus,
    detail: string | null,
  ): void {
    this.deps.db
      .prepare(
        "UPDATE ws_suggestion SET status = ?, decided_at = ?, detail = ? WHERE id = ?",
      )
      .run(status, this.now(), detail, id);
  }

  /**
   * Stored threads' workstreams, so a reviewed division includes archived
   * threads.
   */
  private held(): Held {
    const out: Record<string, number> = {};
    const assignments = this.deps.workstreamStore.assignments();
    for (const assignment of Object.values(assignments)) {
      const id = assignment.workstreamId;
      if (id && !assignment.inheritedFrom) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }

  private threads(): SuggestThread[] {
    const assignments = this.deps.workstreamStore.assignments();
    return this.deps.threads().map((thread) => ({
      id: thread.id,
      title: thread.title,
      checkout: this.deps.checkout(thread.id),
      workstreamId: assignments[thread.id]?.workstreamId ?? null,
    }));
  }

  private tree(): TreeState {
    const assignments = this.deps.workstreamStore.assignments();
    return {
      workstreams: this.deps.workstreamStore.list(),
      held: this.held(),
      threadWorkstream: Object.fromEntries(
        Object.values(assignments)
          .filter((assignment) => !assignment.inheritedFrom)
          .map((assignment) => [assignment.threadId, assignment.workstreamId]),
      ),
    };
  }

  /** Names for descriptions; `new:` references read as their names. */
  private names() {
    const workstreams = this.deps.workstreamStore.list();
    const titles = new Map(this.deps.threads().map((r) => [r.id, r.title]));
    return {
      workstream: (ref: string | null) => {
        if (ref === null) return "the top level";
        if (ref.startsWith("new:")) return ref.slice(4);
        try {
          return workstreamPath(ref, workstreams);
        } catch {
          return "a removed workstream";
        }
      },
      thread: (id: string) => titles.get(id) ?? "a thread",
    };
  }

  /** Workstreams accepted suggestions of a pass created, by lowercased name. */
  private created(pass: string): Map<string, string> {
    try {
      return new Map(
        Object.entries(
          JSON.parse(
            getMeta(this.deps.db, `suggestions_created:${pass}`) ?? "{}",
          ),
        ),
      );
    } catch {
      return new Map();
    }
  }

  /** What accepting a waiting suggestion would change, against `tree`. */
  private review(
    row: Row,
    tree: TreeState,
    known: {
      workstreams: readonly Workstream[];
      titles: ReadonlyMap<string, string>;
    },
  ): {
    change: SuggestionChange | null;
    delta: ChangeDelta | null;
    arrivals: { id: string; title: string }[];
  } {
    const body = JSON.parse(row.body) as TidyEdit | Split;
    const creates = new Map(
      (
        this.deps.db
          .prepare(
            "SELECT body FROM ws_suggestion WHERE pass_id = ? AND status = 'pending' AND kind = 'edit'",
          )
          .all(row.pass_id) as { body: string }[]
      )
        .map((r) => this.resolve(JSON.parse(r.body) as TidyEdit, row.pass_id))
        .flatMap((e) =>
          e.op === "group"
            ? [
                [
                  e.name.toLowerCase(),
                  { name: e.name, parent: e.parent },
                ] as const,
              ]
            : [],
        ),
    );
    const now = "workstreams" in body ? splitNow(body, tree) : null;
    const edit = now ? now.split : this.resolve(body as TidyEdit, row.pass_id);
    const context: ChangeContext = {
      workstreams: known.workstreams,
      threadWorkstream: tree.threadWorkstream,
      title: (id) =>
        known.titles.get(id) ??
        ("workstreams" in body ? body.threadTitles?.[id] : undefined) ??
        "Untitled thread",
      visible: (id) => known.titles.has(id),
      creates,
    };
    return {
      change: suggestionChange(edit, context),
      // Threads that joined a split's group are moved by a model call when it
      // is accepted, so where they end up is not known yet.
      delta: now?.arrivals.length
        ? null
        : wireDelta(changeDelta(edit, context), context),
      arrivals: (now?.arrivals ?? []).map((id) => ({
        id,
        title: context.title(id),
      })),
    };
  }

  /**
   * Settles waiting suggestions that would change nothing, now or ever: a
   * split none of whose threads remain, an edit naming something gone or
   * already done, or one needing a workstream its pass will no longer create.
   * Ones that break a rule only for now stay waiting, out of date.
   */
  private retire(): void {
    const tree = this.tree();
    let retired = 0;
    for (const row of this.deps.db
      .prepare(
        "SELECT * FROM ws_suggestion WHERE status = 'pending' ORDER BY at, rowid",
      )
      .all() as Row[]) {
      const reason = this.moot(row, tree);
      if (!reason) continue;
      this.settle(row.id, "stale", `Nothing left to change: ${reason}`);
      retired++;
    }
    if (retired) this.deps.onChange(false);
  }

  private moot(row: Row, tree: TreeState): string | null {
    if (row.kind === "split") {
      const now = splitNow(JSON.parse(row.body) as Split, tree);
      return now.moot ? now.problem : null;
    }
    const edit = this.resolve(JSON.parse(row.body) as TidyEdit, row.pass_id);
    return this.uncreated(edit, row.pass_id) ?? mootEdit(edit, tree);
  }

  /** Why an edit can't apply: a workstream it needs won't be created anymore. */
  private uncreated(edit: TidyEdit, pass: string): string | null {
    const creating = new Set(
      (
        this.deps.db
          .prepare(
            "SELECT body FROM ws_suggestion WHERE pass_id = ? AND status = 'pending' AND kind = 'edit'",
          )
          .all(pass) as { body: string }[]
      )
        .map((r) => JSON.parse(r.body) as TidyEdit)
        .filter((e) => e.op === "group")
        .map((e) => (e as { name: string }).name.toLowerCase()),
    );
    return refs(edit).some(
      (ref) =>
        ref?.startsWith("new:") && !creating.has(ref.slice(4).toLowerCase()),
    )
      ? "It needs a workstream another suggestion would have created."
      : null;
  }

  private problem(row: Row, tree: TreeState): string | null {
    if (row.kind === "split")
      return splitNow(JSON.parse(row.body) as Split, tree).problem;
    const edit = this.resolve(JSON.parse(row.body) as TidyEdit, row.pass_id);
    // A workstream another suggestion of the pass would create, while that one
    // still waits; once it's declined or stale, this one can't apply.
    return this.uncreated(edit, row.pass_id) ?? refusal(edit, tree);
  }

  /** Replaces `new:` references with workstreams accepted suggestions created. */
  private resolve(edit: TidyEdit, pass: string): TidyEdit {
    const created = this.created(pass);
    const ref = (value: string | null) =>
      value && value.startsWith("new:")
        ? (created.get(value.slice(4).toLowerCase()) ?? value)
        : value;
    switch (edit.op) {
      case "merge":
        return { ...edit, from: ref(edit.from)!, into: ref(edit.into)! };
      case "move-workstream":
        return {
          ...edit,
          workstream: ref(edit.workstream)!,
          parent: ref(edit.parent),
        };
      case "rename":
        return { ...edit, workstream: ref(edit.workstream)! };
      case "group":
        return {
          ...edit,
          parent: ref(edit.parent),
          children: edit.children.map((c) => ref(c)!),
        };
      case "move-thread":
        return { ...edit, workstream: ref(edit.workstream)! };
    }
  }

  /**
   * A split as it applies now, with the threads that joined its group since
   * moved by one split call; undefined for other suggestions. The call's
   * failure leaves the suggestion waiting.
   */
  private async withArrivals(row: Row): Promise<Split | undefined> {
    if (row.kind !== "split") return undefined;
    const now = splitNow(JSON.parse(row.body) as Split, this.tree());
    if (now.problem || now.arrivals.length === 0) return now.split;
    const split = now.split;
    const workstreams = this.deps.workstreamStore.list();
    const key = (name: string) => name.trim().toLowerCase();
    const children = new Set(
      workstreams
        .filter((t) => t.parentId === split.workstreamId)
        .map((t) => key(t.name)),
    );
    // The workstreams it would create stand in as existing ones, so the call
    // moves the newcomers among them as it moves threads beside them.
    const proposed = split.workstreams
      .filter((g) => !children.has(key(g.name)))
      .map((g) => ({
        id: `proposed:${key(g.name)}`,
        name: g.name,
        description: g.description,
        parentId: split.workstreamId,
        aliases: [],
      }));
    const arrivals = new Set(now.arrivals);
    let value: SplitOutput;
    try {
      value = (
        await this.deps.inference.run(
          "split",
          {
            workstreams: [...workstreams, ...proposed],
            held: this.held(),
            workstreamId: split.workstreamId,
            threads: (this.deps.splitThreads
              ? await this.deps.splitThreads(split.workstreamId)
              : this.threads()
            ).filter((t) => arrivals.has(t.id)),
            decisions: this.decisions(),
          },
          {
            model: await this.deps.model(),
            label: `${workstreamPath(split.workstreamId, workstreams)}: threads that joined`,
            links: now.arrivals.map((id) => ({
              kind: "thread" as const,
              ref: id,
            })),
          },
        )
      ).value;
    } catch (error) {
      throw new NotYet(
        `Couldn't move the threads that joined since: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const created = split.workstreams.map((g) => ({
      ...g,
      threadIds: [...g.threadIds],
    }));
    for (const group of value.split.workstreams) {
      const match = created.find((g) => key(g.name) === key(group.name));
      if (match) match.threadIds.push(...group.threadIds);
      else created.push({ ...group, threadIds: [...group.threadIds] });
    }
    return { ...split, workstreams: created };
  }

  /** Applies an accepted suggestion; returns its Activity entry's id. */
  private apply(row: Row, current?: Split): string {
    const workstreamStore = this.deps.workstreamStore;
    const db = this.deps.db;
    const body = JSON.parse(row.body) as TidyEdit | Split;
    return db.transaction(() => {
      const snapshot = snapshotWorkstreams(db, this.now());
      const threads: { id: string; name: string }[] = [];
      if ("workstreams" in body) {
        const now = splitNow(body, this.tree());
        if (now.problem) throw new Error(now.problem);
        const split = current ?? now.split;
        const listed = new Set(split.workstreams.flatMap((g) => g.threadIds));
        if (now.arrivals.some((id) => !listed.has(id)))
          throw new NotYet("More threads joined its group; accept it again.");
        workstreamStore.split(
          split.workstreamId,
          split.workstreams.filter((g) => g.threadIds.length > 0),
        );
      } else {
        const edit = this.resolve(body, row.pass_id);
        if (refs(edit).some((ref) => ref?.startsWith("new:")))
          throw new NotYet(
            "It needs a workstream another suggestion creates; accept that one first.",
          );
        const problem = refusal(edit, this.tree());
        if (problem) throw new Error(problem);
        switch (edit.op) {
          case "merge":
            workstreamStore.merge(edit.from, edit.into);
            break;
          case "move-workstream": {
            const moved = workstreamStore.move(edit.workstream, edit.parent);
            // The old name stays an alias, so a proposal that uses it still
            // finds the workstream.
            if (edit.name !== undefined && edit.name !== moved.name)
              workstreamStore.edit(moved.id, {
                name: edit.name,
                aliases: [...moved.aliases, moved.name],
              });
            break;
          }
          case "rename":
            workstreamStore.rename(edit.workstream, edit.name);
            break;
          case "group": {
            const created = workstreamStore.create(
              edit.name,
              edit.description,
              edit.parent,
            );
            for (const child of edit.children)
              workstreamStore.move(child, created.id);
            const map = Object.fromEntries(this.created(row.pass_id));
            map[edit.name.toLowerCase()] = created.id;
            setMeta(
              db,
              `suggestions_created:${row.pass_id}`,
              JSON.stringify(map),
            );
            break;
          }
          case "move-thread": {
            const current = workstreamStore.assignment(edit.thread);
            workstreamStore.assign(edit.thread, edit.workstream, {
              provenance:
                current.provenance === "manual" ? "manual" : "automatic",
              // An accepted move keeps the basis it was settled from, so the
              // workstream choice leaves it alone until a new request arrives.
              evidence: workstreamStore.basis(edit.thread),
            });
            threads.push({
              id: edit.thread,
              name:
                this.deps.threads().find((r) => r.id === edit.thread)?.title ??
                edit.thread,
            });
            break;
          }
        }
      }
      this.settle(row.id, "accepted", null);
      return this.deps.journal.add({
        action: "suggestion-accepted",
        source: "you",
        rationale: row.summary,
        threads,
        workstreams: [],
        undo: {
          kind: "restore-workstreams",
          snapshotId: snapshot,
          fingerprint: workstreamsFingerprint(db),
        },
        detail: row.reason || null,
      }).id;
    })();
  }

  /** What you decided by hand, for tidy's memory. */
  private decisions(): string[] {
    const workstreams = this.deps.workstreamStore.list();
    const titles = new Map(this.deps.threads().map((r) => [r.id, r.title]));
    const assignments = this.deps.workstreamStore.assignments();
    const moved = Object.values(assignments)
      .filter(
        (a) =>
          a.provenance === "manual" &&
          a.workstreamId &&
          !a.inheritedFrom &&
          titles.has(a.threadId),
      )
      .slice(0, 20)
      .map(
        (a) =>
          `You moved “${titles.get(a.threadId)}” to ${workstreamPath(a.workstreamId!, workstreams)}`,
      );
    const accepted = (
      this.deps.db
        .prepare(
          "SELECT summary FROM ws_suggestion WHERE status = 'accepted' ORDER BY decided_at DESC LIMIT 15",
        )
        .all() as { summary: string }[]
    ).map((row) => `You accepted: ${row.summary}`);
    return [...accepted, ...moved];
  }

  /** Suggestions you declined, newest first, for tidy's memory. */
  private declined(): string[] {
    return (
      this.deps.db
        .prepare(
          "SELECT summary FROM ws_suggestion WHERE status = 'declined' ORDER BY decided_at DESC LIMIT 25",
        )
        .all() as { summary: string }[]
    ).map((row) => row.summary);
  }
}
