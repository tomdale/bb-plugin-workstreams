/**
 * Live evaluation of the turn-end analysis, a thread's start, and the
 * workstream choice.
 * Opt-in and never part of `npm test`: it calls models through Pi's AI
 * Gateway.
 *
 *   node eval/run.ts [model ...]
 *
 * Every case goes through the production prompts and parsers. The workstream
 * choice sees an empty tree, so the workstream a case gets is the one the model
 * proposes; it is scored against the fixture's expected product names. Fixtures may carry a
 * `project` field for provenance; it is never sent. See README.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { DescriptionInput, WorkState } from "../src/domain/analysis.ts";
import { parseStart, startPrompt } from "../src/domain/start.ts";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../src/domain/turnEnd.ts";
import type { WorkstreamChoiceInput } from "../src/domain/workstreamChoice.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";

type Case = {
  id: string;
  title: string;
  project?: string;
  excerpts: string;
  expected: string[];
  /** One state, or the states a reasonable reading allows. */
  expectedState?: WorkState | WorkState[];
};
/** What a run produced: status, title, and the workstream's name. */
type Output = {
  state: WorkState | null;
  title: string | null;
  subject: string | null;
};
type Result = {
  set: string;
  mode: "cold" | "untitled" | "opening";
  id: string;
  /** The title the fixture shows the model. */
  title: string;
  expected: string[];
  project?: string;
  output: Output | null;
  /** The start call's title, in `opening` mode. */
  openingGoal?: string | null;
  error?: string;
  seconds: number;
  cost: number;
  expectedState?: WorkState | WorkState[];
};

const env = process.env;
const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["google/gemini-3.1-flash-lite", "openai/gpt-4.1-mini"];
const PUBLIC = ["cases", "holdout", "delegation", "state"];
const privateSet = env.EVAL_PRIVATE;
if (privateSet) {
  const root = env.EVAL_PRIVATE_ROOT;
  if (
    !root ||
    !env.EVAL_OUTPUT ||
    !resolve(env.EVAL_OUTPUT).startsWith(resolve(root) + "/")
  )
    throw new Error(
      "A private fixture needs EVAL_OUTPUT inside EVAL_PRIVATE_ROOT, so real thread content never leaves private storage.",
    );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NO_SUBJECT = new Set(["unclassified", "crossprojectcoordination"]);

/** Splits a fixture excerpt into requests and the last assistant message. */
export function toInput(c: Case): DescriptionInput {
  const requests: DescriptionInput["requests"][number][] = [];
  let lastAssistantText: string | null = null;
  const sections = c.excerpts.split(
    /\n\n(?=Initial user request|Recent user request|Last assistant report)/,
  );
  if (sections.length > 1 || /^Initial user request/.test(c.excerpts)) {
    for (const section of sections) {
      const body = section.replace(/^[^\n]*:\n/, "").trim();
      if (section.startsWith("Initial user request"))
        requests.push({ text: body, initial: true });
      else if (section.startsWith("Recent user request"))
        requests.push({ text: body, initial: false });
      else if (section.startsWith("Last assistant report"))
        lastAssistantText = body;
    }
  } else if (c.excerpts.trim()) {
    const [user, ...rest] = c.excerpts.split(/\s+Assistant:\s+/);
    requests.push({ text: user!.replace(/^User:\s*/, ""), initial: false });
    lastAssistantText = rest.join(" Assistant: ") || null;
  }
  return {
    title: c.title,
    titledBy: "other",
    mode: "full",
    report: null,
    // Keep the most recent two requests, as production does.
    requests: [
      ...requests.filter((r) => r.initial).slice(0, 1),
      ...requests.filter((r) => !r.initial).slice(-2),
    ],
    lastAssistantText,
  };
}

// The production transport (`src/server/inference/gateway.ts`).
const key = await gatewayKey();
if (!key)
  throw new Error("No AI Gateway key: sign Pi in to Vercel AI Gateway.");
const apiKey: string = key;

/** `<model>:disabled` sends `thinking: disabled` (see `gatewayComplete`). */
async function complete(
  spec: string,
  prompt: string,
  outputSchema?: Record<string, unknown>,
) {
  const [model, flag] = spec.split(":");
  const { text, usage } = await gatewayComplete({
    prompt,
    model: model!,
    apiKey,
    disableThinking: flag === "disabled",
    ...(outputSchema ? { outputSchema } : {}),
  });
  return { text, cost: usage.cost };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const subjectOk = (r: Result) => {
  const subject = r.output?.subject ?? null;
  if (subject === null) return r.expected.some((e) => NO_SUBJECT.has(norm(e)));
  return r.expected.some((e) => norm(e) === norm(subject));
};
const pct = (n: number, d: number) => (d ? `${n}/${d}` : "–");
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function score(results: Result[]) {
  const cold = results.filter((r) => r.mode === "cold");
  const bySet = (set: string) => cold.filter((r) => r.set === set);
  const ok = (rs: Result[]) => rs.filter(subjectOk).length;
  const valid = results.filter((r) => !r.error).length;
  let together = 0;
  let recovered = 0;
  let apart = 0;
  let merged = 0;
  for (const set of new Set(cold.map((r) => r.set)))
    for (const [i, a] of bySet(set).entries())
      for (const b of bySet(set).slice(i + 1)) {
        const same = a.expected.some((x) =>
          b.expected.some((y) => norm(x) === norm(y)),
        );
        const joined =
          !!a.output?.subject &&
          norm(a.output.subject) === norm(b.output?.subject ?? "");
        if (same) {
          together++;
          if (joined) recovered++;
        } else {
          apart++;
          if (joined) merged++;
        }
      }
  const anchored = cold.filter(
    (r) =>
      r.project &&
      r.output?.subject &&
      norm(r.output.subject) === norm(r.project) &&
      !r.expected.some((e) => norm(e) === norm(r.project!)),
  );
  const stated = cold.filter((r) => r.expectedState);
  const accepts = (r: Result) => [r.expectedState ?? []].flat();
  const asks = stated.filter((r) => r.expectedState === "needs-input");
  const untitled = results.filter((r) => r.mode === "untitled");
  const opening = results.filter((r) => r.mode === "opening");
  const named = (r: Result) => Boolean(r.output?.title);
  // A title that differs from the fixture's title is a rename.
  const renamed = (r: Result) =>
    Boolean(r.output?.title) && norm(r.output!.title!) !== norm(r.title);
  const titled = cold.filter((r) => r.output);
  const seconds = results
    .filter((r) => r.mode !== "opening")
    .map((r) => r.seconds)
    .sort((a, b) => a - b);
  const q = (p: number) =>
    seconds[Math.min(seconds.length - 1, Math.floor(p * seconds.length))] ?? 0;
  return {
    valid: pct(valid, results.length),
    subject: Object.fromEntries(
      [...new Set(cold.map((r) => r.set))].map((set) => [
        set,
        pct(ok(bySet(set)), bySet(set).length),
      ]),
    ),
    pairs: `recovered ${pct(recovered, together)}, wrongly merged ${pct(merged, apart)}`,
    anchoredOnProject: anchored.map((r) => r.id),
    state: pct(
      stated.filter(
        (r) => r.output?.state && accepts(r).includes(r.output.state),
      ).length,
      stated.length,
    ),
    needsInputRecall: pct(
      asks.filter((r) => r.output?.state === "needs-input").length,
      asks.length,
    ),
    title: {
      untitledNamed: pct(untitled.filter(named).length, untitled.length),
      renamed: pct(titled.filter(renamed).length, titled.length),
      renamedIds: titled
        .filter(renamed)
        .map((r) => `${r.set}:${r.id} → ${r.output?.title}`),
      examples: untitled
        .filter(named)
        .slice(0, 8)
        .map((r) => `${r.set}:${r.id} → ${r.output?.title}`),
    },
    opening: {
      named: pct(opening.filter((r) => r.openingGoal).length, opening.length),
      medianSeconds: median(opening.map((r) => r.seconds)),
      examples: opening
        .filter((r) => r.openingGoal)
        .slice(0, 8)
        .map((r) => `${r.set}:${r.id} → ${r.openingGoal}`),
    },
    medianSeconds: q(0.5),
    p90Seconds: q(0.9),
    cost: Number(results.reduce((s, r) => s + r.cost, 0).toFixed(4)),
    misses: cold
      .filter((r) => !subjectOk(r))
      .map(
        (r) =>
          `${r.set}:${r.id} → ${r.output?.subject ?? "null"} (want ${r.expected[0]})`,
      ),
  };
}

const sets: [string, Case[]][] = [];
for (const name of PUBLIC)
  sets.push([
    name,
    JSON.parse(
      await readFile(new URL(`${name}.json`, import.meta.url), "utf8"),
    ),
  ]);
if (privateSet)
  sets.push(["private", JSON.parse(await readFile(privateSet, "utf8"))]);

type Job = {
  set: string;
  mode: Result["mode"];
  c: Case;
  input: DescriptionInput;
};
const jobs: Job[] = [];
for (const [set, cases] of sets)
  for (const c of cases) {
    jobs.push({ set, mode: "cold", c, input: toInput(c) });
    // Untitled: BB shows the opening words of the first request instead.
    if (set === "cases" || set === "state") {
      const input = toInput(c);
      const opening = (input.requests[0]?.text ?? "").replace(/\s+/g, " ");
      jobs.push({
        set,
        mode: "untitled",
        c,
        input: {
          ...input,
          titledBy: "none",
          title: `${opening.slice(0, 77)}...`,
        },
      });
      // The call that names a thread while its first turn runs sees the
      // opening request alone.
      jobs.push({ set, mode: "opening", c, input });
    }
  }

const report: Record<string, unknown> = {};
for (const model of models) {
  const results = await mapLimit(jobs, 4, async (job): Promise<Result> => {
    const started = performance.now();
    const base = {
      set: job.set,
      mode: job.mode,
      id: job.c.id,
      title: job.c.title,
      expected: job.c.expected,
      project: job.c.project,
      expectedState: job.c.expectedState,
    };
    try {
      if (job.mode === "opening") {
        const start = {
          request: job.input.requests[0]?.text ?? "",
          project: null,
          choice: null,
        };
        const { text, cost } = await complete(model, startPrompt(start));
        return {
          ...base,
          output: null,
          openingGoal: parseStart(text, start).title,
          seconds: (performance.now() - started) / 1000,
          cost,
        };
      }
      const choice: WorkstreamChoiceInput = {
        title: job.input.title,
        requests: job.input.requests.map((r) => r.text),
        project: null,
        checkout: null,
        workstreams: [],
        hints: [],
        current: null,
      };
      // A cold case's turn also chooses the workstream, as a turn after a
      // new request does in production.
      const turnEnd: TurnEndInput = {
        ...job.input,
        choice: job.mode === "cold" ? choice : null,
      };
      const { text, cost } = await complete(
        model,
        turnEndPrompt(turnEnd),
        turnEndSchema(turnEnd),
      );
      const parsed = parseTurnEnd(text, turnEnd);
      return {
        ...base,
        output: {
          state: parsed.status?.state ?? null,
          title: parsed.title,
          subject: parsed.workstream?.proposed?.name ?? null,
        },
        seconds: (performance.now() - started) / 1000,
        cost,
      };
    } catch (error) {
      return {
        ...base,
        output: null,
        error: String(error),
        seconds: (performance.now() - started) / 1000,
        cost: 0,
      };
    }
  });
  const summary = score(results);
  report[model] = { score: summary, results };
  // Private cases stay out of stdout (transcripts); EVAL_OUTPUT has them.
  const isPublic = (id: string) => !id.startsWith("private:");
  console.log(
    model,
    JSON.stringify(
      {
        ...summary,
        anchoredOnProject: summary.anchoredOnProject.length,
        misses: summary.misses.filter(isPublic),
        title: {
          ...summary.title,
          renamedIds: summary.title.renamedIds.filter(isPublic),
          examples: summary.title.examples.filter(isPublic),
        },
        opening: {
          ...summary.opening,
          examples: summary.opening.examples.filter(isPublic),
        },
      },
      null,
      2,
    ),
  );
}
if (env.EVAL_OUTPUT)
  await writeFile(env.EVAL_OUTPUT, JSON.stringify(report, null, 2));
