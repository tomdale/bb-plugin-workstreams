import { expect, it } from "vitest";
import { testCountProblems } from "../../eval/reply-counts.ts";

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
it("accepts a component that reports only the counts it recorded", () => {
  const partial = {
    type: "checks" as const,
    title: "Local checks",
    scope: "Local",
    items: [],
    testTotals: { passed: 8, failed: 0 },
  };
  expect(
    testCountProblems(
      [partial],
      "8 local tests passed, 0 failed and 1 skipped",
      expected,
    ),
  ).toEqual([]);
  expect(testCountProblems([partial], "", expected)).toEqual([
    "No explicit skipped count from supplied facts",
  ]);
});
