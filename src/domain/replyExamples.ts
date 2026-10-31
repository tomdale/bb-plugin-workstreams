/* Shared, synthetic component examples used by the agent guide and its tests. */
import type { ReplyComponent } from "./replyComponents.ts";

export const COMPONENT_NAMES = [
  "context",
  "text",
  "finding",
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
  finding: {
    type: "finding",
    title: "The calculation subtracts cents",
    explanation:
      "Subtracting `10` from `1000` removes ten cents, rather than ten percent of the amount.",
    certainty: "observed",
    consequence:
      "The caller passes a percentage; convert it before subtracting.",
    evidence: [
      {
        label: "Calculation",
        location: "src/coupon.ts",
        line: 12,
        endLine: 16,
        detail: "The subtraction uses the supplied percentage directly.",
      },
    ],
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
        type: "finding",
        title: "Caller units",
        certainty: "inferred",
        explanation: "The test fixtures use `10` for a ten-percent coupon.",
        evidence: [{ label: "Fixture", location: "tests/coupon.test.ts" }],
      },
    ],
  },
};

export function componentFence(component: ReplyComponent): string {
  return `\`\`\`workstreams\n${JSON.stringify(component)}\n\`\`\``;
}

/** All three replies keep explanations separate from their compact recap fields. */
export const COMPOSED_SAMPLES = {
  investigation: `:::reply{state="complete" kind="investigation"}
# The coupon treats percentages as cents
- [x] The calculation subtracts the supplied number directly

${componentFence(COMPONENT_EXAMPLES.context)}

The caller passes a whole percentage. The calculation subtracts that number from an amount stored in cents, so the two values have different units.

For a ten-percent coupon on 1000 cents, the current calculation removes ten cents. Converting the percentage to a fraction removes 100 cents instead. The evidence establishes the current calculation; other callers still need checking before changing their contracts.

${componentFence(COMPONENT_EXAMPLES.finding)}

${componentFence(COMPONENT_EXAMPLES.comparison)}

### Next
- Fix the calculation: Correct the percentage calculation and test it
:::
`,
  change: `:::reply{state="review" kind="change"}
# The coupon applies a percentage
- [x] The calculation converts whole percentages to fractions

${componentFence({ type: "context", topic: "Coupon calculation", where: "shop · feature/percent", background: "Review the percentage calculation while keeping the caller’s units unchanged." })}

The calculation divides the percentage by 100 before applying it to the original amount. This keeps the caller contract unchanged and avoids making each caller perform the conversion.

The regression test covers the case that exposed the error. Local checks do not establish whether the payment integration works, because that check could not run without its credential.

${componentFence(COMPONENT_EXAMPLES.change)}

${componentFence({ type: "group", relationship: "peers", children: [COMPONENT_EXAMPLES.checks as Extract<ReplyComponent, { type: "checks" }>, COMPONENT_EXAMPLES.delivery as Extract<ReplyComponent, { type: "delivery" }>] })}

### Review
- Inspect the percentage calculation and its regression test

### Next
- Check callers: Check the other coupon callers for the same unit mismatch
:::
`,
  recommendation: `:::reply{state="complete" kind="recommendation"}
# Keep the caller’s percentage contract
- [x] Converting in the calculation avoids a caller migration

${componentFence({ type: "context", topic: "Coupon calculation", background: "Choose how to correct the unit mismatch; this reply recommends an approach without changing code." })}

${componentFence(COMPONENT_EXAMPLES.recommendation)}

Keeping the conversion beside the calculation gives the caller one consistent unit to use. Changing the contract to accept a monetary discount would also work, but it moves the calculation into every caller and requires checking their assumptions.

This recommendation follows the caller and fixture we inspected. It does not establish that every caller uses the same units. Check those callers before applying the change elsewhere.

${componentFence(COMPONENT_EXAMPLES.comparison)}

### Next
- Inspect callers: Inspect the other callers before choosing a migration
:::
`,
} as const;
