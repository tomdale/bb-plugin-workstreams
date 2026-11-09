/**
 * Every model call Workstreams makes, by kind: how the prompt is built from
 * the call's input and how the response is parsed. One definition serves the
 * live call, its debug trace, and a replay from the inspector.
 */
import {
  categoryPrompt,
  categorySchema,
  parseCategories,
  type CategoryInput,
} from "../domain/categories.ts";
import {
  fullAnalysisPrompt,
  fullAnalysisSchema,
  parseFullAnalysis,
  parseQuickAnalysis,
  quickAnalysisPrompt,
  quickAnalysisSchema,
  type FullAnalysisInput,
  type QuickAnalysisInput,
} from "../domain/analysis.ts";
import {
  parseSplit,
  parseTidy,
  splitPrompt,
  splitSchema,
  tidyPrompt,
  tidySchema,
  type SplitInput,
  type TidyInput,
} from "../domain/tidy.ts";
import {
  parsePlacement,
  placementPrompt,
  placementSchema,
  type PlacementInput,
} from "../domain/placement.ts";
import {
  TRACE_KIND_TITLE,
  type Trace,
  type TraceKind,
  type TraceLink,
  type TraceStatus,
  type Usage,
} from "../domain/trace.ts";
import {
  EVALUATE_SYSTEM,
  PROVIDER,
  SYSTEM_PROMPT,
  THINKING,
  type Completion,
  type EvaluationAnswer,
} from "./inference/gateway.ts";
import {
  gatewayModel,
  modelChoiceSchema,
  type ModelChoice,
} from "../domain/prefs.ts";
import { UserError } from "./service.ts";
import { boundedJson, type TraceStore } from "./trace.ts";

export const MODEL_CALLS = {
  "quick-analysis": {
    prompt: (input: QuickAnalysisInput) => quickAnalysisPrompt(input),
    parse: (text: string, input: QuickAnalysisInput) =>
      parseQuickAnalysis(text, input),
    schema: (input: QuickAnalysisInput) => quickAnalysisSchema(input),
  },
  "full-analysis": {
    prompt: (input: FullAnalysisInput) => fullAnalysisPrompt(input),
    parse: (text: string, input: FullAnalysisInput) =>
      parseFullAnalysis(text, input),
    schema: (input: FullAnalysisInput) => fullAnalysisSchema(input),
  },
  placement: {
    prompt: (input: PlacementInput) => placementPrompt(input),
    parse: (text: string, input: PlacementInput) => parsePlacement(text, input),
    schema: (input: PlacementInput) => placementSchema(input),
  },
  categories: {
    prompt: (input: CategoryInput) => categoryPrompt(input),
    parse: (text: string, input: CategoryInput) => parseCategories(text, input),
    schema: (input: CategoryInput) => categorySchema(input),
    maxTokens: 12_000,
  },
  split: {
    prompt: (input: SplitInput) => splitPrompt(input),
    parse: (text: string, input: SplitInput) => parseSplit(text, input),
    schema: (input: SplitInput) => splitSchema(input),
    maxTokens: 8_000,
  },
  tidy: {
    prompt: (input: TidyInput) => tidyPrompt(input),
    parse: (text: string, input: TidyInput) => parseTidy(text, input),
    schema: () => tidySchema(),
    maxTokens: 12_000,
  },
} satisfies Record<
  TraceKind,
  {
    prompt: (input: never) => string;
    parse: (text: string, input: never) => unknown;
    /** Constrains the answer at generation, when the model supports it. */
    schema?: (input: never) => Record<string, unknown>;
    /** Output budget, when the default is too small. */
    maxTokens?: number;
  }
>;

type Calls = typeof MODEL_CALLS;

/** Human-readable identity persisted alongside replayable model choices. */
export function modelLabel(choice: ModelChoice): string {
  const direct = gatewayModel(choice);
  return (
    direct ??
    (choice.kind === "provider"
      ? `${choice.providerId}/${choice.model}`
      : choice.model)
  );
}
type InputOf<K extends TraceKind> = Parameters<Calls[K]["prompt"]>[0];
type OutputOf<K extends TraceKind> = ReturnType<Calls[K]["parse"]>;

/**
 * One line of what a call decided, for lists: the Activity log, the Debug
 * tab, and `bb workstreams trace`.
 */
export function summarize(
  kind: TraceKind,
  value: unknown,
  input: unknown,
): string | null {
  const topicOf = (
    topic: {
      subjectId: string | null;
      proposed: { name: string } | null;
    } | null,
    entities: readonly { id: string; name: string }[] | undefined,
  ) =>
    topic
      ? topic.subjectId
        ? (entities?.find((e) => e.id === topic.subjectId)?.name ??
          topic.subjectId)
        : topic.proposed
          ? `new topic ${topic.proposed.name}`
          : "no topic"
      : null;
  switch (kind) {
    case "quick-analysis": {
      const q = value as OutputOf<"quick-analysis">;
      return [
        q.goal ? `goal “${q.goal}”` : "no goal",
        q.topicError ? "invalid topic (valid title retained)" : null,
        topicOf(q, (input as QuickAnalysisInput).entities ?? undefined),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "categories": {
      const decision = value as OutputOf<"categories">;
      return decision.keep
        ? "kept categories"
        : decision.categories
            .map(
              (category) => `${category.name} (${category.threadIds.length})`,
            )
            .join(", ");
    }
    case "split": {
      const { split } = value as OutputOf<"split">;
      return split.subgroups.length
        ? split.subgroups
            .map((g) => `${g.name} (${g.threadIds.length})`)
            .join(", ")
        : "kept one-level topic";
    }
    case "tidy": {
      const edits = value as OutputOf<"tidy">;
      return edits.length
        ? edits.map(({ edit }) => edit.op).join(", ")
        : "no edits";
    }
    case "placement": {
      const p = value as OutputOf<"placement">;
      return `${topicOf(p, (input as PlacementInput).entities) ?? "no topic"}${p.scopeShift ? " (scope shift)" : ""}`;
    }
    case "full-analysis": {
      const a = value as OutputOf<"full-analysis">;
      return [
        a.status ? a.status.state.replace("_", " ") : "reported",
        a.goal ? `title “${a.goal}”` : null,
        a.threadGoal ? `goal “${a.threadGoal}”` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
}
type Spec = {
  prompt: (input: unknown) => string;
  parse: (text: string, input: unknown) => unknown;
  schema?: (input: unknown) => Record<string, unknown>;
  maxTokens?: number;
};

export type Complete = (
  prompt: string,
  choice: ModelChoice,
  signal?: AbortSignal,
  maxTokens?: number,
  context?: { threadId?: string; outputSchema?: Record<string, unknown> },
) => Promise<
  Pick<Completion, "text"> & { usage: Completion["usage"] | null } & Partial<
      Pick<Completion, "reasoning" | "stopReason">
    >
>;

/**
 * One typed question to a decision model, which answers with choices and
 * probabilities instead of generated text.
 */
export type Evaluate = (
  request: {
    state: string;
    questions: Record<string, unknown>;
    model: string;
  },
  signal?: AbortSignal,
) => Promise<{
  answers: Record<string, EvaluationAnswer>;
  usage: Usage;
}>;

/** A call that never reached the model reports no usage rather than a guess. */
const ZERO_USAGE: Usage = { input: 0, output: 0, cost: 0 };

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const duration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} seconds`;

export class Inference {
  constructor(
    private readonly deps: {
      complete: Complete;
      evaluate: Evaluate;
      traces: TraceStore;
      /** Whether calls are recorded; read before every call. */
      record: () => Promise<boolean>;
      log?: (message: string) => void;
      now?: () => number;
    },
  ) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /**
   * Builds the prompt for `kind` from `input`, calls the model, and parses
   * the response. With recording on, saves the call and returns its trace
   * id.
   */
  async run<K extends TraceKind>(
    kind: K,
    input: InputOf<K>,
    options: {
      model: ModelChoice;
      threadId?: string;
      label?: string;
      links?: readonly TraceLink[];
      /**
       * Aborts the call when its answer stops mattering. An aborted call
       * rejects with the abort reason and is not traced: it explains nothing.
       */
      signal?: AbortSignal;
      /**
       * Gives up on a call that takes longer than this, which fails like any
       * other failed call (and is traced as one), unlike an abort.
       */
      timeoutMs?: number;
    },
  ): Promise<{ value: OutputOf<K>; traceId: string | null }> {
    const spec = MODEL_CALLS[kind] as unknown as Spec;
    const prompt = spec.prompt(input);
    const started = this.now();
    let result = await this.call(kind, {
      prompt,
      parse: (text) => spec.parse(text, input),
      input,
      model: options.model,
      threadId: options.threadId,
      label: options.label ?? TRACE_KIND_TITLE[kind],
      links: options.links ?? [],
      replayOf: null,
      record: await this.deps.record(),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      outputSchema: spec.schema?.(input),
      maxTokens: spec.maxTokens,
    });
    const topicError = result.ok
      ? (result.value as { topicError?: string }).topicError
      : undefined;
    if (
      kind === "quick-analysis" &&
      ((!result.ok && result.invalid) || topicError) &&
      !options.signal?.aborted
    ) {
      const remaining =
        options.timeoutMs === undefined
          ? undefined
          : options.timeoutMs - (this.now() - started);
      if (remaining === undefined || remaining > 100) {
        this.annotate(result.traceId, {
          validation: topicError ?? "Invalid response",
          repair: "one bounded retry",
        });
        const repaired = await this.call(kind, {
          prompt: `${prompt}\n\nValidation requirement: return only a JSON object with the requested fields.${
            (input as QuickAnalysisInput).entities !== null
              ? " subjectId must be exactly an ID in square brackets in <topic_tree>, never a name, path, or decorated label. Use null when ownership is unsupported."
              : ""
          }`,
          parse: (text) => spec.parse(text, input),
          input,
          model: options.model,
          outputSchema: quickAnalysisSchema(input as QuickAnalysisInput),
          threadId: options.threadId,
          label: options.label ?? TRACE_KIND_TITLE[kind],
          links: options.links ?? [],
          replayOf: result.traceId,
          record: await this.deps.record(),
          signal: options.signal,
          timeoutMs: remaining,
        });
        if (repaired.ok) {
          const firstGoal = result.ok
            ? (result.value as OutputOf<"quick-analysis">).goal
            : null;
          const value = repaired.value as OutputOf<"quick-analysis">;
          result = {
            ...repaired,
            value: { ...value, goal: value.goal ?? firstGoal },
          };
        } else if (!result.ok) result = repaired;
      }
    }
    if (!result.ok) throw result.error;
    return { value: result.value as OutputOf<K>, traceId: result.traceId };
  }

  /**
   * Asks a decision model one typed question and records the call like any
   * other, so the answer's probability is inspectable after the fact. Returns
   * null when the answer settles nothing — below the caller's confidence bar,
   * missing, or not answering a gateway model — and the caller falls back to
   * the call this one would have replaced.
   */
  async gate<T>(request: {
    kind: TraceKind;
    input: unknown;
    question: { state: string; questions: Record<string, unknown> };
    model: ModelChoice;
    /** The settled answer and its one-line summary, or null to fall back. */
    decide: (
      answers: Record<string, EvaluationAnswer>,
    ) => { value: T; summary: string } | null;
    callLabel: string;
    threadId?: string;
    label?: string;
    links?: readonly TraceLink[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ value: T; traceId: string | null } | null> {
    const model = gatewayModel(request.model);
    // A provider pick needs a worker thread, which can't answer typed questions.
    if (model === null) return null;
    const started = this.now();
    const record = await this.deps.record();
    const save = (
      status: TraceStatus,
      answers: Record<string, EvaluationAnswer> | null,
      decided: { value: T; summary: string } | null,
      usage: Usage,
      error: unknown,
    ): string | null =>
      record
        ? this.safely(() =>
            this.deps.traces.add(
              {
                at: started,
                kind: request.kind,
                status,
                label: request.label ?? request.callLabel,
                model: modelLabel(request.model),
                modelChoice: request.model,
                durationMs: this.now() - started,
                replayOf: null,
                provider: PROVIDER,
                thinking: THINKING,
                system: EVALUATE_SYSTEM,
                prompt: `${request.question.state}\n\n${JSON.stringify(
                  request.question.questions,
                )}`,
                input: boundedJson(request.input),
                response: answers ? JSON.stringify(answers) : null,
                reasoning: null,
                stopReason: null,
                usage,
                parsed: decided?.value ?? null,
                summary: decided?.summary ?? null,
                outcome: decided
                  ? { gate: "used" }
                  : { gate: "fell back", reason: message(error) },
                error: status === "failed" ? message(error) : null,
                gate: true,
              },
              request.links ?? [],
            ),
          )
        : null;
    const timeout =
      request.timeoutMs === undefined ? null : new AbortController();
    const timer =
      timeout &&
      setTimeout(
        () => timeout.abort(new Error("timed out")),
        request.timeoutMs,
      );
    const signal =
      timeout && request.signal
        ? AbortSignal.any([request.signal, timeout.signal])
        : (timeout?.signal ?? request.signal);
    let result: Awaited<ReturnType<Evaluate>>;
    try {
      result = await this.deps.evaluate(
        {
          state: request.question.state,
          questions: request.question.questions,
          model,
        },
        signal,
      );
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      const failure = timeout?.signal.aborted
        ? new Error(
            `The model didn't answer within ${duration(request.timeoutMs!)}.`,
          )
        : error;
      save("failed", null, null, ZERO_USAGE, failure);
      throw failure;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let decided: { value: T; summary: string } | null = null;
    try {
      decided = request.decide(result.answers);
    } catch (error) {
      save("invalid", result.answers, null, result.usage, error);
      return null;
    }
    const traceId = save(
      decided ? "ok" : "invalid",
      result.answers,
      decided,
      result.usage,
      decided ? null : new Error("no answer cleared the confidence bar"),
    );
    return decided ? { value: decided.value, traceId } : null;
  }

  /**
   * Sends a recorded prompt to its model again and records the answer as a
   * replay of the original. Nothing Workstreams stores changes.
   */
  async replay(traceId: string): Promise<Trace> {
    const original = this.deps.traces.get(traceId);
    if (!original) throw new UserError("That model call is no longer stored.");
    if (original.gate)
      throw new UserError(
        "That call was a typed question to a decision model; running the placement model again is the equivalent.",
      );
    const spec = MODEL_CALLS[original.kind] as unknown as Spec;
    const result = await this.call(original.kind, {
      prompt: original.prompt,
      // The stored input keeps the names and ids the parser checks against.
      parse: (text) => spec.parse(text, original.input),
      input: original.input,
      model:
        original.modelChoice ??
        modelChoiceSchema.parse({ kind: "gateway", model: original.model }),
      label: original.label,
      links: [],
      outputSchema: original.outputSchema,
      maxTokens: spec.maxTokens,
      replayOf: original.id,
      record: true,
    });
    const trace = result.traceId ? this.deps.traces.get(result.traceId) : null;
    if (!trace) throw new Error("The replay could not be recorded.");
    return trace;
  }

  /** Links traces (null ids are skipped) to what they explain. */
  link(
    traceIds:
      string | null | undefined | readonly (string | null | undefined)[],
    ...links: TraceLink[]
  ): void {
    for (const id of [traceIds].flat())
      if (id) this.safely(() => this.deps.traces.link(id, links));
  }

  /** Trace ids linked to each ref of one kind, newest first. */
  linked(
    kind: TraceLink["kind"],
    refs: readonly string[],
  ): Map<string, string[]> {
    return this.safely(() => this.deps.traces.idsFor(kind, refs)) ?? new Map();
  }

  /** Links every trace linked to `from` to `to` as well. */
  copyLinks(from: TraceLink, to: TraceLink): void {
    this.safely(() => this.deps.traces.copyLinks(from, to));
  }

  /** Source removal also removes retained prompts and their replay descendants. */
  forgetTraces(
    ids: readonly (string | null | undefined)[],
    links: readonly TraceLink[] = [],
  ): void {
    this.safely(() =>
      this.deps.traces.remove(
        ids.filter((id): id is string => Boolean(id)),
        links,
      ),
    );
  }

  /** Records what Workstreams did with a call's result (merged). */
  annotate(
    traceId: string | null | undefined,
    outcome: Record<string, unknown>,
  ): void {
    if (traceId) this.safely(() => this.deps.traces.annotate(traceId, outcome));
  }

  /**
   * Recording is best effort: a trace store failure never changes what a
   * model call returns, so recording can't change behavior.
   */
  private safely<T>(work: () => T): T | null {
    try {
      return work();
    } catch (error) {
      this.deps.log?.(`Debug trace not recorded: ${message(error)}`);
      return null;
    }
  }

  private async call(
    kind: TraceKind,
    request: {
      prompt: string;
      parse: (text: string) => unknown;
      input: unknown;
      model: ModelChoice;
      threadId?: string;
      label: string;
      links: readonly TraceLink[];
      replayOf: string | null;
      record: boolean;
      signal?: AbortSignal;
      timeoutMs?: number;
      outputSchema?: Record<string, unknown>;
      maxTokens?: number;
    },
  ): Promise<
    | { ok: true; value: unknown; traceId: string | null }
    | { ok: false; error: unknown; traceId: string | null; invalid?: boolean }
  > {
    const started = this.now();
    const record = (
      status: TraceStatus,
      fields: {
        completion?: Awaited<ReturnType<Complete>>;
        parsed?: unknown;
        error?: unknown;
      },
    ): string | null =>
      request.record
        ? this.safely(() =>
            this.deps.traces.add(
              {
                at: started,
                kind,
                status,
                label: request.label,
                model: modelLabel(request.model),
                modelChoice: request.model,
                durationMs: this.now() - started,
                replayOf: request.replayOf,
                provider:
                  request.model.kind === "gateway" ||
                  gatewayModel(request.model) !== null
                    ? PROVIDER
                    : `bb-provider:${request.model.providerId}`,
                thinking: request.model.reasoningLevel ?? THINKING,
                system: SYSTEM_PROMPT,
                prompt: request.prompt,
                ...(request.outputSchema
                  ? { outputSchema: request.outputSchema }
                  : {}),
                input: boundedJson(request.input),
                response: fields.completion?.text ?? null,
                reasoning: fields.completion?.reasoning ?? null,
                stopReason: fields.completion?.stopReason ?? null,
                usage: fields.completion?.usage ?? null,
                parsed:
                  fields.parsed === undefined
                    ? null
                    : boundedJson(fields.parsed),
                summary:
                  fields.parsed === undefined
                    ? null
                    : this.safely(() =>
                        summarize(kind, fields.parsed, request.input),
                      ),
                outcome: null,
                error:
                  fields.error === undefined ? null : message(fields.error),
              },
              request.links,
            ),
          )
        : null;
    let completion: Awaited<ReturnType<Complete>>;
    // The timeout aborts the request itself, so the host closes it too.
    const timeout =
      request.timeoutMs === undefined ? null : new AbortController();
    const timer =
      timeout &&
      setTimeout(
        () => timeout.abort(new Error("timed out")),
        request.timeoutMs,
      );
    const signal =
      timeout && request.signal
        ? AbortSignal.any([request.signal, timeout.signal])
        : (timeout?.signal ?? request.signal);
    try {
      completion = await this.deps.complete(
        request.prompt,
        request.model,
        signal,
        request.maxTokens,
        {
          ...(request.threadId ? { threadId: request.threadId } : {}),
          ...(request.outputSchema
            ? { outputSchema: request.outputSchema }
            : {}),
        },
      );
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      const failure = timeout?.signal.aborted
        ? new Error(
            `The model didn't answer within ${duration(request.timeoutMs!)}.`,
          )
        : error;
      return {
        ok: false,
        error: failure,
        traceId: record("failed", { error: failure }),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
    let value: unknown;
    try {
      value = request.parse(completion.text);
    } catch (error) {
      return {
        ok: false,
        error,
        invalid: true,
        traceId: record("invalid", { completion, error }),
      };
    }
    return {
      ok: true,
      value,
      traceId: record(
        (value as { topicError?: string }).topicError ? "invalid" : "ok",
        {
          completion,
          parsed: value,
          ...((value as { topicError?: string }).topicError
            ? { error: (value as { topicError: string }).topicError }
            : {}),
        },
      ),
    };
  }
}
