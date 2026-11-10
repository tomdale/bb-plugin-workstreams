import type { ReplyPart } from "../src/domain/replyComponents.ts";

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

/** Synthetic test-count checks accept prose or components, not component selection. */
export function testCountProblems(
  parts: readonly ReplyPart[],
  text: string,
  expected: TestTotals,
): string[] {
  const problems: string[] = [];
  const totals = parts.flatMap((part) =>
    part.type === "checks" && part.testTotals ? [part.testTotals] : [],
  );
  // A count the reply left out is a claim nobody made, not a wrong one.
  for (const given of totals)
    if (
      Object.entries(given).some(
        ([key, value]) => value !== expected[key as keyof TestTotals],
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
  // A component may report only the counts it recorded, so a count it leaves
  // out has to be stated in the prose or nowhere; either way it was not said.
  const stated = new Map<keyof TestTotals, number[]>([...reported]);
  for (const given of totals)
    for (const [key, value] of Object.entries(given) as [
      keyof TestTotals,
      number,
    ][])
      stated.set(key, [...(stated.get(key) ?? []), value]);
  for (const key of Object.keys(expected) as (keyof TestTotals)[])
    if (expected[key] > 0 && !stated.get(key)?.includes(expected[key]))
      problems.push(`No explicit ${key} count from supplied facts`);
  return problems;
}
