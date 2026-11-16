/**
 * The enhanced response document: typed data a presentation model composes
 * after a turn ends, which Workstreams validates and draws below the original
 * response. It is data only. Every string renders as text, so a document
 * cannot carry markup, styles, scripts, links that run commands, or event
 * handlers; unknown fields are rejected rather than ignored.
 *
 * The same validator runs on every preview candidate and again on the final
 * document before it is stored. `documentText` is the document's complete
 * text form: Copy writes it, and the preview tool returns it so the model can
 * check that nothing it wrote is hidden from a reader of the text.
 */
import { z } from "zod";

export const DOCUMENT_VERSION = 1;

/** Bounds on one document, checked before rendering anything. */
export const DOCUMENT_LIMITS = {
  /** Serialized JSON size, in characters. */
  chars: 24_000,
  /** Blocks counted at every depth. */
  blocks: 40,
  /** A section may hold one more level of sections, no deeper. */
  sectionDepth: 2,
  /** Characters in one paragraph, note, list item, or callout body. */
  text: 1_500,
  /** Characters in a title, label, check name, or column heading. */
  title: 200,
  /** Characters in one table cell. */
  cell: 300,
  /** Spans in one rich-text value. */
  spans: 40,
  listItems: 20,
  checks: 24,
  columns: 6,
  rows: 30,
} as const;

/** A literal code span: drawn in the code face, copied inside backticks. */
const codeSpan = z.strictObject({ code: z.string().min(1) });

/**
 * Text with optional code spans. A plain string is literal text: backticks,
 * asterisks, and angle brackets render as typed.
 */
const richText = z.union([
  z.string(),
  z.array(z.union([z.string(), codeSpan])).min(1),
]);
export type RichText = z.infer<typeof richText>;

export const CHECK_RESULTS = [
  "passed",
  "failed",
  "skipped",
  "blocked",
  "untested",
] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

const count = z.number().int().min(0).max(10_000_000);

const checkItem = z.strictObject({
  name: richText,
  result: z.enum(CHECK_RESULTS),
  detail: richText.optional(),
  /** Counts a test run reported; only the counts it reported. */
  totals: z
    .strictObject({
      passed: count.optional(),
      failed: count.optional(),
      skipped: count.optional(),
    })
    .optional(),
});
export type CheckItem = z.infer<typeof checkItem>;

const cell = z.union([richText, z.number().finite()]);

type BlockShape =
  | { type: "paragraph"; text: RichText }
  | { type: "list"; ordered?: boolean; items: RichText[] }
  | { type: "note"; text: RichText }
  | { type: "callout"; label?: RichText; title: RichText; text?: RichText }
  | {
      type: "checks";
      title?: RichText;
      scope?: RichText;
      items: CheckItem[];
    }
  | {
      type: "table";
      title?: RichText;
      caption?: RichText;
      columns: RichText[];
      rows: (RichText | number)[][];
    }
  | { type: "section"; title: RichText; blocks: BlockShape[] };

const block: z.ZodType<BlockShape> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("paragraph"), text: richText }),
    z.strictObject({
      type: z.literal("list"),
      ordered: z.boolean().optional(),
      items: z.array(richText).min(1),
    }),
    z.strictObject({ type: z.literal("note"), text: richText }),
    z.strictObject({
      type: z.literal("callout"),
      label: richText.optional(),
      title: richText,
      text: richText.optional(),
    }),
    z.strictObject({
      type: z.literal("checks"),
      title: richText.optional(),
      scope: richText.optional(),
      items: z.array(checkItem).min(1),
    }),
    z.strictObject({
      type: z.literal("table"),
      title: richText.optional(),
      caption: richText.optional(),
      columns: z.array(richText).min(1),
      rows: z.array(z.array(cell)),
    }),
    z.strictObject({
      type: z.literal("section"),
      title: richText,
      blocks: z.array(block).min(1),
    }),
  ]),
);
export type Block = BlockShape;

const documentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  blocks: z.array(block).min(1),
});
export type EnhancedDocument = { version: 1; blocks: Block[] };

/** One problem with a candidate, at a field path such as `blocks[2].items[0].totals`. */
export type DocumentIssue = { path: string; message: string };

export type DocumentValidation =
  | { ok: true; document: EnhancedDocument }
  | { ok: false; issues: DocumentIssue[] };

/** Issues past this many are summarized, so a broken candidate stays readable. */
const MAX_ISSUES = 20;

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out || "(document)";
}

/**
 * Tags that a reader would mistake for markup Workstreams renders. Text stays
 * literal either way; the issue tells the model to put markup in a code span.
 */
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;
// Control characters other than tab and newline.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function spansOf(text: RichText): (string | { code: string })[] {
  return typeof text === "string" ? [text] : text;
}

/** The text a rich-text value shows, without code-span marks. */
export function plainText(text: RichText): string {
  return spansOf(text)
    .map((span) => (typeof span === "string" ? span : span.code))
    .join("");
}

/** Validates an untrusted candidate: shape, bounds, then content rules. */
export function validateDocument(candidate: unknown): DocumentValidation {
  const issues: DocumentIssue[] = [];
  const add = (path: string, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ path, message });
  };
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    // Cyclic or otherwise unserializable values cannot have come from JSON.
  }
  if (serialized === undefined)
    return {
      ok: false,
      issues: [{ path: "(document)", message: "Not a JSON value." }],
    };
  if (serialized.length > DOCUMENT_LIMITS.chars)
    return {
      ok: false,
      issues: [
        {
          path: "(document)",
          message: `The document is ${serialized.length.toLocaleString("en-US")} characters as JSON; the limit is ${DOCUMENT_LIMITS.chars.toLocaleString("en-US")}. Shorten it.`,
        },
      ],
    };
  const parsed = documentSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      add(formatPath(issue.path), issue.message);
    return { ok: false, issues };
  }
  const document = parsed.data as EnhancedDocument;
  let blocks = 0;
  const text = (value: RichText, path: string, limit: number) => {
    const spans = spansOf(value);
    if (spans.length > DOCUMENT_LIMITS.spans)
      add(path, `Use at most ${DOCUMENT_LIMITS.spans} spans.`);
    const shown = plainText(value);
    if (!shown.trim()) add(path, "Text is empty.");
    if (shown.length > limit)
      add(path, `Text is ${shown.length} characters; the limit is ${limit}.`);
    if (CONTROL.test(shown)) add(path, "Text contains control characters.");
    spans.forEach((span, i) => {
      if (typeof span !== "string") return;
      if (HTML_TAG.test(span))
        add(
          typeof value === "string" ? path : `${path}[${i}]`,
          "HTML is not rendered. Put literal markup in a code span.",
        );
    });
  };
  const optional = (
    value: RichText | undefined,
    path: string,
    limit: number,
  ) => {
    if (value !== undefined) text(value, path, limit);
  };
  const visit = (list: readonly Block[], path: string, depth: number) => {
    list.forEach((item, i) => {
      const at = `${path}[${i}]`;
      blocks++;
      switch (item.type) {
        case "paragraph":
        case "note":
          text(item.text, `${at}.text`, DOCUMENT_LIMITS.text);
          break;
        case "list":
          if (item.items.length > DOCUMENT_LIMITS.listItems)
            add(
              `${at}.items`,
              `Use at most ${DOCUMENT_LIMITS.listItems} items.`,
            );
          item.items.forEach((entry, j) =>
            text(entry, `${at}.items[${j}]`, DOCUMENT_LIMITS.text),
          );
          break;
        case "callout":
          optional(item.label, `${at}.label`, DOCUMENT_LIMITS.title);
          text(item.title, `${at}.title`, DOCUMENT_LIMITS.title);
          optional(item.text, `${at}.text`, DOCUMENT_LIMITS.text);
          break;
        case "checks":
          optional(item.title, `${at}.title`, DOCUMENT_LIMITS.title);
          optional(item.scope, `${at}.scope`, DOCUMENT_LIMITS.title);
          if (item.items.length > DOCUMENT_LIMITS.checks)
            add(`${at}.items`, `Use at most ${DOCUMENT_LIMITS.checks} checks.`);
          item.items.forEach((check, j) => {
            const where = `${at}.items[${j}]`;
            text(check.name, `${where}.name`, DOCUMENT_LIMITS.title);
            optional(check.detail, `${where}.detail`, DOCUMENT_LIMITS.text);
            const totals = check.totals;
            if (!totals) return;
            const reported = [totals.passed, totals.failed, totals.skipped];
            if (reported.every((n) => n === undefined))
              add(
                `${where}.totals`,
                "Report at least one count, or omit totals.",
              );
            if (check.result === "passed" && (totals.failed ?? 0) > 0)
              add(
                `${where}.result`,
                `A check that reports ${totals.failed} failed tests did not pass.`,
              );
          });
          break;
        case "table":
          optional(item.title, `${at}.title`, DOCUMENT_LIMITS.title);
          optional(item.caption, `${at}.caption`, DOCUMENT_LIMITS.text);
          if (item.columns.length > DOCUMENT_LIMITS.columns)
            add(
              `${at}.columns`,
              `Use at most ${DOCUMENT_LIMITS.columns} columns.`,
            );
          item.columns.forEach((column, j) =>
            text(column, `${at}.columns[${j}]`, DOCUMENT_LIMITS.title),
          );
          if (item.rows.length > DOCUMENT_LIMITS.rows)
            add(`${at}.rows`, `Use at most ${DOCUMENT_LIMITS.rows} rows.`);
          item.rows.forEach((row, j) => {
            if (row.length !== item.columns.length)
              add(
                `${at}.rows[${j}]`,
                `Row has ${row.length} cells; the table has ${item.columns.length} columns.`,
              );
            row.forEach((value, k) => {
              if (typeof value !== "number")
                text(value, `${at}.rows[${j}][${k}]`, DOCUMENT_LIMITS.cell);
            });
          });
          break;
        case "section":
          text(item.title, `${at}.title`, DOCUMENT_LIMITS.title);
          if (depth >= DOCUMENT_LIMITS.sectionDepth)
            add(
              `${at}`,
              `Sections nest at most ${DOCUMENT_LIMITS.sectionDepth} deep.`,
            );
          else visit(item.blocks, `${at}.blocks`, depth + 1);
          break;
      }
    });
  };
  visit(document.blocks, "blocks", 0);
  if (blocks > DOCUMENT_LIMITS.blocks)
    add("blocks", `Use at most ${DOCUMENT_LIMITS.blocks} blocks in all.`);
  return issues.length ? { ok: false, issues } : { ok: true, document };
}

/** The first few issues as one line, for a log or a failure reason. */
export function summarizeIssues(issues: readonly DocumentIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");
}

/** Serializes with sorted keys, so two equal documents compare equal. */
export function canonicalDocument(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, sort((input as Record<string, unknown>)[key])]),
      );
    return input;
  };
  return JSON.stringify(sort(value));
}

/** How many checks reported each result, in a fixed order. */
export function checkCounts(
  items: readonly CheckItem[],
): Partial<Record<CheckResult, number>> {
  const counts: Partial<Record<CheckResult, number>> = {};
  for (const item of items)
    counts[item.result] = (counts[item.result] ?? 0) + 1;
  return counts;
}

/** Test totals summed across checks; only counts some check reported. */
export function testTotals(items: readonly CheckItem[]): {
  passed?: number;
  failed?: number;
  skipped?: number;
} {
  const totals: { passed?: number; failed?: number; skipped?: number } = {};
  for (const item of items)
    for (const key of ["passed", "failed", "skipped"] as const) {
      const value = item.totals?.[key];
      if (value !== undefined) totals[key] = (totals[key] ?? 0) + value;
    }
  return totals;
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const spelled = (n: number) => NUMBER_WORDS[n] ?? n.toLocaleString("en-US");

/**
 * The line a checks block shows while its rows are folded: what passed and
 * what did not, from the typed results, so a folded block never reads as a
 * clean pass when a row failed or was skipped.
 */
export function checksSummary(
  items: readonly CheckItem[],
  qualifier?: string | null,
): string {
  const counts = checkCounts(items);
  const total = items.length;
  const noun = `${qualifier ? `${qualifier} ` : ""}${total === 1 ? "check" : "checks"}`;
  if (counts.passed === total)
    return total === 1
      ? "The check passed"
      : `All ${spelled(total)} ${noun} passed`;
  const parts = CHECK_RESULTS.filter((result) => counts[result]).map(
    (result) => `${counts[result]!.toLocaleString("en-US")} ${result}`,
  );
  return `${total.toLocaleString("en-US")} ${noun}: ${parts.join(", ")}`;
}

/**
 * A short scope ("local", "CI") that reads as part of the folded line; a
 * longer one is shown on its own line instead.
 */
export function scopeQualifier(scope: RichText | undefined): string | null {
  if (!scope) return null;
  const words = plainText(scope).trim().split(/\s+/);
  return words.length <= 2 ? words.join(" ") : null;
}

/** Counts that a folded checks block must still show: skipped and failed tests. */
export function foldedTotals(items: readonly CheckItem[]): string | null {
  const totals = testTotals(items);
  const parts: string[] = [];
  if (totals.failed)
    parts.push(
      `${totals.failed.toLocaleString("en-US")} ${totals.failed === 1 ? "test" : "tests"} failed`,
    );
  if (totals.skipped)
    parts.push(
      `${totals.skipped.toLocaleString("en-US")} ${totals.skipped === 1 ? "test" : "tests"} skipped`,
    );
  return parts.length ? parts.join(", ") : null;
}

function richMarkdown(text: RichText): string {
  return spansOf(text)
    .map((span) =>
      typeof span === "string"
        ? span
        : span.code.includes("`")
          ? `\`\` ${span.code} \`\``
          : `\`${span.code}\``,
    )
    .join("");
}

const cellText = (value: RichText | number) =>
  typeof value === "number"
    ? value.toLocaleString("en-US")
    : richMarkdown(value).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Reported test counts as one line, such as "2,104 passed, 0 failed, 1 skipped". */
export function totalsText(totals: NonNullable<CheckItem["totals"]>): string {
  return (["passed", "failed", "skipped"] as const)
    .filter((key) => totals[key] !== undefined)
    .map((key) => `${totals[key]!.toLocaleString("en-US")} ${key}`)
    .join(", ");
}

/**
 * The document's complete text form, as Markdown. Every block appears in
 * full, folded check rows included, so Copy and the preview's text never
 * depend on what the rendered view has open.
 */
export function documentText(
  document: EnhancedDocument,
  heading?: string | null,
): string {
  const out: string[] = [];
  if (heading) out.push(heading);
  const visit = (list: readonly Block[], depth: number) => {
    for (const item of list) {
      switch (item.type) {
        case "paragraph":
          out.push(richMarkdown(item.text));
          break;
        case "note":
          out.push(`Note: ${richMarkdown(item.text)}`);
          break;
        case "list":
          out.push(
            item.items
              .map(
                (entry, i) =>
                  `${item.ordered ? `${i + 1}.` : "-"} ${richMarkdown(entry)}`,
              )
              .join("\n"),
          );
          break;
        case "callout":
          out.push(
            [
              item.label
                ? `${richMarkdown(item.label)}: ${richMarkdown(item.title)}`
                : richMarkdown(item.title),
              item.text ? richMarkdown(item.text) : null,
            ]
              .filter(Boolean)
              .join("\n"),
          );
          break;
        case "checks": {
          const qualifier = scopeQualifier(item.scope);
          const lines = [
            `${item.title ? richMarkdown(item.title) : checksSummary(item.items, qualifier)}${
              item.scope && !qualifier ? ` (${richMarkdown(item.scope)})` : ""
            }:`,
          ];
          for (const check of item.items) {
            const totals = check.totals ? ` (${totalsText(check.totals)})` : "";
            lines.push(
              `- ${richMarkdown(check.name)}: ${check.result}${totals}${
                check.detail ? `. ${richMarkdown(check.detail)}` : ""
              }`,
            );
          }
          out.push(lines.join("\n"));
          break;
        }
        case "table": {
          const lines: string[] = [];
          if (item.title) lines.push(richMarkdown(item.title), "");
          lines.push(`| ${item.columns.map(cellText).join(" | ")} |`);
          lines.push(`| ${item.columns.map(() => "---").join(" | ")} |`);
          for (const row of item.rows)
            lines.push(`| ${row.map(cellText).join(" | ")} |`);
          if (item.caption) lines.push("", richMarkdown(item.caption));
          out.push(lines.join("\n"));
          break;
        }
        case "section":
          out.push(
            `${"#".repeat(Math.min(depth + 2, 4))} ${richMarkdown(item.title)}`,
          );
          visit(item.blocks, depth + 1);
          break;
      }
    }
  };
  visit(document.blocks, 0);
  return out.join("\n\n");
}

/**
 * The JSON Schema of a document, for a tool definition. The validator stays
 * the authority: the schema guides the model, and the bounds and content
 * rules above still apply to whatever it sends.
 */
export function documentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(documentSchema, { unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
}
