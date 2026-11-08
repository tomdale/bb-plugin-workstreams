/* Shared, synthetic component examples used by the agent guide and its tests. */
import type { ReplyComponent } from "./replyComponents.ts";
import { formatComponent } from "./replyFormat.ts";

export const COMPONENT_NAMES = [
  "text",
  "actions",
  "checks",
  "delivery",
  "change",
  "facts",
  "table",
  "details",
] as const;
export const COMPONENT_EXAMPLES: Record<
  (typeof COMPONENT_NAMES)[number],
  ReplyComponent
> = {
  text: {
    type: "text",
    body: "The coupon now applies a percentage. Saved orders keep their old totals.",
  },
  actions: {
    type: "actions",
    items: [
      {
        action: "Merge `feature/percent` into `main`",
        copy: "git merge --ff-only feature/percent",
      },
      {
        action: "Deploy the shop",
        caution:
          "Runs a migration that rewrites `coupon.kind`; it cannot be rolled back.",
      },
      {
        action: "Keep or drop the cents coupon type?",
        decide: true,
        detail: "No caller uses it; dropping it removes one migration step.",
      },
    ],
  },
  checks: {
    type: "checks",
    title: "Local checks",
    scope: "Run on `feature/percent` at `3f9c2ab`; CI has not run.",
    testTotals: { passed: 212, failed: 0, skipped: 1 },
    items: [
      {
        name: "Unit tests",
        status: "passed",
        detail: "Includes the percentage regression.",
        evidence: [{ label: "Test report", location: "reports/tests.json" }],
      },
      {
        name: "Payment integration",
        status: "skipped",
        detail: "The sandbox credential was unavailable.",
      },
    ],
  },
  delivery: {
    type: "delivery",
    title: "Delivery",
    scope: "As of the end of this turn.",
    stages: [
      { name: "Committed", status: "done" },
      { name: "Pushed", status: "done" },
      {
        name: "Merged",
        status: "pending",
        detail: "Waiting for your merge.",
      },
    ],
  },
  change: {
    type: "change",
    title: "Coupon behavior",
    before: "A value of `10` subtracted ten cents.",
    after: "A value of `10` subtracts ten percent.",
    unchanged: "Callers still pass whole percentages.",
    limitation: "Saved orders keep their old totals.",
  },
  facts: {
    type: "facts",
    items: [
      { label: "Branch", value: "feature/percent", note: "based on `main`" },
      { label: "Commit", value: "3f9c2ab" },
      { label: "Migration", value: "db/migrations/0042_coupon_kind.sql" },
    ],
  },
  table: {
    type: "table",
    title: "Coupon callers",
    columns: ["Caller", "Where"],
    rows: [
      {
        cells: ["Checkout", "`src/checkout/total.ts`"],
        state: "Updated",
        tone: "good",
      },
      {
        cells: ["Admin preview", "`src/admin/preview.ts`"],
        state: "Updated",
        tone: "good",
      },
      {
        cells: ["Partner API", "`src/partner/discount.ts`"],
        state: "Check",
        tone: "attention",
      },
    ],
  },
  details: {
    type: "details",
    title: "Why the calculation converts",
    body: "Callers already pass whole percentages, so one calculation owns the conversion and no caller changes.\n\n```ts\nconst discount = amount * (percent / 100);\n```",
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
