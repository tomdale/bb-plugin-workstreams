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

const prose = z.object({ type: z.literal("text"), body: text }).strict();
const actions = z
  .object({
    type: z.literal("actions"),
    title: text.optional(),
    items: z
      .array(
        z
          .object({
            action: text,
            detail: text.optional(),
            decide: z.boolean().optional(),
            caution: text.optional(),
            copy: text.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
const facts = z
  .object({
    type: z.literal("facts"),
    items: z
      .array(
        z.object({ label: text, value: text, note: text.optional() }).strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export const TABLE_TONES = ["good", "attention", "bad"] as const;
const table = z
  .object({
    type: z.literal("table"),
    title: text,
    columns: z.array(text).min(1).max(5),
    rows: list(
      z
        .object({
          cells: z.array(z.string()).min(1).max(5),
          state: text.optional(),
          tone: z.enum(TABLE_TONES).optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (part) =>
      part.rows.every((row) => row.cells.length === part.columns.length),
    { message: "Every row has one cell per column.", path: ["rows"] },
  );
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
          detail: text.optional(),
          evidence: list(evidenceSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();
const details = z
  .object({ type: z.literal("details"), title: text, body: text })
  .strict();

/**
 * Each component's schema by call name, in the order the agent guide lists
 * them; the catalog, parser, and examples read this table.
 */
export const leafSchemas = {
  text: prose,
  actions,
  checks,
  delivery,
  change,
  facts,
  table,
  details,
} as const;
export const replyComponentSchema = z.discriminatedUnion("type", [
  prose,
  actions,
  checks,
  delivery,
  change,
  facts,
  table,
  details,
]);
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

const cell = (value: string) =>
  value.replace(/\|/g, "\\|").replace(/\n+/g, " ") || " ";
const code = (value: string) => {
  const longest = Math.max(
    0,
    ...[...value.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return longest ? `${fence} ${value} ${fence}` : `${fence}${value}${fence}`;
};

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
    case "actions":
      return [
        `### ${part.title ?? "Needs you"}`,
        part.items
          .map((item, i) =>
            [
              `${i + 1}. ${item.decide ? "Decide: " : ""}**${item.action}**${item.detail ? ` — ${item.detail}` : ""}`,
              item.caution && `   ⚠ ${item.caution}`,
              item.copy && `   ${code(item.copy)}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n"),
      ].join("\n\n");
    case "facts":
      return part.items
        .map(
          (item) =>
            `- ${item.label}: ${code(item.value)}${item.note ? ` — ${item.note}` : ""}`,
        )
        .join("\n");
    case "table": {
      const states = part.rows.some((row) => row.state);
      const columns = states ? [...part.columns, "State"] : part.columns;
      return [
        `### ${part.title}`,
        [
          `| ${columns.map(cell).join(" | ")} |`,
          `| ${columns.map(() => "---").join(" | ")} |`,
          ...part.rows.map(
            (row) =>
              `| ${[...row.cells, ...(states ? [row.state ?? ""] : [])].map(cell).join(" | ")} |`,
          ),
        ].join("\n"),
      ].join("\n\n");
    }
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
        part.items
          .map(
            (item) =>
              `- ${item.name}: ${item.status}${item.detail ? ` — ${item.detail}` : ""}${item.evidence ? `\n${evidenceText(item.evidence)}` : ""}`,
          )
          .join("\n"),
      ].join("\n\n");
    case "delivery":
      return [
        `### ${part.title}`,
        part.scope,
        part.stages
          .map(
            (stage) =>
              `- ${stage.name}: ${stage.status}${stage.detail ? ` — ${stage.detail}` : ""}${stage.evidence ? `\n${evidenceText(stage.evidence)}` : ""}`,
          )
          .join("\n"),
      ].join("\n\n");
    case "details":
      return `### ${part.title}\n\n${part.body}`;
  }
}
