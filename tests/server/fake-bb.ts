/*
 * An in-memory BB world behind the SDK harness: threads and sections that the
 * plugin reads and mutates, plus helpers for tests to change them "elsewhere".
 */
import { createInitializedTestPluginHost } from "./test-host.ts";
import {
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../src/server/index.ts";
import { savePrefs } from "../../src/server/prefs.ts";
import type { PrefsPatch } from "../../src/domain/prefs.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { promptIds } from "../../src/domain/workstreamChoice.ts";

type Thread = ReturnType<typeof makeThreadResponse>;
type Section = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

/** The model's answer: its text, or its text with a reasoning summary. */
type FakeAnswer = string | { text: string; reasoning: string };
export type FakeCompletion = (call: {
  prompt: string;
  model: string;
  outputSchema?: Record<string, unknown>;
  /** The host call's abort signal. */
  signal?: AbortSignal;
}) => FakeAnswer | Promise<FakeAnswer>;

/** How the placement prompt opens, so a fake can tell it apart. */
const PLACEMENT = "You choose the workstream for one agent thread";

/** How a turn's end asks for a topic beside its description. */
const TURN_END_WORKSTREAM = "and decide which workstream it belongs in now";

/** How a thread's start opens; a root's also files it under a topic. */
const START = "You name one new agent thread from its opening request";
const START_WORKSTREAM = `${START} and choose its workstream`;

/** Whether a prompt chooses a thread's topic, alone or with other fields. */
export const choosesWorkstream = (prompt: string) =>
  prompt.includes(PLACEMENT) ||
  prompt.includes(TURN_END_WORKSTREAM) ||
  prompt.includes(START_WORKSTREAM);

/**
 * Whether a prompt is a thread's start, which names it. The composer's
 * preview opens the same way and also chooses a topic.
 */
export const isStart = (prompt: string) => prompt.includes(START);

/** How the prompts that write titles open. */
const NAMING = [
  "You name one new agent thread",
  "You describe one agent thread",
];

/**
 * Tests write a title as one string, `title: "Fixing the pipeline"`; the
 * analyses ask for its verb and subject, so split a test's answer for them.
 */
function asTitleParts(answer: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(answer) as Record<string, unknown>;
  } catch {
    return answer;
  }
  if (typeof parsed.title !== "string") return answer;
  const [verb = "", ...subject] = parsed.title.split(" ");
  return JSON.stringify({
    ...parsed,
    title: { verb, subject: subject.join(" ") },
  });
}

/**
 * Tests answer every call with one JSON shape, naming a topic by its ID as
 * `subjectId` or proposing one as `proposed`. Placement names topics by short
 * IDs and proposes with `propose`, so translate a test's answer for it.
 */
function asPlacement(
  answer: string,
  workstreams: Parameters<typeof promptIds>[0],
) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(answer) as Record<string, unknown>;
  } catch {
    return answer;
  }
  if (!parsed || typeof parsed !== "object" || "workstream" in parsed)
    return answer;
  const ids = promptIds(workstreams);
  const short = (id: unknown) =>
    typeof id === "string" ? (ids.get(id) ?? id) : null;
  const proposed = parsed.proposed as {
    name: string;
    description?: string;
    parentId?: string | null;
  } | null;
  return JSON.stringify({
    workstream: short(parsed.workstreamId),
    propose: proposed
      ? {
          name: proposed.name,
          description: proposed.description ?? "",
          parent: short(proposed.parentId ?? null),
        }
      : null,
    scopeShift: parsed.scopeShift ?? false,
  });
}

/** A start names its title `title`; tests write it as `goal`. */
function asStart(answer: Record<string, unknown>): Record<string, unknown> {
  const { goal, ...rest } = answer;
  return { ...rest, title: rest.title ?? goal ?? null };
}
function startText(answer: string): string {
  try {
    return JSON.stringify(
      asStart(JSON.parse(answer) as Record<string, unknown>),
    );
  } catch {
    return answer;
  }
}

const DEFAULT_ANSWER = JSON.stringify({
  recap: "Fixed the bug; tests pass.",
  state: "review",
  ask: null,
  title: null,
  workstreamId: null,
  proposed: null,
});

export async function fakeWorld(
  options: {
    complete?: FakeCompletion;
    /** Preferences the world starts with, as the settings view would save them. */
    prefs?: PrefsPatch;
    send?: (args: Record<string, unknown>) => Promise<void>;
    spawn?: (args: Record<string, unknown>) => Promise<Thread>;
    /** The host's enhanced-response composition; absent: it fails. */
    present?: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  } = {},
) {
  const threads = new Map<string, Thread>();
  /** Per-thread conversation served by promptHistory/events/output. */
  const conversations = new Map<
    string,
    { requests: string[]; output: string | null }
  >();
  const completions: {
    prompt: string;
    model: string;
    outputSchema?: Record<string, unknown>;
  }[] = [];
  const spawned: Record<string, unknown>[] = [];
  /** Inputs of the host's `present` calls. */
  const presents: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  const projects = ["proj_1", "proj_home", "proj_other", "proj_personal"].map(
    (id) => ({ id, name: "Zebracorn", sources: [] }),
  );
  const workerCalls: Record<string, unknown>[] = [];
  const markedUnread: string[] = [];
  /** Each environment's pull request attention; null or absent: none. */
  const pullRequests = new Map<string, string | null>();
  /** Each thread's latest agent turn: its number and how it ended. */
  const turns = new Map<string, { n: number; status: string }>();
  /** Each thread's assistant messages, by the turn that wrote them. */
  const messages = new Map<
    string,
    { turn: number; text: string; nested: boolean }[]
  >();
  const sections: Section[] = [];
  let nextSection = 1;
  const addThread = (id: string, overrides: Partial<Thread> = {}) => {
    const thread = makeThreadResponse({
      id,
      title: `Thread ${id}`,
      projectId: "proj_1",
      environmentId: "env_1",
      sectionId: null,
      parentThreadId: null,
      archivedAt: null,
      visibility: "visible",
      latestAttentionAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });
    threads.set(id, thread);
    return thread;
  };
  const addSection = (name: string, id = `sec_${nextSection++}`) => {
    const section = { id, name, createdAt: 1, updatedAt: 1 };
    sections.push(section);
    return section;
  };
  const missing = (id: string) =>
    Object.assign(new Error(`Thread ${id} not found`), { status: 404 });

  const text = (value: string) => [{ type: "text", text: value }];
  const host = await createInitializedTestPluginHost({
    pluginId: "workstreams",
    experimental_callHostRpc: async (call) => {
      if (call.method === "present") {
        presents.push(call.input as Record<string, unknown>);
        return (
          (await options.present?.(call.input as Record<string, unknown>)) ?? {
            kind: "failed",
            reason: "No fake composition.",
            previews: 0,
            modelCalls: 0,
            usage: { input: 0, output: 0, cost: 0 },
          }
        );
      }
      const input = call.input as {
        prompt: string;
        model: string;
        outputSchema?: Record<string, unknown>;
      };
      completions.push(input);
      const usage = { input: 100, output: 20, cost: 0.0001 };
      const textOf = (answer: FakeAnswer) =>
        typeof answer === "string" ? answer : answer.text;
      // A turn's end describes the thread and chooses its topic in one call,
      // and a root's start names it and files it. Tests answer the two parts
      // as they did when they were separate calls: the topic as a placement
      // answer, the rest as an analysis or opening title.
      const starting = isStart(input.prompt);
      if (
        input.prompt.includes(TURN_END_WORKSTREAM) ||
        input.prompt.includes(START_WORKSTREAM)
      ) {
        const ask = async (prompt: string) => textOf(await answer(prompt));
        const answer = async (prompt: string) =>
          (await options.complete?.({
            ...input,
            prompt,
            signal: call.signal,
          })) ?? DEFAULT_ANSWER;
        const description = await answer(
          starting
            ? input.prompt.replace(START_WORKSTREAM, START)
            : input.prompt,
        );
        // A test that answers in the call's own shape is used as written.
        try {
          const own = JSON.parse(textOf(description)) as unknown;
          if (own && typeof own === "object" && "workstream" in own)
            return { text: textOf(description), usage };
        } catch {
          // Not JSON: handled below.
        }
        const reasoning =
          typeof description === "string" ? null : description.reasoning;
        let described: Record<string, unknown>;
        try {
          described = JSON.parse(asTitleParts(textOf(description))) as Record<
            string,
            unknown
          >;
        } catch {
          // An unparseable answer stays as written, so it fails to parse.
          return { text: textOf(description), usage };
        }
        const workstream = JSON.parse(
          asPlacement(
            // Without the description's opening, so fakes that tell the two
            // calls apart by it answer this part as placement.
            await ask(
              `${PLACEMENT}\n\n${input.prompt.replace("You describe one agent thread", "This agent thread")}`,
            ),
            new WorkstreamStore(openDatabase(host.bb)).list(),
          ),
        ) as Record<string, unknown>;
        if (starting) described = asStart(described);
        return {
          ...(reasoning ? { reasoning, stopReason: "stop" } : {}),
          text: JSON.stringify({
            ...described,
            workstream: workstream.workstream,
            propose: workstream.propose,
            scopeShift: workstream.scopeShift,
          }),
          usage,
        };
      }
      const given = await (options.complete?.({
        ...input,
        signal: call.signal,
      }) ?? DEFAULT_ANSWER);
      const placing = input.prompt.includes(PLACEMENT);
      const naming = NAMING.some((opening) => input.prompt.includes(opening));
      const translate = (text: string) =>
        placing
          ? asPlacement(text, new WorkstreamStore(openDatabase(host.bb)).list())
          : starting
            ? startText(asTitleParts(text))
            : naming
              ? asTitleParts(text)
              : text;
      return typeof given === "string"
        ? { text: translate(given), usage }
        : { ...given, text: translate(given.text), usage, stopReason: "stop" };
    },
    sdk: {
      projects: {
        // A distinctive name that must never reach a model prompt.
        list: async () => [...projects],
        get: async () => ({ id: "proj_1", name: "Zebracorn" }),
        sidebarBootstrap: async () => ({
          personalProject: { id: "proj_personal", name: "Personal" },
        }),
      },
      environments: {
        pullRequest: async ({ environmentId }: { environmentId: string }) => {
          const attention = pullRequests.get(environmentId) ?? null;
          return attention === null
            ? { outcome: "absent" }
            : {
                outcome: "available",
                pullRequest: { attention, number: 1, state: "open" },
              };
        },
        get: async ({ environmentId }: { environmentId: string }) => ({
          id: environmentId,
          hostId: "host_1",
          projectId: "proj_1",
          status: "ready",
          hostLifecycle: "active",
          lifecycle: { phase: "active" },
        }),
      },
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host_1", status: "connected" } as never),
        ],
      },
      providers: {
        models: async () => ({
          models: [
            {
              id: "model-1",
              model: "gpt-5.5",
              isDefault: true,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            },
          ],
          providers: [{ id: "openai", serviceTiers: [{ id: "fast" }] }],
          modelLoadError: null,
          permissionCeiling: "accept-edits",
          selectedOnlyModels: [],
        }),
      },
      threads: {
        getPluginMetadata: async () => ({}),
        promptHistory: async ({
          threadId,
          limit,
        }: {
          threadId: string;
          limit?: string;
        }) =>
          [...(conversations.get(threadId)?.requests ?? [])]
            .reverse()
            .slice(0, Number(limit ?? 50))
            .map((value, i) => ({
              id: `p${i}`,
              createdAt: i,
              input: text(value),
            })),
        spawn: async (args: Record<string, unknown>) => {
          if (options.spawn) return options.spawn(args);
          if (args.title === "Workstreams worker") {
            workerCalls.push(args);
            const answer = await (options.complete?.({
              prompt: String(args.prompt),
              model: String(args.model),
            }) ?? DEFAULT_ANSWER);
            conversations.set(`worker${workerCalls.length}`, {
              requests: [],
              output: typeof answer === "string" ? answer : answer.text,
            });
            return addThread(`worker${workerCalls.length}`, {
              title: "Workstreams worker",
              visibility: "hidden",
              projectId: args.projectId as string,
            });
          }
          spawned.push(args);
          const thread = addThread(`spawn${spawned.length}`, {
            sectionId: (args.sectionId as string | null) ?? null,
            projectId: args.projectId as string,
            parentThreadId: (args.parentThreadId as string | null) ?? null,
          });
          return thread;
        },
        send: async (args: Record<string, unknown>) => {
          await options.send?.(args);
          sent.push(args);
          return { status: "sent" };
        },
        timeline: async () => ({ goal: null, pendingTodos: null }),
        markUnread: async ({ threadId }: { threadId: string }) => {
          markedUnread.push(threadId);
          return { id: threadId };
        },
        stop: async () => ({ ok: true }),
        wait: async ({ threadId }: { threadId: string }) => ({
          matched: true,
          target: { kind: "status", status: "idle" },
          threadId,
        }),
        archive: async ({ threadId }: { threadId: string }) => {
          const thread = threads.get(threadId);
          if (!thread) throw missing(threadId);
          threads.set(threadId, { ...thread, archivedAt: Date.now() });
          return { id: threadId };
        },
        unpin: async ({ threadId }: { threadId: string }) => {
          const thread = threads.get(threadId);
          if (!thread) throw missing(threadId);
          threads.set(threadId, { ...thread, pinnedAt: null });
          return { id: threadId };
        },
        output: async ({ threadId }: { threadId: string }) => ({
          output: conversations.get(threadId)?.output ?? null,
        }),
        events: {
          list: async ({
            threadId,
            types,
          }: {
            threadId: string;
            types?: string[];
          }) => {
            const type = types?.[0];
            if (type === "item/completed")
              return (messages.get(threadId) ?? [])
                .map((message, i) => ({
                  id: `m${i}`,
                  threadId,
                  seq: message.turn * 10 + 1 + i / 100,
                  scope: {
                    kind: "turn",
                    turnId: `${threadId}-t${message.turn}`,
                  },
                  type,
                  data: {
                    type,
                    item: {
                      type: "agentMessage",
                      id: `item${i}`,
                      text: message.text,
                      ...(message.nested ? { parentToolCallId: "call1" } : {}),
                    },
                  },
                  createdAt: 0,
                }))
                .reverse();
            if (type === "turn/started" || type === "turn/completed") {
              const turn = turns.get(threadId);
              if (!turn) return [];
              const started = type === "turn/started";
              return [
                {
                  id: `e${turn.n}`,
                  threadId,
                  seq: turn.n * 10 + (started ? 1 : 2),
                  scope: { kind: "turn", turnId: `${threadId}-t${turn.n}` },
                  type,
                  data: started ? {} : { status: turn.status },
                  createdAt: 0,
                },
              ];
            }
            return (conversations.get(threadId)?.requests ?? []).map(
              (value, i) => ({
                seq: i + 1,
                type: "client/turn/requested",
                data: { input: text(value) },
              }),
            );
          },
        },
        list: async (args: {
          archived?: boolean;
          includeHidden?: boolean;
          sectionId?: string;
          limit?: number;
          offset?: number;
        }) => {
          const all = [...threads.values()].filter(
            (t) =>
              (args.archived ? t.archivedAt !== null : t.archivedAt === null) &&
              (args.includeHidden || t.visibility !== "hidden") &&
              (!args.sectionId || t.sectionId === args.sectionId),
          );
          const offset = args.offset ?? 0;
          return all
            .slice(offset, offset + (args.limit ?? 100))
            .map((thread) => ({
              queuedWork: "none",
              hasPendingInteraction: false,
              activity: {
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activeGoalCount: 0,
                activePlanModeCount: 0,
                activeWorkflowCount: 0,
              },
              ...thread,
            }));
        },
        get: async ({ threadId }: { threadId: string }) => {
          const thread = threads.get(threadId);
          if (!thread) throw missing(threadId);
          return thread;
        },
        update: async ({
          threadId,
          ...patch
        }: {
          threadId: string;
          sectionId?: string | null;
          title?: string | null;
        }) => {
          const thread = threads.get(threadId);
          if (!thread) throw missing(threadId);
          const next = { ...thread, ...patch } as Thread;
          threads.set(threadId, next);
          return next;
        },
      },
      threadSections: {
        list: async () => [...sections],
        create: async ({ name }: { name: string }) => addSection(name),
        update: async ({ id, name }: { id: string; name: string }) => {
          const section = sections.find((s) => s.id === id);
          if (!section) throw new Error("no section");
          section.name = name;
          return section;
        },
        delete: async ({ id }: { id: string }) => {
          const index = sections.findIndex((s) => s.id === id);
          if (index >= 0) sections.splice(index, 1);
          for (const [tid, t] of threads)
            if (t.sectionId === id) threads.set(tid, { ...t, sectionId: null });
          return { id, name: "" };
        },
      },
    } as never,
  });
  await plugin(host.bb);
  if (options.prefs) savePrefs(host.bb.storage.database(), options.prefs);
  // Let the load-time reconcile and analysis catch-up run on the empty world
  // before tests act, then seed explicitly.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await host.harness.behavior.callRpc("refresh", null);
  const converse = (
    id: string,
    requests: string[],
    output: string | null = "Done.",
  ) => conversations.set(id, { requests, output });
  /** Starts the thread's next agent turn, ending it with `status`. */
  const turn = (id: string, status = "completed") => {
    const n = (turns.get(id)?.n ?? 0) + 1;
    turns.set(id, { n, status });
    return `${id}-t${n}`;
  };
  /** The agent writes `text` as a message in the thread's current turn. */
  const say = (id: string, text: string, nested = false) =>
    messages.set(id, [
      ...(messages.get(id) ?? []),
      { turn: turns.get(id)?.n ?? 0, text, nested },
    ]);
  return {
    ...host,
    turn,
    say,
    threads,
    sections,
    addThread,
    addSection,
    converse,
    completions,
    presents,
    spawned,
    workerCalls,
    sent,
    markedUnread,
    pullRequests,
  };
}
