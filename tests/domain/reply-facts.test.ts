import { expect, it } from "vitest";
import {
  testCountProblems,
  unresolvedCauseQualified,
} from "../../eval/reply-facts.ts";

it.each([
  "The inspection did not reproduce the reported behavior",
  "This does not establish the reported behavior or identify a root cause",
  "The root cause remains unknown",
])("recognizes explicit uncertainty about a reported defect: %s", (text) => {
  expect(unresolvedCauseQualified([], text)).toBe(true);
});
it("does not mistake an observed configuration for an unresolved root-cause finding", () => {
  const parts = [
    {
      type: "finding" as const,
      title: "Configuration",
      explanation: "maxRetries=4",
      certainty: "observed" as const,
    },
  ];
  expect(
    unresolvedCauseQualified(parts, "The configuration is maxRetries=4"),
  ).toBe(false);
});

const expected = { passed: 8, failed: 0, skipped: 1 };
it.each([
  "8 local tests passed and 1 remote integration test skipped",
  "Eight tests passed; one skipped",
  "Eight local tests passed; one remote integration test was skipped",
  "Passed: 8, failed: 0, skipped: 1",
  "Eight local tests passed; one skipped integration test",
])(
  "accepts explicit prose counts without requiring a checks component: %s",
  (text) => {
    expect(testCountProblems([], text, expected)).toEqual([]);
  },
);
it("accepts optional structured totals", () => {
  expect(
    testCountProblems(
      [
        {
          type: "checks",
          title: "Local checks",
          scope: "Local",
          items: [],
          testTotals: expected,
        },
      ],
      "",
      expected,
    ),
  ).toEqual([]);
});
it.each([
  "9 tests passed and 1 skipped",
  "8 tests passed and 2 skipped",
  "8 tests passed and 1 skipped, 2 failed",
  "Tests passed",
  "Eight local tests passed; the integration test was skipped",
])("rejects incorrect or missing supplied counts: %s", (text) => {
  expect(testCountProblems([], text, expected).length).toBeGreaterThan(0);
});
it("rejects contradictory structured totals even when prose is accurate", () => {
  expect(
    testCountProblems(
      [
        {
          type: "checks",
          title: "Local checks",
          scope: "Local",
          items: [],
          testTotals: { ...expected, passed: 9 },
        },
      ],
      "8 passed and 1 skipped",
      expected,
    ).length,
  ).toBeGreaterThan(0);
});
