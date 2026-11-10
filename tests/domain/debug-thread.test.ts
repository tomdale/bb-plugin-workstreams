import { describe, expect, it } from "vitest";
import {
  debugThreadMessage,
  debugThreadTitle,
  type DebugSubject,
} from "../../src/domain/debug-thread.ts";
import type { Trace } from "../../src/domain/trace.ts";

const subject = (overrides: Partial<DebugSubject> = {}): DebugSubject => ({
  surface: "Organizing suggestions in the sidebar",
  headline: "Merge Payments into Billing",
  facts: [
    { label: "Suggestion", value: "Merge Payments into Billing" },
    { label: "Reason the model gave", value: "They file the same threads." },
  ],
  calls: { traceIds: ["tr_1"] },
  ...overrides,
});

const trace = (overrides: Partial<Trace> = {}): Trace => ({
  id: "tr_1",
  at: Date.UTC(2026, 1, 1, 11, 30),
  kind: "tidy",
  status: "ok",
  label: "12 threads, 4 topics",
  model: "anthropic/claude-sonnet-5.5",
  durationMs: 4_200,
  replayOf: null,
  usage: { input: 5_400, output: 320, cost: 0.0123 },
  error: null,
  summary: "merge, reparent",
  threads: [],
  provider: "gateway",
  thinking: "medium",
  system: "Organize the topic tree.",
  prompt: "You tidy topics.\nTopics: Billing, Payments",
  input: null,
  response: '{"edits":[{"op":"merge"}]}',
  reasoning: "Payments only holds billing threads.",
  stopReason: "stop",
  parsed: { edits: [{ op: "merge" }] },
  outcome: { applied: "recorded" },
  links: [],
  replays: [],
  ...overrides,
});

describe("debugThreadTitle", () => {
  it("names the suggestion on one line", () => {
    expect(debugThreadTitle(subject())).toBe(
      "Debug: Merge Payments into Billing",
    );
  });

  it("collapses newlines and clips a long headline", () => {
    const title = debugThreadTitle(
      subject({ headline: `${"Payments and billing ".repeat(8)}` }),
    );
    expect(title).toContain("Debug: Payments and billing");
    expect(title).not.toContain("\n");
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to a name when the suggestion has none", () => {
    expect(debugThreadTitle(subject({ headline: "   " }))).toBe(
      "Debug: Workstreams result",
    );
  });
});

describe("debugThreadMessage", () => {
  const message = debugThreadMessage(subject(), [trace()]);

  it("says where the result came from and what it does", () => {
    expect(message).toContain("Organizing suggestions in the sidebar");
    expect(message).toContain("Merge Payments into Billing");
    expect(message).toContain(
      "Reason the model gave: They file the same threads.",
    );
    expect(message).toContain("Workstreams' stored suggestions");
  });

  it("carries the prompt, response, parsed result, and what was applied", () => {
    expect(message).toContain("### Tidy suggestions: 12 threads, 4 topics");
    expect(message).toContain("You tidy topics.");
    expect(message).toContain('{"edits":[{"op":"merge"}]}');
    expect(message).toContain('"applied": "recorded"');
    expect(message).toContain("Payments only holds billing threads.");
    expect(message).toContain("$0.0123");
    expect(message).toContain("bb workstreams trace tr_1");
  });

  it("says so when nothing was recorded", () => {
    const empty = debugThreadMessage(subject(), []);
    expect(empty).toContain("None was recorded for this result");
    expect(empty).not.toContain("#### Prompt");
  });

  it("keeps a fence a prompt's own backticks cannot break", () => {
    const fenced = debugThreadMessage(subject(), [
      trace({ prompt: "Wrap code in ```js fences" }),
    ]);
    expect(fenced).toContain("````text\nWrap code in ```js fences\n````");
  });

  it("keeps a multi-line fact on its own list item", () => {
    const lines = debugThreadMessage(
      subject({
        facts: [
          { label: "What accepting it does", value: "B › P → B\nB › Q → B" },
        ],
      }),
      [],
    );
    expect(lines).toContain("- What accepting it does: B › P → B\n  B › Q → B");
  });

  it("leaves out a fact with nothing to say", () => {
    const lines = debugThreadMessage(
      subject({
        facts: [
          { label: "Detail", value: "" },
          { label: "Kind", value: "Tidy edit" },
        ],
      }),
      [],
    );
    expect(lines).not.toContain("- Detail");
    expect(lines).toContain("- Kind: Tidy edit");
  });

  it("drops a call's sections it has nothing for", () => {
    const failed = debugThreadMessage(subject(), [
      trace({
        status: "failed",
        parsed: null,
        outcome: null,
        response: null,
        reasoning: null,
        error: "gateway timeout",
      }),
    ]);
    expect(failed).toContain("#### Error");
    expect(failed).toContain("gateway timeout");
    expect(failed).not.toContain("#### Parsed result");
    expect(failed).not.toContain("#### Raw response");
    expect(failed).toContain("#### Prompt");
  });
});
