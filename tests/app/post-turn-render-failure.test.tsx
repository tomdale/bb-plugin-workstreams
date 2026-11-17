// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PostTurnDocuments } from "../../src/app/postTurn/PostTurnDocuments.tsx";
import { assistantMessageId } from "../../src/domain/postTurn/message.ts";
import { CORRECTION } from "../fixtures/postTurn.ts";

vi.mock("../../src/app/postTurn/DocumentView.tsx", () => ({
  DocumentView: () => {
    throw new Error("render failed");
  },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

it("draws nothing when the document fails to render, leaving the original", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const id = assistantMessageId({
    threadId: "thr_a",
    turnId: "t1",
    itemId: "m1",
  });
  const row = document.createElement("div");
  row.dataset.timelineRowId = id;
  row.innerHTML = '<div data-message-column=""><p>Original.</p></div>';
  document.body.append(row);
  const presentations = vi.fn(async () => ({
    enabled: true,
    items: [{ messageId: id, workstream: null, document: CORRECTION }],
  }));
  renderSlot(
    { component: PostTurnDocuments },
    {},
    { rpc: { presentations } as never },
  );
  await waitFor(() =>
    expect(row.querySelector("[data-ws-post-turn-anchor]")).not.toBeNull(),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    row.querySelector("[data-ws-post-turn-anchor]")!.childElementCount,
  ).toBe(0);
  expect(row.querySelector("[data-message-column]")!.textContent).toBe(
    "Original.",
  );
});
