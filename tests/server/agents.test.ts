import { afterEach, describe, expect, it } from "vitest";
import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { WORKER_THREAD_MARKER } from "../../src/domain/worker.ts";
import { RECAP_INSTRUCTIONS, recapToolSchema } from "../../src/domain/recap.ts";
import {
  replyInstructions,
  REPLY_EXAMPLES_TOOL,
  REPLY_COMPONENT_INSTRUCTIONS,
} from "../../src/domain/replyInstructions.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";
import { QUESTION_INSTRUCTIONS } from "../../src/server/questions/tool-definition.ts";

/**
 * bb's cap on each instruction contribution, in characters: it cuts longer
 * `configure` and `contributeInstructions` output at this length, and
 * rejects a tool whose registered instructions are longer
 * (apps/server/src/services/threads/thread-runtime-config.ts and
 * packages/plugin-sdk/src/internal/host-policy.ts in bb).
 */
const BB_INSTRUCTIONS_MAX_CHARS = 4096;

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

describe("next-action instruction contract", () => {
  it.each([["recap tool", RECAP_INSTRUCTIONS]])(
    "requires optional follow-ups after completed work in the %s",
    (_, text) => {
      expect(text).toMatch(/required for complete and review/);
      expect(text).toMatch(
        /only a short factual answer with nothing left open omits it/,
      );
      expect(text).toMatch(
        /a pull request unopened, unmerged, or awaiting review/,
      );
      expect(text).toMatch(/a result only the user can check/);
      expect(text).toMatch(/a decision they still own/);
      expect(text).toMatch(/an optional improvement or unauthorized change/);
      expect(text).toMatch(/not blocking approval|never requests approval/);
      expect(text).toMatch(/automatic execution|or executes/);
      expect(text).toContain("Do authorized continuations yourself");
      expect(text).toMatch(
        /unauthorized action (is a Next item|belongs here), not (in )?a question card/,
      );
    },
  );
  it.each([["recap tool", RECAP_INSTRUCTIONS]])(
    "treats a route as complete in the %s",
    (_, text) => {
      expect(text).toContain(
        "a route that leaves the destination owning the follow-up is complete",
      );
      expect(text).toContain("how the destination reports back");
    },
  );
  it("states the same Next requirement in the recap field schema", () => {
    const description = recapToolSchema.shape.next.description ?? "";
    expect(description).toContain("required except for a short factual answer");
    expect(description).toContain("how the destination reports back");
  });
  it("carries its Next example in the tool instructions alone", () => {
    expect(RECAP_INSTRUCTIONS).toMatch(/"next":\[/);
    expect(replyInstructions(true)).not.toMatch(/### Next/);
  });
  it("keeps results and Next out of a waiting recap", () => {
    expect(RECAP_INSTRUCTIONS).toContain(
      "Omit latest, review, links, and next.",
    );
  });
});

describe("configure", () => {
  async function setup() {
    world = await fakeWorld();
    const w = world;
    const alpha = w.addSection("Alpha");
    w.addThread("task", { sectionId: alpha.id, title: "Fix tabs" });
    w.addThread("kid", { parentThreadId: "task", title: "Write test" });
    await w.harness.behavior.callRpc("refresh", null);
    return w;
  }
  const resolve = (
    w: World,
    thread: { id: string; parentThreadId?: string | null },
    extra: Parameters<typeof makePluginAgentConfigurationContext>[0] = {},
  ) =>
    w.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        ...extra,
        thread: { parentThreadId: null, ...thread, ...extra.thread },
      }),
    );
  /** Everything the session's agent reads: tool instructions, then `configure`'s. */
  const delivered = (resolved: Awaited<ReturnType<typeof resolve>>) =>
    [...resolved.tools.map((tool) => tool.instructions), resolved.instructions]
      .filter((text): text is string => text !== null)
      .join("\n\n");

  it("configures tools independently of thread hierarchy and workstream placement", async () => {
    const w = await setup();
    const task = await resolve(w, { id: "task" });
    expect(task.instructions).not.toContain("Alpha");
    expect(task.instructions).not.toContain("task thread");
    expect(task.instructions).not.toContain("bb workstreams handoff");
    expect(task.instructions).not.toContain("wf task new");
    expect(task.tools.map((tool) => tool.name)).toEqual([
      "WorkstreamsRecap",
      "AskUserQuestion",
    ]);
    expect(delivered(task)).toContain(RECAP_INSTRUCTIONS);
    const kid = await resolve(w, { id: "kid", parentThreadId: "task" });
    expect(delivered(kid)).toEqual(delivered(task));
    expect(kid.tools.map((tool) => tool.name)).toEqual(
      task.tools.map((tool) => tool.name),
    );
  });

  it("keeps worker threads out of recap enrollment and role instructions", async () => {
    const w = await setup();
    const worker = await resolve(
      w,
      { id: "worker" },
      {
        pluginMetadata: {
          [WORKER_THREAD_MARKER.key]: WORKER_THREAD_MARKER.value,
          kind: "task",
          filedSectionId: w.sections[0]!.id,
          filedAt: Date.now(),
        },
      },
    );
    expect(worker.instructions).toBeNull();
    expect(worker.tools).toEqual([]);
    expect(
      w.bb.storage
        .database()
        .prepare("SELECT thread_id FROM ws_agent_recap WHERE thread_id = ?")
        .get("worker"),
    ).toBeUndefined();

    const normal = await resolve(w, { id: "ordinary" });
    expect(normal.tools.map((tool) => tool.name)).toEqual([
      "WorkstreamsRecap",
      "AskUserQuestion",
    ]);
    expect(delivered(normal)).toContain(RECAP_INSTRUCTIONS);
  });

  it("stays out of side chats, and gives unknown threads only the recap", async () => {
    const w = await setup();
    const side = await resolve(
      w,
      { id: "task" },
      {
        origin: { kind: "fork", pluginId: "side-chat" },
      },
    );
    // Side chats can still ask questions, but get no role or recap.
    expect(delivered(side)).not.toContain("WorkstreamsRecap");
    expect(side.tools.map((tool) => tool.name)).toEqual(["AskUserQuestion"]);
    // A thread with no role yet still ends its turns with a recap.
    const unknown = await resolve(w, { id: "hidden-helper" });
    expect(delivered(unknown)).not.toContain("workstream");
    expect(delivered(unknown)).toContain("WorkstreamsRecap");
    expect(delivered(unknown)).toContain(RECAP_INSTRUCTIONS);
  });

  it("configures unseen threads independently of role metadata freshness", async () => {
    const w = await setup();
    const fresh = await resolve(
      w,
      { id: "brand-new" },
      {
        pluginMetadata: {
          kind: "task",
          filedSectionId: w.sections[0]!.id,
          filedAt: Date.now(),
        },
      },
    );
    expect(fresh.instructions).not.toContain("Alpha");
    expect(delivered(fresh)).toContain(RECAP_INSTRUCTIONS);
    const copy = await resolve(
      w,
      { id: "hidden-fork" },
      {
        pluginMetadata: {
          kind: "task",
          filedSectionId: w.sections[0]!.id,
          filedAt: Date.now() - 60 * 60_000,
        },
      },
    );
    expect(delivered(copy)).toEqual(delivered(fresh));
    expect(copy.tools.map((tool) => tool.name)).toEqual(
      fresh.tools.map((tool) => tool.name),
    );
  });

  it("offers read-only component examples only to sessions with Structured replies", async () => {
    const w = await setup();
    expect(
      (await resolve(w, { id: "task" })).tools.map((tool) => tool.name),
    ).not.toContain(REPLY_EXAMPLES_TOOL);
    await w.harness.behavior.callRpc("setRecapPrefs", {
      patch: { replies: true },
    });
    await w.harness.behavior.callRpc("reportClient", { messageBlocks: true });
    expect(
      (await resolve(w, { id: "task" })).tools.map((tool) => tool.name),
    ).toContain(REPLY_EXAMPLES_TOOL);
    const output = await w.harness.behavior.callAgentTool(
      REPLY_EXAMPLES_TOOL,
      { types: ["actions", "checks"] },
      { threadId: "task" },
    );
    expect(output).toBe(
      [
        componentFence(COMPONENT_EXAMPLES.actions),
        componentFence(COMPONENT_EXAMPLES.checks),
      ].join("\n\n"),
    );
    // A session that started with an earlier set asks for names outside it.
    const retired = await w.harness.behavior.callAgentTool(
      REPLY_EXAMPLES_TOOL,
      { types: ["context", "facts"] },
      { threadId: "task" },
    );
    expect(retired).toBe(componentFence(COMPONENT_EXAMPLES.facts));
    await w.harness.behavior.callRpc("setRecapPrefs", {
      patch: { required: false },
    });
    const bodyOnly = await resolve(w, { id: "task" });
    expect(bodyOnly.tools.map((tool) => tool.name)).toContain(
      REPLY_EXAMPLES_TOOL,
    );
    expect(bodyOnly.tools.map((tool) => tool.name)).not.toContain(
      "WorkstreamsRecap",
    );
    const worker = await resolve(
      w,
      { id: "worker" },
      {
        pluginMetadata: {
          [WORKER_THREAD_MARKER.key]: WORKER_THREAD_MARKER.value,
        },
      },
    );
    expect(worker.tools).toEqual([]);
    expect(
      (
        await resolve(
          w,
          { id: "task" },
          { origin: { kind: "fork", pluginId: "side-chat" } },
        )
      ).tools.map((tool) => tool.name),
    ).not.toContain(REPLY_EXAMPLES_TOOL);
  });

  it.each([
    ["a task thread", {}],
    ["a provider with its own question tool", { nativeQuestions: true }],
    ["a side chat", { sideChat: true }],
    ["a task thread with Structured replies", { replies: true }],
    [
      "a thread with Structured replies and no recap",
      { replies: true, noRecap: true },
    ],
    ["a side chat with Structured replies", { replies: true, sideChat: true }],
  ] as const)(
    "keeps each instruction contribution within bb's limit for %s",
    async (
      _,
      options: {
        nativeQuestions?: boolean;
        sideChat?: boolean;
        replies?: boolean;
        noRecap?: boolean;
      },
    ) => {
      const w = await setup();
      if (options.replies || options.noRecap)
        await w.harness.behavior.callRpc("setRecapPrefs", {
          patch: {
            ...(options.replies ? { replies: true } : {}),
            ...(options.noRecap ? { required: false } : {}),
          },
        });
      // A bb that draws reply blocks (the tomdale/bb fork) reports it.
      if (options.replies)
        await w.harness.behavior.callRpc("reportClient", {
          messageBlocks: true,
        });
      const { agentConfigurationProvider, agentTools } =
        w.harness.inspection.registrations;
      // The plugin's own output, before bb would cut anything.
      const configured = agentConfigurationProvider!(
        makePluginAgentConfigurationContext({
          thread: { id: "task", parentThreadId: null },
          ...(options.sideChat
            ? { origin: { kind: "fork", pluginId: "side-chat" } }
            : {}),
          ...(options.nativeQuestions
            ? {
                provider: {
                  capabilities: { supportsNativeUserQuestion: true },
                },
              }
            : {}),
        }),
      );
      const selected = configured.tools.map((tool) =>
        typeof tool === "string" ? tool : tool.name,
      );
      const contributions = [
        configured.instructions ?? null,
        ...agentTools
          .filter((tool) => selected.includes(tool.name))
          .map((tool) => tool.instructions),
      ].filter((text): text is string => text !== null);
      for (const text of contributions)
        expect(text.length).toBeLessThanOrEqual(BB_INSTRUCTIONS_MAX_CHARS);
      // Each requirement reaches the agent whole.
      const text = contributions.join("\n\n");
      expect(text).toContain(QUESTION_INSTRUCTIONS);
      const composed = options.replies && !options.sideChat;
      expect(text.split(REPLY_COMPONENT_INSTRUCTIONS).length - 1).toBe(
        composed ? 1 : 0,
      );
      expect(
        (text.match(/The reply is a small panel the reader acts from/g) ?? [])
          .length,
      ).toBe(composed ? 1 : 0);
      if (composed && !options.noRecap)
        expect(text).toContain(
          "call WorkstreamsRecap — the card comes from that call — and write the reply after it",
        );
      // A waiting turn is a reply, so the block reaches it too.
      if (composed)
        expect(text).toContain("a reply that reports a wait on another thread");

      const recap = !options.sideChat && !options.noRecap;
      if (recap) expect(text).toContain("required for complete and review");
      else expect(text).not.toContain("required for complete and review");
      // The recap tool carries the card on every client, so its instructions
      // reach each session that reports recaps.
      if (recap) expect(text).toContain(RECAP_INSTRUCTIONS);
      else expect(text).not.toContain(RECAP_INSTRUCTIONS);
      expect(selected.includes("WorkstreamsRecap")).toBe(recap);
      if (options.replies && !options.sideChat)
        expect(text).toContain(replyInstructions(recap));
      else expect(text).not.toContain(":::reply");
    },
  );
});
