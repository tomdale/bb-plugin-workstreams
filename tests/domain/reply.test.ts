import { describe, expect, it } from "vitest";
import {
  parse,
  type Reply,
  type ReplyParseResult,
  toText,
} from "../../src/domain/reply.ts";
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
      expect(reply(result).lead, entry.kind).not.toBe("");
    }
  });

  it("keeps the whole block in the source and the data JSON-safe", () => {
    for (const entry of REPLY_SAMPLES) {
      const data = reply(read(entry.message));
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
});

describe("rules", () => {
  it("rejects a complete reply without a lead", () => {
    expect(read(":::reply\n### Checked\nTests pass.\n:::\n")).toEqual({
      ok: false,
      error: "The reply needs one or two sentences before its first heading.",
    });
  });

  it("rejects an unterminated reply so the host shows the raw text", () => {
    expect(read(":::reply\nLead.\n\n### Checked\nTests pass.\n")).toMatchObject(
      {
        ok: false,
      },
    );
  });

  it("shows what has arrived while streaming", () => {
    expect(reply(read(":::reply\n", { streaming: true }))).toEqual({
      lead: "",
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
