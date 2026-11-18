// @vitest-environment jsdom
import { useState } from "react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  useComposer,
  type ComposerSelection,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QuestionComposerPickers } from "../../../src/app/question/QuestionComposerPickers.tsx";
import { sidebarThread } from "../fixtures.ts";

afterEach(cleanup);

const thread = sidebarThread("thread-picker-test", {
  hasPendingInteraction: true,
  host: { id: "host-test", name: "Development machine" },
  environment: {
    id: "env-test",
    name: "Plugin checkout",
    branchName: "tomdale/question-pickers",
    path: "/workspace/plugin",
    isWorktree: true,
    providerId: "git-worktree",
    workspaceDisplayKind: null,
  },
});
const selection: ComposerSelection = {
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "high",
  serviceTier: "fast",
  permissionMode: "accept-edits",
};

function HostComposer({
  currentThread = thread,
  portaled = true,
  disabled = true,
  role = "primary",
  controlsKey = "original",
}: {
  currentThread?: PluginSidebarThread;
  portaled?: boolean;
  disabled?: boolean;
  role?: "primary" | "secondary";
  controlsKey?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const composer = useComposer();
  return (
    <div data-app-composer="" data-app-composer-role={role}>
      <div ref={setAnchor}>
        <QuestionComposerPickers anchor={anchor} thread={currentThread} />
        <button
          onClick={() =>
            composer.replace({
              text: "/plan",
              mentions: [
                {
                  from: 0,
                  to: 5,
                  label: "plan",
                  kind: "command",
                  trigger: "/",
                  name: "plan",
                  source: "command",
                  origin: "builtin",
                  argumentHint: null,
                },
              ],
            })
          }
        >
          Plan next message
        </button>
      </div>
      {portaled ? <span className="ws-question-portaled" hidden /> : null}
      <div key={controlsKey} data-follow-up-composer="" hidden={portaled}>
        <button
          aria-label="Provider, model and reasoning (shortcut)"
          disabled={disabled}
        >
          Native model
        </button>
        <button aria-label="Permission mode" disabled={disabled}>
          Native permission
        </button>
        <button disabled={portaled}>Send</button>
      </div>
    </div>
  );
}

function mount(
  props: Parameters<typeof HostComposer>[0] = {},
  selected = selection,
) {
  return renderSlot({ component: HostComposer }, props, {
    composer: {
      scope: { kind: "thread", threadId: thread.id },
      selection: selected,
      text: "Follow up after the answer",
    },
  });
}

it("changes next-message settings through the bound composer while sending stays blocked", async () => {
  const slot = mount();
  const model = await slot.findByTestId("bb-provider-model-picker");
  expect(model.getAttribute("data-routing-kind")).toBe("environment");
  expect(model.getAttribute("data-routing-id")).toBe("env-test");
  expect(
    slot.getByText("Native model").previousElementSibling?.contains(model),
  ).toBe(true);
  expect(
    slot
      .getByText("Native model")
      .hasAttribute("data-ws-question-picker-replaced"),
  ).toBe(true);
  expect(slot.getByText("Send")).toHaveProperty("disabled", true);
  fireEvent.change(slot.getByLabelText("Provider ID"), {
    target: { value: "pi" },
  });
  fireEvent.change(slot.getByLabelText("Model"), {
    target: { value: "vercel-ai-gateway/anthropic/claude-sonnet-5.5" },
  });
  fireEvent.change(slot.getByLabelText("Reasoning level"), {
    target: { value: "medium" },
  });
  fireEvent.change(slot.getByLabelText("Service tier"), {
    target: { value: "default" },
  });
  fireEvent.click(slot.getByText("Apply execution selection"));
  await waitFor(() =>
    expect(slot.inspection.composer.selections).toHaveLength(1),
  );
  expect(slot.inspection.composer.selection).toMatchObject({
    providerId: "pi",
    model: "vercel-ai-gateway/anthropic/claude-sonnet-5.5",
    reasoningLevel: "medium",
    serviceTier: "default",
  });
  fireEvent.change(slot.getByTestId("bb-permission-mode-picker"), {
    target: { value: "full" },
  });
  await waitFor(() =>
    expect(slot.inspection.composer.selection?.permissionMode).toBe("full"),
  );
  expect(slot.inspection.composer.submits).toHaveLength(0);
  expect(slot.getByText("Send")).toHaveProperty("disabled", true);
});

it("restores host controls when the question closes and after unmount", async () => {
  const slot = mount();
  await slot.findByTestId("bb-provider-model-picker");
  const native = slot.getByText("Native model");
  slot.lifecycle.rerender(<HostComposer portaled={false} />);
  await waitFor(() =>
    expect(slot.queryByTestId("bb-provider-model-picker")).toBeNull(),
  );
  expect(native.hasAttribute("data-ws-question-picker-replaced")).toBe(false);
  expect(
    slot.container.querySelectorAll("[data-ws-question-picker]"),
  ).toHaveLength(0);
  slot.lifecycle.rerender(<HostComposer portaled />);
  await slot.findByTestId("bb-provider-model-picker");
  slot.lifecycle.unmount();
  expect(native.hasAttribute("data-ws-question-picker-replaced")).toBe(false);
});

it("reattaches once when BB replaces the control row", async () => {
  const slot = mount();
  await slot.findByTestId("bb-provider-model-picker");
  const original = slot.getByText("Native model");
  slot.lifecycle.rerender(<HostComposer controlsKey="new-row" />);
  await waitFor(() => {
    const next = slot.getByText("Native model");
    expect(next).not.toBe(original);
    expect(
      next.previousElementSibling?.contains(
        slot.getByTestId("bb-provider-model-picker"),
      ),
    ).toBe(true);
  });
  expect(original.hasAttribute("data-ws-question-picker-replaced")).toBe(false);
  expect(
    slot.container.querySelectorAll("[data-ws-question-picker]"),
  ).toHaveLength(2);
});

it.each([
  { portaled: false },
  { disabled: false },
  { currentThread: { ...thread, id: "other-thread" } },
  { currentThread: { ...thread, isArchived: true } },
])(
  "leaves native controls alone outside a blocked Workstreams question: %j",
  async (props) => {
    const slot = mount(props);
    await act(async () => undefined);
    expect(slot.queryByTestId("bb-provider-model-picker")).toBeNull();
    expect(
      slot
        .getByText("Native model")
        .hasAttribute("data-ws-question-picker-replaced"),
    ).toBe(false);
  },
);

it("preserves plan-mode and inherited permission locks", async () => {
  const slot = mount({
    currentThread: { ...thread, activity: { ...thread.activity, planMode: 1 } },
  });
  await slot.findByTestId("bb-provider-model-picker");
  expect(slot.queryByTestId("bb-permission-mode-picker")).toBeNull();
  expect(
    slot
      .getByText("Native permission")
      .hasAttribute("data-ws-question-picker-replaced"),
  ).toBe(false);
  slot.lifecycle.rerender(<HostComposer role="secondary" />);
  await slot.findByTestId("bb-provider-model-picker");
  expect(slot.queryByTestId("bb-permission-mode-picker")).toBeNull();
  slot.lifecycle.rerender(<HostComposer />);
  await slot.findByTestId("bb-permission-mode-picker");
  fireEvent.click(slot.getByText("Plan next message"));
  await waitFor(() =>
    expect(slot.queryByTestId("bb-permission-mode-picker")).toBeNull(),
  );
});

it("routes a personal thread through its machine", async () => {
  const slot = mount({ currentThread: { ...thread, environment: null } });
  expect(
    (await slot.findByTestId("bb-provider-model-picker")).getAttribute(
      "data-routing-id",
    ),
  ).toBe("host-test");
});

it("does not hide a native picker before its selection is available", async () => {
  const slot = mount({}, {});
  await act(async () => undefined);
  expect(slot.queryByTestId("bb-provider-model-picker")).toBeNull();
  expect(
    slot
      .getByText("Native model")
      .hasAttribute("data-ws-question-picker-replaced"),
  ).toBe(false);
});

it("uses the mounted question before the sidebar pending flag catches up", async () => {
  const slot = mount({
    currentThread: { ...thread, hasPendingInteraction: false },
  });
  await slot.findByTestId("bb-provider-model-picker");
  await slot.behavior.setComposerScope({
    kind: "queued-message",
    threadId: thread.id,
    queuedMessageId: "queued-test",
  });
  await waitFor(() =>
    expect(slot.queryByTestId("bb-provider-model-picker")).toBeNull(),
  );
  expect(
    slot
      .getByText("Native model")
      .hasAttribute("data-ws-question-picker-replaced"),
  ).toBe(false);
});

it("ignores a question mounted in a nested composer", async () => {
  const slot = mount({ portaled: false });
  const nested = document.createElement("div");
  nested.setAttribute("data-app-composer", "");
  nested.innerHTML =
    '<span class="ws-question-portaled" hidden></span><div data-follow-up-composer><button aria-label="Provider, model and reasoning" disabled>Nested model</button></div>';
  await act(async () => {
    slot.container.querySelector("[data-app-composer]")!.append(nested);
  });
  expect(slot.queryByTestId("bb-provider-model-picker")).toBeNull();
  expect(
    slot.container.querySelector("[data-ws-question-picker-replaced]"),
  ).toBeNull();
});
