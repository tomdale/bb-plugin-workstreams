/* Shared, synthetic component examples used by the agent guide and its tests. */
import type { ReplyComponent } from "./replyComponents.ts";
import { formatComponent } from "./replyFormat.ts";

export const COMPONENT_NAMES = [
  "context",
  "text",
  "comparison",
  "sequence",
  "change",
  "checks",
  "delivery",
  "recommendation",
  "details",
  "group",
] as const;
export const COMPONENT_EXAMPLES: Record<
  (typeof COMPONENT_NAMES)[number],
  ReplyComponent
> = {
  context: {
    type: "context",
    topic: "Coupon calculation",
    where: "shop · feature/percent",
    background: "The coupon subtracts cents when it should apply a percentage.",
  },
  text: {
    type: "text",
    body: "The caller supplies a whole percentage, so divide it by 100 before multiplying the amount.\n\nThis keeps the calculation in the caller’s units.",
  },
  comparison: {
    type: "comparison",
    title: "Compare the remedies",
    items: [
      {
        name: "Convert in the calculation",
        summary: "Keep callers in percentage units",
        qualification:
          "Recommended for the current caller contract: callers already supply whole percentages, so one calculation can own the conversion.",
        recommended: true,
      },
      {
        name: "Change the caller contract",
        summary: "Pass a monetary discount",
        qualification:
          "Requires checking and updating every caller. Choose this only if callers already know the monetary discount.",
        detail:
          "For an amount of 1000 cents, the caller would pass a 100-cent discount rather than a whole percentage of 10.",
      },
    ],
  },
  sequence: {
    type: "sequence",
    title: "How the discount is calculated",
    steps: [
      { title: "Read the percentage", detail: "The caller passes `10`." },
      {
        title: "Convert to a fraction",
        detail: "Divide by 100.",
        attention: true,
      },
      {
        title: "Apply to the amount",
        detail: "Subtract that fraction of the original amount.",
      },
    ],
  },
  change: {
    type: "change",
    title: "Coupon behavior",
    before: "A value of `10` subtracted ten cents.",
    after: "A value of `10` subtracts ten percent.",
    unchanged: "Callers still pass whole percentages.",
    limitation: "Existing saved orders are unchanged.",
  },
  checks: {
    type: "checks",
    title: "Local checks",
    scope: "Recorded for the coupon change; CI has not run.",
    testTotals: { passed: 22, failed: 0, skipped: 1 },
    items: [
      {
        name: "Unit tests",
        status: "passed",
        detail: "22 passed, including the percentage regression.",
        evidence: [{ label: "Test report", location: "reports/tests.json" }],
      },
      {
        name: "Payment integration",
        status: "skipped",
        detail:
          "The credential was unavailable; that connection remains unverified.",
      },
    ],
  },
  delivery: {
    type: "delivery",
    title: "Delivery record",
    scope: "Reported at the end of this turn.",
    stages: [
      {
        name: "Committed",
        status: "done",
        detail: "The coupon change is committed on the feature branch.",
      },
      { name: "Pushed", status: "pending", detail: "No push was requested." },
    ],
  },
  recommendation: {
    type: "recommendation",
    choice: "Convert the percentage in the calculation",
    reason:
      "The caller already supplies whole percentages. Keeping that contract avoids changing each caller.",
    qualification:
      "Confirm the caller units before applying the same change elsewhere.",
  },
  details: {
    type: "details",
    title: "Supporting calculation",
    body: "For an amount of 1000 cents:\n\n```ts\nconst discount = 1000 * (10 / 100);\n```\n\nThe discount is 100 cents.",
  },
  group: {
    type: "group",
    relationship: "supporting",
    children: [
      [
        {
          type: "text",
          body: "The caller passes a whole percentage. The calculation must convert that value to a fraction before applying it.",
        },
        {
          type: "sequence",
          title: "The conversion boundary",
          steps: [
            {
              title: "Read a whole percentage",
              detail: "The caller passes `10`.",
            },
            {
              title: "Apply a fraction",
              detail: "The calculation uses `0.10`.",
              attention: true,
            },
          ],
        },
      ],
      {
        type: "text",
        body: "The test fixtures use `10` for a ten-percent coupon.",
      },
    ],
  },
};

/** A component as the fence an agent writes; text holding backtick fences gets a longer outer fence. */
export function componentFence(component: ReplyComponent): string {
  const source = formatComponent(component);
  const longest = Math.max(
    2,
    ...[...source.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}workstreams\n${source}\n${fence}`;
}
