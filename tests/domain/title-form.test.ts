import { describe, expect, it } from "vitest";
import {
  GOAL_MAX,
  composeTitle,
  dropListedPrefix,
  fullAnalysisPrompt,
  parseQuickAnalysis,
  quickAnalysisPrompt,
} from "../../src/domain/analysis.ts";

const listing = { group: "Streams Plugin: Recap Cards", parent: null };

describe("dropListedPrefix", () => {
  it("drops a leading name the listing already shows", () => {
    expect(
      dropListedPrefix("Inside Harbor book rewrite", {
        group: "Inside Harbor",
        parent: null,
      }),
    ).toBe("Book rewrite");
    expect(dropListedPrefix("Recap cards completed tasks", listing)).toBe(
      "Completed tasks",
    );
    // The singular repeats the plural name as much.
    expect(dropListedPrefix("Recap card layout fixes", listing)).toBe(
      "Layout fixes",
    );
    expect(
      dropListedPrefix("Streams plugin recap cards sizing bug", listing),
    ).toBe("Sizing bug");
  });

  it("drops a listed name right after the verb", () => {
    expect(
      dropListedPrefix("Fixing Atlas invoice export", {
        group: "Atlas: Billing",
        parent: null,
      }),
    ).toBe("Fixing invoice export");
    expect(dropListedPrefix("Restoring recap cards task list", listing)).toBe(
      "Restoring task list",
    );
    // A name the verb's subject would be left without stays.
    expect(dropListedPrefix("Restoring recap card details", listing)).toBe(
      "Restoring recap card details",
    );
    // Acronyms keep their case.
    expect(
      dropListedPrefix("Reviewing Atlas API docs", {
        group: "Atlas",
        parent: null,
      }),
    ).toBe("Reviewing API docs");
  });

  it("keeps a title whose rest would be one word, or with nothing listed", () => {
    expect(
      dropListedPrefix("Inside Harbor rewrite", {
        group: "Inside Harbor",
        parent: null,
      }),
    ).toBe("Inside Harbor rewrite");
    expect(dropListedPrefix("Recap cards tasks", null)).toBe(
      "Recap cards tasks",
    );
    // A name inside the title isn't a leading one.
    expect(dropListedPrefix("Completed recap cards", listing)).toBe(
      "Completed recap cards",
    );
  });
});

describe("listing context", () => {
  const child = {
    group: "Harbor: Sandbox Plugin",
    parent: "Build Harbor Access tunnel",
  };

  it("tells Quick analysis where the thread is listed", () => {
    const prompt = quickAnalysisPrompt({
      request: "Implement Phase 0",
      entities: null,
      listing: child,
    });
    expect(prompt).toContain(
      "<listed_under>\nHarbor: Sandbox Plugin\n</listed_under>",
    );
    expect(prompt).toContain(
      "<parent_thread>\nBuild Harbor Access tunnel\n</parent_thread>",
    );
    expect(
      quickAnalysisPrompt({ request: "Implement Phase 0", entities: null }),
    ).not.toContain("listed_under");
  });

  it("tells Full analysis only when it settles the goal", () => {
    const input = {
      title: "Phase 0",
      titledBy: "workstreams",
      requests: [{ text: "Implement Phase 0", initial: true }],
      lastAssistantText: null,
      listing: child,
    } as const;
    expect(fullAnalysisPrompt({ ...input, mode: "full" })).toContain(
      "<listed_under>",
    );
    expect(fullAnalysisPrompt({ ...input, mode: "status" })).not.toContain(
      "<listed_under>",
    );
  });

  it("drops a listed name from the titles it parses", () => {
    expect(
      parseQuickAnalysis(
        JSON.stringify({
          goal: { verb: "restoring", subject: "recap cards task list" },
        }),
        { entities: null, listing },
      ).goal,
    ).toBe("Restoring task list");
  });
});

describe("composeTitle", () => {
  it("joins the parts as one sentence-case title", () => {
    expect(
      composeTitle({ verb: "Reviewing", subject: "Phase 3 rollout." }, null),
    ).toBe("Reviewing Phase 3 rollout");
    expect(
      composeTitle({ verb: "setting up", subject: "CI cache" }, null),
    ).toBe("Setting up CI cache");
  });

  it("gives no title for a missing part, or one too long for BB", () => {
    expect(composeTitle(null, null)).toBeNull();
    expect(composeTitle({ verb: "Fixing", subject: " " }, null)).toBeNull();
    expect(
      composeTitle({ verb: "Fixing", subject: "x".repeat(GOAL_MAX) }, null),
    ).toBeNull();
  });
});
