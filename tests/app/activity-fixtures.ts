import type { TraceSummary } from "../../src/domain/trace.ts";
import type { ActivityEntry } from "../../src/app/page/activityLoader.ts";

export const trace = (
  id: string,
  overrides: Partial<TraceSummary> = {},
): TraceSummary => ({
  id,
  at: 1000,
  kind: "full-analysis",
  status: "ok",
  label: id,
  model: "test/model",
  durationMs: 1200,
  replayOf: null,
  usage: { input: 100, output: 20, cost: 0.01 },
  error: null,
  summary: "No change needed",
  threads: [],
  ...overrides,
});
export const entry: ActivityEntry = {
  id: "e1",
  at: 900,
  action: "move",
  source: "user",
  status: "applied",
  rationale: "Moved a thread",
  threads: [{ id: "missing-thread", name: "Parser thread" }],
  workstreams: [],
  undo: null,
  detail: null,
  traceIds: [],
};
