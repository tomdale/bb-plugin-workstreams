import { createTestPluginHost } from "../test-host.ts";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/server/db.ts";
import { QuestionStore } from "../../../src/server/questions/store.ts";
import { registerQuestionTool } from "../../../src/server/questions/tool.ts";

const input = {
  questions: [
    { question: "Ship it?", header: "Ship", options: [], multiSelect: false },
  ],
};

function setup() {
  const send = vi.fn(
    async (_args: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]) => ({
      status: "started",
    }),
  );
  const events = { current: [] as unknown[] };
  const host = createTestPluginHost({
    pluginId: "workstreams",
    sdk: {
      threads: {
        send,
        get: async () => ({ projectId: "thread-project" }),
        events: { list: async () => events.current },
      },
      projects: {
        attachments: {
          copy: async () => undefined,
          read: async () => ({
            bytes: new Uint8Array([1]),
            mimeType: "image/png",
            sizeBytes: 1,
          }),
        },
      },
    },
  });
  let store: QuestionStore;
  const plugin = (bb: typeof host.bb) => {
    store = new QuestionStore(openDatabase(bb), bb);
    registerQuestionTool(bb, store);
  };
  plugin(host.bb);
  return { host, send, plugin, events, store: () => store! };
}

describe("durable questions", () => {
  it("looks up a saved answer at its exact interaction row", async () => {
    const { host, store } = setup();
    const id = store().open("thread", {
      questions: [
        {
          id: "q0",
          prompt: "Ship it?",
          shortLabel: "Ship",
          options: [],
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    });
    store().attach("thread", "interaction");
    store().finish(
      id,
      { ...input, answers: { "Ship it?": "Tomorrow" } },
      "answered",
    );
    expect(await store().atInteraction("thread", "interaction")).toMatchObject({
      id,
      status: "answered",
      result: { answers: { "Ship it?": "Tomorrow" } },
    });
    expect(
      await store().atInteraction("other-thread", "interaction"),
    ).toBeNull();
    await host.harness.lifecycle.dispose();
  });
  it("recovers old detached answers and avoids duplicating them on repeated history reads", async () => {
    const { host, store } = setup();
    const result = { ...input, answers: { "Ship it?": "Yes, tomorrow" } };
    host.harness.sdk.stub("threads.events.list", async () => [
      {
        id: "event-answer",
        createdAt: 123,
        type: "client/turn/requested",
        data: {
          input: [
            {
              type: "text",
              text: `Your earlier AskUserQuestion tool call has finished. Its result:\n\n${JSON.stringify(result)}`,
            },
          ],
        },
      },
    ]);
    const rows = await store().history("thread");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "answered", result, at: 123 });
    expect(await store().history("thread")).toEqual(rows);
    await host.harness.lifecycle.dispose();
  });
  it("survives plugin reload and delivers the recovered answer as a user message", async () => {
    const { host, send, plugin, store } = setup();
    const call = host.harness.callAgentTool("AskUserQuestion", input);
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const threadId = host.harness.pendingInteractions[0]!.threadId;
    const saved = store().pending(threadId)!;
    await host.harness.lifecycle.reload(plugin);
    await call;
    expect(store().pending(threadId)).toEqual({ ...saved, recoverable: true });
    await store().recover(
      threadId,
      saved.id,
      { answers: { q0: { selected: [], freeText: "Ship tomorrow" } } },
      false,
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toEqual([
      expect.objectContaining({
        threadId,
        mode: "auto",
        input: [
          expect.objectContaining({
            text: expect.stringContaining("Ship tomorrow"),
          }),
        ],
      }),
    ]);
    expect(store().pending(threadId)).toBeNull();
    expect((await store().history(threadId))[0]).toMatchObject({
      status: "answered",
      result: { answers: { "Ship it?": "Ship tomorrow" } },
    });
    await expect(
      store().recover(threadId, saved.id, null, true),
    ).rejects.toThrow("no longer pending");
    await host.harness.lifecycle.dispose();
  });

  it("resolves normal answers and explicit dismissal without recovery messages", async () => {
    const { host, send, store } = setup();
    for (const dismiss of [false, true]) {
      const call = host.harness.callAgentTool("AskUserQuestion", input);
      await vi.waitFor(() =>
        expect(host.harness.pendingInteractions).toHaveLength(1),
      );
      const interaction = host.harness.pendingInteractions[0]!;
      if (dismiss) host.harness.cancelInteraction(interaction.id);
      else
        host.harness.submitInteraction(interaction.id, {
          answers: { q0: { selected: [], freeText: "Yes" } },
        });
      await call;
      expect(store().pending(interaction.threadId)).toBeNull();
      expect((await store().history(interaction.threadId))[0]).toMatchObject({
        status: dismiss ? "dismissed" : "answered",
      });
    }
    expect(send).not.toHaveBeenCalled();
    await host.harness.lifecycle.dispose();
  });

  it("dismisses a recovered question without sending a message", async () => {
    const { host, send, store } = setup();
    const id = store().open("thread", {
      questions: [
        {
          id: "q0",
          prompt: "Ship it?",
          shortLabel: "Ship",
          options: [],
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    });
    store().interrupted(id);
    await store().recover("thread", id, null, true);
    expect(send).not.toHaveBeenCalled();
    expect(store().pending("thread")).toBeNull();
    expect((await store().history("thread"))[0]).toMatchObject({
      id,
      status: "dismissed",
      result: null,
    });
    await host.harness.lifecycle.dispose();
  });

  it("retains questions on send failure and rejects empty answers", async () => {
    const { host, send, store } = setup();
    const payload = {
      questions: [
        {
          id: "q0",
          prompt: "Ship it?",
          shortLabel: "Ship",
          options: [],
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    };
    const id = store().open("thread", payload);
    store().interrupted(id);
    await expect(
      store().recover("thread", id, { answers: {} }, false),
    ).rejects.toThrow("at least one");
    send.mockRejectedValueOnce(new Error("offline"));
    await expect(
      store().recover(
        "thread",
        id,
        { answers: { q0: { selected: [], freeText: "Yes" } } },
        false,
      ),
    ).rejects.toThrow("offline");
    expect(store().pending("thread")?.id).toBe(id);
    await host.harness.lifecycle.dispose();
  });
});

it.each([false, true])(
  "retains the identical full submission through reload and event reconstruction (interrupted: %s)",
  async (interrupted) => {
    const { host: initialHost, plugin, store, send, events } = setup();
    let host = initialHost;
    const { original, submission, result } =
      await import("../../app/question/submission-fixture.ts");
    const call = host.harness.callAgentTool("AskUserQuestion", original);
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const interaction = host.harness.pendingInteractions[0]!;
    const saved = store().pending(interaction.threadId)!;
    store().attach(interaction.threadId, interaction.id);
    // Use same-project attachments so both paths preserve the exact references.
    const answer = JSON.parse(JSON.stringify(submission));
    for (const attachment of answer.answers.q2.attachments)
      attachment.projectId = "thread-project";
    if (interrupted) {
      host = await host.harness.lifecycle.reload(plugin);
      await call;
      await store().recover(interaction.threadId, saved.id, answer, false);
    } else {
      host.harness.submitInteraction(interaction.id, answer);
      await call;
    }
    const history = (await store().history(interaction.threadId))[0]!;
    expect(history.result).toMatchObject({
      questions: result.questions,
      answers: result.answers,
      submission: answer,
    });
    host = await host.harness.lifecycle.reload(plugin);
    expect(
      await store().atInteraction(interaction.threadId, interaction.id),
    ).toEqual(history);
    const retained = JSON.stringify(history.result);
    // Simulate history without the plugin database: only retained BB events remain.
    events.current = [
      {
        id: "answer-event",
        createdAt: 123,
        type: interrupted ? "client/turn/requested" : "item/completed",
        data: interrupted
          ? {
              input: [
                {
                  type: "text",
                  text: (
                    send.mock.calls[0]![0] as { input: { text: string }[] }
                  ).input[0]!.text,
                },
              ],
            }
          : {
              item: {
                type: "toolCall",
                tool: "AskUserQuestion",
                result: retained,
              },
            },
      },
    ];
    const reconstructed = await store().history("other-thread");
    expect(reconstructed).toHaveLength(1);
    expect(reconstructed[0]!.result).toEqual(history.result);
    expect(await store().history("other-thread")).toEqual(reconstructed);
    await host.harness.lifecycle.dispose();
  },
);
