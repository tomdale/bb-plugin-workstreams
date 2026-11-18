// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PostTurnDocuments } from "../../src/app/postTurn/PostTurnDocuments.tsx";
import { assistantMessageId } from "../../src/domain/postTurn/message.ts";
import { documentText } from "../../src/domain/postTurn/document.ts";
import {
  CORRECTION,
  DEPLOYED_CHANGE,
  SETTINGS_PLAN,
} from "../fixtures/postTurn.ts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const T1 = assistantMessageId({
  threadId: "thr_a",
  turnId: "t1",
  itemId: "m1",
});
const T2 = assistantMessageId({
  threadId: "thr_a",
  turnId: "t2",
  itemId: "m2",
});
const ORIGINAL = "<p>Presets sync between windows now.</p>";

/** A timeline row as BB draws it: the wrapper, then the message column. */
function row(id: string, parent: HTMLElement = document.body, column = true) {
  const element = document.createElement("div");
  element.dataset.timelineRowId = id;
  if (column) {
    const message = document.createElement("div");
    message.setAttribute("data-message-column", "");
    message.innerHTML = ORIGINAL;
    element.append(message);
  }
  parent.append(element);
  return element;
}

function mount(
  items: () => { messageId: string; document: unknown }[],
  enabled = () => true,
) {
  const presentations = vi.fn(async ({ threadId }: { threadId: string }) => ({
    enabled: enabled(),
    items:
      threadId === "thr_a"
        ? items().map((item) => ({
            workstream: { name: "Snooze", color: null },
            ...item,
          }))
        : [],
  }));
  const slot = renderSlot(
    { component: PostTurnDocuments },
    {},
    { rpc: { presentations } as never },
  );
  return { slot, presentations };
}
const drawn = (element: ParentNode) =>
  element.querySelectorAll(
    ":scope > [data-ws-post-turn-anchor] [data-ws-document]",
  );

describe("PostTurnDocuments", () => {
  it("draws below the exact row and leaves the original response untouched", async () => {
    const target = row(T1);
    const userRow = row("thr_a:user-seed:4");
    const nested = row(`thr_p:delegation:call_1:child:${T1}`);
    const other = row(T2);
    const { presentations } = mount(() => [
      { messageId: T1, document: DEPLOYED_CHANGE },
    ]);
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
    const column = target.querySelector("[data-message-column]")!;
    expect(column.innerHTML).toBe(ORIGINAL);
    expect(
      column.nextElementSibling?.hasAttribute("data-ws-post-turn-anchor"),
    ).toBe(true);
    for (const element of [userRow, nested, other])
      expect(element.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
    expect(target.textContent).toContain("All four local checks passed");
    expect(target.textContent).toContain("1 test skipped");
    // One read for the thread, however many of its rows are on screen.
    expect(presentations).toHaveBeenCalledTimes(1);
  });

  it("draws a thread mention in the document as a thread chip", async () => {
    const target = row(T1);
    mount(() => [
      {
        messageId: T1,
        document: {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              text: ["@thread:thr_ahqvgud24k runs ", { code: "dormant-path" }],
            },
          ],
        },
      },
    ]);
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
    expect(
      target.querySelector('a[href$="/threads/thr_ahqvgud24k"]'),
    ).not.toBeNull();
    expect(target.textContent).not.toContain("@thread:");
    expect(target.textContent).toContain("dormant-path");
  });

  it("draws one copy per pane and never doubles one", async () => {
    const left = document.createElement("section");
    const right = document.createElement("section");
    document.body.append(left, right);
    const a = row(T1, left);
    const b = row(T1, right);
    mount(() => [{ messageId: T1, document: CORRECTION }]);
    await waitFor(() => {
      expect(drawn(a)).toHaveLength(1);
      expect(drawn(b)).toHaveLength(1);
    });
    // A later mutation in the row rescans it without adding another.
    act(() => {
      a.querySelector("[data-message-column]")!.append(
        document.createElement("span"),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(a.querySelectorAll("[data-ws-post-turn-anchor]")).toHaveLength(1);
    expect(b.querySelectorAll("[data-ws-post-turn-anchor]")).toHaveLength(1);
  });

  it("restores the document when a virtualized row returns, without reading again", async () => {
    const first = row(T1);
    const { presentations } = mount(() => [
      { messageId: T1, document: CORRECTION },
    ]);
    await waitFor(() => expect(drawn(first)).toHaveLength(1));
    act(() => first.remove());
    const returned = row(T1);
    await waitFor(() => expect(drawn(returned)).toHaveLength(1));
    expect(presentations).toHaveBeenCalledTimes(1);
  });

  it("skips a row whose message column is missing", async () => {
    const bare = row(T1, document.body, false);
    mount(() => [{ messageId: T1, document: CORRECTION }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bare.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
  });

  it("draws nothing while the experiment is off, or for an invalid document", async () => {
    const target = row(T1);
    const other = row(T2);
    let on = false;
    const { slot } = mount(
      () => [
        { messageId: T1, document: CORRECTION },
        { messageId: T2, document: { version: 1, blocks: [{ type: "html" }] } },
      ],
      () => on,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
    on = true;
    await slot.emitRealtime("presentationPrefs", { prefs: { enabled: true } });
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
    expect(other.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
    on = false;
    await slot.emitRealtime("presentationPrefs", { prefs: { enabled: false } });
    await waitFor(() =>
      expect(target.querySelector("[data-ws-post-turn-anchor]")).toBeNull(),
    );
  });

  it("draws a document stored after the row appeared", async () => {
    const target = row(T1);
    let items: { messageId: string; document: unknown }[] = [];
    const { slot } = mount(() => items);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
    items = [{ messageId: T1, document: CORRECTION }];
    await slot.emitRealtime("presentations", { threadId: "thr_a" });
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
  });

  it("ignores a list that was replaced while it loaded", async () => {
    const target = row(T1);
    let on = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const presentations = vi.fn(async () => {
      const enabled = on;
      await gate;
      return {
        enabled,
        items: [{ messageId: T1, workstream: null, document: CORRECTION }],
      };
    });
    const slot = renderSlot(
      { component: PostTurnDocuments },
      {},
      { rpc: { presentations } as never },
    );
    await waitFor(() => expect(presentations).toHaveBeenCalledTimes(1));
    on = false;
    await slot.emitRealtime("presentationPrefs", { prefs: { enabled: false } });
    await waitFor(() => expect(presentations).toHaveBeenCalledTimes(2));
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(target.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
  });

  it("copies the complete text form, folded rows included", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const target = row(T1);
    mount(() => [{ messageId: T1, document: DEPLOYED_CHANGE }]);
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
    const copy = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Copy"),
    )!;
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(documentText(DEPLOYED_CHANGE));
    expect(writeText.mock.calls[0]![0]).toContain(
      "Test suite: passed (2,104 passed, 0 failed, 1 skipped)",
    );
    await waitFor(() => expect(copy.textContent).toContain("Copied"));
  });

  it("removes its anchors when it unmounts", async () => {
    const target = row(T1);
    const { slot } = mount(() => [{ messageId: T1, document: CORRECTION }]);
    await waitFor(() => expect(drawn(target)).toHaveLength(1));
    slot.unmount();
    expect(target.querySelector("[data-ws-post-turn-anchor]")).toBeNull();
    expect(target.querySelector("[data-message-column]")!.innerHTML).toBe(
      ORIGINAL,
    );
  });
});

describe("plan documents", () => {
  type Outcome =
    | { kind: "approved" }
    | { kind: "replied"; message: string }
    | { kind: "superseded" }
    | null;

  /** A plan below T1, with a server that records answers like the plugin's. */
  function mountPlan(
    options: {
      outcome?: Outcome;
      refuse?: string;
    } = {},
  ) {
    let outcome: Outcome = options.outcome ?? null;
    const presentations = vi.fn(async () => ({
      enabled: true,
      items: [
        {
          messageId: T1,
          workstream: { name: "Workstreams", color: null },
          document: SETTINGS_PLAN,
          outcome,
        },
      ],
    }));
    const presentation_answer = vi.fn(
      async ({
        answer,
      }: {
        answer: { kind: "approve" } | { kind: "reply"; message: string };
      }) => {
        if (options.refuse) throw new Error(options.refuse);
        outcome =
          answer.kind === "approve"
            ? { kind: "approved" }
            : { kind: "replied", message: answer.message };
        return { outcome };
      },
    );
    const target = row(T1);
    const slot = renderSlot(
      { component: PostTurnDocuments },
      {},
      { rpc: { presentations, presentation_answer } as never },
    );
    return { target, slot, presentations, presentation_answer };
  }
  const plan = (target: HTMLElement) =>
    target.querySelector<HTMLElement>("[data-ws-plan]");
  const approve = (target: HTMLElement) =>
    target.querySelector<HTMLButtonElement>("[data-plan-approve]");
  const replies = (target: HTMLElement) => [
    ...target.querySelectorAll<HTMLButtonElement>("[data-plan-reply]"),
  ];

  it("draws the plan form without the document surface", async () => {
    const { target } = mountPlan();
    await waitFor(() => expect(plan(target)).not.toBeNull());
    const view = plan(target)!;
    expect(view.querySelector("[data-doc-body]")).toBeNull();
    expect(view.querySelector("header")!.textContent).toContain("Plan");
    expect(view.querySelector("h3")!.textContent).toBe(
      "Move settings from JSON to SQLite",
    );
    const steps = [...view.querySelectorAll("ol > li")].map((li) =>
      li.textContent?.trim(),
    );
    expect(steps).toEqual([
      "1Add SQLite storageCreate the ws_setting table, then write settings to SQLite and JSON for one release.",
      "2Switch reads to SQLiteOn the next release's first launch, copy the JSON values into SQLite.",
      "3Keep the JSON fallbackLeave the blob unchanged for two releases, then delete it.",
      "4Remove dual writesDelete the code that writes to both stores.",
    ]);
    const headings = [...view.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(["Risks", "Notes"]);
    expect(view.querySelectorAll("ul > li")).toHaveLength(2);
    expect(view.textContent).toContain(
      "Versioned JSON: less work, but two windows saving at once could still overwrite each other.",
    );
    expect(approve(target)!.textContent).toBe("Approve");
    expect(approve(target)!.disabled).toBe(false);
    expect(view.textContent).not.toMatch(/approve this/i);
    const group = view.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Suggested replies");
    // The replies sit outside the plan's reading measure.
    expect(group.parentElement).toBe(view);
    expect(replies(target).map((button) => button.textContent)).toEqual(
      SETTINGS_PLAN.plan.replies,
    );
  });

  it("approves through the server and removes the replies", async () => {
    const { target, presentation_answer } = mountPlan();
    await waitFor(() => expect(approve(target)).not.toBeNull());
    fireEvent.click(approve(target)!);
    expect(replies(target)).toHaveLength(0);
    await waitFor(() =>
      expect(target.querySelector("[data-plan-approved]")).not.toBeNull(),
    );
    expect(presentation_answer).toHaveBeenCalledTimes(1);
    expect(presentation_answer.mock.calls[0]![0]).toEqual({
      threadId: "thr_a",
      messageId: T1,
      answer: { kind: "approve" },
    });
    expect(approve(target)).toBeNull();
    expect(replies(target)).toHaveLength(0);
  });

  it.each(SETTINGS_PLAN.plan.replies!.map((reply) => [reply]))(
    "sends %s and keeps it as the sent message, disabling Approve",
    async (reply) => {
      const { target, presentation_answer } = mountPlan();
      await waitFor(() => expect(replies(target)).toHaveLength(4));
      fireEvent.click(replies(target).find((b) => b.textContent === reply)!);
      await waitFor(() =>
        expect(presentation_answer).toHaveBeenCalledWith(
          expect.objectContaining({
            messageId: T1,
            answer: { kind: "reply", message: reply },
          }),
        ),
      );
      const sent = target.querySelector("[data-plan-sent]")!;
      expect(sent.textContent).toBe(reply);
      expect(sent.getAttribute("role")).toBe("status");
      expect(replies(target)).toHaveLength(0);
      expect(approve(target)!.disabled).toBe(true);
      fireEvent.click(approve(target)!);
      expect(presentation_answer).toHaveBeenCalledTimes(1);
    },
  );

  it("draws a stored outcome after a reload", async () => {
    const replied = mountPlan({
      outcome: { kind: "replied", message: "What if the copy fails?" },
    });
    await waitFor(() => expect(plan(replied.target)).not.toBeNull());
    expect(replied.target.querySelector("[data-plan-sent]")!.textContent).toBe(
      "What if the copy fails?",
    );
    expect(approve(replied.target)!.disabled).toBe(true);
    cleanup();
    document.body.innerHTML = "";
    const passed = mountPlan({ outcome: { kind: "superseded" } });
    await waitFor(() => expect(plan(passed.target)).not.toBeNull());
    expect(approve(passed.target)).toBeNull();
    expect(replies(passed.target)).toHaveLength(0);
    expect(passed.target.querySelector("[data-plan-sent]")).toBeNull();
  });

  it("restores the open plan with the server's reason when it refuses", async () => {
    const { target } = mountPlan({
      refuse: "A newer turn has replaced this plan.",
    });
    await waitFor(() => expect(replies(target)).toHaveLength(4));
    fireEvent.click(replies(target)[1]!);
    await waitFor(() =>
      expect(target.querySelector('[role="alert"]')!.textContent).toBe(
        "A newer turn has replaced this plan.",
      ),
    );
    expect(target.querySelector("[data-plan-sent]")).toBeNull();
    expect(replies(target)).toHaveLength(4);
    expect(approve(target)!.disabled).toBe(false);
  });

  it("copies the plan's text form", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { target } = mountPlan();
    await waitFor(() => expect(plan(target)).not.toBeNull());
    fireEvent.click(
      [...target.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Copy"),
      )!,
    );
    expect(writeText).toHaveBeenCalledWith(documentText(SETTINGS_PLAN));
  });
});
