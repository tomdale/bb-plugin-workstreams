/**
 * Placement's gate: the closed choice as a typed question, and the rule for
 * trusting one answer. Everything here is pure, so the cases read as the
 * question a decision model would be asked.
 */
import { describe, expect, it } from "vitest";
import type { PlacementInput } from "../../src/domain/placement.ts";
import {
  NO_TOPIC,
  PLACEMENT_GATE_CONFIDENCE,
  parsePlacementGate,
  placementGateQuestion,
} from "../../src/domain/placementGate.ts";

const tree = [
  {
    id: "harbor",
    name: "Harbor",
    description: "Shared infrastructure",
    parentId: null,
    aliases: [],
  },
  {
    id: "harbor-automations",
    name: "Automations",
    description: "Scheduled runs consumed by tools",
    parentId: "harbor",
    aliases: ["jobs"],
  },
  {
    id: "beacon-automations",
    name: "Automations",
    description: "Scheduled assistant actions",
    parentId: null,
    aliases: [],
  },
  {
    id: "prism-cli",
    name: "Prism CLI",
    description: "Code review execution tool",
    parentId: null,
    aliases: [],
  },
];

const input = (overrides: Partial<PlacementInput> = {}): PlacementInput => ({
  title: "Cron failures",
  requests: ["The cron trigger stops invoking Beacon's scheduled actions."],
  project: "Coordination",
  checkout: "/Users/tomdale/Code/harbor",
  entities: tree,
  counts: { "harbor-automations": 3, "beacon-automations": 8 },
  hints: [
    "Threads in its checkout are usually filed under Harbor: Automations.",
  ],
  current: null,
  ...overrides,
});

const criteriaOf = (question: ReturnType<typeof placementGateQuestion>) =>
  (question!.questions.topic as { criteria: Record<string, string> }).criteria;

describe("placementGateQuestion", () => {
  it("asks a choice over the topics that can hold the thread", () => {
    const question = placementGateQuestion(input());
    expect(Object.keys(criteriaOf(question))).toEqual([
      "automations",
      "harbor-automations",
      "prism-cli",
      NO_TOPIC,
    ]);
  });

  it("names a topic's path so two topics with one name stay distinct", () => {
    const criteria = criteriaOf(placementGateQuestion(input()));
    expect(criteria["harbor-automations"]).toBe(
      "Harbor: Automations — Scheduled runs consumed by tools",
    );
    expect(criteria["automations"]).toBe(
      "Automations — Scheduled assistant actions",
    );
  });

  it("leaves out a topic that holds subtopics", () => {
    const criteria = criteriaOf(placementGateQuestion(input()));
    expect(criteria.harbor).toBeUndefined();
  });

  it("carries the thread's evidence, redacted and bounded", () => {
    const question = placementGateQuestion(
      input({
        requests: ["Use ghp_0123456789abcdefghij to fix the trigger."],
      }),
    );
    expect(question!.state).toContain("Cron failures");
    expect(question!.state).toContain("Coordination");
    expect(question!.state).toContain("[redacted]");
    expect(question!.state).not.toContain("ghp_0123456789abcdefghij");
  });

  it("offers no unfiled answer when a group move constrains the choice", () => {
    const question = placementGateQuestion(
      input({
        entities: [
          ...tree,
          {
            id: "harbor-providers",
            name: "Providers",
            description: "Agent provider selection",
            parentId: "harbor",
            aliases: [],
          },
        ],
        within: "harbor",
      }),
    );
    expect(Object.keys(criteriaOf(question))).toEqual([
      "harbor-automations",
      "providers",
    ]);
  });

  it("declines a tree with nothing to choose between", () => {
    const question = placementGateQuestion(
      input({ entities: [tree[3]!], counts: {} }),
    );
    expect(question).not.toBeNull();
    // A group move into a single-topic destination is the real single case.
    expect(
      placementGateQuestion(
        input({ entities: [tree[3]!], within: "prism-cli" }),
      ),
    ).toBeNull();
  });

  it("declines more choices than a question can hold", () => {
    const entities = Array.from({ length: 260 }, (_, n) => ({
      id: `t${n}`,
      name: `Topic ${n}`,
      description: null,
      parentId: null,
      aliases: [],
    }));
    expect(placementGateQuestion(input({ entities }))).toBeNull();
  });

  it("excerpts a long request rather than sending it whole", () => {
    const question = placementGateQuestion(
      input({ requests: ["x".repeat(60_000)] }),
    );
    expect(question!.state.length).toBeLessThan(5_000);
  });
});

describe("parsePlacementGate", () => {
  it("settles a confident pick on a topic that holds threads", () => {
    expect(
      parsePlacementGate(
        {
          topic: {
            type: "choice",
            choice: "harbor-automations",
            confidence: 0.98,
          },
        },
        input(),
      ),
    ).toEqual({
      answer: {
        subjectId: "harbor-automations",
        proposed: null,
        scopeShift: false,
      },
      confidence: 0.98,
    });
  });

  it("falls back below the bar", () => {
    expect(
      parsePlacementGate(
        {
          topic: {
            type: "choice",
            choice: "harbor-automations",
            confidence: PLACEMENT_GATE_CONFIDENCE - 0.001,
          },
        },
        input(),
      ),
    ).toBeNull();
  });

  it("reads the pick's probability when the answer carries no confidence", () => {
    expect(
      parsePlacementGate(
        {
          topic: {
            type: "choice",
            choice: "prism-cli",
            probabilities: { "prism-cli": 0.97, "harbor-automations": 0.03 },
          },
        },
        input(),
      )?.confidence,
    ).toBe(0.97);
  });

  it("falls back on an unfiled answer, which the generative call may still place", () => {
    expect(
      parsePlacementGate(
        { topic: { type: "choice", choice: NO_TOPIC, confidence: 1 } },
        input(),
      ),
    ).toBeNull();
  });

  it("falls back on a topic that holds subtopics", () => {
    expect(
      parsePlacementGate(
        { topic: { type: "choice", choice: "harbor", confidence: 1 } },
        input(),
      ),
    ).toBeNull();
  });

  it("falls back on an answer naming nothing it was offered", () => {
    expect(parsePlacementGate({}, input())).toBeNull();
    expect(
      parsePlacementGate(
        { topic: { type: "choice", choice: null, confidence: 1 } },
        input(),
      ),
    ).toBeNull();
  });
});
