// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PostTurnDocuments } from "../../src/app/postTurn/PostTurnDocuments.tsx";
import { assistantMessageId } from "../../src/domain/postTurn/message.ts";
import { documentText } from "../../src/domain/postTurn/document.ts";
import { CORRECTION, DEPLOYED_CHANGE } from "../fixtures/postTurn.ts";

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
            topic: { name: "Snooze", color: null },
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
        items: [{ messageId: T1, topic: null, document: CORRECTION }],
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
