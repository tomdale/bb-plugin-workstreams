/*
 * Information the agent can place among a reply's Markdown paragraphs. These
 * values describe reported information and results, not executable UI or
 * verified host facts. The same schemas govern rendering, examples, and
 * plain-text output.
 */
import { z } from "zod";

export const COMPONENT_FENCE = "workstreams";
/** A fence's info string names components regardless of case or a missing plural "s". */
export const isComponentFence = (lang: string | null | undefined): boolean =>
  /^workstreams?$/i.test(lang ?? "");
const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Use nonempty text.");
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(32);

function relativeEscapesWorkspace(path: string): boolean {
  let depth = 0;
  for (const part of path.split("/")) {
    if (part === "..") {
      if (--depth < 0) return true;
    } else if (part && part !== ".") depth++;
  }
  return false;
}

export const evidenceSchema = z
  .object({
    label: text,
    detail: text.optional(),
    location: text
      .refine((value) => {
        if (/[\u0000-\u001f]/.test(value) || value.startsWith("//"))
          return false;
        try {
          encodeURIComponent(value);
        } catch {
          return false;
        }
        if (value.startsWith("https://")) {
          try {
            return new URL(value).protocol === "https:";
          } catch {
            return false;
          }
        }
        return (
          !/^[a-z][\w+.-]*:/i.test(value) &&
          (value.startsWith("/") || !relativeEscapesWorkspace(value))
        );
      }, "Use HTTPS or a file path; relative paths stay in the workspace.")
      .optional(),
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    threadId: z
      .string()
      .regex(/^thr_[a-zA-Z0-9_-]+$/)
      .max(200)
      .optional(),
  })
  .strict()
  .refine(
    (item) =>
      (!item.endLine ||
        (item.line !== undefined && item.endLine >= item.line)) &&
      (!item.line ||
        (item.location !== undefined && !item.location.startsWith("https://"))),
    {
      message: "Line references need a file location and an ordered range.",
      path: ["line"],
    },
  )
  .refine((item) => !item.threadId || !item.location, {
    message: "Use a threadId or a location, not both.",
    path: ["threadId"],
  });
export type ReplyEvidence = z.infer<typeof evidenceSchema>;

const context = z
  .object({
    type: z.literal("context"),
    topic: text,
    where: text.optional(),
    background: text.optional(),
  })
  .strict();
const prose = z.object({ type: z.literal("text"), body: text }).strict();
const comparison = z
  .object({
    type: z.literal("comparison"),
    title: text,
    items: z
      .array(
        z
          .object({
            name: text,
            summary: text,
            detail: text.optional(),
            qualification: text.optional(),
            recommended: z.boolean().optional(),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();
const sequence = z
  .object({
    type: z.literal("sequence"),
    title: text,
    steps: list(
      z
        .object({
          title: text,
          detail: text.optional(),
          attention: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const change = z
  .object({
    type: z.literal("change"),
    title: text,
    before: text,
    after: text,
    unchanged: text.optional(),
    limitation: text.optional(),
  })
  .strict();
const checks = z
  .object({
    type: z.literal("checks"),
    title: text,
    scope: text,
    testTotals: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    items: list(
      z
        .object({
          name: text,
          status: z.enum([
            "passed",
            "failed",
            "skipped",
            "blocked",
            "untested",
          ]),
          detail: text.optional(),
          evidence: list(evidenceSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();
const delivery = z
  .object({
    type: z.literal("delivery"),
    title: text,
    scope: text,
    stages: list(
      z
        .object({
          name: text,
          status: z.enum([
            "done",
            "pending",
            "blocked",
            "not-started",
            "unknown",
          ]),
          detail: text.optional(),
          evidence: list(evidenceSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();
const recommendation = z
  .object({
    type: z.literal("recommendation"),
    choice: text,
    reason: text,
    qualification: text.optional(),
  })
  .strict();
const details = z
  .object({ type: z.literal("details"), title: text, body: text })
  .strict();

const table = z
  .object({
    type: z.literal("table"),
    title: text,
    scope: text.optional(),
    columns: z.array(text).min(1).max(12),
    rows: z.array(z.array(z.string()).max(12)).max(256),
  })
  .strict()
  .refine(
    (value) => value.rows.every((row) => row.length === value.columns.length),
    {
      message: "Each table row must have one cell per column.",
      path: ["rows"],
    },
  );
const references = z
  .object({
    type: z.literal("references"),
    title: text,
    items: z.array(evidenceSchema).min(1).max(256),
  })
  .strict();
export const reviewStepSchema = z
  .object({
    title: text,
    detail: text.optional(),
    requires: text.optional(),
    expected: text.optional(),
  })
  .strict();
const review = z
  .object({
    type: z.literal("review"),
    title: text,
    scope: text.optional(),
    steps: z.array(reviewStepSchema).min(1).max(256),
  })
  .strict();
export const replyActionSchema = z
  .object({
    title: text,
    detail: text.optional(),
    owner: text.optional(),
    condition: text.optional(),
    permission: text.optional(),
    message: text.optional(),
    recommended: z.boolean().optional(),
  })
  .strict();
const actions = z
  .object({
    type: z.literal("actions"),
    title: text,
    scope: text.optional(),
    items: z.array(replyActionSchema).min(1).max(256),
  })
  .strict();

/** Each component's schema by call name; the catalog, parser, and examples read this table. */
export const leafSchemas = {
  context,
  text: prose,
  comparison,
  sequence,
  change,
  checks,
  delivery,
  recommendation,
  details,
  table,
  references,
  review,
  actions,
} as const;
const replyLeafSchema = z.discriminatedUnion("type", [
  context,
  prose,
  comparison,
  sequence,
  change,
  checks,
  delivery,
  recommendation,
  details,
  table,
  references,
  review,
  actions,
]);
export const groupSchema = z
  .object({
    type: z.literal("group"),
    relationship: z.enum(["peers", "supporting"]),
    children: z
      .array(z.union([replyLeafSchema, z.array(replyLeafSchema).min(1).max(8)]))
      .min(2)
      .max(8),
  })
  .strict()
  .refine(
    (group) => group.children.flat().length <= 8,
    "A group contains at most eight components.",
  );
export const replyComponentSchema = z.union([replyLeafSchema, groupSchema]);
export type ReplyLeaf = z.infer<typeof replyLeafSchema>;
export type ReplyComponent = z.infer<typeof replyComponentSchema>;
export const replyPartSchema = z.union([
  replyComponentSchema,
  z.object({ type: z.literal("directive"), source: z.string() }).strict(),
  z
    .object({ type: z.literal("unparsed"), source: z.string(), error: text })
    .strict(),
  z.object({ type: z.literal("pending") }).strict(),
]);
export type ReplyPart = z.infer<typeof replyPartSchema>;

function encodedFilePath(path: string): string | null {
  try {
    return path.split("/").map(encodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** Resolve literal file paths; only explicit absolute locations can select host files outside the workspace. */
export function evidenceFilePath(
  location: string,
  root: string | null,
): string | null {
  if (
    /[\u0000-\u001f]/.test(location) ||
    location.startsWith("//") ||
    /^[a-z][\w+.-]*:/i.test(location)
  )
    return null;
  const absolute = location.startsWith("/")
    ? location
    : root !== null
      ? `${root.replace(/\/+$/, "")}/${location}`
      : null;
  const encoded = absolute ? encodedFilePath(absolute) : null;
  if (!encoded || !encoded.startsWith("/")) return null;
  try {
    const resolved = decodeURIComponent(new URL(`file://${encoded}`).pathname);
    if (!location.startsWith("/")) {
      const base = root === null ? null : evidenceFilePath(root, null);
      if (
        !base ||
        (resolved !== base &&
          !resolved.startsWith(`${base.replace(/\/$/, "")}/`))
      )
        return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

/** Link labels and literal filename characters cannot change a Markdown target. */
export function evidenceMarkdown(item: ReplyEvidence): string {
  const label = item.label.replace(/[\\\[\]`*_~]/g, "\\$&");
  if (item.threadId) return `${label} (@thread:${item.threadId})`;
  if (!item.location) return label;
  const web = item.location.startsWith("https://");
  const target = web
    ? item.location.replace(/</g, "%3C").replace(/>/g, "%3E")
    : encodedFilePath(item.location);
  const range =
    !web && item.line
      ? `#L${item.line}${item.endLine ? `-L${item.endLine}` : ""}`
      : "";
  return target ? `[${label}](<${target}${range}>)` : label;
}

function evidenceText(items: ReplyEvidence[] | undefined): string {
  return (items ?? [])
    .map(
      (item) =>
        `- ${evidenceMarkdown(item)}${item.detail ? `: ${item.detail}` : ""}`,
    )
    .join("\n");
}

/** Every claim, qualification, and piece of evidence survives the text view. */
export function componentText(part: ReplyPart): string {
  switch (part.type) {
    case "text":
      return part.body;
    case "directive":
      return part.source;
    case "pending":
      return "";
    case "unparsed":
      return `${part.error}\n\n${part.source}`;
    case "context":
      return [part.topic, part.where, part.background]
        .filter(Boolean)
        .join(" · ");
    case "comparison":
      return [
        `### ${part.title}`,
        ...part.items.map((item) =>
          [
            `**${item.name}${item.recommended ? " (recommended)" : ""}**`,
            item.summary,
            item.qualification,
            item.detail,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      ].join("\n\n");
    case "sequence":
      return `### ${part.title}\n\n${part.steps.map((step, i) => `${i + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ""}`).join("\n")}`;
    case "change":
      return [
        `### ${part.title}`,
        `Before: ${part.before}`,
        `After: ${part.after}`,
        part.unchanged && `Unchanged: ${part.unchanged}`,
        part.limitation && `Limitation: ${part.limitation}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "checks":
      return [
        `### ${part.title}`,
        part.scope,
        ...(part.testTotals
          ? [
              `${part.testTotals.passed} tests passed; ${part.testTotals.failed} failed; ${part.testTotals.skipped} skipped`,
            ]
          : []),
        ...part.items.map(
          (item) =>
            `- ${item.name}: ${item.status}${item.detail ? ` — ${item.detail}` : ""}${item.evidence ? `\n${evidenceText(item.evidence)}` : ""}`,
        ),
      ].join("\n\n");
    case "delivery":
      return [
        `### ${part.title}`,
        part.scope,
        ...part.stages.map(
          (stage) =>
            `- ${stage.name}: ${stage.status}${stage.detail ? ` — ${stage.detail}` : ""}${stage.evidence ? `\n${evidenceText(stage.evidence)}` : ""}`,
        ),
      ].join("\n\n");
    case "recommendation":
      return [part.choice, part.reason, part.qualification]
        .filter(Boolean)
        .join("\n\n");
    case "details":
      return `### ${part.title}\n\n${part.body}`;
    case "table": {
      const cell = (value: string) =>
        value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      return [
        `### ${part.title}`,
        part.scope,
        `| ${part.columns.map(cell).join(" | ")} |\n| ${part.columns.map(() => "---").join(" | ")} |\n${part.rows.map((row) => `| ${row.map(cell).join(" | ")} |`).join("\n")}`,
        part.rows.length ? undefined : "No rows.",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "references":
      return `### ${part.title}\n\n${evidenceText(part.items)}`;
    case "review":
      return [
        `### ${part.title}`,
        part.scope,
        ...part.steps.map((step, i) =>
          [
            `${i + 1}. ${step.title}`,
            step.detail,
            step.requires && `Requires: ${step.requires}`,
            step.expected && `Expected: ${step.expected}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "actions":
      return [
        `### ${part.title}`,
        part.scope,
        ...part.items.map((item) =>
          [
            `${item.recommended ? "Recommended: " : ""}${item.title}`,
            item.detail,
            item.owner && `Owner: ${item.owner}`,
            item.condition && `When: ${item.condition}`,
            item.permission && `Permission: ${item.permission}`,
            item.message && `Request: ${item.message}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "group":
      return part.children.flat().map(componentText).join("\n\n");
  }
}
