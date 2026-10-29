import { describe, expect, it } from "vitest";
import {
  parse,
  type Reply,
  type ReplyParseResult,
  toText,
} from "../../src/domain/reply.ts";
import { replyInstructions } from "../../src/domain/replyInstructions.ts";
import { recapInputFromCard } from "../../src/domain/replyRecap.ts";
import { lastReplyBlock } from "../../src/domain/replyText.ts";
import { blockInput } from "./replyFixtures.ts";
import { REPLY_SAMPLES } from "./replySamples.ts";

function read(message: string, options?: { streaming?: boolean }) {
  const { status, ...input } = blockInput(message, options);
  return parse(input, { status });
}

function reply(result: ReplyParseResult): Reply {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const sample = (kind: string) =>
  reply(read(REPLY_SAMPLES.find((entry) => entry.kind === kind)!.message));

const shape = (data: Reply) =>
  data.sections.map(({ label, kind }) => `${kind}:${label}`);

describe("reply samples", () => {
  it("reads every sample without error", () => {
    for (const entry of REPLY_SAMPLES) {
      const result = read(entry.message);
      expect(result, entry.kind).toMatchObject({ ok: true });
      // Beside a card the block starts at its first section.
      expect(reply(result).lead !== undefined, entry.kind).toBe(!entry.card);
    }
  });

  it("keeps the whole block in the source and the data JSON-safe", () => {
    for (const entry of REPLY_SAMPLES) {
      const data = reply(read(entry.message));
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    }
  });

  it("finished work with a card: no lead, Checked, Why, folded details", () => {
    const data = sample("finished work");
    expect(data.lead).toBeUndefined();
    expect(shape(data)).toEqual(["fixed:Checked", "fixed:Why"]);
    expect(data.sections[0]!.markdown).toBe(
      "Ran the 22 tests, the type check, the build and the Pi smoke test locally.",
    );
    expect(data.details).toBe("- I removed both temporary worktrees");
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
    expect(shape(data)).toEqual([
      "fixed:Checked",
      "fixed:Not done",
      "fixed:Why",
    ]);
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
      "fixed:Why",
      "free:Root cause",
      "free:Suggested fix",
    ]);
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

  it("handed off without a card keeps its lead", () => {
    expect(sample("handed off").lead).toBe(
      "@thread:thr_4teudyehkq now owns the browser-automation Zod error. It has the error text and the steps to reproduce it.",
    );
  });
});

describe("rules", () => {
  it("reads a block that starts at a section, with no lead", () => {
    expect(
      reply(read(":::reply\n### Checked\nRan the tests locally.\n:::\n")),
    ).toEqual({
      sections: [
        { label: "Checked", kind: "fixed", markdown: "Ran the tests locally." },
      ],
    });
  });

  it("reads a block that is only a lead", () => {
    expect(reply(read(":::reply\nPASS\n:::\n"))).toEqual({
      lead: "PASS",
      sections: [],
    });
  });

  it("rejects a closed block with nothing in it", () => {
    expect(read(":::reply\n:::\n")).toEqual({
      ok: false,
      error: "The reply is empty.",
    });
    expect(read(":::reply\n### Checked\n:::\n")).toMatchObject({ ok: false });
  });

  it("reads an unclosed reply leniently, so bb adds no failure note", () => {
    const data = reply(read(":::reply\n### Checked\nTests pass.\n"));
    expect(data.lead).toBeUndefined();
    expect(data.sections).toEqual([
      { label: "Checked", kind: "fixed", markdown: "Tests pass." },
    ]);
  });

  it("shows what has arrived while streaming", () => {
    expect(reply(read(":::reply\n", { streaming: true }))).toEqual({
      sections: [],
    });
    const data = reply(
      read(":::reply\nTests pass.\n\n### Checked\n22 tests\n\n### Ne", {
        streaming: true,
      }),
    );
    expect(data.lead).toBe("Tests pass.");
    expect(data.sections).toEqual([
      { label: "Checked", kind: "fixed", markdown: "22 tests" },
      { label: "Ne", kind: "free", markdown: "" },
    ]);
  });

  it("drops empty sections once complete", () => {
    expect(
      shape(
        reply(
          read(":::reply\nLead.\n\n### Checked\n\n### Why\nBecause.\n:::\n"),
        ),
      ),
    ).toEqual(["fixed:Why"]);
  });

  it("matches fixed labels loosely and keeps their exact text", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n## not  done:\n- [ ] Merge\n\n### NEEDS YOU\nA token.\n:::\n",
      ),
    );
    expect(shape(data)).toEqual(["fixed:Not done", "fixed:Needs you"]);
  });

  it("folds list items past five under Details", () => {
    const items = Array.from({ length: 7 }, (_, n) => `- Item ${n + 1}`).join(
      "\n",
    );
    const data = reply(read(`:::reply\nLead.\n\n### Checked\n${items}\n:::\n`));
    expect(data.sections[0]!.markdown).toBe(
      "- Item 1\n- Item 2\n- Item 3\n- Item 4\n- Item 5",
    );
    expect(data.sections[0]!.items).toHaveLength(5);
    expect(data.details).toBe("**Checked, continued**\n\n- Item 6\n- Item 7");
  });

  it("folds sentences past three, ignoring periods in code and abbreviations", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### Why\nThe `a.b. C` path breaks, e.g. on Linux. Second one! Third? Fourth sentence. Fifth.\n:::\n",
      ),
    );
    expect(data.sections[0]!.markdown).toBe(
      "The `a.b. C` path breaks, e.g. on Linux. Second one! Third?",
    );
    expect(data.details).toBe("**Why, continued**\n\nFourth sentence. Fifth.");
  });

  it("counts sentences across paragraphs and folds later blocks whole", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### Root cause\nOne. Two.\n\nThree.\n\nFour.\n\n- After\n:::\n",
      ),
    );
    expect(data.sections[0]!.markdown).toBe("One. Two.\n\nThree.");
    expect(data.details).toBe("**Root cause, continued**\n\nFour.\n\n- After");
  });

  it("puts the agent's own Details before folded overflow", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### One\nA.\n\n### Two\nB.\n\n### Three\nC.\n\n### Details\nOwn notes.\n:::\n",
      ),
    );
    expect(data.details).toBe("Own notes.\n\n**Three**\n\nC.");
  });

  it("keeps deeper headings, ordered lists and code inside a section", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### Next\n#### Order\n1. First\n2. Second\n\n```sh\nnpm test\n```\n:::\n",
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

  it("ignores headings inside a code block", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### Checked\n```md\n### Done\n- [x] not an item\n```\n:::\n",
      ),
    );
    expect(data.sections).toEqual([
      {
        label: "Checked",
        kind: "fixed",
        markdown: "```md\n### Done\n- [x] not an item\n```",
      },
    ]);
  });

  it("keeps a ::: line inside a code block when the block uses a longer marker", () => {
    const data = reply(
      read(
        "::::reply\nLead.\n\n### Checked\n```md\n:::\n```\n\n### Next\nShip it.\n::::\n",
      ),
    );
    expect(data.sections.map((section) => section.label)).toEqual([
      "Checked",
      "Next",
    ]);
    expect(data.sections[0]!.markdown).toBe("```md\n:::\n```");
  });

  it("dedents multi-line list items", () => {
    const data = reply(
      read(
        ":::reply\nLead.\n\n### Done\n- [x] First line\n  second line\n:::\n",
      ),
    );
    expect(data.sections[0]!.items).toEqual([
      { checked: true, markdown: "First line\nsecond line" },
    ]);
  });

  it("rejects a tree without source offsets", () => {
    expect(
      parse({
        source: "Lead.",
        tree: {
          type: "root",
          children: [
            { type: "paragraph", children: [{ type: "text", value: "Lead." }] },
          ],
        },
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("toText", () => {
  it("writes the labeled sections and details as Markdown", () => {
    expect(toText(sample("status check"))).toBe(
      [
        "**Checked**\n- Read the PR's status and required checks on GitHub\n- Read the preview deployments' status on GitHub\n- Read the code review and code owner checks on GitHub\n- Compared the branch with `feature/register-artifacts`; the force push changed nothing",
        "**Not done**\n- [ ] Merge: the PR is still open",
        "**Why**\nThe PR already sat on the latest `feature/register-artifacts`, so it needed no rebase.",
        "**Details**\nOne older Build Container run failed. A newer run replaced it and passed, so it needs no fix.",
      ].join("\n\n"),
    );
  });

  it("puts a lead first when there is one", () => {
    expect(toText(sample("handed off"))).toBe(
      "@thread:thr_4teudyehkq now owns the browser-automation Zod error. It has the error text and the steps to reproduce it.\n\n**Next**\nThat thread reports back here when it has a fix.",
    );
    expect(toText({ lead: "PASS", sections: [] })).toBe("PASS");
  });

  it("returns an empty string for data that is not a reply", () => {
    expect(toText(null)).toBe("");
    expect(toText({ lead: 3 })).toBe("");
  });
});

describe("replyInstructions", () => {
  const example = (text: string) =>
    /^:{3}reply(\{[^}\n]*\})?\n[\s\S]*?\n:::$/m.exec(text)![0];

  it("with the recap on, the example carries a card the server can store", () => {
    const block = lastReplyBlock(`${example(replyInstructions(true))}\n`)!;
    const data = reply(parse(block, { status: block.status }));
    expect(data.lead).toBeUndefined();
    expect(data.card?.headline).toBe("Percent coupons apply a percentage");
    expect(data.sections.map((section) => section.label)).toEqual(["Checked"]);
    expect(recapInputFromCard(data.card!)).toMatchObject({
      ok: true,
      input: {
        state: "review",
        review: ["Run the cart tests and check the 10% case"],
      },
    });
  });

  it("with the recap on, the short-answer example is a complete recap with no results", () => {
    const text = replyInstructions(true);
    const short = /^:::reply\{state="complete"\}\n# [^\n]+\n:::$/m.exec(
      text,
    )![0];
    const block = lastReplyBlock(`${short}\n`)!;
    const data = reply(parse(block, { status: block.status }));
    expect(recapInputFromCard(data.card!)).toMatchObject({
      ok: true,
      input: { state: "complete", goal: "Python 3.9 or newer", latest: [] },
    });
  });

  it("without the recap, the example has a lead and Done", () => {
    const data = reply(read(`${example(replyInstructions(false))}\n`));
    expect(data.card).toBeUndefined();
    expect(data.lead).not.toBeUndefined();
    expect(data.sections[0]!.label).toBe("Done");
  });

  it("with the recap on: final message, states, card fields, body order, short answers, question cards", () => {
    const text = replyInstructions(true);
    for (const phrase of [
      "End every turn with one reply block as your final message",
      "no space after the colons or before the `{`",
      "`::::reply{…}`",
      'timeout="<seconds>"',
      "`### Review` (review only)",
      "`### Links` (review only)",
      "`### Waiting on` (waiting only)",
      "`Title: message`",
      "in this order: Checked, Not done, Needs you, Why",
      "Checked says what was run and its result",
      'not "Ran tests"',
      "not the task's name",
      "A short answer",
      ':::reply{state="complete"}\n# Python 3.9 or newer\n:::',
      "unless the turn ends with a question card, which is then the reply",
      "A two-line body is a good body",
    ])
      expect(text).toContain(phrase);
    expect(text).not.toContain("WorkstreamsRecap");
    expect(text).not.toContain("without `state`");
  });

  it("without the recap: the fixed labels in order, and the block before a question card", () => {
    const text = replyInstructions(false);
    expect(text).toContain(
      "these exact labels in this order: Done, Checked, Not done, Needs you, Next, Why",
    );
    expect(text).toContain("write the block before calling the question tool");
    expect(text).not.toContain("state=");
    expect(text).toContain("A two-line body is a good body");
  });
});
