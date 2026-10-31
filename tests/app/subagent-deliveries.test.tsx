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
        { "data-document": JSON.stringify(props.experimental_document) },
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
const reply = `:::reply{state="complete" kind="investigation"}
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
        <Markdown content={notificationHeader} />
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
  expect(message.getByText("@thread:thr_worker")).toBeTruthy();
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
      <div data-message-column="">{reply}</div>
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
      <section data-message-column="">{header}</section>
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
