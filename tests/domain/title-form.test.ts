import { describe, expect, it } from "vitest";
import {
  dropListedPrefix,
  fullAnalysisPrompt,
  parseQuickAnalysis,
  parseRestyle,
  quickAnalysisPrompt,
  restylePrompt,
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
      entities: [],
      listing: child,
    });
    expect(prompt).toContain(
      "<listed_under>\nHarbor: Sandbox Plugin\n</listed_under>",
    );
    expect(prompt).toContain(
      "<parent_thread>\nBuild Harbor Access tunnel\n</parent_thread>",
    );
    expect(
      quickAnalysisPrompt({ request: "Implement Phase 0", entities: [] }),
    ).not.toContain("listed_under");
  });

  it("tells Full analysis only when it settles the goal", () => {
    const input = {
      title: "Phase 0",
      requests: [{ text: "Implement Phase 0", initial: true, id: "r1" }],
      lastAssistantText: null,
      listing: child,
    };
    expect(fullAnalysisPrompt({ ...input, mode: "full" })).toContain(
      "<listed_under>",
    );
    expect(fullAnalysisPrompt({ ...input, mode: "status" })).not.toContain(
      "<listed_under>",
    );
  });

  it("drops a leading listed name from the goals it parses", () => {
    expect(
      parseQuickAnalysis(
        JSON.stringify({
          goal: "Recap cards completed tasks",
          subjectId: null,
          proposed: null,
        }),
        { entities: [], listing },
      ).goal,
    ).toBe("Completed tasks");
  });
});

describe("restyle", () => {
  it("asks to keep the subject and change only the form", () => {
    const prompt = restylePrompt({
      title: "Review Vercel Access Phase 2 lifecycle",
      objective: "Review the Phase 2 lifecycle",
      listing,
    });
    expect(prompt).toContain(
      "<title>\nReview Vercel Access Phase 2 lifecycle\n</title>",
    );
    expect(prompt).toContain("names the same subject as the current one");
  });

  it("drops a title too long for one, and a leading listed name", () => {
    expect(
      parseRestyle(JSON.stringify({ title: "x".repeat(60) }), { listing })
        .title,
    ).toBeNull();
    expect(
      parseRestyle(JSON.stringify({ title: "Recap cards next action" }), {
        listing,
      }).title,
    ).toBe("Next action");
  });
});
