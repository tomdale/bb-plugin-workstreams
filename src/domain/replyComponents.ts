/*
 * Information the agent can place among a reply's Markdown paragraphs. These
 * values describe findings and results, not executable UI or verified host
 * facts. The same schemas govern rendering, examples, and plain-text output.
 */
import { z } from "zod";

export const COMPONENT_FENCE = "workstreams";
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
    line: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
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
  );
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
const finding = z
  .object({
    type: z.literal("finding"),
    title: text,
    explanation: text,
    certainty: z.enum(["observed", "inferred", "unknown"]),
    consequence: text.optional(),
    evidence: list(evidenceSchema).optional(),
  })
  .strict();
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
          status: z.enum(["done", "pending", "blocked", "unknown"]),
          detail: text,
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

export const replyLeafSchema = z.discriminatedUnion("type", [
  context,
  prose,
  finding,
  comparison,
  sequence,
  change,
  checks,
  delivery,
  recommendation,
  details,
]);
export const replyComponentSchema = z.union([
  replyLeafSchema,
  z
    .object({
      type: z.literal("group"),
      relationship: z.enum(["peers", "supporting"]),
      children: z.array(replyLeafSchema).min(2).max(8),
    })
    .strict(),
]);
export type ReplyLeaf = z.infer<typeof replyLeafSchema>;
export type ReplyComponent = z.infer<typeof replyComponentSchema>;
export const replyPartSchema = z.union([
  replyComponentSchema,
  z
    .object({ type: z.literal("unparsed"), source: z.string(), error: text })
    .strict(),
  z.object({ type: z.literal("pending") }).strict(),
]);
export type ReplyPart = z.infer<typeof replyPartSchema>;

export const REPLY_KINDS = [
  "answer",
  "investigation",
  "change",
  "recommendation",
  "proposal",
  "status",
  "handoff",
] as const;

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
    case "pending":
      return "";
    case "unparsed":
      return `${part.error}\n\n${part.source}`;
    case "context":
      return [part.topic, part.where, part.background]
        .filter(Boolean)
        .join(" · ");
    case "finding":
      return [
        `### ${part.title}`,
        `Evidence: ${part.certainty}`,
        part.explanation,
        part.consequence,
        evidenceText(part.evidence),
      ]
        .filter(Boolean)
        .join("\n\n");
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
            `- ${stage.name}: ${stage.status} — ${stage.detail}${stage.evidence ? `\n${evidenceText(stage.evidence)}` : ""}`,
        ),
      ].join("\n\n");
    case "recommendation":
      return [part.choice, part.reason, part.qualification]
        .filter(Boolean)
        .join("\n\n");
    case "details":
      return `### ${part.title}\n\n${part.body}`;
    case "group":
      return part.children.map(componentText).join("\n\n");
  }
}
