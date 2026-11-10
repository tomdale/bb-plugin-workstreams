// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Markdown, type PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { SubagentDeliveries } from "../../src/app/reply/SubagentDeliveries.tsx";

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  const { default: ReactMarkdown } = await import("react-markdown");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) =>
      React.createElement(
        "div",
        {
          "data-markdown-preview": "",
          "data-document": JSON.stringify(props.experimental_document),
        },
        React.createElement(ReactMarkdown, {
          children: props.content,
          urlTransform: (url) => url,
        }),
      ),
  };
});
afterEach(cleanup);
const id = "12345678-1234-1234-1234-123456789abc";
const header = `Subagent "Review" (${id}) completed. `;
const reply = `:::reply{state="complete"}
# The controls fit the app
- [x] Reviewed all states

Read [the source](src/widget.ts:12).
:::`;
const text = `${header}\n${reply}\nFull transcript: @thread:thr_worker`;
function fixtures(
  options: {
    match?: boolean;
    input?: string;
    reject?: boolean;
    delay?: Promise<void>;
    title?: string;
    groups?: "visible" | "hidden";
    label?: string;
    plainPreview?: boolean;
  } = {},
) {
  const title = options.title ?? "Review";
  const notificationHeader = `Subagent ${JSON.stringify(title)} (${id}) completed. `;
  const events = vi.fn(async () => {
    await options.delay;
    if (options.reject) throw Error("Offline");
    const input = [
      {
        type: "text",
        text:
          options.input ??
          `${notificationHeader}\n${reply}\nFull transcript: @thread:thr_worker`,
      },
    ];
    const other = [{ type: "text", text: "User requested a review" }];
    const inputGroups = options.groups
      ? [
          ...(options.groups === "hidden"
            ? [
                [
                  {
                    type: "text",
                    text: "Hidden setup",
                    visibility: "agent-only",
                  },
                ],
              ]
            : []),
          other,
          input,
        ]
      : undefined;
    return [
      {
        type: "client/turn/requested",
        seq: 42,
        data: {
          input: inputGroups
            ? [...other, { type: "text", text: "\n\n" }, ...input]
            : input,
          ...(inputGroups ? { inputGroups } : {}),
        },
      },
    ];
  });
  const callRpc = vi.fn(async () => ({
    runs: [
      {
        id,
        title,
        threadId: "thr_worker",
        output: reply,
        ownerThreadId: options.match === false ? "thr_other" : "thr_parent",
      },
    ],
  }));
  const get = vi.fn(async () => ({
    environment: {
      id: "env_worker",
      path: "/work/worker",
      hostId: "host_worker",
    },
  }));
  const sdk = {
    threads: { events: { list: events }, get },
    plugins: { callRpc },
  } as unknown as PluginBrowserBbSdk;
  const message = render(
    <div
      data-timeline-row-id={`thr_parent:user-seed:42${options.groups ? "-1" : ""}`}
    >
      <div data-message-column="">
        {options.label ? <span>{options.label}</span> : null}
        {options.plainPreview ? (
          <span>{notificationHeader}</span>
        ) : (
          <Markdown content={notificationHeader} />
        )}
        <p>:::reply…</p>
        <button>Show more</button>
      </div>
    </div>,
  );
  const overlay = renderSlot({ component: SubagentDeliveries }, {}, { sdk });
  return { message, overlay, events, callRpc, get };
}

it("renders the complete saved reply outside the clipped bubble and restores it on unmount", async () => {
  const { message, overlay, events, callRpc, get } = fixtures();
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-reply-block]"),
    ).not.toBeNull(),
  );
  expect(message.getByText("The controls fit the app")).toBeTruthy();
  expect(message.getByText("Reviewed all states")).toBeTruthy();
  expect(message.getByText("Review")).toBeTruthy();
  expect(
    message.getByText("@thread:thr_worker").closest("[data-markdown-preview]"),
  ).not.toBeNull();
  expect(
    message.container
      .querySelector("[data-ws-subagent-delivery]")
      ?.hasAttribute("data-bb-plugin-root"),
  ).toBe(true);
  expect(
    message.container.querySelector(".ws-subagent-delivery-source"),
  ).not.toBeNull();
  expect(
    message.container.querySelectorAll("[data-ws-subagent-anchor]"),
  ).toHaveLength(1);
  expect(events).toHaveBeenCalledTimes(1);
  expect(callRpc).toHaveBeenCalledWith({
    pluginId: "subagents",
    method: "list",
    input: { threadId: "thr_parent" },
    outputSchema: expect.anything(),
  });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith({
      threadId: "thr_worker",
      include: "environment",
    }),
  );
  await waitFor(() =>
    expect(
      message.container
        .querySelector('a[href="src/widget.ts:12"]')
        ?.closest("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain('"threadId":"thr_worker"'),
  );
  overlay.lifecycle.unmount();
  expect(message.container.querySelector("[data-reply-block]")).toBeNull();
  expect(
    message.container.querySelector(".ws-subagent-delivery-source"),
  ).toBeNull();
  expect(message.getByText("Show more")).toBeTruthy();
});

it("recognizes a quoted title after Markdown removes its JSON escapes", async () => {
  const title = 'Review "controls"';
  const { message, overlay } = fixtures({ title });
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-reply-block]"),
    ).not.toBeNull(),
  );
  expect(message.getByText(title)).toBeTruthy();
  overlay.lifecycle.unmount();
});

it.each(["Steer", "Follow-up"])(
  "recognizes a delivery after BB's %s label",
  async (label) => {
    const { message, overlay } = fixtures({ label });
    await waitFor(() =>
      expect(
        message.container.querySelector("[data-reply-block]"),
      ).not.toBeNull(),
    );
    expect(message.getByText("The controls fit the app")).toBeTruthy();
    expect(
      message.container.querySelector(".ws-subagent-delivery-source"),
    ).not.toBeNull();
    overlay.lifecycle.unmount();
    expect(message.getByText(label)).toBeTruthy();
  },
);

it.each(["visible", "hidden"] as const)(
  "renders the matching visible row from %s grouped input",
  async (groups) => {
    const { message, overlay } = fixtures({ groups });
    await waitFor(() =>
      expect(
        message.container.querySelector("[data-reply-block]"),
      ).not.toBeNull(),
    );
    expect(message.getByText("The controls fit the app")).toBeTruthy();
    expect(message.queryByText("Hidden setup")).toBeNull();
    expect(message.queryByText("User requested a review")).toBeNull();
    overlay.lifecycle.unmount();
  },
);

it("recognizes a collapsed plain-text delivery without a Markdown wrapper", async () => {
  const { message, overlay } = fixtures({
    label: "Steer",
    plainPreview: true,
  });
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-reply-block]"),
    ).not.toBeNull(),
  );
  expect(message.getByText("The controls fit the app")).toBeTruthy();
  overlay.lifecycle.unmount();
});

it.each([
  { match: false },
  { input: text.replace("The controls fit the app", "Unverified output") },
  { input: text.replace(/\n:::\n/, "\n") },
  { reject: true },
])(
  "keeps the original notification when a replacement cannot be verified: %s",
  async (options) => {
    const { message, overlay, events } = fixtures(options);
    await waitFor(() => expect(events).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      message.container.querySelector("[data-ws-subagent-anchor]"),
    ).toBeNull();
    expect(
      message.container.querySelector(".ws-subagent-delivery-source"),
    ).toBeNull();
    overlay.lifecycle.unmount();
  },
);

it("does not activate blocks in ordinary user messages", async () => {
  const message = render(
    <div data-timeline-row-id="thr_parent:user-seed:42">
      <div data-message-column="">
        <Markdown content={reply} />
      </div>
    </div>,
  );
  const events = vi.fn();
  const sdk = {
    threads: { events: { list: events } },
  } as unknown as PluginBrowserBbSdk;
  const overlay = renderSlot({ component: SubagentDeliveries }, {}, { sdk });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(events).not.toHaveBeenCalled();
  expect(
    message.container.querySelector("[data-ws-subagent-anchor]"),
  ).toBeNull();
  overlay.lifecycle.unmount();
});

it("does not attach a late result to a recycled timeline row", async () => {
  let finish!: () => void;
  const delay = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { message, overlay, callRpc } = fixtures({ delay });
  message.rerender(
    <div data-timeline-row-id="thr_parent:user-seed:43">
      <div data-message-column="">A different message</div>
    </div>,
  );
  await act(async () => {
    finish();
    await delay;
  });
  await waitFor(() => expect(callRpc).toHaveBeenCalled());
  expect(
    message.container.querySelector("[data-ws-subagent-anchor]"),
  ).toBeNull();
  expect(
    message.container.querySelector(".ws-subagent-delivery-source"),
  ).toBeNull();
  overlay.lifecycle.unmount();
});

it("restores the old host when BB remounts the body of a retained row", async () => {
  const { message, overlay } = fixtures();
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-reply-block]"),
    ).not.toBeNull(),
  );
  const oldHost = message.container.querySelector("[data-message-column]")!;
  message.rerender(
    <div data-timeline-row-id="thr_parent:user-seed:42">
      <section data-message-column="">
        <Markdown content={header} />
      </section>
    </div>,
  );
  await waitFor(() =>
    expect(
      message.container.querySelector("section.ws-subagent-delivery-source"),
    ).not.toBeNull(),
  );
  expect(oldHost.classList.contains("ws-subagent-delivery-source")).toBe(false);
  expect(
    message.container.querySelectorAll("[data-ws-subagent-anchor]"),
  ).toHaveLength(1);
  overlay.lifecycle.unmount();
});

it("cleans up a retained row reported through removed mutation nodes", async () => {
  const { message, overlay } = fixtures();
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-ws-subagent-anchor]"),
    ).not.toBeNull(),
  );
  const row = message.container.querySelector<HTMLElement>(
    "[data-timeline-row-id]",
  )!;
  const host = row.querySelector<HTMLElement>("[data-message-column]")!;

  message.unmount();

  await waitFor(() => {
    expect(row.querySelector("[data-ws-subagent-anchor]")).toBeNull();
    expect(host.classList.contains("ws-subagent-delivery-source")).toBe(false);
  });
  overlay.lifecycle.unmount();
});

it("does not scan the full timeline for unrelated DOM updates", async () => {
  const { message, overlay } = fixtures();
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-reply-block]"),
    ).not.toBeNull(),
  );
  const composer = document.createElement("div");
  composer.dataset.appComposer = "";
  const composerText = document.createElement("div");
  composer.append(composerText);
  const sidebar = document.createElement("aside");
  const assistant = document.createElement("div");
  assistant.dataset.timelineRowId = "thr_parent:assistant";
  const stream = document.createElement("p");
  assistant.append(stream);
  message.container.append(composer, sidebar, assistant);
  const queries = vi.spyOn(document, "querySelectorAll");
  const scans = () =>
    queries.mock.calls.filter(
      ([selector]) => selector === "[data-timeline-row-id]",
    ).length;
  const flush = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await flush();
  queries.mockClear();

  try {
    for (const value of ["H", "He", "Hel"]) {
      composerText.textContent = value;
      await flush();
    }
    const composerScans = scans();
    for (const label of ["One", "Two"]) {
      sidebar.append(document.createTextNode(label));
      await flush();
    }
    const sidebarScans = scans() - composerScans;
    const beforeStreaming = scans();
    for (const chunk of ["Working", " on", " the", " answer"]) {
      stream.append(document.createTextNode(chunk));
      await flush();
    }
    const streamingScans = scans() - beforeStreaming;

    expect({ composerScans, sidebarScans, streamingScans }).toEqual({
      composerScans: 0,
      sidebarScans: 0,
      streamingScans: 0,
    });
  } finally {
    queries.mockRestore();
    overlay.lifecycle.unmount();
  }
});

/** Delivery rows for several runs of one owner thread, keyed by event seq. */
function deliveryThread(seqs: number[]) {
  const ids = new Map(
    seqs.map((seq) => [
      seq,
      `${String(seq).padStart(8, "0")}-1234-1234-1234-123456789abc`,
    ]),
  );
  const notice = (seq: number) =>
    `Subagent "Review ${seq}" (${ids.get(seq)}) completed. `;
  const events = vi.fn(async ({ afterSeq }: { afterSeq: string }) => {
    const seq = Number(afterSeq) + 1;
    return [
      {
        type: "client/turn/requested",
        seq,
        data: {
          input: [
            {
              type: "text",
              text: `${notice(seq)}\n${reply}\nFull transcript: @thread:thr_worker`,
            },
          ],
        },
      },
    ];
  });
  /** Runs the subagents plugin reports; a test adds runs as they finish. */
  const finished = new Set(seqs);
  const callRpc = vi.fn(async () => ({
    runs: [...finished].map((seq) => ({
      id: ids.get(seq)!,
      title: `Review ${seq}`,
      threadId: "thr_worker",
      output: reply,
      ownerThreadId: "thr_parent",
    })),
  }));
  const get = vi.fn(async () => ({
    environment: { id: "env_worker", path: "/work/worker", hostId: "host" },
  }));
  const sdk = {
    threads: { events: { list: events }, get },
    plugins: { callRpc },
  } as unknown as PluginBrowserBbSdk;
  const Row = ({ seq }: { seq: number }) => (
    <div data-timeline-row-id={`thr_parent:user-seed:${seq}`}>
      <div data-message-column="">
        <Markdown content={notice(seq)} />
      </div>
    </div>
  );
  const Timeline = ({ rows }: { rows: number[] }) => (
    <>
      {rows.map((seq) => (
        <Row key={seq} seq={seq} />
      ))}
    </>
  );
  return { sdk, events, callRpc, get, finished, ids, Timeline };
}

const cards = (container: HTMLElement) =>
  container.querySelectorAll("[data-ws-subagent-delivery]").length;

it("reads each delivery row once, however often BB remounts it", async () => {
  const thread = deliveryThread([42, 43]);
  const message = render(<thread.Timeline rows={[42, 43]} />);
  const overlay = renderSlot(
    { component: SubagentDeliveries },
    {},
    { sdk: thread.sdk },
  );
  await waitFor(() => expect(cards(message.container)).toBe(2));
  // Both rows of the thread share one run list.
  expect(thread.callRpc).toHaveBeenCalledTimes(1);
  expect(thread.events).toHaveBeenCalledTimes(2);

  // Virtualized scrolling unmounts rows and mounts them again.
  for (let pass = 0; pass < 3; pass++) {
    message.rerender(<thread.Timeline rows={[]} />);
    await waitFor(() => expect(cards(message.container)).toBe(0));
    message.rerender(<thread.Timeline rows={[42, 43]} />);
    await waitFor(() => expect(cards(message.container)).toBe(2));
  }
  expect(thread.events).toHaveBeenCalledTimes(2);
  expect(thread.callRpc).toHaveBeenCalledTimes(1);
  expect(thread.get).toHaveBeenCalledTimes(1);
  overlay.lifecycle.unmount();
});

it("asks for the run list again when a newer delivery is not in it", async () => {
  const thread = deliveryThread([42, 43]);
  thread.finished.delete(43);
  const message = render(<thread.Timeline rows={[42]} />);
  const overlay = renderSlot(
    { component: SubagentDeliveries },
    {},
    { sdk: thread.sdk },
  );
  await waitFor(() => expect(cards(message.container)).toBe(1));
  thread.finished.add(43);
  message.rerender(<thread.Timeline rows={[42, 43]} />);
  await waitFor(() => expect(cards(message.container)).toBe(2));
  expect(thread.callRpc).toHaveBeenCalledTimes(2);
  overlay.lifecycle.unmount();
});

it("judges an ordinary message row once instead of on every mutation", async () => {
  const message = render(
    <div data-timeline-row-id="thr_parent:user-seed:7">
      <div data-message-column="">
        <p>Please review the plan.</p>
      </div>
    </div>,
  );
  const row = message.container.querySelector<HTMLElement>(
    "[data-timeline-row-id]",
  )!;
  const paragraph = row.querySelector("p")!;
  const reads = vi.spyOn(row, "querySelector");
  const events = vi.fn();
  const sdk = {
    threads: { events: { list: events } },
  } as unknown as PluginBrowserBbSdk;
  const overlay = renderSlot({ component: SubagentDeliveries }, {}, { sdk });
  const flush = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await flush();
  expect(reads).toHaveBeenCalledTimes(1);
  for (const text of [" It", " is", " long."]) {
    paragraph.append(document.createTextNode(text));
    await flush();
  }
  expect(reads).toHaveBeenCalledTimes(1);
  expect(events).not.toHaveBeenCalled();
  overlay.lifecycle.unmount();
});
