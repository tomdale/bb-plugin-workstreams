/**
 * `bb workstreams …` for Tom, scripts, and agents. Output is bounded: lists
 * are capped and titles truncated.
 */
import type { Suggestions, SuggestionsState } from "./suggestions.ts";
import type { AgentRecaps } from "./recap.ts";
import type { PostTurnPresenter } from "./postTurn/presenter.ts";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import {
  projectWorkstreams,
  type Group,
  type Section,
} from "../domain/project.ts";
import {
  needYouLabel,
  relativeAge,
  workStateLabel,
} from "../domain/presentation.ts";
import { changeLines } from "../domain/suggestion-change.ts";
import { isCurrent } from "../domain/analysis.ts";
import { needsYou, workView } from "../domain/status.ts";
import { isSnoozed, type ThreadSnooze } from "../domain/snooze.ts";
import type { Analyzer, StoredAnalysis } from "./analyzer.ts";
import type { Organizer } from "./organizer.ts";
import {
  listActiveThreads,
  listSections,
  type InventoryThread,
} from "./inventory.ts";
import type { Journal, JournalEntry } from "./journal.ts";
import { UserError, type WorkstreamService } from "./service.ts";
import {
  TRACE_KINDS,
  TRACE_KIND_TITLE,
  costText,
  type Trace,
  type TraceSummary,
} from "../domain/trace.ts";
import type { TraceStore } from "./trace.ts";
import type { StoredOrder } from "./order.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import type { WorkstreamMigration } from "./workstreamMigration.ts";
import type { Repair } from "./reclassification.ts";
import { buildForest } from "../domain/tree.ts";
import {
  takesThreads,
  type Workstream,
  type WorkstreamAssignment,
} from "../domain/workstreams.ts";
import { workstreamPath } from "../domain/workstream-path.ts";
import { activeHome } from "../domain/regroup.ts";
import type { Prefs } from "../domain/prefs.ts";
import {
  diagnoseReply,
  parseReplyTarget,
  type ReplyIssue,
} from "../domain/replyDiagnosis.ts";
import { ACTION_LABEL, SOURCE_LABEL } from "../app/page/activityLabels.ts";
import { formatCount, formatMoney, formatTokens } from "../app/usage/format.ts";
import {
  LIMIT_SUBJECT,
  USAGE_RANGES,
  type LimitState,
  type SpendState,
  type UsageGroup,
  type UsageRange,
  type UsageReport,
  type UsageTotals,
} from "../domain/usage.ts";
import { pauseMessage } from "./spendGuard.ts";
import { buildUsageReport, type UsageReportDeps } from "./usageReport.ts";

const terminalLine = (text: string) =>
  text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
const TITLE_MAX = 80;
const SHOW_LIMIT = 200;
const clip = (text: string) =>
  text.length <= TITLE_MAX ? text : `${text.slice(0, TITLE_MAX - 1)}…`;

/** Whether a workstream argument names Other, the threads in no workstream. */
const namesOther = (arg: string) => arg.trim().toLowerCase() === "other";

function resolveSection(sections: Section[], arg: string): Section | null {
  const lowered = arg.trim().toLowerCase();
  return (
    sections.find((s) => s.id === arg) ??
    sections.find((s) => s.name.toLowerCase() === lowered) ??
    null
  );
}

/** How `thread show` names where a thread's workstream came from. */
const WORKSTREAM_SOURCE_LABEL = {
  manual: "moved there by you",
  inherited: "inherited from where the thread started",
  automatic: "chosen automatically from its requests",
  composer: "shown by the composer for an earlier draft",
  none: "none yet",
} as const;

function workstreamSourceLines(assignment: WorkstreamAssignment): string[] {
  const source = WORKSTREAM_SOURCE_LABEL[assignment.provenance ?? "none"];
  if (!assignment.inheritedFrom) return [`Source:          ${source}`];
  return [
    "Source:          follows its parent thread's workstream",
    `Parent source:   ${source}`,
    `Follows parent:  @thread:${assignment.inheritedFrom}`,
  ];
}

function resolveWorkstream(
  workstreamStore: WorkstreamStore,
  arg: string,
): Workstream {
  const direct = workstreamStore.getById(arg);
  if (direct) return direct;
  const list = workstreamStore.list();
  const lowered = arg.trim().toLowerCase();
  const byName = list.find((e) => e.name.toLowerCase() === lowered);
  if (byName) return byName;
  const byAlias = list.find((e) =>
    e.aliases.some((a) => a.toLowerCase() === lowered),
  );
  if (byAlias) return byAlias;
  throw new PluginCliError(`Unknown workstream or group: "${arg}"`, {
    code: "workstream_not_found",
    hint: "Run `bb workstreams tree` to see workstream and group names.",
  });
}

function resolveThread(
  service: WorkstreamService,
  arg: string,
): { id: string; title: string; sectionId: string | null } {
  const cleanId = arg.replace(/^@thread:/, "");
  const threads = service.threads();
  const thread = threads.find((t) => t.id === cleanId || t.id === arg);
  if (!thread) {
    throw new PluginCliError(`Unknown thread: "${arg}"`, {
      code: "thread_not_found",
    });
  }
  return thread;
}

function groupJson(group: Group<InventoryThread>, now: number) {
  return {
    id: group.id,
    name: group.name,
    threads: group.total,
    needsYou: group.needsYou,
    lastActive: group.lastActiveAt
      ? relativeAge(group.lastActiveAt, now)
      : null,
    focused: group.focused,
  };
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `YYYY-MM-DD HH:MM` in the server's local time zone. */
function localMinute(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type CompletedAgentMessage = {
  seq: number;
  turnId: string | null;
  itemId: string;
  text: string;
};

function asCompletedAgentMessage(event: unknown): CompletedAgentMessage | null {
  const e = event as {
    type?: string;
    seq?: number;
    scope?: { kind?: string; turnId?: string };
    data?: { item?: { type?: string; id?: string; text?: string } };
  };
  if (
    e.type !== "item/completed" ||
    e.data?.item?.type !== "agentMessage" ||
    typeof e.data.item.text !== "string" ||
    typeof e.seq !== "number"
  ) {
    return null;
  }
  return {
    seq: Math.floor(e.seq),
    turnId: e.scope?.kind === "turn" ? (e.scope.turnId ?? null) : null,
    itemId: e.data.item.id ?? "",
    text: e.data.item.text,
  };
}

function formatReplyIssue(issue: ReplyIssue): string {
  return `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`;
}

function entryLine(entry: JournalEntry): string {
  const when = localMinute(entry.at);
  const status = entry.status === "applied" ? "" : ` [${entry.status}]`;
  return `${when}  ${ACTION_LABEL[entry.action].padEnd(20)} ${SOURCE_LABEL[entry.source].padEnd(19)} ${entry.rationale}${status}  (${entry.id})`;
}

function analysisLine(
  thread: InventoryThread,
  analysis: StoredAnalysis | undefined,
): string {
  if (!analysis) return "not analyzed yet";
  const where = `${workStateLabel(analysis.state)} — ${analysis.recap}`;
  return isCurrent(analysis, thread) ? where : `pending (was: ${where})`;
}

function traceLine(trace: TraceSummary): string {
  const status = trace.status === "ok" ? "" : ` [${trace.status}]`;
  const seconds = `${(trace.durationMs / 1000).toFixed(1)}s`;
  return `${localMinute(trace.at)}  ${trace.kind.padEnd(15)} ${seconds.padStart(6)}  ${clip(trace.label)}${
    trace.summary ? ` — ${trace.summary}` : ""
  }${status}  (${trace.id})`;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** A whole trace as plain text, in the order a reader debugs it. */
function traceText(trace: Trace): string {
  const section = (title: string, body: string | null) =>
    body ? [`── ${title} ──`, body, ""] : [];
  return [
    `${TRACE_KIND_TITLE[trace.kind]}: ${trace.label}`,
    `${localMinute(trace.at)} · ${trace.model} · ${(trace.durationMs / 1000).toFixed(1)}s · ${trace.status}${
      trace.usage
        ? ` · ${trace.usage.input} in / ${trace.usage.output} out · ${costText(trace.usage.cost)}`
        : ""
    }${trace.replayOf ? ` · replay of ${trace.replayOf}` : ""}`,
    "",
    ...section("Error", trace.error),
    ...section("Parsed", trace.parsed === null ? null : json(trace.parsed)),
    ...section("Outcome", trace.outcome === null ? null : json(trace.outcome)),
    ...section("Reasoning", trace.reasoning ?? "(none returned)"),
    ...section("Response", trace.response),
    ...section("System prompt", trace.system),
    ...section("Prompt", trace.prompt),
    ...section(
      "Links",
      trace.links.map((l) => `${l.kind} ${l.ref}`).join("\n") || null,
    ),
    ...section("Replays", trace.replays.map(traceLine).join("\n") || null),
  ].join("\n");
}

const USAGE_RANGE_TITLE: Record<UsageRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};
const USAGE_FLAGS_SHOWN = 20;
const USAGE_GROUPS_SHOWN = 5;

const requestCount = (calls: number) =>
  `${formatCount(calls)} ${calls === 1 ? "request" : "requests"}`;

/**
 * Reported cost, or the words for none when every request went unreported: a
 * total of $0.00 would claim those requests were free.
 */
const reportedCost = (totals: UsageTotals) =>
  totals.calls > 0 && totals.unmetered === totals.calls
    ? "no cost reported"
    : formatMoney(totals.cost);

function limitLevel(limit: LimitState): string {
  if (limit.resumedUntil !== null)
    return `cap reached, resumed until ${localMinute(limit.resumedUntil)}`;
  if (limit.level === "warning") return "warning reached";
  if (limit.level === "ok") return "under its thresholds";
  // The rolling hour empties gradually, so it has no moment to name.
  return limit.window === "hour"
    ? "cap reached, paused"
    : `cap reached, paused until ${localMinute(limit.resetsAt)}`;
}

function limitLine(limit: LimitState): string {
  const amount = (value: number) =>
    limit.metric === "spend" ? formatMoney(value) : formatCount(value);
  const thresholds = [
    limit.warn === null ? null : `warning at ${amount(limit.warn)}`,
    limit.cap === null ? null : `cap ${amount(limit.cap)}`,
  ].filter((part) => part !== null);
  const subject = LIMIT_SUBJECT[limit.key];
  return `  ${subject[0]!.toUpperCase()}${subject.slice(1)}: ${amount(limit.used)} (${thresholds.join(", ")}), ${limitLevel(limit)}`;
}

/** Whether calls are paused, then every limit that has a threshold. */
function spendStateLines(state: SpendState): string[] {
  return [
    state.level === "capped"
      ? `${pauseMessage(state)} From here, run \`bb workstreams usage resume\`.`
      : "Model calls are running.",
    "",
    ...(state.limits.length
      ? ["Limits", ...state.limits.map(limitLine)]
      : ["No limits are set."]),
  ];
}

function usageGroupLines(title: string, groups: UsageGroup[]): string[] {
  if (groups.length === 0) return [];
  return [
    "",
    title,
    ...groups.slice(0, USAGE_GROUPS_SHOWN).map((group) => {
      const unreported =
        group.unmetered > 0 && group.unmetered < group.calls
          ? `, ${formatCount(group.unmetered)} with no cost reported`
          : "";
      return `  ${clip(terminalLine(group.label))}: ${reportedCost(group)}, ${requestCount(group.calls)}${unreported}`;
    }),
  ];
}

/** A usage report as plain text: the pause, the limits, the range, the flags, who spent. */
function usageText(report: UsageReport): string {
  const { totals } = report;
  return [
    ...spendStateLines(report.state),
    "",
    USAGE_RANGE_TITLE[report.range],
    ...(totals.calls === 0
      ? ["  No requests."]
      : [
          `  Reported cost: ${reportedCost(totals)}`,
          `  Requests: ${formatCount(totals.calls)}${totals.failed ? ` (${formatCount(totals.failed)} did not succeed)` : ""}`,
          `  Tokens: ${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out`,
          `  Requests with no cost reported: ${formatCount(totals.unmetered)}`,
        ]),
    "",
    ...(report.flags.length === 0
      ? ["No flags."]
      : [
          "Flags",
          ...report.flags
            .slice(0, USAGE_FLAGS_SHOWN)
            .flatMap((flag) => [
              `  [${flag.severity}] ${terminalLine(flag.title)}`,
              `      ${terminalLine(flag.detail)}`,
            ]),
          ...(report.flags.length > USAGE_FLAGS_SHOWN
            ? [`  … and ${report.flags.length - USAGE_FLAGS_SHOWN} more`]
            : []),
        ]),
    ...usageGroupLines("Top sources", report.bySource),
    ...usageGroupLines("Top models", report.byModel),
    ...usageGroupLines("Top workstreams", report.byWorkstream),
  ].join("\n");
}

export function registerCli(
  bb: BbPluginApi,
  {
    service,
    journal,
    analyzer,
    recaps,
    organizer,
    traces,
    arrangement,
    workstreamStore,
    currentPrefs,
    snoozes,
    notify,
    chooseAutomatically,
    repair,
    suggestions,
    workstreamMigration,
    presenter,
    usage,
  }: {
    /** The sidebar's stored order and focused workstreams. */
    arrangement: {
      load(): StoredOrder;
    };
    service: WorkstreamService;
    journal: Journal;
    analyzer: Analyzer;
    recaps: AgentRecaps;
    organizer: Organizer;
    repair?: Repair;
    traces: TraceStore;
    workstreamStore: WorkstreamStore;
    workstreamMigration?: WorkstreamMigration;
    currentPrefs?: () => Prefs;
    /** Every thread's snooze, so snoozed threads leave groups and counts. */
    snoozes?: () => Readonly<Record<string, ThreadSnooze>>;
    notify?: () => void;
    chooseAutomatically?: (input: {
      threadId: string;
    }) => Promise<{ assignment: WorkstreamAssignment }>;
    suggestions?: Suggestions;
    /** Enhanced responses; `present` composes or stores one on demand. */
    presenter?: PostTurnPresenter;
    /** The ledger, spend guard, flags, and workstream names behind `usage`. */
    usage: UsageReportDeps;
    /** Renames the threads Workstreams titled in an earlier title form. */
  },
): void {
  const suggestionsOutput = (
    state: SuggestionsState,
    options: { all?: boolean; json?: boolean },
  ) => {
    const shown = state.suggestions.filter(
      (s) => options.all || s.status === "pending",
    );
    if (options.json)
      return {
        exitCode: 0,
        stdout: JSON.stringify({ ...state, suggestions: shown }, null, 2),
      };
    if (shown.length === 0)
      return {
        exitCode: 0,
        stdout: state.error
          ? `No suggestions. The last run failed: ${state.error}`
          : "No suggestions waiting.",
      };
    return {
      exitCode: 0,
      stdout: shown
        .map(
          (s) =>
            `${s.id}  ${s.status === "pending" ? "" : `[${s.status}] `}${s.summary}${(s.change ? changeLines(s.change) : []).map((line) => `\n    ${line}`).join("")}${s.reason ? `\n    ${s.reason}` : ""}${s.problem ? `\n    Can't apply now: ${s.problem}` : ""}`,
        )
        .join("\n"),
    };
  };
  const decideSuggestions = async (
    given: string | string[],
    decision: "accept" | "decline",
    options: { json?: boolean },
  ) => {
    if (!suggestions) return fail(new Error("Suggestions are unavailable."));
    const list = [given].flat();
    const ids =
      list.length === 1 && list[0] === "all"
        ? suggestions
            .state()
            .suggestions.filter((s) => s.status === "pending")
            .map((s) => s.id)
        : list;
    if (ids.length === 0)
      return { exitCode: 0, stdout: "No suggestions waiting." };
    const result = await suggestions.decide(ids, decision).catch(fail);
    if (options.json)
      return {
        exitCode: result.failed.length ? 1 : 0,
        stdout: JSON.stringify(result, null, 2),
      };
    const verb = decision === "accept" ? "Accepted" : "Declined";
    return {
      exitCode: result.failed.length ? 1 : 0,
      stdout: [
        `${verb} ${plural(result.applied.length, "suggestion")}.`,
        ...result.failed.map((f) => `Couldn't apply ${f.id}: ${f.reason}`),
      ].join("\n"),
    };
  };
  const load = async () => {
    const [threads, sections] = await Promise.all([
      listActiveThreads(bb.sdk),
      listSections(bb.sdk),
    ]);
    const now = Date.now();
    const analyzed = analyzer.all();
    const reported = recaps.all();
    // Status follows the shared rule: the agent's recap outranks analysis.
    const work = new Map(
      threads.map((thread) => [
        thread.id,
        workView(thread, analyzed[thread.id], reported[thread.id]),
      ]),
    );
    const analysis: Record<string, StoredAnalysis> = { ...analyzed };
    for (const [threadId, view] of work)
      if (view.kind === "current") analysis[threadId] = view.analysis;
    return {
      now,
      sections,
      threads,
      analysis,
      projection: projectWorkstreams(threads, sections, {
        now,
        needsYou: (thread) => needsYou(thread, work.get(thread.id)!),
        order: arrangement.load(),
        snoozedUntil: (thread) => {
          const snooze = snoozes?.()[thread.id];
          return isSnoozed(snooze, now) ? snooze!.until : undefined;
        },
      }),
    };
  };
  const fail = (error: unknown): never => {
    if (error instanceof UserError)
      throw new PluginCliError(error.message, { code: "workstreams_error" });
    throw error;
  };
  /**
   * Whatever the ledger or the spend guard raises becomes the command's
   * message, so a damaged usage record reads as one line, not a stack.
   */
  const usageRead = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      throw new PluginCliError(
        error instanceof Error ? error.message : String(error),
        { code: "usage_unavailable" },
      );
    }
  };

  bb.cli.register(
    defineCli({
      name: "workstreams",
      summary:
        "List workstreams and their threads, organize workstreams and groups, and read the activity log",
      commands: {
        list: cliCommand({
          summary: "List the workstreams in the sidebar with thread counts",
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const { now, projection } = await load();
            const active = projection.groups.map((g) => groupJson(g, now));
            const other = groupJson(projection.other, now);
            const dormant = projection.dormant.map((g) => groupJson(g, now));
            if (options.json)
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  { workstreams: active, other, dormant },
                  null,
                  2,
                ),
              };
            const line = (g: ReturnType<typeof groupJson>) =>
              `${g.name.padEnd(36)} ${plural(g.threads, "thread").padStart(11)}${g.needsYou ? ` · ${needYouLabel(g.needsYou)}` : ""}${g.lastActive ? ` · ${g.lastActive}` : ""}${g.focused ? " · focused" : ""}  (${g.id})`;
            const lines = [
              ...active.map(line),
              line(other),
              ...(dormant.length
                ? ["", `Dormant: ${dormant.map((g) => g.name).join(", ")}`]
                : []),
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        show: cliCommand({
          summary:
            "Show the threads in one workstream, child threads under their parents",
          positionals: [
            {
              name: "workstream",
              description:
                "Workstream name or section id; `other` for threads in no workstream",
              required: true,
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            const { now, sections, projection, analysis } = await load();
            const arg = positionals.workstream;
            const group = namesOther(arg)
              ? projection.other
              : (() => {
                  const section = resolveSection(sections, arg);
                  if (!section)
                    throw new PluginCliError(`No workstream named "${arg}".`, {
                      code: "workstream_not_found",
                      hint: "Run `bb workstreams list` to see workstream names and ids.",
                    });
                  return projection.all.find((g) => g.id === section.id)!;
                })();
            const rows = group.rows.slice(0, SHOW_LIMIT);
            const hasMore = group.rows.length > rows.length;
            if (options.json)
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  {
                    ...groupJson(group, now),
                    count: group.total,
                    shown: rows.length,
                    hasMore,
                    rows: rows.map((r) => ({
                      id: r.thread.id,
                      title: clip(r.thread.title),
                      depth: r.depth,
                      status: r.thread.status,
                      needsYou: r.needsYou,
                      lastActive: relativeAge(r.thread.latestAttentionAt, now),
                      analysis: analysis[r.thread.id] ?? null,
                      current: isCurrent(analysis[r.thread.id], r.thread),
                    })),
                  },
                  null,
                  2,
                ),
              };
            const lines = rows.flatMap((r) => {
              const indent = "  ".repeat(Math.min(r.depth, 4));
              return [
                `${indent}${r.needsYou ? "? " : ""}${clip(r.thread.title)}  · ${relativeAge(r.thread.latestAttentionAt, now)}  (${r.thread.id})`,
                `${indent}    ${analysisLine(r.thread, analysis[r.thread.id])}`,
              ];
            });
            return {
              exitCode: 0,
              stdout: [
                `${group.name} — ${plural(group.total, "thread")}${hasMore ? ` (showing first ${rows.length})` : ""}`,
                ...lines,
                ...(hasMore
                  ? [
                      `${group.total - rows.length} more threads omitted by the ${SHOW_LIMIT}-row CLI limit.`,
                    ]
                  : []),
              ].join("\n"),
            };
          },
        }),
        log: cliCommand({
          summary:
            "Show the activity log: every change Workstreams made or observed",
          options: {
            limit: {
              type: "integer",
              min: 1,
              max: 500,
              default: 50,
              description: "Entries to show (1-500)",
            },
            since: {
              type: "duration",
              defaultUnit: "h",
              description: "Only entries newer than this (e.g. 90m, 7d)",
            },
            outside: {
              type: "boolean",
              description: "Include changes made outside Workstreams",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const cutoff = options.since ? Date.now() - options.since : 0;
            const { entries, hasMore, limit } = journal.window({
              limit: options.limit,
              external: options.outside,
              since: cutoff || undefined,
            });
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(
                    { entries, count: entries.length, hasMore, limit },
                    null,
                    2,
                  )
                : entries.length
                  ? [
                      ...entries.map(entryLine),
                      ...(hasMore
                        ? [
                            `Showing ${entries.length} newest matching entries; older matching entries are omitted by --limit ${limit}.`,
                          ]
                        : []),
                    ].join("\n")
                  : "No activity.",
            };
          },
        }),
        analyze: cliCommand({
          summary:
            "Analyze one thread now, or queue every thread whose latest turn isn't analyzed yet",
          positionals: [
            {
              name: "thread",
              description: "Thread id; omit to catch up on all threads",
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            if (positionals.thread) {
              const started = Date.now();
              const result = await analyzer
                .analyzeNow(positionals.thread)
                .catch((error: unknown) => {
                  throw new PluginCliError(
                    error instanceof Error ? error.message : String(error),
                    { code: "analysis_failed" },
                  );
                });
              if (!result)
                throw new PluginCliError(
                  "That thread is archived or hidden, so it isn't analyzed.",
                  { code: "not_analyzable" },
                );
              const seconds = ((Date.now() - started) / 1000).toFixed(1);
              return {
                exitCode: 0,
                stdout: options.json
                  ? JSON.stringify({ ...result, seconds }, null, 2)
                  : [
                      `${workStateLabel(result.state)}${result.reported ? " (reported)" : ""} · ${seconds}s · ${result.model}`,
                      result.recap,
                      ...(result.title ? [`Title: ${result.title}`] : []),
                      ...(result.goal ? [`Goal: ${result.goal}`] : []),
                      `Workstream: ${workstreamStore.assignment(positionals.thread).label ?? "none"}`,
                      ...(result.ask ? [`Asks: ${result.ask}`] : []),
                    ].join("\n"),
              };
            }
            const queued = analyzer.catchUp(await listActiveThreads(bb.sdk));
            const globalLastError = analyzer.lastError;
            const message = `Queued ${plural(queued, "thread")} for analysis.${globalLastError ? ` Most recent analyzer failure anywhere: ${globalLastError}` : ""}`;
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(
                    {
                      queued,
                      lastError: globalLastError,
                      lastErrorScope: globalLastError ? "global" : null,
                    },
                    null,
                    2,
                  )
                : message,
            };
          },
        }),
        organize: cliCommand({
          summary:
            "Show how threads are listed in workstreams, or organize them again now",
          options: {
            rebuild: {
              type: "boolean",
              description:
                "Run an organizer pass now, and retry one that failed",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const state = options.rebuild
              ? await organizer.rebuild().catch(fail)
              : organizer.state();
            const coverage = analyzer.coverage();
            if (options.json)
              return {
                exitCode: state.status === "failed" ? 1 : 0,
                stdout: JSON.stringify({ ...state, coverage }, null, 2),
              };
            const lines = [
              `Status: ${state.status}${state.error ? ` (${state.error})` : ""}`,
              `Workstreams: ${state.groups.length}`,
              `Active threads: ${state.counts.activeThreads}, complete: ${state.counts.completedThreads}, no workstream: ${state.counts.noWorkstreamThreads}`,
              `Agent reports: ${coverage.reported} of ${coverage.analyzed} analyzed latest turns`,
              ...state.groups.map(
                (g) =>
                  `  ${g.name} (${plural(g.totalCount, "thread")}: ${g.activeCount} active, ${g.completedCount} complete)`,
              ),
            ];
            return {
              exitCode: state.status === "failed" ? 1 : 0,
              stdout: lines.join("\n"),
            };
          },
        }),
        suggestions: cliCommand({
          summary: "List organizing suggestions waiting for your decision",
          options: {
            all: {
              type: "boolean",
              description: "Include recently decided suggestions",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const state = suggestions?.state();
            if (!state) return fail(new Error("Suggestions are unavailable."));
            return suggestionsOutput(state, options);
          },
        }),
        "suggestions run": cliCommand({
          summary: "Suggest changes now, whatever is due",
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ options }) {
            if (!suggestions)
              return fail(new Error("Suggestions are unavailable."));
            await suggestions.run({ manual: true }).catch(fail);
            return suggestionsOutput(suggestions.state(), options);
          },
        }),
        "suggestions accept": cliCommand({
          summary: "Accept suggestions, in the order they were made",
          positionals: [
            {
              name: "ids",
              description: "Suggestion ids, or all",
              required: true,
              variadic: true,
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            return decideSuggestions(positionals.ids, "accept", options);
          },
        }),
        "suggestions decline": cliCommand({
          summary: "Decline suggestions; tidy won't propose them again",
          positionals: [
            {
              name: "ids",
              description: "Suggestion ids, or all",
              required: true,
              variadic: true,
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            return decideSuggestions(positionals.ids, "decline", options);
          },
        }),
        present: cliCommand({
          summary:
            "Compose an enhanced response for a thread's latest finished response, or store a given document",
          positionals: [
            { name: "thread", description: "Thread id", required: true },
          ],
          options: {
            document: {
              type: "string",
              description:
                "A document as JSON to validate and store instead of composing one (needs WORKSTREAMS_PRESENT_DOCUMENTS=1 on the BB server)",
            },
            turn: {
              type: "string",
              description:
                "The turn whose final response to use; default: the latest finished turn",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            if (!presenter?.enabled())
              throw new PluginCliError("Enhanced responses are off.", {
                code: "presentation_off",
                hint: "Turn on Enhanced responses in Workstreams' Recap settings.",
              });
            const thread = await bb.sdk.threads.get({
              threadId: positionals.thread,
            });
            if (
              thread.visibility !== "visible" ||
              thread.parentThreadId ||
              thread.archivedAt !== null
            )
              throw new PluginCliError(
                "Enhanced responses apply only to open top-level threads.",
                { code: "presentation_thread" },
              );
            let injected: unknown;
            if (
              options.document !== undefined &&
              process.env.WORKSTREAMS_PRESENT_DOCUMENTS !== "1"
            )
              throw new PluginCliError(
                "--document stores a document without composing it, so it is off unless the BB server runs with WORKSTREAMS_PRESENT_DOCUMENTS=1.",
                { code: "presentation_document_off" },
              );
            if (options.document !== undefined)
              try {
                injected = JSON.parse(options.document);
              } catch {
                throw new PluginCliError("--document is not JSON.", {
                  code: "invalid_document",
                });
              }
            const { output } = await bb.sdk.threads.output({
              threadId: positionals.thread,
            });
            const outcome = await presenter.present(
              positionals.thread,
              output,
              {
                ...(injected !== undefined ? { document: injected } : {}),
                ...(options.turn ? { turnId: options.turn } : {}),
              },
            );
            return {
              exitCode: outcome.kind === "stored" ? 0 : 1,
              stdout: options.json
                ? json(outcome)
                : outcome.kind === "stored"
                  ? `Stored an enhanced response for ${outcome.messageId}.`
                  : `Nothing stored: ${outcome.reason}`,
            };
          },
        }),
        trace: cliCommand({
          summary: "Show model traces: one in full, or the latest",
          positionals: [
            {
              name: "id",
              description: "Trace id; omit to list the latest calls",
            },
          ],
          options: {
            thread: {
              type: "string",
              description: "Only calls about this thread",
            },
            entry: {
              type: "string",
              description: "Only calls behind this activity log entry",
            },
            kind: {
              type: "string",
              description: `Only this kind: ${TRACE_KINDS.join(", ")}`,
            },
            limit: {
              type: "integer",
              min: 1,
              max: 500,
              default: 20,
              description: "Calls to list (1-500)",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            if (positionals.id) {
              const trace = traces.get(positionals.id);
              if (!trace)
                throw new PluginCliError("No model call with that id.", {
                  code: "trace_not_found",
                  hint: "Run `bb workstreams trace` to list recorded calls.",
                });
              return {
                exitCode: 0,
                stdout: options.json ? json(trace) : traceText(trace),
              };
            }
            const kind = options.kind
              ? TRACE_KINDS.find((k) => k === options.kind)
              : undefined;
            if (options.kind && !kind)
              throw new PluginCliError(`Unknown kind "${options.kind}".`, {
                code: "unknown_kind",
                hint: `Kinds: ${TRACE_KINDS.join(", ")}`,
              });
            const list = traces.list({
              kind,
              limit: options.limit,
              link: options.thread
                ? { kind: "thread", ref: options.thread }
                : options.entry
                  ? { kind: "entry", ref: options.entry }
                  : undefined,
            });
            const noCalls =
              currentPrefs?.().advanced.debugRecord === false
                ? "No model traces recorded. Turn on Record model traces in Workstreams settings to record them."
                : "No model traces recorded yet.";
            return {
              exitCode: 0,
              stdout: options.json
                ? json({ traces: list })
                : list.length
                  ? list.map(traceLine).join("\n")
                  : noCalls,
            };
          },
        }),
        usage: cliCommand({
          summary:
            "Show what model calls spent, the limits, and what looks wrong",
          options: {
            range: {
              type: "enum",
              values: USAGE_RANGES,
              default: "24h",
              description: `The span to total: ${USAGE_RANGES.join(", ")}`,
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const report = usageRead(() =>
              buildUsageReport(usage, options.range, Date.now()),
            );
            return {
              exitCode: 0,
              stdout: options.json ? json(report) : usageText(report),
            };
          },
        }),
        "usage resume": cliCommand({
          summary:
            "Let model calls through past every cap reached now, until its window resets",
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ options }) {
            const state = usageRead(() => usage.guard.resume());
            return {
              exitCode: 0,
              stdout: options.json
                ? json({ state })
                : spendStateLines(state).join("\n"),
            };
          },
        }),
        reply: cliCommand({
          summary:
            "Inspect an assistant reply's raw output and reply-block syntax",
          positionals: [
            {
              name: "target",
              description:
                "Thread ID, @thread:<id>[#msg=<seq>], or thread/message URL",
              required: true,
            },
          ],
          options: {
            message: {
              type: "integer",
              min: 1,
              max: 1_000_000_000,
              description:
                "Message event sequence (#msg=<seq>); defaults to the latest assistant reply",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            const parsedTarget = parseReplyTarget(
              positionals.target,
              options.message,
            );
            if (!parsedTarget) {
              throw new PluginCliError(
                `Invalid reply target "${positionals.target}".`,
                {
                  code: "invalid_reply_target",
                  hint: "Pass a thread ID, @thread:<id>[#msg=<seq>], or a BB thread URL.",
                },
              );
            }
            const { threadId, messageSeq } = parsedTarget;
            let matched: CompletedAgentMessage | null = null;
            if (messageSeq !== undefined) {
              const windowEvents = await bb.sdk.threads.events
                .list({
                  threadId,
                  types: ["item/completed"],
                  afterSeq: String(messageSeq - 1),
                  beforeSeq: String(messageSeq + 10),
                  limit: "20",
                  order: "asc",
                })
                .catch(fail);
              const candidates = windowEvents
                .map(asCompletedAgentMessage)
                .filter((m): m is CompletedAgentMessage => m !== null);
              matched =
                candidates.find((m) => m.seq === messageSeq) ??
                candidates.find(
                  (m) => m.seq >= messageSeq && m.seq <= messageSeq + 5,
                ) ??
                null;
              if (!matched) {
                const recent = await bb.sdk.threads.events
                  .list({
                    threadId,
                    types: ["item/completed"],
                    limit: "200",
                    order: "desc",
                  })
                  .catch(fail);
                matched =
                  recent
                    .map(asCompletedAgentMessage)
                    .find((m): m is CompletedAgentMessage =>
                      Boolean(m && m.seq === messageSeq),
                    ) ?? null;
              }
              if (!matched) {
                throw new PluginCliError(
                  `No assistant reply at #msg=${messageSeq} in ${threadId}.`,
                  { code: "reply_not_found" },
                );
              }
            } else {
              const recent = await bb.sdk.threads.events
                .list({
                  threadId,
                  types: ["item/completed"],
                  limit: "50",
                  order: "desc",
                })
                .catch(fail);
              matched =
                recent
                  .map(asCompletedAgentMessage)
                  .find((m): m is CompletedAgentMessage => m !== null) ?? null;
              if (!matched) {
                throw new PluginCliError(
                  `No assistant replies in ${threadId}.`,
                  { code: "reply_not_found" },
                );
              }
            }
            const diagnosis = diagnoseReply(matched.text);
            const payload = {
              threadId,
              messageSeq: matched.seq,
              turnId: matched.turnId,
              itemId: matched.itemId,
              status: diagnosis.status,
              issues: diagnosis.issues,
              reply: diagnosis.reply,
              raw: matched.text,
            };
            if (options.json) {
              return { exitCode: 0, stdout: json(payload) };
            }
            const lines = [
              `Thread:   @thread:${threadId}#msg=${matched.seq}`,
              `Turn:     ${matched.turnId ?? "none"} (${matched.itemId || "unknown"})`,
              `Status:   ${diagnosis.status}`,
              "",
              ...(diagnosis.issues.length
                ? [
                    "Issues:",
                    ...diagnosis.issues.map(
                      (issue) => `- ${formatReplyIssue(issue)}`,
                    ),
                    "",
                  ]
                : []),
              "Raw agent output:",
              matched.text,
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        undo: cliCommand({
          summary: "Undo a logged change, where BB state still allows it",
          positionals: [
            {
              name: "entry",
              description: "Activity log entry id",
              required: true,
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            const entry = await service.undo(positionals.entry).catch(fail);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ entry }, null, 2)
                : `${entry.rationale}${entry.detail ? ` (${entry.detail})` : ""}`,
            };
          },
        }),
        preview: cliCommand({
          summary:
            "Preview where Workstreams would move threads now, without moving any",
          positionals: [
            {
              name: "thread",
              description:
                "Thread id; omit for up to 100 visible threads. For larger sets, preview threads one at a time",
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            if (!repair) throw new Error("Previews are unavailable.");
            const ids = positionals.thread
              ? [positionals.thread]
              : buildForest(await listActiveThreads(bb.sdk)).threads.map(
                  (r) => r.thread.id,
                );
            const plan = await repair.preview(ids);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(plan, null, 2)
                : [
                    `Preview ${plan.id}; no threads moved; ${plan.excludedManual} threads you moved left out`,
                    ...plan.rows.map(
                      (r) =>
                        `${terminalLine(r.title)}: ${terminalLine(r.from ?? "No workstream")} → ${terminalLine(r.to ?? "No workstream")}${r.error ? ` (${terminalLine(r.error)})` : ""}`,
                    ),
                    plan.rows.some((row) => !row.error && row.answer)
                      ? `Apply with bb workstreams apply ${plan.id}`
                      : "Workstreams would move no threads, so there is nothing to apply",
                  ].join("\n"),
            };
          },
        }),
        apply: cliCommand({
          summary:
            "Apply a fresh preview, leaving threads you moved where they are",
          positionals: [
            { name: "preview", description: "Preview ID", required: true },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            if (!repair) throw new Error("Previews are unavailable.");
            const result = await repair.apply(positionals.preview!);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(result)
                : `${result.changed} changed, ${result.skipped} skipped`,
            };
          },
        }),
        "migration preview": cliCommand({
          summary:
            "Preview folding deeper workstreams into two levels, without moving any threads",
          options: {
            mapping: {
              type: "string",
              description:
                "JSON choices, newWorkstreams, and explicit resetThreadIds for where each thread goes",
            },
            json: {
              type: "boolean",
              description: "Print the complete preview",
            },
          },
          async run({ options }) {
            if (!workstreamMigration)
              throw new PluginCliError("Migration is unavailable.");
            const plan = workstreamMigration.preview(
              options.mapping ? JSON.parse(options.mapping) : {},
            );
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(plan, null, 2)
                : [
                    `Preview: ${plan.id}`,
                    `${plan.removed.length} deeper workstreams; ${plan.changes.length} moved; ${plan.resets.length} reset; ${plan.blockers.length} blockers`,
                    ...plan.blockers
                      .slice(0, SHOW_LIMIT)
                      .map(
                        (blocker) =>
                          `${blocker.threadId ?? blocker.workstreamId}: ${blocker.reason}`,
                      ),
                    "Inspect the complete preview with --json before applying it.",
                  ].join("\n"),
            };
          },
        }),
        "migration apply": cliCommand({
          summary: "Apply a migration preview while its facts still match",
          positionals: [
            {
              name: "preview",
              description: "Migration preview ID",
              required: true,
            },
          ],
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run({ positionals, options }) {
            if (!workstreamMigration)
              throw new PluginCliError("Migration is unavailable.");
            const result = await service.exclusive(async () =>
              workstreamMigration.apply(positionals.preview),
            );
            organizer.trigger(0);
            notify?.();
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(result, null, 2)
                : `Moved ${result.changed} threads; reset ${result.reset} automatic choices; backup ${result.backupId}`,
            };
          },
        }),
        "migration backup": cliCommand({
          summary: "Read the backup an applied migration saved",
          positionals: [
            {
              name: "backup",
              description: "Backup ID",
              required: true,
            },
          ],
          async run({ positionals }) {
            if (!workstreamMigration)
              throw new PluginCliError("Migration is unavailable.");
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                workstreamMigration.backup(positionals.backup),
                null,
                2,
              ),
            };
          },
        }),
        tree: cliCommand({
          summary:
            "List every workstream and group, including ones with no open threads",
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ options }) {
            const workstreams = workstreamStore.list();
            if (options.json) {
              const items = workstreams.map((e) => ({
                id: e.id,
                name: e.name,
                description: e.description,
                parentId: e.parentId,
                aliases: e.aliases,
                path: workstreamPath(e.id, workstreams),
              }));
              return {
                exitCode: 0,
                stdout: JSON.stringify({ workstreams: items }, null, 2),
              };
            }
            if (workstreams.length === 0) {
              return { exitCode: 0, stdout: "No workstreams yet." };
            }
            const sorted = [...workstreams].sort((a, b) =>
              workstreamPath(a.id, workstreams).localeCompare(
                workstreamPath(b.id, workstreams),
              ),
            );
            const lines = sorted.map((e) => {
              const label = workstreamPath(e.id, workstreams);
              const aliases =
                e.aliases.length > 0
                  ? ` [aliases: ${e.aliases.join(", ")}]`
                  : "";
              return `${label.padEnd(40)} ${e.id}${aliases}`;
            });
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        describe: cliCommand({
          summary: "Show a workstream's or group's details",
          positionals: [
            {
              name: "workstream",
              description: "Workstream or group name or ID",
              required: true,
            },
          ],
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            const workstream = resolveWorkstream(
              workstreamStore,
              positionals.workstream,
            );
            const workstreams = workstreamStore.list();
            const label = workstreamPath(workstream.id, workstreams);
            const groups = workstreamStore.sectionBindings();
            const home = activeHome(
              workstream.id,
              [...groups.values()],
              workstreams,
            );
            const assignments = workstreamStore.assignments();
            const assignedThreads = (
              Object.values(assignments) as WorkstreamAssignment[]
            ).filter((a) => a.workstreamId === workstream.id);
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  {
                    workstream,
                    path: label,
                    listedInWorkstreamId: home,
                    threads: assignedThreads.map((a) => a.threadId),
                  },
                  null,
                  2,
                ),
              };
            }
            const group = workstream.parentId
              ? workstreamStore.getById(workstream.parentId)
              : null;
            const lines = [
              `${takesThreads(workstream.id, workstreams) ? "Workstream" : "Group"}: ${label}`,
              `ID:              ${workstream.id}`,
              `Description:     ${workstream.description || "(none)"}`,
              `Group:           ${group ? group.name : "(none)"}`,
              `Aliases:         ${workstream.aliases.length ? workstream.aliases.join(", ") : "(none)"}`,
              `Threads:         ${assignedThreads.length}`,
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        create: cliCommand({
          summary: "Create a workstream",
          positionals: [
            {
              name: "name",
              description: "Workstream name",
              required: true,
            },
          ],
          options: {
            description: {
              type: "string",
              description: "Description of scope",
            },
            group: {
              type: "string",
              description:
                "Group (or top-level workstream) name or ID to create it in",
            },
            aliases: {
              type: "string",
              description: "Comma-separated aliases",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            let parentId: string | null = null;
            if (options.group) {
              const parent = resolveWorkstream(workstreamStore, options.group);
              parentId = parent.id;
            }
            const aliases = options.aliases
              ? options.aliases
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean)
              : [];
            try {
              const workstream = workstreamStore.create(
                positionals.name,
                options.description ?? "",
                parentId,
                aliases,
              );
              notify?.();
              organizer.trigger();
              if (options.json) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ workstream }, null, 2),
                };
              }
              return {
                exitCode: 0,
                stdout: `Created workstream "${workstream.name}" (${workstream.id}).`,
              };
            } catch (err) {
              throw new PluginCliError(
                err instanceof Error ? err.message : String(err),
                { code: "workstream_create_failed" },
              );
            }
          },
        }),
        edit: cliCommand({
          summary:
            "Rename a workstream or group, or change its description or aliases",
          positionals: [
            {
              name: "workstream",
              description: "Workstream or group name or ID to edit",
              required: true,
            },
          ],
          options: {
            name: { type: "string", description: "New name" },
            description: { type: "string", description: "New description" },
            aliases: {
              type: "string",
              description: "New comma-separated aliases",
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            const workstream = resolveWorkstream(
              workstreamStore,
              positionals.workstream,
            );
            try {
              const updated = workstreamStore.edit(workstream.id, {
                name: options.name,
                description: options.description,
                aliases:
                  options.aliases !== undefined
                    ? options.aliases
                        .split(",")
                        .map((a) => a.trim())
                        .filter(Boolean)
                    : undefined,
              });
              notify?.();
              organizer.trigger();
              if (options.json) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ workstream: updated }, null, 2),
                };
              }
              return {
                exitCode: 0,
                stdout: `Updated "${updated.name}" (${updated.id}).`,
              };
            } catch (err) {
              throw new PluginCliError(
                err instanceof Error ? err.message : String(err),
                { code: "workstream_edit_failed" },
              );
            }
          },
        }),
        move: cliCommand({
          summary:
            "Move a workstream into a group, between groups, or out of its group",
          positionals: [
            {
              name: "workstream",
              description: "Workstream name or ID to move",
              required: true,
            },
          ],
          options: {
            to: {
              type: "string",
              description:
                'Group name or ID to move it into, or "top" to take it out of its group',
            },
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            const workstream = resolveWorkstream(
              workstreamStore,
              positionals.workstream,
            );
            let newParentId: string | null = null;
            if (options.to && options.to.toLowerCase() !== "top") {
              const parent = resolveWorkstream(workstreamStore, options.to);
              newParentId = parent.id;
            }
            try {
              const updated = workstreamStore.move(workstream.id, newParentId);
              notify?.();
              organizer.trigger();
              if (options.json) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ workstream: updated }, null, 2),
                };
              }
              const targetName = newParentId
                ? (workstreamStore.getById(newParentId)?.name ?? newParentId)
                : null;
              return {
                exitCode: 0,
                stdout: targetName
                  ? `Moved "${updated.name}" into ${targetName} (${updated.id}).`
                  : `Moved "${updated.name}" out of its group (${updated.id}).`,
              };
            } catch (err) {
              throw new PluginCliError(
                err instanceof Error ? err.message : String(err),
                { code: "workstream_move_failed" },
              );
            }
          },
        }),
        merge: cliCommand({
          summary:
            "Merge a workstream or group into another, moving its threads and workstreams",
          positionals: [
            {
              name: "source",
              description: "Workstream or group name or ID to merge",
              required: true,
            },
            {
              name: "target",
              description: "Workstream or group name or ID to merge into",
              required: true,
            },
          ],
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            const source = resolveWorkstream(
              workstreamStore,
              positionals.source,
            );
            const target = resolveWorkstream(
              workstreamStore,
              positionals.target,
            );
            try {
              const merged = workstreamStore.merge(source.id, target.id);
              notify?.();
              organizer.trigger();
              if (options.json) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ workstream: merged }, null, 2),
                };
              }
              return {
                exitCode: 0,
                stdout: `Merged "${source.name}" into "${target.name}" (${merged.id}).`,
              };
            } catch (err) {
              throw new PluginCliError(
                err instanceof Error ? err.message : String(err),
                { code: "workstream_merge_failed" },
              );
            }
          },
        }),
        "thread show": cliCommand({
          summary:
            "Show a thread's workstream, where that came from, and where the sidebar lists it",
          positionals: [
            {
              name: "thread",
              description: "Thread ID",
              required: true,
            },
          ],
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            await service.reconcile();
            const thread = resolveThread(service, positionals.thread);
            const assignment = workstreamStore.assignment(thread.id);
            const parentmostId = workstreamStore.topThreadOf(thread.id);
            const parentmost =
              parentmostId !== thread.id
                ? service.threads().find((t) => t.id === parentmostId)
                : thread;
            const effectiveSectionId =
              parentmost?.sectionId ?? thread.sectionId;
            const sectionName = effectiveSectionId
              ? (service.sectionName(effectiveSectionId) ?? effectiveSectionId)
              : "Other";
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  {
                    threadId: thread.id,
                    title: thread.title,
                    sectionId: thread.sectionId,
                    listedIn: sectionName,
                    assignment,
                  },
                  null,
                  2,
                ),
              };
            }
            const lines = [
              `Thread:          ${clip(thread.title)} (@thread:${thread.id})`,
              `Listed in:       ${sectionName}`,
              `Workstream:      ${assignment.label ?? "none"}`,
              ...workstreamSourceLines(assignment),
            ];
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
        "thread move": cliCommand({
          summary:
            "Move a thread to a workstream yourself; Workstreams then leaves it there",
          positionals: [
            {
              name: "thread",
              description: "Thread ID",
              required: true,
            },
            {
              name: "workstream",
              description:
                "Workstream name or ID, or `none` to move it to No workstream",
              required: true,
            },
          ],
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            await service.reconcile();
            const thread = resolveThread(service, positionals.thread);
            const workstream =
              positionals.workstream.trim().toLowerCase() === "none"
                ? null
                : resolveWorkstream(workstreamStore, positionals.workstream);
            const assignment = workstreamStore.assign(
              thread.id,
              workstream?.id ?? null,
              { provenance: "manual" },
            );
            notify?.();
            organizer.trigger();
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ assignment }, null, 2),
              };
            }
            return {
              exitCode: 0,
              stdout: workstream
                ? `Moved @thread:${thread.id} to "${workstream.name}" (${assignment.label}).`
                : `Moved @thread:${thread.id} to No workstream; it stays under Other.`,
            };
          },
        }),
        "thread automatic": cliCommand({
          summary:
            "Workstreams chooses from your requests a thread's workstream again, now and from then on",
          positionals: [
            {
              name: "thread",
              description: "Thread ID",
              required: true,
            },
          ],
          options: {
            json: { type: "boolean", description: "Print JSON" },
          },
          async run({ positionals, options }) {
            await service.reconcile();
            const thread = resolveThread(service, positionals.thread);
            if (!chooseAutomatically) {
              throw new PluginCliError(
                "Inference is unavailable to choose a workstream.",
                { code: "inference_unavailable" },
              );
            }
            const { assignment } = await chooseAutomatically({
              threadId: thread.id,
            }).catch((error: unknown) => {
              throw new PluginCliError(
                error instanceof Error ? error.message : String(error),
                { code: "automatic_failed" },
              );
            });
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ assignment }, null, 2),
              };
            }
            return {
              exitCode: 0,
              stdout: `@thread:${thread.id} is now in ${assignment.label ?? "No workstream"}.`,
            };
          },
        }),
      },
    }),
  );
}
