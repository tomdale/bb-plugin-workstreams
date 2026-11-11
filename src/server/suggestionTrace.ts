/**
 * Suggestions that were already waiting before suggestions kept the model call
 * that proposed them: this gives each one the call that could have produced it,
 * once, so the debug UI can open the prompt behind a suggestion the user is
 * looking at now rather than only behind the next one Workstreams proposes.
 *
 * The match is by kind and time, because a suggestion is stored right after its
 * call returns: a split names the topic its call was about, and a tidy edit
 * belongs to the newest tidy pass before it, which that pass's own outcome
 * confirms when the edit names a thread or topic. A call that has left the
 * trace store leaves the suggestion without one, which the debug thread says.
 */
import { getMeta, setMeta, type Database } from "./db.ts";
import type { TraceStore } from "./trace.ts";
import type { Trace, TraceKind } from "../domain/trace.ts";

const DONE_KEY = "suggestions-trace-backfill";

/** How old a call can be and still have written the row it explains. */
const WINDOW_MS = 5 * 60 * 1000;

type Row = {
  id: string;
  kind: "split" | "edit";
  at: number;
  body: string;
};

const KIND: Record<Row["kind"], TraceKind> = { split: "split", edit: "tidy" };

const isId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:thr_[a-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.test(
    value,
  );

/** The threads and topics an edit names, which its call's answer names too. */
function refsOf(body: Record<string, unknown>): string[] {
  return Object.values(body).filter(isId);
}

/** Whether a call's recorded output names anything this row is about. */
function mentions(trace: Trace, refs: readonly string[]): boolean {
  if (!refs.length) return true;
  const text = `${trace.response ?? ""}${JSON.stringify(trace.parsed ?? null)}`;
  return refs.some((ref) => text.includes(ref));
}

/**
 * The call that produced `row`, or null when none is still stored: a split's
 * own topic, else the newest pass of its kind before it.
 */
function callOf(
  row: Row,
  candidates: readonly Trace[],
  body: Record<string, unknown>,
): string | null {
  for (const trace of candidates) {
    if (row.kind === "split") {
      const topicId = (trace.input as { topicId?: unknown } | null)?.topicId;
      if (topicId === body.topicId) return trace.id;
      continue;
    }
    // One tidy pass's edits replace the ones waiting from an older pass, so the
    // newest call before the row is its own; the answer has to agree.
    if (mentions(trace, refsOf(body))) return trace.id;
  }
  return null;
}

/**
 * Links every suggestion that has no call yet, once per database. Returns how
 * many it linked.
 */
export function linkSuggestionTraces(db: Database, traces: TraceStore): number {
  if (getMeta(db, DONE_KEY)) return 0;
  setMeta(db, DONE_KEY, String(Date.now()));
  const rows = db
    .prepare(
      "SELECT id, kind, at, body FROM ws_suggestion WHERE trace_id IS NULL ORDER BY at",
    )
    .all() as Row[];
  if (!rows.length) return 0;
  const calls = new Map<TraceKind, Trace[]>();
  const loaded = (kind: TraceKind): Trace[] => {
    const known = calls.get(kind);
    if (known) return known;
    const found = traces
      .list({ kinds: [kind], limit: 500 })
      .flatMap((summary) => traces.get(summary.id) ?? []);
    calls.set(kind, found);
    return found;
  };
  const update = db.prepare(
    "UPDATE ws_suggestion SET trace_id = ? WHERE id = ?",
  );
  let linked = 0;
  db.transaction(() => {
    for (const row of rows) {
      const body = JSON.parse(row.body) as Record<string, unknown>;
      const candidates = loaded(KIND[row.kind]).filter(
        (trace) => trace.at <= row.at && row.at - trace.at <= WINDOW_MS,
      );
      const id = callOf(row, candidates, body);
      if (!id) continue;
      update.run(id, row.id);
      linked++;
    }
  })();
  return linked;
}
