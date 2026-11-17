import { describe, expect, it } from "vitest";
import {
  TITLE_MAX,
  composeTitle,
  dropListedPrefix,
  type DescriptionInput,
} from "../../src/domain/analysis.ts";
import { parseStart, startPrompt } from "../../src/domain/start.ts";
import { turnEndPrompt } from "../../src/domain/turnEnd.ts";

/** The turn-end call with no workstream to choose: only its description. */
const descriptionPrompt = (input: DescriptionInput) =>
  turnEndPrompt({ ...input, choice: null });

const listing = { workstream: "Streams Plugin › Recap Cards", parent: null };

describe("dropListedPrefix", () => {
  it("drops a leading name the listing already shows", () => {
    expect(
      dropListedPrefix("Inside Harbor book rewrite", {
        workstream: "Inside Harbor",
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
        workstream: "Atlas › Billing",
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
        workstream: "Atlas",
        parent: null,
      }),
    ).toBe("Reviewing API docs");
  });

  it("keeps a title whose rest would be one word, or with nothing listed", () => {
    expect(
      dropListedPrefix("Inside Harbor rewrite", {
        workstream: "Inside Harbor",
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
    workstream: "Harbor › Sandbox Plugin",
    parent: "Build Harbor Access tunnel",
  };

  it("tells a child thread's start where the thread is listed", () => {
    const prompt = startPrompt({
      request: "Implement Phase 0",
      project: null,
      choice: null,
      listing: child,
    });
    expect(prompt).toContain(
      "<listed_under>\nHarbor › Sandbox Plugin\n</listed_under>",
    );
    expect(prompt).toContain(
      "<parent_thread>\nBuild Harbor Access tunnel\n</parent_thread>",
    );
    expect(
      startPrompt({
        request: "Implement Phase 0",
        project: null,
        choice: null,
      }),
    ).not.toContain("listed_under");
  });

  it("tells the turn-end analysis only when it settles the goal", () => {
    const input = {
      title: "Phase 0",
      titledBy: "workstreams",
      requests: [{ text: "Implement Phase 0", initial: true }],
      lastAssistantText: null,
      listing: child,
    } as const;
    expect(descriptionPrompt({ ...input, mode: "full" })).toContain(
      "<listed_under>",
    );
    expect(descriptionPrompt({ ...input, mode: "status" })).not.toContain(
      "<listed_under>",
    );
  });

  it("drops a listed name from the titles it parses", () => {
    expect(
      parseStart(
        JSON.stringify({
          title: { verb: "restoring", subject: "recap cards task list" },
        }),
        { request: "", project: null, choice: null, listing },
      ).title,
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

  it("strips quotes that wrap a part and keeps ones that don't", () => {
    const subject = (text: string) =>
      composeTitle({ verb: "Fixing", subject: text }, null);
    expect(subject("\u201cgains\u201d phrasing")).toBe(
      "Fixing \u201cgains\u201d phrasing",
    );
    expect(subject('"gains" phrasing')).toBe('Fixing "gains" phrasing');
    expect(subject('"a" and "b"')).toBe('Fixing "a" and "b"');
    expect(subject("users'")).toBe("Fixing users'");
    expect(subject("\u201cgains phrasing\u201d")).toBe("Fixing gains phrasing");
    expect(subject("`'CI cache'`.")).toBe("Fixing CI cache");
    expect(composeTitle({ verb: '"fixing"', subject: "CI cache" }, null)).toBe(
      "Fixing CI cache",
    );
  });

  it("gives no title for a missing part, or one too long for BB", () => {
    expect(composeTitle(null, null)).toBeNull();
    expect(composeTitle({ verb: "Fixing", subject: " " }, null)).toBeNull();
    expect(
      composeTitle({ verb: "Fixing", subject: "x".repeat(TITLE_MAX) }, null),
    ).toBeNull();
  });
});
