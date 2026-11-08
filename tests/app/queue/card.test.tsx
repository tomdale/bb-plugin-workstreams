// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Recap } from "../../../src/domain/recap.ts";
import {
  cardOf,
  nextActionsOf,
  type QueueCard,
} from "../../../src/app/page/queue/card.ts";
import { ThreadCard } from "../../../src/app/page/queue/QueueItem.tsx";
import { sidebarThread } from "../fixtures.ts";

const recap = (state: Recap["state"]): Recap => ({
  id: `recap-${state}`,
  turnId: "turn",
  at: Date.now(),
  state,
  goal: "Updated the card stack",
  latest: ["Question answers resume the tool"],
  review: state === "review" ? ["Answer a question"] : [],
  links:
    state === "review"
      ? [{ title: "Review changes", location: "https://example.com/review" }]
      : [],
  next:
    state === "waiting"
      ? []
      : [{ title: "Check layouts", message: "Check both layouts" }],
  timeout: state === "waiting" ? 120 : undefined,
});

afterEach(cleanup);

it.each(["complete", "review", "waiting"] as const)(
  "uses the shared %s recap content and actions",
  (state) => {
    const value = recap(state);
    const card = cardOf(
      sidebarThread("thread"),
      { kind: "none" },
      value,
      undefined,
      false,
    );
    expect(card).toEqual({ kind: "recap", recap: value });
    const slot = renderSlot(
      { component: ThreadCard },
      { card, threadId: "thread", files: null, age: "now" },
    );
    expect(slot.getByText("Updated the card stack")).toBeTruthy();
    if (state === "review") {
      expect(slot.getByText("Answer a question")).toBeTruthy();
      expect(
        slot.getByRole("link", { name: "Review changes" }).getAttribute("href"),
      ).toBe("https://example.com/review");
    }
    if (state === "waiting") {
      expect(slot.getByLabelText("Status check countdown")).toBeTruthy();
      expect(nextActionsOf(card)).toEqual([]);
    } else expect(nextActionsOf(card)).toEqual(value.next);
    slot.lifecycle.unmount();
  },
);

it.each<{ card: QueueCard; label: string; line: string }>([
  {
    card: { kind: "working", line: "Building the plugin" },
    label: "Working",
    line: "Building the plugin",
  },
  {
    card: { kind: "needs", line: "Choose a layout" },
    label: "Needs your decision",
    line: "Choose a layout",
  },
  {
    card: { kind: "failed" },
    label: "Failed",
    line: "The last turn failed. Open the thread to see why.",
  },
  {
    card: { kind: "sent", sent: { text: "Run the checks", at: 1 } },
    label: "Working",
    line: "You sent: Run the checks",
  },
  {
    card: { kind: "line", label: "No recap", line: "Waiting for a result" },
    label: "No recap",
    line: "Waiting for a result",
  },
])("keeps the $card.kind fallback content", ({ card, label, line }) => {
  const slot = renderSlot(
    { component: ThreadCard },
    { card, threadId: "thread", files: null, age: "now" },
  );
  expect(slot.getByText(label, { exact: false, selector: "p" })).toBeTruthy();
  expect(slot.getByText(line)).toBeTruthy();
  expect(nextActionsOf(card)).toEqual([]);
  slot.lifecycle.unmount();
});
