import { describe, expect, it } from "vitest";
import {
  diagnoseReply,
  parseReplyTarget,
} from "../../src/domain/replyDiagnosis.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";

describe("diagnoseReply", () => {
  it("accepts a single closed reply block with valid components", () => {
    const message = [
      ":::reply",
      "# Answered",
      "",
      componentFence(COMPONENT_EXAMPLES.facts),
      "",
      "Prose explanation.",
      ":::",
    ].join("\n");
    const result = diagnoseReply(message);
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
    expect(result.reply?.headline).toBe("Answered");
  });

  it("diagnoses a reply closed with :::reply instead of :::", () => {
    const message = [
      ":::reply",
      "**Make approval a capability tied to a displayed draft.**",
      "",
      componentFence(COMPONENT_EXAMPLES.table),
      "",
      "Final paragraph.",
      ":::reply",
    ].join("\n");
    const result = diagnoseReply(message);
    expect(result.status).toBe("unclosed");
    expect(result.reply).toBeNull();
    expect(result.issues).toEqual([
      {
        line: message.split("\n").length,
        message:
          'Closing line is ":::reply" — close ":::reply" with ":::" alone on a line, not ":::reply".',
      },
    ]);
  });

  it.each([
    [
      "fewer closing colons than opener",
      "::::reply\nBody.\n:::",
      "unclosed",
      {
        line: 3,
        message:
          'Opened with 4 colons ("::::reply") but closed with 3 (":::").',
      },
    ],
    [
      "trailing text on closing line",
      ":::reply\nBody.\n::: end",
      "unclosed",
      {
        line: 3,
        message: 'Closing ":::" must be alone on its line (found "::: end").',
      },
    ],
    [
      "missing closing line",
      ":::reply\nBody without closer.",
      "unclosed",
      {
        line: 1,
        message:
          'Unclosed ":::reply" block — end the block with ":::" alone on its own line.',
      },
    ],
    [
      "unclosed code fence swallowing the closing :::",
      ":::reply\n```ts\nconst x = 1;\n:::",
      "unclosed",
      {
        line: 2,
        message:
          'Unclosed code fence inside ":::reply" swallowed the closing ":::" line.',
      },
    ],
    [
      "space after colons in opener",
      "::: reply\nBody.\n:::",
      "missing",
      {
        line: 1,
        message:
          '"::: reply" has a space after ":::" — write ":::reply" with no space.',
      },
    ],
    [
      "space before attributes in opener",
      ':::reply {v="1"}\nBody.\n:::',
      "missing",
      {
        line: 1,
        message:
          '":::reply {v="1"}" has a space before "{" — write ":::reply{...}" with no space.',
      },
    ],
    [
      "fewer than three colons in opener",
      "::reply\nBody.\n::",
      "missing",
      {
        line: 1,
        message: '"::reply" uses fewer than three colons — write ":::reply".',
      },
    ],
    [
      "code fence instead of directive",
      "```reply\nBody.\n```",
      "missing",
      {
        line: 1,
        message:
          '"```reply" is a code fence — use a ":::reply" container directive closed with ":::".',
      },
    ],
    [
      "indented :::reply",
      "    :::reply\n    Body.\n    :::",
      "missing",
      {
        line: 1,
        message:
          '":::reply" is indented by 4+ spaces, so Markdown reads it as code instead of a directive.',
      },
    ],
    [
      "nested :::reply in blockquote",
      "> :::reply\n> Body.\n> :::",
      "missing",
      {
        line: 1,
        message:
          '":::reply" is inside a list or quote — place it at the top level of the message.',
      },
    ],
  ] as const)(
    "diagnoses %s",
    (_name, message, expectedStatus, expectedIssue) => {
      const result = diagnoseReply(message);
      expect(result.status).toBe(expectedStatus);
      expect(result.issues).toContainEqual(expectedIssue);
    },
  );

  it("reports workstreams fences outside :::reply or nested in lists", () => {
    const outside = `Explanation.\n\n${componentFence(COMPONENT_EXAMPLES.facts)}`;
    const outsideResult = diagnoseReply(outside);
    expect(outsideResult.status).toBe("missing");
    expect(outsideResult.issues).toEqual([
      {
        line: 3,
        message:
          '"workstreams" code fence is outside a ":::reply" block, so it renders as raw source.',
      },
    ]);

    const nestedInList = [
      ":::reply",
      "- Item:",
      "  ```workstreams",
      '  {"type":"text","body":"Nested"}',
      "  ```",
      ":::",
    ].join("\n");
    const nestedResult = diagnoseReply(nestedInList);
    expect(nestedResult.status).toBe("invalid");
    expect(nestedResult.issues).toEqual([
      {
        line: 3,
        message:
          '"workstreams" code fence is inside a list or quote — place it at the top level of ":::reply".',
      },
    ]);
  });

  it("reports content outside :::reply and malformed components", () => {
    const message = [
      "The closing delimiter was :::reply instead of :::.",
      "",
      ":::reply",
      "```workstreams",
      '{"type":"unknown"}',
      "```",
      ":::",
    ].join("\n");
    const result = diagnoseReply(message);
    expect(result.status).toBe("invalid");
    expect(result.issues).toEqual([
      {
        line: 1,
        message:
          'Content appears before ":::reply" — put the whole reply inside one ":::reply" block.',
      },
      {
        line: 4,
        message: expect.stringContaining("Component not displayed"),
      },
    ]);
  });

  it("parses thread IDs, @thread mentions, and BB message URLs", () => {
    expect(
      parseReplyTarget(
        "http://127.0.0.1:38886/projects/proj_wsn9w7svv8/threads/thr_5wjm6b2596#msg=115",
      ),
    ).toEqual({ threadId: "thr_5wjm6b2596", messageSeq: 115 });
    expect(parseReplyTarget("@thread:thr_5wjm6b2596#msg=90")).toEqual({
      threadId: "thr_5wjm6b2596",
      messageSeq: 90,
    });
    expect(parseReplyTarget("thr_5wjm6b2596", 42)).toEqual({
      threadId: "thr_5wjm6b2596",
      messageSeq: 42,
    });
    expect(parseReplyTarget("thr_5wjm6b2596")).toEqual({
      threadId: "thr_5wjm6b2596",
    });
    expect(parseReplyTarget("   ")).toBeNull();
  });
});
