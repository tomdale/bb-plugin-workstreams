import { expect, it } from "vitest";
import {
  fileTarget,
  plainText,
  recapSegments,
  RECAP_TOOL_DESCRIPTION,
  RECAP_INSTRUCTIONS,
  recapInputSchema,
  recapToolSchema,
  recapMarkdown,
  recapSchema,
  toRecap,
  reportedAnalysis,
  reportedStatus,
  withHeadline,
} from "../../src/domain/recap.ts";

it("counts only rendered thread mentions as chips for visible length", () => {
  const input = {
    state: "complete",
    headline: "Finished work",
    latest: ["Tests passed"],
  };
  expect(
    recapInputSchema.safeParse({
      ...input,
      headline: `@thread:${"a".repeat(90)}`,
    }).success,
  ).toBe(true);
  for (const kind of ["project", "section"]) {
    expect(
      recapInputSchema.safeParse({
        ...input,
        headline: `@${kind}:${"a".repeat(90)}`,
      }).success,
    ).toBe(false);
  }
});

it.each([
  { headline: "x".repeat(81) },
  { latest: ["x".repeat(121)] },
  { next: ["x".repeat(121)] },
  { next: [{ title: "x".repeat(29), message: "Run it" }] },
  { next: [{ title: "Run it", message: "x".repeat(121) }] },
  { state: "review", latest: ["Done"], review: ["x".repeat(161)] },
  {
    state: "review",
    latest: ["Done"],
    review: ["Inspect"],
    links: [{ title: "x".repeat(81), location: "https://example.com" }],
  },
  {
    state: "waiting",
    timeout: 600,
    waitingAgents: [{ threadId: "thr_worker", task: "x".repeat(81) }],
  },
])("keeps the recap tool's text limits for %j", (patch) => {
  expect(
    recapInputSchema.safeParse({
      state: "complete",
      headline: "Done",
      latest: [],
      ...patch,
    }).success,
  ).toBe(false);
});

it("distinguishes recap selection from required user input", () => {
  expect(RECAP_TOOL_DESCRIPTION).toMatch(/finished result|async task/i);
  expect(RECAP_TOOL_DESCRIPTION).toMatch(/blocker only the user can clear/i);
  expect(RECAP_TOOL_DESCRIPTION).toMatch(/choice[^.]*question-card tool/i);
  expect(RECAP_TOOL_DESCRIPTION).toMatch(/before you write the reply/i);
  expect(RECAP_TOOL_DESCRIPTION).toMatch(/card comes from this call/i);
});

it("scopes the attached recap policy to owned work and real completion", () => {
  expect(RECAP_INSTRUCTIONS).toContain(
    "responsibilities this thread owns under the user's request",
  );
  expect(RECAP_INSTRUCTIONS).toContain("all work this thread owns is finished");
  expect(RECAP_INSTRUCTIONS).toContain(
    "Work continuing elsewhere affects this recap only while this thread owns follow-up",
  );
  expect(RECAP_INSTRUCTIONS).toMatch(
    /waiting only[^.]*async task[^.]*resume owned work/,
  );
  expect(RECAP_INSTRUCTIONS).toMatch(
    /Keep collaborating[^.]*intermediate step is not completion/,
  );
});

it("advertises named parameters on a concrete root object", () => {
  const schema = recapToolSchema.toJSONSchema({ io: "input" });
  expect(schema.type).toBe("object");
  expect(schema).not.toHaveProperty("oneOf");
  expect(schema).not.toHaveProperty("anyOf");
  expect(Object.keys(schema.properties!)).toEqual([
    "state",
    "headline",
    "waitingAgents",
    "latest",
    "timeout",
    "review",
    "unblock",
    "links",
    "next",
    "goal",
  ]);
  expect(schema.required).toEqual(["state"]);
  expect(schema.additionalProperties).toBe(false);
});

it("validates state-specific fields at execution", () => {
  const schema = recapInputSchema.toJSONSchema({ io: "input" });
  const variants = schema.oneOf as Array<{
    properties: Record<string, { const?: string; minItems?: number }>;
    required: string[];
    additionalProperties: boolean;
  }>;
  expect(variants).toHaveLength(4);
  const branch = (state: string) =>
    variants.find((variant) => variant.properties.state?.const === state)!;
  for (const state of ["complete", "review"]) {
    expect(branch(state).properties).toHaveProperty("timeout");
    expect(branch(state).properties).not.toHaveProperty("task");
    expect(branch(state).additionalProperties).toBe(false);
  }
  // Review needs results; a short answer's complete recap may have none.
  expect(branch("review").properties.latest?.minItems).toBe(1);
  expect(branch("review").required).toContain("latest");
  expect(branch("complete").properties.latest?.minItems).toBeUndefined();
  expect(branch("complete").required).not.toContain("latest");
  expect(branch("review").required).toContain("review");
  expect(branch("waiting").required).not.toContain("task");
  expect(branch("waiting").required).toContain("timeout");
  expect(branch("waiting").properties).toHaveProperty("review");
  expect(branch("complete").properties).toHaveProperty("review");
  expect(branch("blocked").required).toContain("unblock");
  expect(branch("blocked").properties.unblock?.minItems).toBe(1);
  const review = {
    state: "review",
    headline: "Finished work",
    latest: ["Tests passed"],
    review: "Check navigation",
  };
  expect(recapInputSchema.safeParse(review).success).toBe(true);
});

it.each([undefined, null, []])("accepts empty unused arrays: %j", (empty) => {
  for (const state of ["complete", "review", "waiting"] as const) {
    const input = {
      state,
      headline:
        state === "waiting" ? "Running checks" : "Fixed recap validation",
      latest: state === "waiting" ? [] : ["Tests passed"],
      timeout: state === "waiting" ? 60 : undefined,
      review: state === "review" ? ["Inspect the fix"] : empty,
    };
    expect(recapToolSchema.safeParse(input).success).toBe(true);
    const recap = toRecap(recapInputSchema.parse(input), {
      id: "r",
      turnId: "t",
      at: 1,
    });
    expect(recap.headline).toBe(
      state === "waiting" ? "Running checks" : "Fixed recap validation",
    );
    if (state !== "review") expect(recap.review).toEqual([]);
  }
});

it.each(["complete", "review"] as const)(
  "accepts ordinary recap input in the %s state",
  (state) => {
    const input = {
      state,
      headline: "Finished work",
      latest: ["Tests passed"],
      ...(state === "review" ? { review: "Inspect the result" } : {}),
    };
    expect(recapInputSchema.safeParse(input).success).toBe(true);
    expect(recapToolSchema.safeParse(input).success).toBe(true);
    expect(
      recapSchema.safeParse({
        id: "r",
        turnId: "t",
        at: 1,
        ...input,
        review: [],
        links: [],
      }).success,
    ).toBe(true);
  },
);

it("accepts empty review strings only when review is not required", () => {
  for (const state of ["complete", "waiting"] as const) {
    expect(
      recapInputSchema.safeParse({
        state,
        headline: "Fixed validation",
        latest: state === "waiting" ? [] : ["Tests passed"],
        ...(state === "waiting" ? { timeout: 60 } : {}),
        review: "",
      }).success,
    ).toBe(true);
  }
  for (const review of [undefined, null, [], "", "   "]) {
    expect(
      recapInputSchema.safeParse({
        state: "review",
        headline: "Fixed validation",
        latest: ["Tests passed"],
        review,
      }).success,
    ).toBe(false);
  }
});

it("rejects substantive unused fields and unknown keys", () => {
  const complete = {
    state: "complete",
    headline: "Fixed validation",
    latest: ["Tests passed"],
  };
  for (const patch of [
    { timeout: 60 },
    { review: ["Inspect the fix"] },
    { review: "Inspect the fix" },
    { extra: [] },
  ])
    expect(recapInputSchema.safeParse({ ...complete, ...patch }).success).toBe(
      false,
    );
});

it("stores waiting agents and includes their linked tasks in the recap output", () => {
  const recap = toRecap(
    recapInputSchema.parse({
      state: "waiting",
      headline: "Building the theme toggle",
      timeout: 60,
      waitingAgents: [
        { threadId: "thr_ui", task: "Building the theme toggle UI" },
        { threadId: "thr_server", task: "Adding theme preference support" },
      ],
    }),
    { id: "r", turnId: "t", at: 1 },
  );
  expect(recap.waitingAgents).toEqual([
    { threadId: "thr_ui", task: "Building the theme toggle UI" },
    { threadId: "thr_server", task: "Adding theme preference support" },
  ]);
  expect(recapMarkdown(recap)).toContain(
    "- Building the theme toggle UI · @thread:thr_ui",
  );
  expect(recapMarkdown(recap)).toContain(
    "- Adding theme preference support · @thread:thr_server",
  );
});

it("uses the headline as the Waiting title and requires a timeout", () => {
  const input = {
    state: "waiting",
    headline: "Waiting for the settings toggle",
    timeout: 60,
    links: [],
  };
  const recap = toRecap(recapInputSchema.parse(input), {
    id: "r",
    turnId: "t",
    at: 1,
  });
  expect(recap).toMatchObject({
    headline: "Waiting for the settings toggle",
    timeout: 60,
    latest: [],
    review: [],
  });
  const markdown = recapMarkdown(recap);
  expect(markdown).toContain("**Waiting**");
  expect(markdown).toContain("Waiting for the settings toggle");
  expect(markdown).toContain("Check status in 60s");
  expect(markdown).not.toContain("**Next:");
  expect(markdown).not.toContain("Nothing needed");
  const analysis = reportedAnalysis(recap, { latestAttentionAt: 1 });
  expect(analysis.state).toBe("waiting");
  expect(analysis.recap).toBe("Waiting for the settings toggle");

  const rejects = (patch: Record<string, unknown>) =>
    expect(recapInputSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
  rejects({ latest: ["Done"] });
  rejects({ next: ["Inspect results"] });
  for (const timeout of [undefined, null, 0, -1, 1.5, 86401])
    rejects({ timeout });
  rejects({ review: "Nothing to review" });
  rejects({ links: [{ title: "File", location: "/work/a" }] });
  expect(
    recapInputSchema.safeParse({ ...input, state: "complete", latest: ["x"] })
      .success,
  ).toBe(false);
});

it("accepts a complete recap with no results, and writes only its title", () => {
  for (const input of [
    { state: "complete", headline: "Python 3.9 or newer is required" },
    {
      state: "complete",
      headline: "Python 3.9 or newer is required",
      latest: [],
    },
  ]) {
    const recap = toRecap(recapInputSchema.parse(input), {
      id: "r",
      turnId: "t",
      at: 1,
    });
    expect(recap.latest).toEqual([]);
    expect(recapMarkdown(recap)).toBe(
      "**Complete** · Python 3.9 or newer is required",
    );
    // The sidebar's status line falls back to the title.
    expect(reportedStatus(recap).recap).toBe("Python 3.9 or newer is required");
  }
  expect(
    recapInputSchema.safeParse({
      state: "review",
      headline: "Goal",
      latest: [],
      review: "Check it",
    }).success,
  ).toBe(false);
});

it("marks reported working threads but leaves inferred progress unmarked", async () => {
  const { slotMarkFor } = await import("../../src/domain/presentation.ts");
  const thread = {
    indicator: "",
    status: "idle",
    hasPendingInteraction: false,
    isUnread: false,
  };
  expect(
    slotMarkFor(thread, {
      kind: "current",
      analysis: { state: "waiting" },
    }),
  ).toEqual({ kind: "waiting", label: "Waiting" });
});

const files = { environmentId: "env_1", root: "/work/", hostId: "host_1" };

it("opens paths inside the workspace there, and others through the host", () => {
  expect(fileTarget("/work/src/a.ts", files)).toEqual({
    kind: "workspace",
    environmentId: "env_1",
    path: "src/a.ts",
  });
  expect(fileTarget("/work//src/nested/b.ts", files)).toEqual({
    kind: "workspace",
    environmentId: "env_1",
    path: "src/nested/b.ts",
  });
  expect(fileTarget("/workspace/a.ts", files)).toEqual({
    kind: "host",
    hostId: "host_1",
    path: "/workspace/a.ts",
  });
  expect(fileTarget("/work", files)).toEqual({
    kind: "host",
    hostId: "host_1",
    path: "/work",
  });
  expect(fileTarget("/tmp/a.md", { ...files, hostId: null })).toBeNull();
  expect(fileTarget("/tmp/a.md", null)).toBeNull();
});

it("accepts links only for review recaps", () => {
  const input = {
    state: "complete",
    headline: "Writing a report",
    latest: ["Report is ready"],
    links: [{ title: "Report", location: "/work/report.md" }],
  };
  expect(recapInputSchema.safeParse(input).success).toBe(false);
  expect(recapInputSchema.parse({ ...input, links: [] }).links).toEqual([]);
  expect(
    recapInputSchema.parse({
      ...input,
      state: "review",
      review: ["Read the report and check that the findings cover each risk"],
    }).links,
  ).toEqual(input.links);
});

it("omits complete links from normalization and stored recap Markdown", () => {
  const input = {
    state: "complete" as const,
    headline: "Writing a report",
    latest: ["Report is ready"],
    links: [{ title: "Report", location: "/work/report.md" }],
  };
  const recap = toRecap(
    { ...input, next: [], waitingAgents: [] },
    { id: "r", turnId: "t", at: 1 },
  );
  expect(recap.links).toEqual([]);
  expect(recapMarkdown({ ...recap, links: input.links })).not.toContain(
    "/work/report.md",
  );
});

it("enforces short sentence-case labels and keeps longer context in descriptions", () => {
  const parsed = recapInputSchema.parse({
    state: "complete",
    headline: "Added dark mode",
    latest: ["Theme toggle works"],
    next: [
      "Run the full test suite",
      {
        title: "Run tests",
        message: "Run the full test suite and show me the result",
        description: "Check for regressions",
      },
    ],
  });
  expect(parsed.next).toHaveLength(2);
  expect(
    recapInputSchema.safeParse({
      state: "complete",
      headline: "Added dark mode",
      latest: ["Theme toggle works"],
      next: [
        {
          title:
            "Run the complete regression test suite with additional coverage over multiple packages for this change",
          message: "Run tests",
        },
      ],
    }).success,
  ).toBe(false);
  const recap = toRecap(parsed, { id: "r", turnId: "t", at: 1 });
  expect(recap.next[1]).toEqual({
    title: "Run tests",
    message: "Run the full test suite and show me the result",
    description: "Check for regressions",
  });
  expect(recapMarkdown(recap)).toContain(
    "- Run tests: Run the full test suite and show me the result (Check for regressions)",
  );
});

it("accepts next actions for complete and review, never for waiting", () => {
  const next = ["Run the full test suite", "Open a pull request"];
  for (const state of ["complete", "review"] as const) {
    const parsed = recapInputSchema.parse({
      state,
      headline: "Added dark mode",
      latest: ["Theme toggle works"],
      ...(state === "review" ? { review: ["Try the theme toggle"] } : {}),
      next,
    });
    expect(parsed.next).toEqual(next);
  }
  expect(
    recapInputSchema.safeParse({
      state: "waiting",
      headline: "Waiting for tests",
      timeout: 120,
      next: ["Check back later"],
    }).success,
  ).toBe(false);
  expect(
    recapInputSchema.parse({
      state: "waiting",
      headline: "Waiting for tests",
      timeout: 120,
    }).next,
  ).toEqual([]);
});

it("tidies next actions and reports them in the recap Markdown", () => {
  const input = recapInputSchema.parse({
    state: "complete",
    headline: "Added dark mode.",
    latest: ["Theme toggle works"],
    next: ["Run the full test suite.", "  Open a   pull request  "],
  });
  const recap = toRecap(input, { id: "r", turnId: "t", at: 1 });
  expect(recap.next).toEqual([
    "Run the full test suite",
    "Open a pull request",
  ]);
  expect(recapMarkdown(recap)).toContain(
    "**Next:**\n- Run the full test suite\n- Open a pull request",
  );
});

it("reads stored recaps without next actions as offering none", () => {
  const stored = {
    id: "r",
    turnId: "t",
    at: 1,
    state: "complete",
    headline: "Goal",
    latest: ["Done"],
    review: [],
    links: [],
  };
  expect(recapSchema.parse(stored).next).toEqual([]);
});

it("keeps legacy string lists and reads structured review JSON", () => {
  const stored = {
    id: "r",
    turnId: "t",
    at: 1,
    state: "review",
    headline: "Goal",
    latest: ["Legacy result"],
    review: JSON.stringify([
      { text: "Open Settings", detail: "The panel appears" },
    ]),
    links: [],
  };
  const recap = recapSchema.parse(stored);
  expect(recap).toMatchObject({
    latest: ["Legacy result"],
    review: [{ text: "Open Settings", detail: "The panel appears" }],
  });
});

it("reads a stored single review line as one step", () => {
  const stored = {
    id: "r",
    turnId: "t",
    at: 1,
    state: "review",
    headline: "Goal",
    latest: ["Latest"],
    links: [],
  };
  expect(recapSchema.parse({ ...stored, review: "Check it" }).review).toEqual([
    "Check it",
  ]);
  expect(recapSchema.parse({ ...stored, review: null }).review).toEqual([]);
});

it("keeps structured review steps and writes their expectations", () => {
  const input = recapInputSchema.parse({
    state: "review",
    headline: "Adding dark mode",
    latest: ["Theme toggle works"],
    review: [
      { text: "Open Appearance.", detail: "Dark should be available." },
      "Reload Settings",
    ],
  });
  const recap = toRecap(input, { id: "r", turnId: "t", at: 1 });
  expect(recap.review).toEqual([
    { text: "Open Appearance", detail: "Dark should be available" },
    "Reload Settings",
  ]);
  expect(recapMarkdown(recap)).toContain(
    "- Open Appearance\n  - Dark should be available",
  );
});

it("uses the goal as the single Waiting title", () => {
  const parsed = recapInputSchema.parse({
    state: "waiting",
    headline: "Building UI and running tests in @thread:thr_abc123",
    timeout: 120,
  });
  const recap = toRecap(parsed, { id: "r", turnId: "t", at: 1 });
  expect(recap.headline).toBe(
    "Building UI and running tests in @thread:thr_abc123",
  );
  expect(recapMarkdown(recap)).toContain("Building UI and running tests");
});

it("rejects the retired step/expect item shape", () => {
  const parsed = recapInputSchema.safeParse({
    state: "review",
    headline: "Compatibility check",
    latest: [{ step: "Implemented generic items", expect: "Kept working" }],
    review: [{ step: "Run tests", expect: "All tests pass" }],
  });
  expect(parsed.success).toBe(false);
});

it("measures inline Markdown by its visible text", () => {
  const url = `https://example.com/${"a".repeat(200)}`;
  const latest = `Merged [the fix](${url}) after @thread:thr_abc123def review`;
  expect(
    recapInputSchema.safeParse({
      state: "complete",
      headline: "Fixing",
      latest: [latest],
    }).success,
  ).toBe(true);
  expect(
    recapInputSchema.safeParse({
      state: "complete",
      headline: "Fixing",
      latest: ["x".repeat(121)],
    }).success,
  ).toBe(false);
});

it("strips inline Markdown to plain text", () => {
  expect(
    plainText(
      "Shipped **bold** `code` [link](https://a.b) for @thread:thr_1 _now_",
    ),
  ).toBe("Shipped bold code link for @thread:thr_1 now");
  expect(plainText("keep snake_case_name and 2*3*4")).toBe(
    "keep snake_case_name and 2*3*4",
  );
});

it("splits commit hashes out of a line and leaves thread mentions to Markdown", () => {
  expect(
    recapSegments(
      "Pushed cef4818 for @thread:thr_ab1, see `deadbee1` and [x](https://a.b/cef4818)",
    ),
  ).toEqual([
    { kind: "markdown", text: "Pushed " },
    { kind: "sha", sha: "cef4818" },
    { kind: "markdown", text: " for @thread:thr_ab1, see " },
    { kind: "sha", sha: "deadbee1" },
    { kind: "markdown", text: " and [x](https://a.b/cef4818)" },
  ]);
  expect(recapSegments("1234567 deadbeef facade1x")).toEqual([
    { kind: "markdown", text: "1234567 deadbeef facade1x" },
  ]);
});

it("reports a blocker with the steps only the user can take", () => {
  const parsed = recapInputSchema.parse({
    state: "blocked",
    headline: "Blocked on the missing staging credential",
    latest: ["The migration is written and committed"],
    unblock: ["Add QUARRY_STAGING_DB_URL to the environment"],
  });
  const recap = toRecap(parsed, { id: "r", turnId: "t", at: 1 });
  expect(recap).toMatchObject({
    state: "blocked",
    unblock: ["Add QUARRY_STAGING_DB_URL to the environment"],
    next: [],
    links: [],
  });
  expect(recapMarkdown(recap)).toContain("**Blocked**");
  expect(recapMarkdown(recap)).toContain("**To unblock:**");
  expect(reportedStatus(recap)).toEqual({
    recap: "The migration is written and committed",
    state: "blocked",
    ask: "Add QUARRY_STAGING_DB_URL to the environment",
  });
  expect(() =>
    recapInputSchema.parse({ state: "blocked", headline: "Blocked" }),
  ).toThrow();
  expect(() =>
    recapInputSchema.parse({
      state: "complete",
      headline: "Done",
      unblock: ["Do something"],
    }),
  ).toThrow();
});

it("accepts the headline under the name earlier sessions were given", () => {
  expect(withHeadline({ state: "complete", goal: "Fixed it" })).toEqual({
    state: "complete",
    headline: "Fixed it",
  });
  const current = { state: "complete", headline: "Fixed it" };
  expect(withHeadline(current)).toBe(current);
});

it("accepts a headline under either name, from sessions on either tool list", () => {
  for (const name of ["headline", "goal"]) {
    const call = { state: "complete", [name]: "Fixed the recap tool" };
    // BB checks the advertised schema before the tool runs.
    expect(recapToolSchema.safeParse(call).success).toBe(true);
    expect(recapInputSchema.parse(withHeadline(call)).headline).toBe(
      "Fixed the recap tool",
    );
  }
  expect(
    recapInputSchema.safeParse(withHeadline({ state: "complete" })).success,
  ).toBe(false);
});
