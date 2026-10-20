import { describe, expect, it } from "vitest";
import {
  parse,
  type Reply,
  type ReplyParseResult,
  toText,
} from "../../src/domain/reply.ts";
import { replyInstructions } from "../../src/domain/replyInstructions.ts";
import { REPLY_SAMPLES } from "./replySamples.ts";

function read(body: string, options?: { streaming?: boolean }) {
  return parse(body, { status: options?.streaming ? "streaming" : "closed" });
}

function reply(result: ReplyParseResult): Reply {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const sample = (kind: string) =>
  reply(read(REPLY_SAMPLES.find((entry) => entry.kind === kind)!.body));

const shape = (data: Reply) =>
  data.sections.map(({ label, kind }) => `${kind}:${label}`);

describe("reply samples", () => {
  it("reads every sample without error", () => {
    for (const entry of REPLY_SAMPLES) {
      const result = read(entry.body);
      expect(result, entry.kind).toMatchObject({ ok: true });
      expect(reply(result).lead, entry.kind).not.toBe("");
    }
  });

  it("keeps the data JSON-safe", () => {
    for (const entry of REPLY_SAMPLES) {
      const data = reply(read(entry.body));
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    }
  });

  it("finished work with a card: lead, Checked, folded details", () => {
    const data = sample("finished work");
    expect(data.lead).toBe(
      "Skills find their helper scripts from every install path because each snapshot now keeps `skills/` and `scripts/` side by side.",
    );
    expect(shape(data)).toEqual(["fixed:Checked"]);
    expect(data.sections[0]!.markdown).toBe(
      "22 tests, type check, build and the Pi smoke test pass locally. Both commits are pushed.",
    );
    expect(data.details).toBe(
      "- Changing a script makes a new snapshot; older snapshots keep their own copy\n- I removed both temporary worktrees",
    );
  });

  it("finished work without a card carries Done as task items", () => {
    const data = sample("finished work, no card");
    expect(shape(data)).toEqual(["fixed:Done", "fixed:Checked"]);
    expect(data.lead).toContain("[toolbelt ff20695](https://github.com/");
    expect(data.sections[0]!.items).toEqual([
      {
        checked: true,
        markdown:
          "Each skill snapshot keeps `skills/` and `scripts/` side by side",
      },
      {
        checked: true,
        markdown: "Both helper scripts run from Pi's skill folders",
      },
      { checked: true, markdown: "All 18 skills still load in BB and Pi" },
    ]);
    expect(data.details).toBeUndefined();
  });

  it("status check: plain list items and an unchecked Not done", () => {
    const data = sample("status check");
    expect(shape(data)).toEqual(["fixed:Checked", "fixed:Not done"]);
    expect(data.sections[0]!.items).toHaveLength(4);
    expect(
      data.sections[0]!.items!.every((item) => item.checked === null),
    ).toBe(true);
    expect(data.sections[1]!.items).toEqual([
      { checked: false, markdown: "Merge: the PR is still open" },
    ]);
    expect(data.details).toContain("A newer run replaced it");
  });

  it("report: keeps two extra sections and folds the third", () => {
    const data = sample("report");
    expect(shape(data)).toEqual([
      "fixed:Not done",
      "free:Root cause",
      "free:Suggested fix",
    ]);
    expect(data.lead).toContain("@thread:thr_yfujvpd8vc");
    expect(data.details).toBe(
      "**Workaround**\n\nLeave out the subagent model override, or write `vercel-ai-gateway/openai/gpt-6-luna`.",
    );
  });

  it("handed off, waiting on you, blocked: the fixed labels in order", () => {
    expect(shape(sample("handed off"))).toEqual(["fixed:Next"]);
    expect(shape(sample("waiting on you"))).toEqual(["fixed:Needs you"]);
    expect(shape(sample("blocked"))).toEqual([
      "fixed:Done",
      "fixed:Not done",
      "fixed:Needs you",
      "fixed:Next",
    ]);
  });

  it("short reply and one-line answer are a lead alone", () => {
    expect(sample("short reply")).toEqual({
      lead: 'The waiting card works: WorkstreamsRecap took state `waiting`, goal "Testing Circle X waiting card" and a 120-second timeout, and returned the Waiting state.',
      sections: [],
    });
    expect(sample("one-line answer")).toEqual({ lead: "PASS", sections: [] });
  });

  it("with code: an inner fence stays whole and its heading-like line is code", () => {
    const data = sample("with code");
    expect(shape(data)).toEqual(["fixed:Done", "free:How to run"]);
    expect(data.sections[0]!.items!.map((item) => item.checked)).toEqual([
      true,
      true,
      false,
    ]);
    expect(data.sections[1]).toEqual({
      label: "How to run",
      kind: "free",
      markdown:
        "```sh\nnpm run check -- --all\n# a heading-like line inside code stays code:\n### not a section\n```",
    });
    expect(data.details).toBe(
      "It reuses the last build when no source file changed since then.",
    );
  });

  it("task list: boxes, a continued item, and plain bullets", () => {
    const data = sample("task list");
    expect(shape(data)).toEqual(["fixed:Checked", "fixed:Needs you"]);
    expect(data.sections[0]!.items).toEqual([
      {
        checked: true,
        markdown:
          "`sync.test.ts` passes 200 runs in a row\nafter the clock is faked",
      },
      {
        checked: true,
        markdown: "`upload.test.ts` and `queue.test.ts` pass 200 runs each",
      },
      {
        checked: false,
        markdown: "`retry.test.ts` still fails about 1 run in 40",
      },
    ]);
    expect(data.sections[1]!.items).toEqual([
      {
        checked: null,
        markdown:
          "Keep the retry limit at 3, or raise it to 5 so the test can pass",
      },
    ]);
  });
});

describe("rules", () => {
  it("rejects a closed reply without a lead", () => {
    expect(read("### Checked\nTests pass.")).toEqual({
      ok: false,
      error: "The reply needs one or two sentences before its first heading.",
    });
  });

  it("rejects an unclosed reply so the app shows bb's code block", () => {
    expect(
      parse("Lead.\n\n### Checked\nTests pass.", { status: "unclosed" }),
    ).toMatchObject({ ok: false });
  });

  it("rejects a closed reply whose inner code block never closes", () => {
    // What bb hands over when the reply's fence is no longer than the one
    // inside it: the inner closing line ended the reply early.
    expect(
      read("Lead.\n\n### Checked\nRun this:\n\n```sh\nnpm test"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("backticks") });
    expect(
      reply(read("Lead.\n\n### Checked\n```sh\nnpm test", { streaming: true }))
        .sections[0]!.markdown,
    ).toBe("```sh\nnpm test");
  });

  it("shows what has arrived while streaming", () => {
    expect(reply(read("", { streaming: true }))).toEqual({
      lead: "",
      sections: [],
    });
    const data = reply(
      read("Tests pass.\n\n### Checked\n22 tests\n\n### Ne", {
        streaming: true,
      }),
    );
    expect(data.lead).toBe("Tests pass.");
    expect(data.sections).toEqual([
      { label: "Checked", kind: "fixed", markdown: "22 tests" },
      { label: "Ne", kind: "free", markdown: "" },
    ]);
  });

  it("reads every streamed prefix of every sample without throwing", () => {
    for (const entry of REPLY_SAMPLES)
      for (let end = 0; end <= entry.body.length; end += 7)
        expect(
          read(entry.body.slice(0, end), { streaming: true }),
          `${entry.kind} @${end}`,
        ).toMatchObject({ ok: true });
  });

  it("drops empty sections once closed", () => {
    expect(
      shape(reply(read("Lead.\n\n### Checked\n\n### Why\nBecause."))),
    ).toEqual(["fixed:Why"]);
  });

  it("matches fixed labels loosely and keeps their exact text", () => {
    const data = reply(
      read(
        "Lead.\n\n## not  done:\n- [ ] Merge\n\n### **NEEDS YOU**\nA token.",
      ),
    );
    expect(shape(data)).toEqual(["fixed:Not done", "fixed:Needs you"]);
  });

  it("folds list items past five under Details", () => {
    const items = Array.from({ length: 7 }, (_, n) => `- Item ${n + 1}`).join(
      "\n",
    );
    const data = reply(read(`Lead.\n\n### Checked\n${items}`));
    expect(data.sections[0]!.markdown).toBe(
      "- Item 1\n- Item 2\n- Item 3\n- Item 4\n- Item 5",
    );
    expect(data.sections[0]!.items).toHaveLength(5);
    expect(data.details).toBe("**Checked, continued**\n\n- Item 6\n- Item 7");
  });

  it("folds sentences past three, ignoring periods in code, links and abbreviations", () => {
    const data = reply(
      read(
        "Lead.\n\n### Why\nThe `a.b. C` path breaks, e.g. on Linux. See [v1.2. Notes](https://x.test/a.b). Third? Fourth sentence. Fifth.",
      ),
    );
    expect(data.sections[0]!.markdown).toBe(
      "The `a.b. C` path breaks, e.g. on Linux. See [v1.2. Notes](https://x.test/a.b). Third?",
    );
    expect(data.details).toBe("**Why, continued**\n\nFourth sentence. Fifth.");
  });

  it("counts sentences across paragraphs and folds later blocks whole", () => {
    const data = reply(
      read("Lead.\n\n### Root cause\nOne. Two.\n\nThree.\n\nFour.\n\n- After"),
    );
    expect(data.sections[0]!.markdown).toBe("One. Two.\n\nThree.");
    expect(data.details).toBe("**Root cause, continued**\n\nFour.\n\n- After");
  });

  it("puts the agent's own Details before folded overflow", () => {
    const data = reply(
      read(
        "Lead.\n\n### One\nA.\n\n### Two\nB.\n\n### Three\nC.\n\n### Details\nOwn notes.",
      ),
    );
    expect(data.details).toBe("Own notes.\n\n**Three**\n\nC.");
  });

  it("keeps deeper headings, ordered lists and code inside a section", () => {
    const data = reply(
      read(
        "Lead.\n\n### Next\n#### Order\n1. First\n2. Second\n\n```sh\nnpm test\n```",
      ),
    );
    expect(data.sections).toEqual([
      {
        label: "Next",
        kind: "fixed",
        markdown: "#### Order\n1. First\n2. Second\n\n```sh\nnpm test\n```",
      },
    ]);
  });

  it("keeps a fence inside a list item with its item", () => {
    const data = reply(
      read(
        "Lead.\n\n### Next\n- Run it:\n\n  ```sh\n  ### still code\n  ```\n- Then check",
      ),
    );
    expect(shape(data)).toEqual(["fixed:Next"]);
    expect(data.sections[0]!.items).toEqual([
      { checked: null, markdown: "Run it:\n\n```sh\n### still code\n```" },
      { checked: null, markdown: "Then check" },
    ]);
  });

  it("dedents multi-line list items and accepts Windows line ends", () => {
    const data = reply(
      read("Lead.\r\n\r\n### Done\r\n- [x] First line\r\n  second line"),
    );
    expect(data.sections[0]!.items).toEqual([
      { checked: true, markdown: "First line\nsecond line" },
    ]);
  });
});

describe("toText", () => {
  it("writes the lead, labeled sections, and details as Markdown", () => {
    expect(toText(sample("status check"))).toBe(
      [
        "[PR #412](https://github.com/example/api/pull/412) needed no rebase: it already sat on the latest `feature/register-artifacts`.",
        "**Checked**\n- GitHub shows the PR open, mergeable and clean\n- Required preview deployments pass\n- Code review, code owner and preview comment checks pass\n- The force push changed nothing; GitHub already had `1e55e423e40`",
        "**Not done**\n- [ ] Merge: the PR is still open",
        "**Details**\nOne older Build Container run failed. A newer run replaced it and passed, so it needs no fix.",
      ].join("\n\n"),
    );
    expect(toText(sample("one-line answer"))).toBe("PASS");
  });

  it("returns an empty string for data that is not a reply", () => {
    expect(toText(null)).toBe("");
    expect(toText({ lead: 3 })).toBe("");
  });
});

describe("replyInstructions", () => {
  it("shows a copy-ready example that parses as a reply", () => {
    for (const withRecap of [true, false]) {
      const text = replyInstructions(withRecap);
      const example = /^```reply\n([\s\S]*?)\n```$/m.exec(text)![1]!;
      const data = reply(read(example));
      expect(data.lead).not.toBe("");
      expect(data.sections.some((section) => section.label === "Done")).toBe(
        !withRecap,
      );
    }
  });

  it("names the fixed labels in order and the folded Details section", () => {
    const text = replyInstructions(true);
    expect(text).toContain(
      "these exact labels in this order: Done, Checked, Not done, Needs you, Next, Why",
    );
    expect(text).toContain("`### Details`");
    expect(text).toContain("A two-line body is a good body");
  });

  it("asks for a longer outer fence around a body with code", () => {
    expect(replyInstructions(false)).toContain(
      "more backticks than any fence inside it, at least four (open with ````reply, close with ````)",
    );
  });
});
