/**
 * The agent's recap: what a thread's agent reports when it ends a turn, shown
 * above the composer and as the thread's work state in the sidebar. Pure, so
 * the server, the app, and tests share one definition.
 */
import { z } from "zod";
import {
  normalizeRecapFileLinks,
  recapMarkdownSpans,
} from "./recapFileLinks.ts";
import type { AgentReport, StoredAnalysis, WorkState } from "./analysis.ts";

export const RECAP_TOOL = "WorkstreamsRecap";

export const RECAP_CORRECTION = `Your turn ended without a recap. Any answer you already gave is visible to the user: do not repeat it, in a block or otherwise, and add no closing note. Finish any remaining authorized work, then call ${RECAP_TOOL}, which is the whole of this turn's output. Write nothing after it — no note, no reply block — and put anything the recap leaves unsaid in its own fields. If you need the user's input instead, ask through the available question-card tool; the question ends the turn.`;

/**
 * How a turn's result stands: complete, awaiting review, or waiting on an async task.
 * A turn that needs the user's answer ends with a question card instead.
 */
export const RECAP_STATES = ["complete", "review", "waiting"] as const;
export type RecapState = (typeof RECAP_STATES)[number];

/**
 * Recap lines are inline Markdown: `code`, emphasis, [links](url), and
 * `@thread:<id>` mentions, which BB renders as thread chips. Newlines are
 * collapsed, so block syntax never applies.
 *
 * The line as a reader sees it, without Markdown syntax or link
 * destinations, for limits and for surfaces that show plain text.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Visible length, with a mention counted as the short chip it renders as. */
const visibleLength = (markdown: string) =>
  plainText(markdown).replace(/@thread:[\w-]+/g, "@chip").length;

// Tool parameters avoid transforms so BB can describe them as JSON Schema.
// `max` bounds the visible text; the raw cap leaves room for link targets.
const line = (max?: number) => {
  const text = z.string().trim().min(1);
  return max === undefined
    ? text
    : text.max(max * 4 + 2048).refine((text) => visibleLength(text) <= max, {
        message: `Keep the visible text to ${max} characters or fewer.`,
      });
};
/** One line without the closing period models add despite instructions. */
const tidy = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?<!\.)\.$/, "");

/** One recap list item, optionally with a secondary subrow. */
const genericRecapItem = (max?: number) =>
  z
    .object({
      text: line(max).describe("The item's primary text"),
      detail: line(max)
        .optional()
        .describe("Optional secondary text shown on a subrow"),
    })
    .strict();

const recapItemSchema = (max?: number) =>
  z.union([line(max), genericRecapItem(max)]);

export type RecapItem = string | { text: string; detail?: string };

type StoredRecapItem = string | { text: string; detail?: string };

export function itemParts(item: RecapItem): { text: string; detail?: string } {
  if (typeof item === "string") return { text: item };
  return {
    text: item.text,
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
  };
}

const storedRecapItemSchema: z.ZodType<StoredRecapItem> = z.union([
  z.string(),
  z.object({ text: z.string(), detail: z.string().optional() }).strict(),
]);
/** One review action, optionally with the result the user should see. */
const reviewStepSchema = recapItemSchema(160);
type ReviewStep = RecapItem;

/** A suggested action can separate its short button title from its message. */
const nextActionSchema = z.union([
  z
    .string()
    .trim()
    .min(1)
    .max(120 * 4 + 2048)
    .refine((text) => visibleLength(text) <= 120, {
      message: "Keep the visible text to 120 characters or fewer.",
    }),
  z
    .object({
      title: line(28).describe(
        "Short sentence-case button label, at most 28 characters",
      ),
      message: line(120).describe(
        "The follow-up request sent when clicked, at most 120 characters; whitespace and closing periods are normalized",
      ),
      description: line(120)
        .optional()
        .describe(
          "Optional short explanation shown on hover or in the action menu",
        ),
    })
    .strict(),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

export const linkSchema = z
  .object({
    title: line(80).describe("Review target title, at most 80 characters"),
    location: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine((value) => {
        if (value.startsWith("https://")) {
          try {
            return new URL(value).protocol === "https:";
          } catch {
            return false;
          }
        }
        return (
          value.startsWith("/") &&
          !value.startsWith("//") &&
          !/[\r\n\u0000]/.test(value)
        );
      }, "Use an absolute file path or an HTTPS URL."),
  })
  .strict();
export type RecapLink = z.infer<typeof linkSchema>;

const waitingAgentSchema = z
  .object({
    threadId: z.string().trim().min(1).max(200),
    task: line(80),
  })
  .strict();
export type WaitingAgent = z.infer<typeof waitingAgentSchema>;

/**
 * The tool's parameters. The limits keep each line glanceable: a goal
 * heading, short results, acceptance checks, and optional review targets.
 */
const recapFields = z
  .object({
    state: z.enum(RECAP_STATES),
    goal: line(80).describe(
      "Present-tense fact about this turn, -ing for waiting; at most 80 characters",
    ),
    waitingAgents: z
      .array(waitingAgentSchema)
      .max(8)
      .optional()
      .describe(
        "Waiting only: agents this thread is waiting for, each with a short task and thread ID so the card can link to that agent thread.",
      ),
    latest: z
      .array(recapItemSchema(120))
      .max(3)
      .default([])
      .describe(
        "Completed results: required for review, optional for complete (a short answer needs none). Items can be strings or { text, detail } objects with optional secondary text. At most 120 characters each.",
      ),
    timeout: z
      .number()
      .int()
      .min(1)
      .max(86400)
      .nullable()
      .optional()
      .describe(
        "Waiting only: seconds until the agent should check task status, from 1 to 86400",
      ),
    // A string is one step, or a list some harnesses send JSON-encoded.
    review: z
      .union([z.array(reviewStepSchema).max(3), z.string().trim()])
      .nullable()
      .optional()
      .describe(
        "Required for review. Send each distinct action as its own array item; separate items render as a numbered list. Items can be strings or { text, detail } objects with optional secondary text. At most 160 characters each.",
      ),
    links: z
      .array(linkSchema)
      .max(8)
      .default([])
      .describe(
        "Review state only: optional links to artifacts or pages explicitly being reviewed, as absolute file paths or HTTPS URLs.",
      ),
    next: z
      .array(nextActionSchema)
      .max(3)
      .default([])
      .describe(
        "Complete and review only: one to three future requests or questions shown as buttons, required except for a short factual answer that leaves nothing open. Name a pull request that is unopened, unmerged, or awaiting review; a result only the user can check on their own machine or display; a decision the user still owns; a step the reply names but nobody did; an optional improvement or unauthorized change the reply recommends; and for a handoff, how the destination reports back. Use { title, message, description? }: title is a short sentence-case button label of at most 28 characters, message supplies the follow-up request, and optional description holds longer context shown on hover and in the action menu. Keep button labels very short. Strings remain supported as the same short label and sent message.",
      ),
  })
  .strict();

/**
 * Stored recaps preserve the agent's full inline Markdown: rows written by a
 * session that reported through a reply block exceed the tool's text limits,
 * and reading one back must not reject it.
 */
const fullNextActionSchema = z.union([
  line(),
  nextActionSchema.options[1].extend({
    title: line(),
    message: line(),
    description: line().optional(),
  }),
]);
const fullLinkSchema = linkSchema.extend({ title: line() });
const fullWaitingAgentSchema = waitingAgentSchema.extend({ task: line() });

/**
 * The fields advertised to agents. Keep the root a concrete object: provider
 * bridges can flatten a root union into a tool with no named parameters.
 * State-specific requirements are enforced by recapInputSchema at execution.
 */
export const recapToolSchema = recapFields;

/**
 * The state-specific contract checked before accepting a recap. A review
 * recap needs at least one result alongside its steps.
 */
export const recapInputSchema = z
  .discriminatedUnion("state", [
    recapFields.extend({
      state: z.literal("complete"),
      timeout: z.null().optional(),
      waitingAgents: z.array(z.never()).max(0).default([]),
      review: z
        .union([z.array(z.never()).max(0), z.literal("")])
        .nullable()
        .optional(),
      // A short answer's goal states the answer and needs no results.
      latest: recapFields.shape.latest,
      links: z
        .array(linkSchema)
        .max(0, "Links are review targets and belong only in a review recap.")
        .default([]),
    }),
    recapFields.extend({
      state: z.literal("review"),
      timeout: z.null().optional(),
      waitingAgents: z.array(z.never()).max(0).default([]),
      latest: recapFields.shape.latest.removeDefault().min(1),
      review: z.union([
        z.array(recapItemSchema(160)).min(1).max(3),
        z.string().trim().min(1),
      ]),
    }),
    recapFields.extend({
      state: z.literal("waiting"),
      timeout: z.number().int().min(1).max(86400),
      latest: z.array(z.never()).max(0).default([]),
      next: z.array(z.never()).max(0).default([]),
      review: z
        .union([z.array(z.never()).max(0), z.literal("")])
        .nullable()
        .optional(),
      links: z
        .array(linkSchema)
        .max(0, "Links are review targets and belong only in a review recap.")
        .default([]),
    }),
  ])
  .refine(
    (recap) => {
      const steps = reviewSteps(
        recap.state === "review" ? recap.review : undefined,
      );
      return (
        steps.length <= 3 && steps.every((step) => recapItemWithin(step, 160))
      );
    },
    {
      message: "Review takes one to three steps of 160 characters or fewer.",
      path: ["review"],
    },
  );
export type RecapInput = z.infer<typeof recapInputSchema>;

/** A stored recap, tied to the turn that reported it. */
export const recapSchema = z
  .object({
    id: z.string(),
    turnId: z.string(),
    at: z.number(),
    state: z.enum(RECAP_STATES),
    goal: z.string(),
    waitingAgents: z.array(fullWaitingAgentSchema).optional(),
    latest: z.array(storedRecapItemSchema).default([]),
    timeout: z.number().optional(),
    /** Review steps; empty unless the state is review. */
    review: z.preprocess(
      (value) => storedRecapItems(value),
      z.array(storedRecapItemSchema),
    ),
    links: z.array(fullLinkSchema),
    /** Suggested next messages, offered as buttons; empty while waiting. */
    next: z.array(fullNextActionSchema).default([]),
  })
  .transform(({ waitingAgents, ...recap }) => ({
    ...recap,
    ...(waitingAgents ? { waitingAgents } : {}),
  }));
export type Recap = z.infer<typeof recapSchema>;

function storedRecapItems(value: unknown): unknown {
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Stored plain strings remain one-item lists.
  }
  return [value];
}

/** The review as steps, from a list, a single step, or a JSON-encoded list. */
function recapItemWithin(item: RecapItem, max: number): boolean {
  if (typeof item === "string") return visibleLength(item) <= max;
  const { text, detail } = itemParts(item);
  return visibleLength(text) <= max && visibleLength(detail ?? "") <= max;
}

function reviewSteps(review: string | ReviewStep[] | undefined): ReviewStep[] {
  if (review === undefined) return [];
  if (Array.isArray(review)) return review;
  if (review.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(review);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((step) => recapItemSchema(160).safeParse(step).success)
      )
        return parsed.map((step) =>
          typeof step === "string" ? step.trim() : step,
        ) as ReviewStep[];
    } catch {
      // Not JSON: a step that happens to start with a bracket.
    }
  }
  return [review];
}

export function toRecap(
  input: RecapInput,
  meta: { id: string; turnId: string; at: number },
): Recap {
  return {
    ...meta,
    state: input.state,
    goal: tidy(input.goal),
    latest: input.latest.map(tidyRecapItem),
    ...(input.state === "waiting"
      ? {
          timeout: input.timeout,
          waitingAgents: (input.waitingAgents ?? []).map((agent) => ({
            threadId: agent.threadId,
            task: tidy(agent.task),
          })),
        }
      : { waitingAgents: [] }),
    review:
      input.state === "review"
        ? reviewSteps(input.review).map(tidyRecapItem)
        : [],
    links:
      input.state === "review"
        ? input.links.map((item) => ({ ...item, title: tidy(item.title) }))
        : [],
    next:
      input.state === "waiting"
        ? []
        : input.next.map((action) =>
            typeof action === "string"
              ? tidy(action)
              : {
                  title: tidy(action.title),
                  message: tidy(action.message),
                  ...(action.description
                    ? { description: tidy(action.description) }
                    : {}),
                },
          ),
  };
}

/**
 * The recap as short Markdown: the tool call's output, which BB shows in the
 * call's timeline row so the recap stays in the thread after the card is
 * gone. The agent reads it back as the call's result.
 */
/** A recap item with optional secondary text on its own Markdown row. */
function recapItemText(item: RecapItem): string {
  if (typeof item === "string") return item;
  const { text, detail } = itemParts(item);
  return detail ? `${text}\n  - ${detail}` : text;
}

/** A review step as readable Markdown. */
const reviewStepText = recapItemText;

function tidyRecapItem(item: RecapItem): StoredRecapItem {
  if (typeof item === "string") return tidy(item);
  const { text, detail } = itemParts(item);
  return {
    text: tidy(text),
    ...(detail ? { detail: tidy(detail) } : {}),
  };
}

export function recapMarkdown(recap: Recap): string {
  const state =
    recap.state === "complete"
      ? "Complete"
      : recap.state === "waiting"
        ? "Waiting"
        : "Ready for review";
  const markdown = [
    `**${state}** · ${recap.goal}`,
    ...(recap.state === "waiting"
      ? [
          ...(recap.waitingAgents ?? []).map(
            (agent) => `- ${agent.task} · @thread:${agent.threadId}`,
          ),
          `Check status in ${recap.timeout}s`,
        ]
      : recap.latest.map((item) => `- ${recapItemText(item)}`)),
    recap.review.length === 1
      ? `\n**Review:** ${reviewStepText(recap.review[0]!)}`
      : recap.review.length
        ? `\n**Review:**\n${recap.review.map((step) => `- ${reviewStepText(step)}`).join("\n")}`
        : null,
    recap.state === "review" && recap.links.length
      ? `\n${recap.links.map((link) => `[${link.title}](${link.location})`).join(" · ")}`
      : null,
    recap.next.length
      ? `\n**Next:**\n${recap.next
          .map((action) =>
            typeof action === "string"
              ? `- ${action}`
              : `- ${action.title}: ${action.message}${action.description ? ` (${action.description})` : ""}`,
          )
          .join("\n")}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n");
  return normalizeRecapFileLinks(markdown);
}

/** The tool's description, as the agent sees it in its tool list. */
export const RECAP_TOOL_DESCRIPTION =
  "Report a finished result or an async task this thread must resume; this sets the visible card and sidebar state. Required user input belongs in the available question-card tool, not a recap or next action. Call it before you write the reply: the card comes from this call.";

/**
 * Instructions for every thread that has the recap tool. They state the
 * contract once; the tool's schema carries the limits. They are the tool's
 * registered instructions, which bb adds whenever a session has the tool and
 * rejects at registration above 4,096 characters, so the tool fails to
 * register rather than reaching agents cut short.
 */
export const RECAP_INSTRUCTIONS = `Finish authorized work, then report it with ${RECAP_TOOL} before you write the reply: the card comes from that call, so make it the turn's last tool call. The reply follows as the turn's last text, with nothing written after it. When required input or approval is missing, use the available question-card tool and wait instead, with the explanation in the reply before that card. Keep collaborating while requested work remains; an intermediate step is not completion.
State describes the responsibilities this thread owns under the user's request. Work continuing elsewhere affects this recap only while this thread owns follow-up; a route that leaves the destination owning the follow-up is complete, and its next names how the destination reports back. Use complete when all work this thread owns is finished; review for a finished result awaiting inspection, testing, merging, or shipping; waiting only for an async task whose result this thread needs to resume owned work.
Write terse sentence-case inline Markdown without closing periods. Limits count visible text, not link targets. @thread:<id> mentions render as chips; lowercase commit hashes render shortened with copy support when bare or alone in backticks, not links.
goal: purpose in past tense for complete/review, -ing for waiting, at most 80 characters; a short factual answer states the answer itself and omits latest, review, links, and next.
latest: 1–3 concrete results, most important first, about 12 words each; omit for a short answer. Advice states the recommendation itself, not an implemented change, and offers the action it proposes as Next. review: required for review state, 1–3 distinct steps to inspect or try the result and what to expect; UI steps include how to reach and exercise it. Items may be strings or { text, detail } with optional secondary detail; keep separate items, not semicolon-joined steps.
waiting: goal names the awaited task, timeout gives a realistic polling interval in seconds. The card prompts a status check at expiry if the turn is still current. Add { threadId, task } per awaited agent in waitingAgents; with several, goal names their shared outcome. Omit latest, review, links, and next.
links: review targets only, as absolute paths or HTTPS URLs; source files qualify only for requested source review.
next: required for complete and review; only a short factual answer with nothing left open omits it. Next names each thing the recap leaves open: a pull request unopened, unmerged, or awaiting review; a result only the user can check on their own machine or display; a decision they still own; a step named but not done; an optional improvement or unauthorized change you recommended; for a handoff, how the destination reports back. These are optional future requests, not blocking approval or automatic execution; an unauthorized action belongs here, not in a question card, unless the recap cannot stand without the answer. Do authorized continuations yourself. Prefer { title, message, description? }: a 2–4-word button label of at most 28 characters, the self-contained plain-text request it sends, at most 120 characters, and optional hover context of at most 120. A string is both label and request. Whitespace and closing periods are normalized. The user decides whether to archive the thread.
Advice-only example: {"state":"complete","goal":"Recommended renaming the label","latest":["Renaming matches the stored value without changing execution"],"next":[{"title":"Rename the label","message":"Rename the setting label and add a regression test"}]}.`;

/** How the agent's report of a turn reads as a status. */
export function reportedStatus(recap: Recap): {
  recap: string;
  state: WorkState;
  needsYou: null;
} {
  return {
    recap: plainText(recapItemText(recap.latest[0] ?? recap.goal)),
    state:
      recap.state === "complete"
        ? "done"
        : recap.state === "waiting"
          ? "in_progress"
          : "review",
    needsYou: null,
  };
}

/** The agent's report as Full analysis is shown it. */
export function agentReport(recap: Recap): AgentReport {
  return {
    state: recap.state,
    headline: plainText(recap.goal),
    latest: recap.latest.map((item) => plainText(recapItemText(item))),
  };
}

/**
 * A thread's work as its agent reported it, in analysis's shape: the recap's
 * state and first result over `base`, a current analysis that still supplies
 * the goal. The agent's report outranks analysis for the turn it describes.
 */
export function reportedAnalysis(
  recap: Recap,
  thread: { latestAttentionAt: number },
  base?: StoredAnalysis,
): StoredAnalysis {
  return {
    goal: base?.goal ?? null,
    model: "agent",
    traceId: null,
    ...base,
    ...reportedStatus(recap),
    reported: true,
    revision: thread.latestAttentionAt,
    at: recap.at,
  };
}

/** Where the thread's files live, for resolving a recap's file links. */
export type RecapFiles = {
  environmentId: string;
  /** The environment's directory on its host. */
  root: string | null;
  hostId: string | null;
};

/**
 * BB's file target for a recap link's absolute path: the thread's workspace
 * when the path is inside it (with the workspace-relative path BB requires),
 * else the environment's host. Null when neither is known, so the link shows
 * as plain text.
 */
export function fileTarget(
  path: string,
  files: RecapFiles | null,
):
  | { kind: "workspace"; environmentId: string; path: string }
  | { kind: "host"; hostId: string; path: string }
  | null {
  if (!files) return null;
  const root = files.root?.replace(/\/+$/, "");
  if (root && (path === root || path.startsWith(`${root}/`))) {
    const rel = path.slice(root.length).replace(/^\/+/, "");
    if (rel) {
      return {
        kind: "workspace",
        environmentId: files.environmentId,
        path: rel,
      };
    }
  }
  return files.hostId ? { kind: "host", hostId: files.hostId, path } : null;
}

/** A piece of a recap line: Markdown, or a token the card renders itself. */
type RecapSegment =
  | { kind: "markdown"; text: string }
  | { kind: "thread"; threadId: string }
  | { kind: "sha"; sha: string };

/**
 * `@thread:<id>` mentions, and commit hashes: 7–40 hex digits with at least
 * one digit and one letter, so plain numbers and hex-looking words stay text.
 */
const TOKEN =
  /@thread:([A-Za-z0-9_-]+)|(?<![\w/#.-])(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])([0-9a-f]{7,40})(?![\w/-])/g;

/**
 * Splits a recap line around thread mentions and commit hashes, which BB's
 * Markdown renders as plain text. A code span holding only a hash counts as
 * a hash; other code spans and link syntax stay whole for Markdown.
 */
export function recapSegments(text: string): RecapSegment[] {
  text = normalizeRecapFileLinks(text);
  const segments: RecapSegment[] = [];
  let markdown = "";
  let last = 0;
  const scan = (chunk: string) => {
    let at = 0;
    for (const match of chunk.matchAll(TOKEN)) {
      markdown += chunk.slice(at, match.index);
      if (markdown) segments.push({ kind: "markdown", text: markdown });
      markdown = "";
      segments.push(
        match[1]
          ? { kind: "thread", threadId: match[1] }
          : { kind: "sha", sha: match[2]! },
      );
      at = match.index + match[0].length;
    }
    markdown += chunk.slice(at);
  };
  for (const span of recapMarkdownSpans(text)) {
    scan(text.slice(last, span.index));
    const sha = /^`\s*([0-9a-f]{7,40})\s*`$/.exec(span.text)?.[1];
    if (sha && /[0-9]/.test(sha) && /[a-f]/.test(sha)) {
      if (markdown) segments.push({ kind: "markdown", text: markdown });
      markdown = "";
      segments.push({ kind: "sha", sha });
    } else markdown += span.text;
    last = span.index + span.text.length;
  }
  scan(text.slice(last));
  if (markdown) segments.push({ kind: "markdown", text: markdown });
  return segments;
}
