/**
 * Placement's gate end to end: a confident typed pick files a root without
 * the placement call, and every other case — below the bar, no answer, a
 * failed call, the gate switched off — is asked of the placement model
 * exactly as before.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld, type FakeGate } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { TopicStore } from "../../src/server/topics.ts";

const PLACEMENT = "You file one agent thread under a topic";
type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;

afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

/** A world with two topics, and a thread whose first request arrives. */
async function dispatch(
  options: {
    evaluate?: FakeGate;
    placementGate?: boolean;
    placementGateModel?:
      | { kind: "gateway"; model: string }
      | {
          kind: "provider";
          providerId: string;
          model: string;
          reasoningLevel: string;
        };
    debug?: boolean;
  } = {},
) {
  const batch: string[] = [];
  world = await fakeWorld({
    ...(options.evaluate ? { evaluate: options.evaluate } : {}),
    complete: ({ prompt }) => {
      if (prompt.includes(PLACEMENT))
        return JSON.stringify({ subjectId: batch[0], propose: null });
      return JSON.stringify({ goal: "Write docs", subjectId: null });
    },
    prefs: {
      analysis: {
        placementGate: options.placementGate ?? true,
        ...(options.placementGateModel
          ? { placementGateModel: options.placementGateModel }
          : {}),
      },
      ...(options.debug ? { advanced: { debug: true } } : {}),
    },
  });
  const topics = new TopicStore(openDatabase(world.bb));
  const docs = topics.create("Docs", "Documentation");
  const tooling = topics.create("Tooling", "Command line tools");
  batch.push(tooling.id);
  const thread = world.addThread("new", {
    status: "starting",
    createdAt: Date.now(),
    environmentId: null,
  });
  const hook = world.harness.registrations.hooks["message.dispatch"]!;
  await hook(
    makeMessageDispatchHookContext({
      thread,
      input: { text: "Fix the parser" },
      origin: "cli",
      parentThreadId: null,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { world, topics, docs, tooling, thread };
}

/** Whether the placement model itself was asked anything. */
const askedPlacement = (given: World) =>
  given.completions.filter((call) => call.prompt.includes(PLACEMENT));

describe("placement gate", () => {
  it("files a confident pick without asking the placement model", async () => {
    const { world, topics, tooling, thread } = await dispatch({
      evaluate: () => ({
        topic: { type: "choice", choice: "tooling", confidence: 0.98 },
      }),
    });
    expect(world.evaluations).toHaveLength(1);
    expect(askedPlacement(world)).toHaveLength(0);
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: tooling.id,
      provenance: "full",
    });
  });

  it("offers the gate the closed choice of topics that hold threads", async () => {
    const { world } = await dispatch({
      evaluate: () => ({
        topic: { type: "choice", choice: "tooling", confidence: 0.98 },
      }),
    });
    const question = world.evaluations[0]!.questions.topic as {
      criteria: Record<string, string>;
    };
    expect(Object.keys(question.criteria)).toEqual([
      "docs",
      "tooling",
      "no-topic",
    ]);
    expect(world.evaluations[0]!.state).toContain("Fix the parser");
  });

  it("asks the placement model when the pick is below the bar", async () => {
    const { world, topics, tooling, thread } = await dispatch({
      evaluate: () => ({
        topic: { type: "choice", choice: "docs", confidence: 0.5 },
      }),
    });
    expect(world.evaluations).toHaveLength(1);
    expect(askedPlacement(world)).toHaveLength(1);
    // The generated answer decides, not the untrusted pick.
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: tooling.id,
      provenance: "full",
    });
  });

  it("asks the placement model when the answer is unfiled", async () => {
    const { world } = await dispatch({
      evaluate: () => ({
        topic: { type: "choice", choice: "no-topic", confidence: 1 },
      }),
    });
    expect(askedPlacement(world)).toHaveLength(1);
  });

  it("asks the placement model when the gate's own call fails", async () => {
    const { world, topics, tooling, thread } = await dispatch({
      evaluate: () => {
        throw new Error("AI Gateway returned 403.");
      },
    });
    expect(askedPlacement(world)).toHaveLength(1);
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: tooling.id,
      provenance: "full",
    });
  });

  it("asks nothing of the gate when fast placement is off", async () => {
    const { world } = await dispatch({
      placementGate: false,
      evaluate: () => ({
        topic: { type: "choice", choice: "tooling", confidence: 0.99 },
      }),
    });
    expect(world.evaluations).toHaveLength(0);
    expect(askedPlacement(world)).toHaveLength(1);
  });

  it("asks nothing of the gate when its model needs a worker thread", async () => {
    const { world } = await dispatch({
      // A provider pick runs in a BB worker, which answers text, not typed
      // questions: the gate declines and the placement model answers.
      placementGateModel: {
        kind: "provider",
        providerId: "pi",
        model: "anthropic/claude-sonnet-5.5",
        reasoningLevel: "medium",
      },
      evaluate: () => ({
        topic: { type: "choice", choice: "tooling", confidence: 0.99 },
      }),
    });
    expect(world.evaluations).toHaveLength(0);
    expect(askedPlacement(world)).toHaveLength(1);
  });

  it("records the gate's answer with its probability", async () => {
    const { world } = await dispatch({
      debug: true,
      evaluate: () => ({
        topic: { type: "choice", choice: "tooling", confidence: 0.98 },
      }),
    });
    const listed = await (world.harness.behavior.callRpc("traces", {
      kind: "placement",
    }) as Promise<{
      traces: {
        kind: string;
        model: string;
        summary: string | null;
        gate?: boolean;
      }[];
    }>);
    const placement = listed.traces;
    expect(placement).toHaveLength(1);
    expect(placement[0]).toMatchObject({
      model: "openai/gpt-6-luna-decisions",
      summary: "Tooling · 0.98 confidence",
    });
    // The detail marks the call so it is not offered as a replayable prompt.
    const { trace } = (await world.harness.behavior.callRpc("trace", {
      id: (placement[0] as unknown as { id: string }).id,
    })) as { trace: { gate?: boolean; outcome: unknown; usage: unknown } };
    expect(trace.gate).toBe(true);
    // Applying the pick annotates the same trace.
    expect(trace.outcome).toMatchObject({ gate: "used", topic: "applied" });
  });
});
