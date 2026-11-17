/**
 * Organizing suggestions as the Workstreams view lists them: each suggestion is a
 * block of rows, every row a subject with where it is now and where it would
 * be after accepting, so the Now and After columns line up down the page.
 * Pure, so tests can check the rows.
 *
 * A suggestion that moves threads has one row per thread. One that only
 * changes workstreams or groups (merge, move under, rename, create) has one row
 * per workstream or group it changes; no thread changes workstream.
 */
import {
  movesThreads,
  type ChangeMove,
  type SuggestionChange,
  type WorkstreamPlace,
} from "./suggestion-change.ts";

export type LedgerRow = {
  /** The thread's title, or the workstream's name. */
  readonly subject: string;
  /** Where it is now; empty when it's the same as the row above. */
  readonly now: string;
  /** The thread has no workstream yet. */
  readonly other: boolean;
  /** Where accepting puts it. */
  readonly after: string;
  /** Precedes `after`: "into" for a merge. */
  readonly verb: string | null;
  /** Accepting creates the After workstream; marked where it first appears. */
  readonly created: boolean;
};

/** Which ledger a suggestion belongs in. */
export function ledgerKind(change: SuggestionChange): "threads" | "groups" {
  return ["move-thread", "split", "repair"].includes(change.op) ||
    movesThreads(change)
    ? "threads"
    : "groups";
}

const TOP = "Top level";
const leaf = (place: WorkstreamPlace) => place.at(-1)?.name ?? TOP;
const parent = (place: WorkstreamPlace) => place.slice(0, -1);
const same = (a: WorkstreamPlace, b: WorkstreamPlace) =>
  a.length === b.length && a.every((part, i) => part.name === b[i]!.name);

function threadRows(moves: readonly ChangeMove[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const marked = new Set<string>();
  let previous: string | null = null;
  for (const move of moves) {
    const now = move.from ? leaf(move.from) : "No workstream";
    const after = leaf(move.to);
    const created = move.to.at(-1)?.created ?? false;
    for (const thread of move.threads) {
      const fresh = created && !marked.has(after);
      if (fresh) marked.add(after);
      rows.push({
        subject: thread.title,
        now: now === previous ? "" : now,
        other: move.from === null,
        after,
        verb: null,
        created: fresh,
      });
      previous = now;
    }
  }
  return rows;
}

function workstreamRow(
  op: SuggestionChange["op"],
  move: ChangeMove,
): LedgerRow {
  if (op === "group" || move.from === null)
    return {
      subject: leaf(move.to),
      now: "",
      other: false,
      after: parent(move.to).length ? leaf(parent(move.to)) : TOP,
      verb: null,
      created: true,
    };
  const from = move.from;
  const now = parent(from).length ? leaf(parent(from)) : TOP;
  if (op === "merge")
    return {
      subject: leaf(from),
      now,
      other: false,
      after: leaf(move.to),
      verb: "into",
      created: false,
    };
  const moved = !same(parent(from), parent(move.to));
  const renamed = leaf(from) !== leaf(move.to);
  const under = parent(move.to).length ? leaf(parent(move.to)) : TOP;
  return {
    subject: leaf(from),
    now,
    other: false,
    after:
      moved && renamed
        ? `${under} › ${leaf(move.to)}`
        : moved
          ? under
          : leaf(move.to),
    verb: null,
    created: move.to.slice(0, -1).some((part) => part.created),
  };
}

export function ledgerRows(change: SuggestionChange): LedgerRow[] {
  if (ledgerKind(change) === "threads") {
    const rows = threadRows(change.moves);
    if (rows.length) return rows;
  }
  return change.moves.map((move) => workstreamRow(change.op, move));
}
