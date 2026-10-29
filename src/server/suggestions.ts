/**
 * Organizing suggestions (docs/organization.md): splits of busy topics and
 * tidy edits to the topic tree, which change nothing until you accept them.
 *
 * - A split is asked for when a topic without subtopics passes
 *   `SPLIT_ABOVE` visible roots, or holds threads beside subtopics, at most
 *   once a day per topic.
 * - A tidy pass runs at most once a day, after `TIDY_NEW_TOPICS` new topics
 *   or `TIDY_NEW_ROOTS` new roots since the last one, or when the sidebar is
 *   messy: Unfiled roots plus one-thread groups reach `MESSY_AT` and that set
 *   changed since the last pass. While earlier tidy edits wait for review, no
 *   new pass runs on its own. Asking for suggestions runs both now.
 * - Tidy sees what you decided by hand and what you declined, and an edit
 *   identical to a declined one is dropped, so settled questions stay
 *   settled.
 *
 * Accepting applies a suggestion through the topic store, whose partition
 * rule refuses anything that would put threads beside subtopics, and logs it
 * in Activity with an undo that restores the tree as it was. A split applies
 * to its group as it is then (`splitNow`): threads that left are left out, and
 * threads that joined are filed by one more split call.
 */
import { randomUUID } from "node:crypto";
import type { LayoutNode } from "../domain/layout.ts";
import { SPLIT_ABOVE } from "../domain/layout.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { Topic } from "../domain/topics.ts";
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
  changeHeadline,
  suggestionChange,
  type ChangeContext,
  type SuggestionChange,
} from "../domain/suggestion-change.ts";
import { topicPath } from "../domain/topic-path.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { Journal } from "./journal.ts";
import type { Inference } from "./model.ts";
import {
  snapshotTopics,
  topicsFingerprint,
  type TopicStore,
} from "./topics.ts";

export const DAY_MS = 24 * 60 * 60_000;
export const TIDY_NEW_TOPICS = 3;
export const TIDY_NEW_ROOTS = 5;
export const MESSY_AT = 4;
/** How long an automatic check waits for changes to settle. */
const CHECK_DEBOUNCE_MS = 2_000;

export type SuggestionStatus = "pending" | "accepted" | "declined" | "stale";

/** A suggestion as review shows it. */
export type SuggestionView = {
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
  /** What it does in a sentence, while `change` is known; else `summary`. */
  headline: string;
  /**
   * Threads that joined a split's group since it was made; accepting asks
   * the model which subgroup each goes in.
   */
  arrivals: { id: string; title: string }[];
  traceId: string | null;
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
  topics: string[];
  roots: string[];
  mess: string | null;
};

/** A visible root as suggestions read it. */
export type SuggestRoot = { id: string; title: string };

/** An edit that needs a topic another suggestion of its pass creates. */
class NotYet extends Error {}

const refs = (edit: TidyEdit): (string | null)[] => {
  switch (edit.op) {
    case "merge":
      return [edit.from, edit.into];
    case "reparent":
      return [edit.topic, edit.parent];
    case "rename":
      return [edit.topic];
    case "create":
      return [edit.parent, ...edit.children];
    case "move":
      return [edit.topic];
  }
};

const TIDY_KEY = "suggestions_tidy";
const SPLITS_KEY = "suggestions_splits";

export class Suggestions {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private error: string | null = null;

  constructor(
    private readonly deps: {
      db: Database;
      inference: Inference;
      topics: TopicStore;
      journal: Journal;
      model: () => Promise<ModelChoice>;
      /** Whether automatic suggestions are on. */
      enabled: () => boolean;
      /** Visible, non-archived roots. */
      roots: () => readonly SuggestRoot[];
      checkout: (threadId: string) => string | null;
      coordination: () => string[];
      layout: () => readonly LayoutNode[];
      /** Suggestions or the topic tree changed. */
      onChange: (topicsChanged: boolean) => void;
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
      topics: this.deps.topics.list(),
      titles: new Map(this.deps.roots().map((r) => [r.id, r.title])),
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
    this.retire();
    if (!this.deps.enabled()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run({ manual: false }).catch(() => {});
    }, CHECK_DEBOUNCE_MS);
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
  ): Promise<{ applied: string[]; failed: { id: string; reason: string }[] }> {
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM ws_suggestion WHERE status = 'pending' AND id IN (${ids.map(() => "?").join(", ") || "NULL"}) ORDER BY at, rowid`,
      )
      .all(...ids) as Row[];
    const applied: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    if (decision === "decline") {
      for (const row of rows) this.settle(row.id, "declined", null);
      // An edit needing a topic a declined one would create is moot now.
      this.retire();
      this.deps.onChange(false);
      return { applied: rows.map((row) => row.id), failed };
    }
    for (const row of rows) {
      try {
        this.apply(row, await this.filed(row));
        applied.push(row.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // It can still apply once the topic it needs exists.
        if (!(error instanceof NotYet)) this.settle(row.id, "stale", reason);
        failed.push({ id: row.id, reason });
      }
    }
    // What was accepted may leave others with nothing left to change.
    this.retire();
    this.deps.onChange(applied.length > 0);
    return { applied, failed };
  }

  // Splits ----------------------------------------------------------------

  private async splits(manual: boolean): Promise<void> {
    const topics = this.deps.topics.list();
    const held = this.held();
    const pending = new Set(
      (
        this.deps.db
          .prepare(
            "SELECT body FROM ws_suggestion WHERE status = 'pending' AND kind = 'split'",
          )
          .all() as { body: string }[]
      ).map((row) => (JSON.parse(row.body) as Split).topicId),
    );
    const tried = this.tried();
    for (const topic of topics) {
      const count = held[topic.id] ?? 0;
      const kids = topics.some((t) => t.parentId === topic.id);
      const due = kids ? count > 0 : count > SPLIT_ABOVE;
      if (!due || pending.has(topic.id)) continue;
      if (!manual && this.now() - (tried[topic.id] ?? 0) < DAY_MS) continue;
      const threads = this.threads().filter((t) => t.topicId === topic.id);
      if (this.declinedSplit(topic.id, threads)) continue;
      tried[topic.id] = this.now();
      setMeta(this.deps.db, SPLITS_KEY, JSON.stringify(tried));
      const { value, traceId } = await this.deps.inference.run(
        "split",
        {
          topics,
          held,
          topicId: topic.id,
          threads,
          decisions: this.decisions(),
        },
        {
          model: await this.deps.model(),
          label: topicPath(topic.id, topics),
          links: threads.map((t) => ({ kind: "thread" as const, ref: t.id })),
        },
      );
      this.propose(randomUUID(), "split", value.split, value.reason, traceId);
    }
  }

  /** You declined a split of these same threads; asking again changes nothing. */
  private declinedSplit(
    topicId: string,
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
        split.topicId === topicId &&
        JSON.stringify(split.subgroups.flatMap((g) => g.threadIds).sort()) ===
          members
      );
    });
  }

  private tried(): Record<string, number> {
    try {
      return JSON.parse(getMeta(this.deps.db, SPLITS_KEY) ?? "{}");
    } catch {
      return {};
    }
  }

  // Tidy ------------------------------------------------------------------

  private memo(): TidyMemo {
    try {
      const raw = getMeta(this.deps.db, TIDY_KEY);
      if (raw) return JSON.parse(raw) as TidyMemo;
    } catch {
      // A damaged record starts the triggers over.
    }
    return { at: null, topics: [], roots: [], mess: null };
  }

  /** Unfiled roots and one-thread groups: what a messy sidebar shows. */
  private mess(): { count: number; key: string } {
    const assignments = this.deps.topics.assignments();
    const unfiled = this.deps
      .roots()
      .filter((root) => !assignments[root.id]?.entityId)
      .map((root) => root.id);
    const singles = this.deps
      .layout()
      .filter((node) => node.total === 1)
      .map((node) => node.topicId);
    return {
      count: unfiled.length + singles.length,
      key: JSON.stringify([unfiled.sort(), singles.sort()]),
    };
  }

  private async tidy(manual: boolean): Promise<void> {
    const memo = this.memo();
    const topics = this.deps.topics.list();
    const roots = this.deps.roots();
    const mess = this.mess();
    if (!manual) {
      const known = new Set(memo.topics);
      const seen = new Set(memo.roots);
      const newTopics = topics.filter((t) => !known.has(t.id)).length;
      const newRoots = roots.filter((r) => !seen.has(r.id)).length;
      const due =
        newTopics >= TIDY_NEW_TOPICS ||
        newRoots >= TIDY_NEW_ROOTS ||
        (mess.count >= MESSY_AT && mess.key !== memo.mess);
      // Edits that stopped fitting the tree don't hold up a new pass.
      const tree = this.tree();
      const waiting = (
        this.deps.db
          .prepare(
            "SELECT * FROM ws_suggestion WHERE status = 'pending' AND kind = 'edit'",
          )
          .all() as Row[]
      ).filter((row) => !this.problem(row, tree)).length;
      if (
        !due ||
        waiting > 0 ||
        (memo.at !== null && this.now() - memo.at < DAY_MS)
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
        topics: topics.map((t) => t.id),
        roots: roots.map((r) => r.id),
        mess: mess.key,
      } satisfies TidyMemo),
    );
    const input = {
      topics,
      held: this.held(),
      threads: this.threads(),
      coordination: this.deps.coordination(),
      decisions: this.decisions(),
      declined: this.declined(),
    };
    const { value, traceId } = await this.deps.inference.run("tidy", input, {
      model: await this.deps.model(),
      label: `${roots.length} threads, ${topics.length} topics`,
    });
    const pass = randomUUID();
    const tree = this.tree();
    for (const { edit, reason } of value)
      if (!refusal(edit, tree))
        this.propose(pass, "edit", edit, reason, traceId);
  }

  /** Proposes the moves topic names imply (see `prefixMoves`). */
  private prefixes(): void {
    const pass = randomUUID();
    for (const { edit, reason } of prefixMoves(this.tree()))
      this.propose(pass, "edit", edit, reason, null);
  }

  // Shared ----------------------------------------------------------------

  /** Stores a suggestion unless it waits already or you declined it before. */
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

  /** Visible roots filed directly in each topic. */
  private held(): Held {
    const out: Record<string, number> = {};
    const assignments = this.deps.topics.assignments();
    for (const root of this.deps.roots()) {
      const id = assignments[root.id]?.entityId;
      if (id) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }

  private threads(): SuggestThread[] {
    const assignments = this.deps.topics.assignments();
    return this.deps.roots().map((root) => ({
      id: root.id,
      title: root.title,
      checkout: this.deps.checkout(root.id),
      topicId: assignments[root.id]?.entityId ?? null,
    }));
  }

  private tree(): TreeState {
    const assignments = this.deps.topics.assignments();
    return {
      topics: this.deps.topics.list(),
      held: this.held(),
      threadTopic: Object.fromEntries(
        this.deps
          .roots()
          .map((root) => [root.id, assignments[root.id]?.entityId ?? null]),
      ),
    };
  }

  /** Names for descriptions; `new:` references read as their names. */
  private names() {
    const topics = this.deps.topics.list();
    const titles = new Map(this.deps.roots().map((r) => [r.id, r.title]));
    return {
      topic: (ref: string | null) => {
        if (ref === null) return "the top level";
        if (ref.startsWith("new:")) return ref.slice(4);
        try {
          return topicPath(ref, topics);
        } catch {
          return "a removed topic";
        }
      },
      thread: (id: string) => titles.get(id) ?? "a thread",
    };
  }

  /** Topics accepted suggestions of a pass created, by lowercased name. */
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
    known: { topics: readonly Topic[]; titles: ReadonlyMap<string, string> },
  ): {
    change: SuggestionChange | null;
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
          e.op === "create"
            ? [
                [
                  e.name.toLowerCase(),
                  { name: e.name, parent: e.parent },
                ] as const,
              ]
            : [],
        ),
    );
    const now = "subgroups" in body ? splitNow(body, tree) : null;
    const edit = now ? now.split : this.resolve(body as TidyEdit, row.pass_id);
    const context: ChangeContext = {
      topics: known.topics,
      threadTopic: tree.threadTopic,
      title: (id) => known.titles.get(id) ?? "Untitled thread",
      creates,
    };
    return {
      change: suggestionChange(edit, context),
      arrivals: (now?.arrivals ?? []).map((id) => ({
        id,
        title: context.title(id),
      })),
    };
  }

  /**
   * Settles waiting suggestions that would change nothing, now or ever: a
   * split none of whose threads remain, an edit naming something gone or
   * already done, or one needing a topic its pass will no longer create.
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

  /** Why an edit can't apply: a topic it needs won't be created anymore. */
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
        .filter((e) => e.op === "create")
        .map((e) => (e as { name: string }).name.toLowerCase()),
    );
    return refs(edit).some(
      (ref) =>
        ref?.startsWith("new:") && !creating.has(ref.slice(4).toLowerCase()),
    )
      ? "It needs a topic another suggestion would have created."
      : null;
  }

  private problem(row: Row, tree: TreeState): string | null {
    if (row.kind === "split")
      return splitNow(JSON.parse(row.body) as Split, tree).problem;
    const edit = this.resolve(JSON.parse(row.body) as TidyEdit, row.pass_id);
    // A topic another suggestion of the pass would create, while that one
    // still waits; once it's declined or stale, this one can't apply.
    return this.uncreated(edit, row.pass_id) ?? refusal(edit, tree);
  }

  /** Replaces `new:` references with topics accepted suggestions created. */
  private resolve(edit: TidyEdit, pass: string): TidyEdit {
    const created = this.created(pass);
    const ref = (value: string | null) =>
      value && value.startsWith("new:")
        ? (created.get(value.slice(4).toLowerCase()) ?? value)
        : value;
    switch (edit.op) {
      case "merge":
        return { ...edit, from: ref(edit.from)!, into: ref(edit.into)! };
      case "reparent":
        return { ...edit, topic: ref(edit.topic)!, parent: ref(edit.parent) };
      case "rename":
        return { ...edit, topic: ref(edit.topic)! };
      case "create":
        return {
          ...edit,
          parent: ref(edit.parent),
          children: edit.children.map((c) => ref(c)!),
        };
      case "move":
        return { ...edit, topic: ref(edit.topic)! };
    }
  }

  /**
   * A split as it applies now, with the threads that joined its group since
   * filed by one split call; undefined for other suggestions. The call's
   * failure leaves the suggestion waiting.
   */
  private async filed(row: Row): Promise<Split | undefined> {
    if (row.kind !== "split") return undefined;
    const now = splitNow(JSON.parse(row.body) as Split, this.tree());
    if (now.problem || now.arrivals.length === 0) return now.split;
    const split = now.split;
    const topics = this.deps.topics.list();
    const key = (name: string) => name.trim().toLowerCase();
    const children = new Set(
      topics
        .filter((t) => t.parentId === split.topicId)
        .map((t) => key(t.name)),
    );
    // The subgroups it would create stand in as subgroups, so the call files
    // the newcomers among them as it files threads beside subgroups.
    const proposed = split.subgroups
      .filter((g) => !children.has(key(g.name)))
      .map((g) => ({
        id: `proposed:${key(g.name)}`,
        name: g.name,
        description: g.description,
        parentId: split.topicId,
        aliases: [],
      }));
    const arrivals = new Set(now.arrivals);
    let value: SplitOutput;
    try {
      value = (
        await this.deps.inference.run(
          "split",
          {
            topics: [...topics, ...proposed],
            held: this.held(),
            topicId: split.topicId,
            threads: this.threads().filter((t) => arrivals.has(t.id)),
            decisions: this.decisions(),
          },
          {
            model: await this.deps.model(),
            label: `${topicPath(split.topicId, topics)}: threads that joined`,
            links: now.arrivals.map((id) => ({
              kind: "thread" as const,
              ref: id,
            })),
          },
        )
      ).value;
    } catch (error) {
      throw new NotYet(
        `Couldn't file the threads that joined since: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const subgroups = split.subgroups.map((g) => ({
      ...g,
      threadIds: [...g.threadIds],
    }));
    for (const group of value.split.subgroups) {
      const match = subgroups.find((g) => key(g.name) === key(group.name));
      if (match) match.threadIds.push(...group.threadIds);
      else subgroups.push({ ...group, threadIds: [...group.threadIds] });
    }
    return { ...split, subgroups };
  }

  private apply(row: Row, filed?: Split): void {
    const topics = this.deps.topics;
    const db = this.deps.db;
    const body = JSON.parse(row.body) as TidyEdit | Split;
    db.transaction(() => {
      const snapshot = snapshotTopics(db, this.now());
      const threads: { id: string; name: string }[] = [];
      if ("subgroups" in body) {
        const now = splitNow(body, this.tree());
        if (now.problem) throw new Error(now.problem);
        const split = filed ?? now.split;
        const listed = new Set(split.subgroups.flatMap((g) => g.threadIds));
        if (now.arrivals.some((id) => !listed.has(id)))
          throw new NotYet("More threads joined its group; accept it again.");
        topics.split(
          split.topicId,
          split.subgroups.filter((g) => g.threadIds.length > 0),
        );
      } else {
        const edit = this.resolve(body, row.pass_id);
        if (refs(edit).some((ref) => ref?.startsWith("new:")))
          throw new NotYet(
            "It needs a topic another suggestion creates; accept that one first.",
          );
        const problem = refusal(edit, this.tree());
        if (problem) throw new Error(problem);
        switch (edit.op) {
          case "merge":
            topics.merge(edit.from, edit.into);
            break;
          case "reparent": {
            const moved = topics.reparent(edit.topic, edit.parent);
            // The old name stays an alias, so a proposal that uses it still
            // finds the topic.
            if (edit.name !== undefined && edit.name !== moved.name)
              topics.edit(moved.id, {
                name: edit.name,
                aliases: [...moved.aliases, moved.name],
              });
            break;
          }
          case "rename":
            topics.rename(edit.topic, edit.name);
            break;
          case "create": {
            const created = topics.create(
              edit.name,
              edit.description,
              edit.parent,
            );
            for (const child of edit.children)
              topics.reparent(child, created.id);
            const map = Object.fromEntries(this.created(row.pass_id));
            map[edit.name.toLowerCase()] = created.id;
            setMeta(
              db,
              `suggestions_created:${row.pass_id}`,
              JSON.stringify(map),
            );
            break;
          }
          case "move": {
            const current = topics.assignment(edit.thread);
            topics.assign(edit.thread, edit.topic, {
              provenance: current.provenance === "manual" ? "manual" : "full",
              // An accepted refile keeps the basis it was settled from, so
              // placement leaves it alone until a new request arrives.
              evidence: topics.basis(edit.thread),
            });
            threads.push({
              id: edit.thread,
              name:
                this.deps.roots().find((r) => r.id === edit.thread)?.title ??
                edit.thread,
            });
            break;
          }
        }
      }
      this.settle(row.id, "accepted", null);
      this.deps.journal.add({
        action: "suggestion",
        source: "user",
        rationale: row.summary,
        threads,
        workstreams: [],
        undo: {
          kind: "restore-topics",
          snapshotId: snapshot,
          fingerprint: topicsFingerprint(db),
        },
        detail: row.reason || null,
      });
    })();
  }

  /** What you decided by hand, for tidy's memory. */
  private decisions(): string[] {
    const topics = this.deps.topics.list();
    const titles = new Map(this.deps.roots().map((r) => [r.id, r.title]));
    const assignments = this.deps.topics.assignments();
    const filed = Object.values(assignments)
      .filter(
        (a) =>
          a.provenance === "manual" &&
          a.entityId &&
          !a.inheritedFrom &&
          titles.has(a.threadId),
      )
      .slice(0, 20)
      .map(
        (a) =>
          `You filed “${titles.get(a.threadId)}” under ${topicPath(a.entityId!, topics)}`,
      );
    const accepted = (
      this.deps.db
        .prepare(
          "SELECT summary FROM ws_suggestion WHERE status = 'accepted' ORDER BY decided_at DESC LIMIT 15",
        )
        .all() as { summary: string }[]
    ).map((row) => `You accepted: ${row.summary}`);
    return [...accepted, ...filed];
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
