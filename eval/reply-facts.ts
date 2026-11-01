import type { ReplyPart } from "../src/domain/replyComponents.ts";

/** Explicit uncertainty cues for the synthetic unresolved-cause case, not a factual verifier. */
export function unresolvedCauseQualified(
  parts: readonly ReplyPart[],
  text: string,
): boolean {
  return (
    parts.some(
      (part) => part.type === "finding" && part.certainty !== "observed",
    ) ||
    /no root cause|cause.{0,50}(unknown|unresolved|not established)|cannot.{0,30}(determine|establish)|unverified|not reproduced|did not reproduce|does not.{0,100}(establish|identify).{0,80}(root cause|behavior)/i.test(
      text,
    )
  );
}

type TestTotals = { passed: number; failed: number; skipped: number };
const words = [
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
const number = `\\d+|${words.join("|")}`;
const count = (text: string) =>
  /^\d+$/.test(text) ? Number(text) : words.indexOf(text.toLowerCase());

/** Synthetic factual-count checks accept prose or components; they do not grade component selection. */
export function testCountProblems(
  parts: readonly ReplyPart[],
  text: string,
  expected: TestTotals,
): string[] {
  const problems: string[] = [];
  const totals = parts.flatMap((part) =>
    part.type === "checks" && part.testTotals ? [part.testTotals] : [],
  );
  for (const reported of totals)
    if (
      Object.keys(expected).some(
        (key) =>
          reported[key as keyof TestTotals] !==
          expected[key as keyof TestTotals],
      )
    )
      problems.push("Reported test totals differ from supplied facts");

  const reported = new Map<keyof TestTotals, number[]>();
  const record = (status: string, value: string) => {
    const key = status.toLowerCase() as keyof TestTotals;
    reported.set(key, [...(reported.get(key) ?? []), count(value)]);
  };
  for (const match of text.matchAll(
    new RegExp(
      `\\b(${number})\\s+(?:(?:local|remote|integration|unit|tests?|checks?)\\s+){0,4}(?:(?:was|were|has been|have been)\\s+)?(passed|failed|skipped)\\b`,
      "gi",
    ),
  ))
    record(match[2]!, match[1]!);
  for (const match of text.matchAll(
    new RegExp(`\\b(passed|failed|skipped)\\s*[:=]?\\s*(${number})\\b`, "gi"),
  ))
    record(match[1]!, match[2]!);
  // A count written as an adjective, as in "one skipped integration test".
  for (const match of text.matchAll(
    new RegExp(
      `\\b(${number})\\s+(passed|failed|skipped)\\s+(?:[A-Za-z][\\w-]*\\s+){0,3}(?:tests?|checks?|cases?|specs?)\\b`,
      "gi",
    ),
  ))
    record(match[2]!, match[1]!);

  for (const [key, actual] of reported)
    if (actual.some((value) => value !== expected[key]))
      problems.push(`Reported ${key} count differs from supplied facts`);
  if (!totals.length)
    for (const key of Object.keys(expected) as (keyof TestTotals)[])
      if (expected[key] > 0 && !reported.get(key)?.includes(expected[key]))
        problems.push(`No explicit ${key} count from supplied facts`);
  return problems;
}
