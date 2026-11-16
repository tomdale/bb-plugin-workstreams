/**
 * Every model call Workstreams makes, by kind: how the prompt is built from
 * the call's input and how the response is parsed. One definition serves the
 * live call, its debug trace, and a replay from the inspector.
 */
import {
  categoryFitPrompt,
  categoryFitSchema,
  parseCategoryFit,
  type CategoryFitInput,
  categoryPrompt,
  categorySchema,
  parseCategories,
  type CategoryInput,
} from "../domain/categories.ts";
import {
  parseStart,
  startPrompt,
  startSchema,
  type StartInput,
} from "../domain/start.ts";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../domain/turnEnd.ts";
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
  parseWorkstreamChoice,
  workstreamChoicePrompt,
  workstreamChoiceSchema,
  type WorkstreamChoiceInput,
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
  PROVIDER,
  SYSTEM_PROMPT,
  THINKING,
  type Completion,
} from "./inference/gateway.ts";
import {
  gatewayModel,
  modelChoiceSchema,
  type ModelChoice,
} from "../domain/prefs.ts";
import { UserError } from "./service.ts";
import { boundedJson, type TraceStore } from "./trace.ts";

/** A call recorded before turn ends chose workstreams asks for none. */
const withPlacement = (input: TurnEndInput): TurnEndInput => ({
  ...input,
  choice: input.choice ?? null,
});

export const MODEL_CALLS = {
  start: {
    prompt: (input: StartInput) => startPrompt(input),
    parse: (text: string, input: StartInput) => parseStart(text, input),
    schema: (input: StartInput) => startSchema(input),
  },
  "turn-end": {
    prompt: (input: TurnEndInput) => turnEndPrompt(withPlacement(input)),
    parse: (text: string, input: TurnEndInput) =>
      parseTurnEnd(text, withPlacement(input)),
    schema: (input: TurnEndInput) => turnEndSchema(withPlacement(input)),
  },
  "workstream-choice": {
    prompt: (input: WorkstreamChoiceInput) => workstreamChoicePrompt(input),
    parse: (text: string, input: WorkstreamChoiceInput) =>
      parseWorkstreamChoice(text, input),
    schema: (input: WorkstreamChoiceInput) => workstreamChoiceSchema(input),
  },
  "category-fit": {
    prompt: (input: CategoryFitInput) => categoryFitPrompt(input),
    parse: (text: string, input: CategoryFitInput) =>
      parseCategoryFit(text, input),
    schema: (input: CategoryFitInput) => categoryFitSchema(input),
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
  const workstreamOf = (
    workstream: {
      workstreamId: string | null;
      proposed: { name: string } | null;
    } | null,
    workstreams: readonly { id: string; name: string }[] | undefined,
  ) =>
    workstream
      ? workstream.workstreamId
        ? (workstreams?.find((e) => e.id === workstream.workstreamId)?.name ??
          workstream.workstreamId)
        : workstream.proposed
          ? `new workstream ${workstream.proposed.name}`
          : "no workstream"
      : null;
  switch (kind) {
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
    case "start": {
      const s = value as OutputOf<"start">;
      return [
        s.title ? `title “${s.title}”` : "no title",
        s.workstream
          ? `${workstreamOf(s.workstream, (input as StartInput).choice?.workstreams) ?? "no workstream"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "category-fit": {
      const fit = value as OutputOf<"category-fit">;
      const misfits = Object.values(fit).filter((id) => id === null).length;
      return misfits
        ? `${misfits} ${misfits === 1 ? "thread doesn't" : "threads don't"} fit`
        : "fits current categories";
    }
    case "split": {
      const { split } = value as OutputOf<"split">;
      return split.workstreams.length
        ? split.workstreams
            .map((g) => `${g.name} (${g.threadIds.length})`)
            .join(", ")
        : "kept as one workstream";
    }
    case "tidy": {
      const edits = value as OutputOf<"tidy">;
      return edits.length
        ? edits.map(({ edit }) => edit.op).join(", ")
        : "no edits";
    }
    case "workstream-choice": {
      const p = value as OutputOf<"workstream-choice">;
      return `${workstreamOf(p, (input as WorkstreamChoiceInput).workstreams) ?? "no workstream"}${p.scopeShift ? " (scope shift)" : ""}`;
    }
    case "turn-end": {
      const a = value as OutputOf<"turn-end">;
      return [
        a.status ? a.status.state : "reported",
        a.title ? `title “${a.title}”` : null,
        a.goal ? `goal “${a.goal}”` : null,
        a.workstreamError
          ? "invalid workstream"
          : a.workstream
            ? `${workstreamOf(a.workstream, (input as TurnEndInput).choice?.workstreams) ?? "no workstream"}${a.workstream.scopeShift ? " (scope shift)" : ""}`
            : null,
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

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const duration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} seconds`;

export class Inference {
  constructor(
    private readonly deps: {
      complete: Complete;
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
    const workstreamError = result.ok
      ? (result.value as { workstreamError?: string }).workstreamError
      : undefined;
    // A thread's start is asked again once when its answer is unusable, so
    // a valid title survives an invalid workstream and the composer still shows
    // one; other calls are retried by their callers or a later event.
    if (
      kind === "start" &&
      ((!result.ok && result.invalid) || workstreamError) &&
      !options.signal?.aborted
    ) {
      const remaining =
        options.timeoutMs === undefined
          ? undefined
          : options.timeoutMs - (this.now() - started);
      if (remaining === undefined || remaining > 100) {
        this.annotate(result.traceId, {
          validation: workstreamError ?? "Invalid response",
          repair: "one bounded retry",
        });
        const repaired = await this.call(kind, {
          prompt: `${prompt}\n\nValidation requirement: return only a JSON object with the requested fields.${
            (input as StartInput).choice !== null
              ? " workstream must be exactly an ID in square brackets in <workstream_tree> of a workstream, never a group, name, path, or decorated label. Use null when ownership is unsupported."
              : ""
          }`,
          parse: (text) => spec.parse(text, input),
          input,
          model: options.model,
          outputSchema: startSchema(input as StartInput),
          threadId: options.threadId,
          label: options.label ?? TRACE_KIND_TITLE[kind],
          links: options.links ?? [],
          replayOf: result.traceId,
          record: await this.deps.record(),
          signal: options.signal,
          timeoutMs: remaining,
        });
        if (repaired.ok) {
          const firstTitle = result.ok
            ? (result.value as OutputOf<"start">).title
            : null;
          const value = repaired.value as OutputOf<"start">;
          result = {
            ...repaired,
            value: { ...value, title: value.title ?? firstTitle },
          };
        } else if (!result.ok) result = repaired;
      }
    }
    if (!result.ok) throw result.error;
    return { value: result.value as OutputOf<K>, traceId: result.traceId };
  }

  /**
   * Sends a recorded prompt to its model again and records the answer as a
   * replay of the original. Nothing Workstreams stores changes.
   */
  async replay(traceId: string): Promise<Trace> {
    const original = this.deps.traces.get(traceId);
    if (!original) throw new UserError("That model call is no longer stored.");
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
        (value as { workstreamError?: string }).workstreamError
          ? "invalid"
          : "ok",
        {
          completion,
          parsed: value,
          ...((value as { workstreamError?: string }).workstreamError
            ? { error: (value as { workstreamError: string }).workstreamError }
            : {}),
        },
      ),
    };
  }
}
