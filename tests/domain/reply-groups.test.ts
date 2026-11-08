import { expect, it } from "vitest";
import {
  componentText,
  replyComponentSchema,
  type ReplyLeaf,
} from "../../src/domain/replyComponents.ts";

const explanation: ReplyLeaf = {
  type: "text",
  body: "The primary explanation.",
};
const flow: ReplyLeaf = {
  type: "sequence",
  title: "The conversion",
  steps: [
    { title: "Parse", detail: "Keep the full input." },
    { title: "Store", detail: "Preserve its Markdown." },
  ],
};
const supporting: ReplyLeaf = {
  type: "text",
  body: "The source establishes the conversion.",
};

it("keeps a primary explanation and flow together beside supporting prose", () => {
  const part = replyComponentSchema.parse({
    type: "group",
    relationship: "supporting",
    children: [[explanation, flow], supporting],
  });
  const text = componentText(part);
  expect(text).toContain("The primary explanation.");
  expect(text).toContain("The conversion");
  expect(text).toContain("Preserve its Markdown.");
  expect(text).toContain("The source establishes the conversion.");
  expect(text.indexOf("The primary explanation.")).toBeLessThan(
    text.indexOf("The conversion"),
  );
  expect(text.indexOf("The conversion")).toBeLessThan(
    text.indexOf("The source establishes the conversion."),
  );
});

it("continues to accept a single component in each group entry", () => {
  expect(
    replyComponentSchema.safeParse({
      type: "group",
      relationship: "peers",
      children: [explanation, supporting],
    }).success,
  ).toBe(true);
});

it("bounds the total component count, not just the number of entries", () => {
  expect(
    replyComponentSchema.safeParse({
      type: "group",
      relationship: "peers",
      children: [Array(4).fill(explanation), Array(4).fill(supporting)],
    }).success,
  ).toBe(true);
  expect(
    replyComponentSchema.safeParse({
      type: "group",
      relationship: "peers",
      children: [Array(5).fill(explanation), Array(4).fill(supporting)],
    }).success,
  ).toBe(false);
});

it.each([
  { children: [[], supporting] },
  { children: [[[explanation]], supporting] },
  {
    children: [
      {
        type: "group",
        relationship: "peers",
        children: [explanation, supporting],
      },
      supporting,
    ],
  },
])("refuses empty, recursive, or nested group entries", ({ children }) => {
  expect(
    replyComponentSchema.safeParse({
      type: "group",
      relationship: "supporting",
      children,
    }).success,
  ).toBe(false);
});
