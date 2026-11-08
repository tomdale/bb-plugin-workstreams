import type { TraceKind, TraceSummary } from "../../domain/trace.ts";
import type { JournalEntry as Entry } from "../../server/journal.ts";

export const TRACE_PAGE = 100;
export type ActivityEntry = Entry & { traceIds?: string[] };
export type ActivityQuery = {
  external: boolean;
  debug: boolean;
  traceLimit: number;
  callKind: TraceKind | "";
};

type ActivitySource = {
  journal(input: {
    limit: number;
    external: boolean;
  }): Promise<ActivityEntry[]>;
  traces(input: {
    limit: number;
    kind?: TraceKind;
    before?: { at: number; id: string };
  }): Promise<TraceSummary[]>;
};
type ActivitySink = {
  entries(entries: ActivityEntry[]): void;
  calls(calls: TraceSummary[], more: boolean): void;
  error(message: string | null): void;
};

/**
 * Loads Activity's journal and model calls independently. Each refresh owns its
 * results until another refresh or effect cleanup invalidates it; stale pages
 * and errors cannot replace the current filter's data. Realtime bursts share
 * one active load and one trailing refresh; explicit loads start immediately.
 */
export function createActivityLoader(
  source: ActivitySource,
  sink: ActivitySink,
) {
  let request = 0;
  let active: Promise<void> | null = null;
  let trailing: ActivityQuery | null = null;
  const run = async (
    { external, debug, traceLimit, callKind }: ActivityQuery,
    generation: number,
  ) => {
    sink.error(null);
    const report = (cause: unknown) => {
      if (generation === request)
        sink.error(cause instanceof Error ? cause.message : String(cause));
    };
    await Promise.all([
      (async () => {
        const entries = await source.journal({ limit: 300, external });
        if (generation === request) sink.entries(entries);
      })().catch(report),
      (async () => {
        const traces: TraceSummary[] = [];
        let more = false;
        let before: { at: number; id: string } | undefined;
        // Reload from the top: appending to old pages would retain deleted
        // calls or duplicate calls whose position changed between refreshes.
        if (debug) {
          do {
            const page = await source.traces({
              limit: TRACE_PAGE,
              ...(callKind ? { kind: callKind } : {}),
              ...(before ? { before } : {}),
            });
            if (generation !== request) return;
            traces.push(...page);
            more = page.length === TRACE_PAGE;
            const last = page.at(-1);
            before = last ? { at: last.at, id: last.id } : undefined;
          } while (more && traces.length < traceLimit);
        }
        if (generation === request) sink.calls(traces, more);
      })().catch(report),
    ]);
  };
  const start = (query: ActivityQuery) => {
    const loading = run(query, ++request);
    active = loading;
    const settled = () => {
      if (active !== loading) return;
      active = null;
      if (!trailing) return;
      const next = trailing;
      trailing = null;
      start(next);
    };
    void loading.then(settled, settled);
    return loading;
  };
  return {
    cancel() {
      request++;
      active = null;
      trailing = null;
    },
    load(query: ActivityQuery) {
      trailing = null;
      return start(query);
    },
    refresh(query: ActivityQuery) {
      if (active) {
        trailing = query;
        return active;
      }
      return start(query);
    },
  };
}
