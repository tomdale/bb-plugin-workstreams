/*
 * The reply panel's derived values: the order its pieces are drawn in and the
 * counts its headings and tiles show. Both the renderer and the plain-text
 * view read them, so a count on screen is always a count of the reply's own
 * rows and a degraded reply leads with the same action the panel does.
 */
import type { ReplyComponent, ReplyPart } from "./replyComponents.ts";

type Of<T extends ReplyComponent["type"]> = Extract<
  ReplyComponent,
  { type: T }
>;

/**
 * Lead text first, then every actions piece wherever it was written, then the
 * rest in written order, then every details fold. The lead is the text that
 * comes before the first other part.
 */
export function arrangeBody(body: readonly ReplyPart[]): ReplyPart[] {
  const lead: ReplyPart[] = [];
  let i = 0;
  while (i < body.length && body[i]!.type === "text") lead.push(body[i++]!);
  const rest = body.slice(i);
  return [
    ...lead,
    ...rest.filter((part) => part.type === "actions"),
    ...rest.filter(
      (part) => part.type !== "actions" && part.type !== "details",
    ),
    ...rest.filter((part) => part.type === "details"),
  ];
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** "3 steps", "1 decision", or "2 steps, 1 decision". */
export function actionsCount(part: Of<"actions">): string {
  const decisions = part.items.filter((item) => item.decide).length;
  const steps = part.items.length - decisions;
  return [
    steps ? plural(steps, "step") : null,
    decisions ? plural(decisions, "decision") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export type CheckTone = "good" | "bad" | "neutral";
export type Tile = { value: string; label: string; tone: CheckTone };

/**
 * The checks' tiles: how many passed out of how many ran, then the test
 * totals when reported. A failure turns its tile red; anything short of all
 * passed without a failure stays neutral.
 */
export function checksTiles(part: Of<"checks">): Tile[] {
  const count = (status: string) =>
    part.items.filter((item) => item.status === status).length;
  const passed = count("passed"),
    failed = count("failed"),
    total = part.items.length;
  const others = (
    [
      ["failed", failed],
      ["skipped", count("skipped")],
      ["blocked", count("blocked")],
      ["not tested", count("untested")],
    ] as const
  )
    .filter(([, n]) => n)
    .map(([word, n]) => `${n.toLocaleString("en-US")} ${word}`);
  const tiles: Tile[] = [
    {
      value: `${passed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
      label: [`${total === 1 ? "check" : "checks"} passed`, ...others].join(
        ", ",
      ),
      tone: failed ? "bad" : passed === total ? "good" : "neutral",
    },
  ];
  const totals = part.testTotals;
  if (totals)
    tiles.push({
      value: totals.passed.toLocaleString("en-US"),
      label: [
        `${totals.passed === 1 ? "test" : "tests"} passed`,
        totals.failed ? `${totals.failed.toLocaleString("en-US")} failed` : "",
        totals.skipped
          ? `${totals.skipped.toLocaleString("en-US")} skipped`
          : "",
      ]
        .filter(Boolean)
        .join(", "),
      tone: totals.failed ? "bad" : totals.passed ? "good" : "neutral",
    });
  return tiles;
}

/** Every check passed, so the list can fold behind its tiles. */
export const checksSettled = (part: Of<"checks">) =>
  part.items.every((item) => item.status === "passed");

/** "4 of 5 done": stages the work reached out of those listed. */
export function deliveryCount(part: Of<"delivery">): string {
  const done = part.stages.filter((stage) => stage.status === "done").length;
  return `${done} of ${part.stages.length} done`;
}

/** Each state word with how many rows carry it, in first-seen order: "5 Reuse, 2 Add". */
export function tableCounts(part: Of<"table">): string | null {
  const counts = new Map<string, number>();
  for (const row of part.rows)
    if (row.state) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  if (!counts.size) return plural(part.rows.length, "row");
  return [...counts].map(([state, n]) => `${n} ${state}`).join(", ");
}

/**
 * The closed line of a details fold, computed from its Markdown: how many
 * code blocks, links, list items, and table rows it holds, or how many
 * paragraphs when it holds none of those. Two kinds at most.
 */
export function detailsSummary(body: string): string {
  const fences = body.match(/^ {0,3}(`{3,}|~{3,})/gm)?.length ?? 0;
  const code = Math.floor(fences / 2);
  const outside = body.replace(
    /^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1\s*$/gm,
    "",
  );
  const links = outside.match(/\]\([^)]+\)|https:\/\/\S+/g)?.length ?? 0;
  const items = outside.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm)?.length ?? 0;
  const tableRows = Math.max(
    0,
    (outside.match(/^\s*\|.*\|\s*$/gm)?.length ?? 0) -
      2 * (outside.match(/^\s*\|?\s*:?-{3,}/gm)?.length ?? 0),
  );
  const parts = [
    code ? plural(code, "code block") : null,
    tableRows ? plural(tableRows, "table row") : null,
    links ? plural(links, "link") : null,
    items > links ? plural(items, "list item") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length) return parts.slice(0, 2).join(", ");
  const paragraphs = outside
    .split(/\n\s*\n/)
    .filter((block) => block.trim()).length;
  return plural(Math.max(1, paragraphs), "paragraph");
}
