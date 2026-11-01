import { expect, it } from "vitest";
import { cases } from "../../eval/classification-cases.ts";
import {
  parseQuickAnalysis,
  quickAnalysisPrompt,
} from "../../src/domain/analysis.ts";
import { parseTopic, topicFieldsSchema } from "../../src/domain/classify.ts";

it("renders the synthetic ownership fixtures in Quick analysis and parses their expected topics", () => {
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const input = {
      request: (c.input.requests ?? [c.input.prompt]).join("\n\n"),
      entities: c.input.entities,
      project: null,
    };
    const prompt = quickAnalysisPrompt(input);
    expect(prompt).toContain(c.input.requests![0]);
    expect(prompt).toContain("User requests and explicit diagnoses");
    expect(prompt).toContain(
      "Shared platform capabilities and contracts belong to the platform",
    );
    expect(prompt).toContain(
      "Triggering or consuming another capability, or targeting an object, does not establish parentage",
    );
    expect(prompt).toContain(
      "a topic beneath a different owner does not fit however closely its description matches",
    );
    expect(
      parseQuickAnalysis(
        JSON.stringify({ goal: "Goal", subjectId: c.expected, proposed: null }),
        input,
      ).subjectId ?? null,
    ).toBe(c.expected);
  }
});

it("parses a topic answer that omits the unused field", () => {
  const entities = [
    {
      id: "alerts",
      name: "Alert Investigations",
      description: null,
      parentId: null,
      aliases: [],
    },
  ];
  const parse = (text: string) =>
    parseTopic(topicFieldsSchema.parse(JSON.parse(text)), entities);
  expect(parse('{"subjectId":"alerts"}').subjectId).toBe("alerts");
  const proposal = parse(
    '{"proposed":{"name":"Recap Cards","description":""}}',
  );
  expect(proposal.subjectId).toBeNull();
  expect(proposal.proposed?.name).toBe("Recap Cards");
  expect(() => parse('{"subjectId":"invented"}')).toThrow();
});
