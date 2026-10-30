import { describe, expect, it } from "vitest";
import { parse, type Reply } from "../../src/domain/reply.ts";
import {
  DEFAULT_WAITING_TIMEOUT,
  recapInputFromCard,
} from "../../src/domain/replyRecap.ts";
import { lastReplyBlock } from "../../src/domain/replyText.ts";
import {
  recapInputSchema,
  recapSchema,
  toRecap,
} from "../../src/domain/recap.ts";

/** Reads a whole message the way the server does. */
function read(message: string): Reply {
  const block = lastReplyBlock(message);
  if (!block) throw new Error("no block");
  const result = parse(block, { status: block.status });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const recap = (message: string) => recapInputFromCard(read(message).card!);

const REVIEW = `:::reply{state="review"}
# Fixed the percent coupon math
- [x] \`apply_percent_coupon\` now applies a percentage
- [x] Committed \`e69d1dd\` locally; nothing pushed

### Checked
Ran \`python3 -m unittest\` in the repo: 5 of 5 pass.

### Review
- Run the cart tests and check the 10% case

### Links
- [Coupon code](/work/shop/coupons.py)
- https://example.com/pr/12

### Next
- Push the fix: Push the coupon fix and watch CI
- Run the slow tests
:::
`;

describe("the card in a reply block", () => {
  it("reads the headline, results and card sections out of the body", () => {
    const data = read(REVIEW);
    expect(data.card).toEqual({
      state: "review",
      headline: "Fixed the percent coupon math",
      results: [
        {
          checked: true,
          markdown: "`apply_percent_coupon` now applies a percentage",
        },
        {
          checked: true,
          markdown: "Committed `e69d1dd` locally; nothing pushed",
        },
      ],
      review: ["Run the cart tests and check the 10% case"],
      next: [
        "Push the fix: Push the coupon fix and watch CI",
        "Run the slow tests",
      ],
      waitingOn: [],
      links: [
        "[Coupon code](/work/shop/coupons.py)",
        "https://example.com/pr/12",
      ],
    });
    expect(data.lead).toBeUndefined();
    expect(data.sections.map((section) => section.label)).toEqual(["Checked"]);
  });

  it("maps a review block to recap input", () => {
    expect(recap(REVIEW)).toEqual({
      ok: true,
      input: expect.objectContaining({
        state: "review",
        goal: "Fixed the percent coupon math",
        waitingAgents: [],
        latest: [
          "`apply_percent_coupon` now applies a percentage",
          "Committed `e69d1dd` locally; nothing pushed",
        ],
        review: ["Run the cart tests and check the 10% case"],
        links: [
          { title: "Coupon code", location: "/work/shop/coupons.py" },
          {
            title: "https://example.com/pr/12",
            location: "https://example.com/pr/12",
          },
        ],
        next: [
          {
            title: "Push the fix",
            message: "Push the coupon fix and watch CI",
          },
          "Run the slow tests",
        ],
      }),
    });
  });

  it("reads a complete block with results", () => {
    const result = recap(
      ':::reply{state="complete"}\n# Added the count_items helper\n- [x] `count_items()` counts nested carts\n\n### Checked\nRan `python3 -m unittest` locally.\n:::\n',
    );
    expect(result).toMatchObject({
      ok: true,
      input: {
        state: "complete",
        goal: "Added the count_items helper",
        latest: ["`count_items()` counts nested carts"],
        links: [],
      },
    });
  });

  it("reads a short answer: a headline alone", () => {
    const data = read(
      ':::reply{state="complete"}\n# Python 3.9 or newer\n:::\n',
    );
    expect(data.sections).toEqual([]);
    expect(recapInputFromCard(data.card!)).toMatchObject({
      ok: true,
      input: { state: "complete", goal: "Python 3.9 or newer", latest: [] },
    });
  });

  it("reads a waiting block with its timeout and agents", () => {
    const result = recap(
      ':::reply{state="waiting" timeout="900"}\n# Waiting for the migration workers\n\n### Waiting on\n- @thread:thr_abc123 Migrate the orders table\n- @thread:thr_def456\n- a line with no thread\n:::\n',
    );
    expect(result).toMatchObject({
      ok: true,
      input: {
        state: "waiting",
        goal: "Waiting for the migration workers",
        timeout: 900,
        waitingAgents: [
          { threadId: "thr_abc123", task: "Migrate the orders table" },
          { threadId: "thr_def456", task: "Agent thr_def456" },
        ],
        latest: [],
      },
    });
  });

  it("gives a waiting block without a usable timeout the default", () => {
    for (const opener of [
      ':::reply{state="waiting"}',
      ':::reply{state="waiting" timeout="soon"}',
    ])
      expect(recap(`${opener}\n# Waiting for CI\n:::\n`)).toMatchObject({
        ok: true,
        input: { timeout: DEFAULT_WAITING_TIMEOUT },
      });
    expect(
      recap(':::reply{state="waiting" timeout="999999"}\n# Waiting\n:::\n'),
    ).toMatchObject({ ok: true, input: { timeout: 86400 } });
  });

  it("keeps full text while dropping extra items", () => {
    const long = "word ".repeat(60).trim();
    const result = recap(
      `:::reply{state="complete"}\n# ${long}\n- [x] one\n- [x] two\n- [x] three\n- [x] four\n- [x] ${long}\n\n### Next\n- a\n- b\n- c\n- d\n- ${"Very long button title here: send it"}\n:::\n`,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.input.goal).toBe(long);
    expect(result.input.latest).toEqual(["one", "two", "three"]);
    expect(result.input.next).toEqual(["a", "b", "c"]);
    const full = recap(
      `:::reply{state="complete"}\n# Done\n- [x] ${long}\n:::\n`,
    );
    if (!full.ok) throw new Error(full.error);
    expect(full.input.latest).toEqual([long]);
  });

  it("keeps a next action's full title and message", () => {
    const result = recap(
      ':::reply{state="complete"}\n# Done\n\n### Next\n- This title is far too long for a button: send it\n:::\n',
    );
    expect(result).toMatchObject({
      ok: true,
      input: {
        next: [
          {
            title: "This title is far too long for a button",
            message: "send it",
          },
        ],
      },
    });
  });

  it.each(["complete", "review", "waiting"] as const)(
    "preserves long Markdown fields through storage for %s",
    (state) => {
      // Exceeds both the tool's visible limit and its raw-text allowance.
      const markdown = `**${"full text ".repeat(400).trim()}** with \`code\` and [the source](https://example.com/source)`;
      const title =
        "A full next-action title longer than twenty-eight characters";
      const linkTitle = `**${"review target ".repeat(30).trim()}**`;
      const result = recap(
        `:::reply{state="${state}" timeout="600"}\n# ${markdown}\n- [x] ${markdown}\n\n### Review\n- ${markdown}\n\n### Next\n- ${title}: ${markdown}\n\n### Links\n- [${linkTitle}](https://example.com/review)\n\n### Waiting on\n- @thread:thr_worker ${markdown}\n:::\n`,
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.input.goal).toBe(markdown);
      if (state === "waiting") {
        expect(result.input.waitingAgents).toEqual([
          { threadId: "thr_worker", task: markdown },
        ]);
      } else {
        expect(result.input.latest).toEqual([markdown]);
        expect(result.input.next).toEqual([{ title, message: markdown }]);
      }
      if (state === "review") {
        expect(result.input.review).toEqual([markdown]);
        expect(result.input.links).toEqual([
          { title: linkTitle, location: "https://example.com/review" },
        ]);
      }
      const stored = toRecap(result.input, { id: "r1", turnId: "t1", at: 1 });
      expect(recapSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(
        stored,
      );
      expect(recapInputSchema.safeParse(result.input).success).toBe(false);
    },
  );

  it("drops links that are not absolute paths or HTTPS URLs", () => {
    const result = recap(
      ':::reply{state="review"}\n# Ready\n- [x] Built it\n\n### Review\n- Open it\n\n### Links\n- [Relative](src/a.ts)\n- [Plain](http://example.com)\n- [Good](/work/a.ts)\n:::\n',
    );
    expect(result).toMatchObject({
      ok: true,
      input: { links: [{ title: "Good", location: "/work/a.ts" }] },
    });
  });

  it("reads a review block with no steps as complete", () => {
    expect(
      recap(':::reply{state="review"}\n# Ready\n- [x] Built it\n:::\n'),
    ).toMatchObject({ ok: true, input: { state: "complete", links: [] } });
  });

  it("accepts a review block without results", () => {
    expect(
      recap(
        ':::reply{state="review"}\n# Ready for a look\n\n### Review\n- Open the page\n:::\n',
      ),
    ).toMatchObject({
      ok: true,
      input: { state: "review", latest: [], review: ["Open the page"] },
    });
  });

  it("reports a missing headline or an unknown state", () => {
    expect(
      recap(':::reply{state="complete"}\n### Checked\nRan the tests.\n:::\n'),
    ).toMatchObject({ ok: false, problem: "headline" });
    expect(recap(':::reply{state="done"}\n# Done\n:::\n')).toMatchObject({
      ok: false,
      problem: "state",
    });
  });

  it("leaves a block with no state without a card, as before", () => {
    const data = read(
      ":::reply\nThe card needs your choice.\n\n### Done\n- [x] Read the coupon code\n\n### Next\nI apply the fix you pick.\n:::\n",
    );
    expect(data.card).toBeUndefined();
    expect(data.lead).toBe("The card needs your choice.");
    expect(data.sections.map((section) => section.label)).toEqual([
      "Done",
      "Next",
    ]);
  });
});

describe("finding the block in a message", () => {
  it("takes the last top-level block and ignores text after it", () => {
    const block = lastReplyBlock(
      ':::reply{state="complete"}\n# First\n:::\n\nSome text.\n\n:::reply{state="review"}\n# Second\n:::\n\nDone.\n',
    );
    expect(block).toMatchObject({
      attributes: { state: "review" },
      status: "closed",
    });
    expect(block!.source).toBe("# Second\n");
  });

  it("returns null without a block, and ignores one inside a code block", () => {
    expect(lastReplyBlock("Just text.")).toBeNull();
    expect(
      lastReplyBlock('```md\n:::reply{state="complete"}\n# X\n:::\n```\n'),
    ).toBeNull();
  });

  it("reads a block without its closing line as unclosed", () => {
    expect(
      lastReplyBlock(':::reply{state="complete"}\n# Done\n'),
    ).toMatchObject({ status: "unclosed", source: "# Done\n" });
  });

  it("reads a longer marker around a bare ::: line", () => {
    const data = read(
      '::::reply{state="complete"}\n# Documented the marker\n\n### Example\n```md\n:::\n```\n::::\n',
    );
    expect(data.card?.headline).toBe("Documented the marker");
    expect(data.sections[0]!.markdown).toBe("```md\n:::\n```");
  });
});

describe("a block without state that holds only a headline", () => {
  const ONLY =
    ":::reply\n# No. The `shop` package declares no third-party dependencies\n:::\n";

  it("reads as a plain headline with no card", () => {
    expect(read(ONLY)).toEqual({
      headline: "No. The `shop` package declares no third-party dependencies",
      sections: [],
    });
  });

  it("keeps a later # line after a lead as a section, as before", () => {
    const data = read(":::reply\nLead.\n\n# Notes\nSome notes.\n:::\n");
    expect(data.headline).toBeUndefined();
    expect(data.sections.map((section) => section.label)).toEqual(["Notes"]);
  });
});
