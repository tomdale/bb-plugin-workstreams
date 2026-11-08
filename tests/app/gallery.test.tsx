// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SPECIMENS } from "../../src/app/page/gallery.ts";
import { WorkstreamsPage } from "../../src/app/page/Page.tsx";
import { parse } from "../../src/domain/reply.ts";
import type { ReplyPart } from "../../src/domain/replyComponents.ts";
import { COMPONENT_NAMES } from "../../src/domain/replyExamples.ts";
import { onlyReplyBlock } from "../../src/domain/replyText.ts";
import { emptyState } from "./fixtures.ts";

afterEach(cleanup);

/** Every agent block in the gallery, read the way the message surface reads it. */
function parts(): { part: ReplyPart; features: readonly string[] }[] {
  const out: { part: ReplyPart; features: readonly string[] }[] = [];
  for (const specimen of SPECIMENS)
    for (const message of specimen.messages) {
      if (message.from !== "agent") continue;
      const block = onlyReplyBlock(message.block);
      if (!block || block.status !== "closed")
        throw new Error(`Specimen block is not closed: ${specimen.title}`);
      const read = parse(block, { status: block.status });
      if (!read.ok) throw new Error(`${specimen.title}: ${read.error}`);
      for (const part of read.data.body)
        out.push({ part, features: message.features });
    }
  return out;
}

it("uses every component a reply block accepts", () => {
  const types = new Set(parts().map(({ part }) => part.type));
  for (const name of COMPONENT_NAMES) expect(types).toContain(name);
});

it("parses every specimen, apart from the part it means to reject", () => {
  const unparsed = parts().filter(({ part }) => part.type === "unparsed");
  expect(unparsed).toHaveLength(1);
  expect(parts().filter(({ part }) => part.type === "pending")).toHaveLength(0);
  // A directive is passed through for bb to render, not parsed here.
  expect(parts().some(({ part }) => part.type === "directive")).toBe(true);
});

async function mount(subPath = "gallery") {
  return renderSlot(
    { component: WorkstreamsPage },
    { subPath },
    {
      sidebarThreads: {
        status: "ready",
        threads: [],
        sections: [],
        projects: [],
      },
      rpc: {
        state: () => emptyState(),
        recapPrefs: () => ({ prefs: {} }),
        recapFiles: () => ({ files: {} }),
      },
    },
  );
}

it("renders every specimen with its component", async () => {
  const slot = await mount();
  expect(slot.getByRole("heading", { level: 1 }).textContent).toBe("Gallery");
  const replies = [
    ...slot.container.querySelectorAll<HTMLElement>("[data-gallery-reply]"),
  ];
  const reply = (title: string) =>
    replies[
      SPECIMENS.filter((specimen) =>
        specimen.messages.some((message) => message.from === "agent"),
      ).findIndex((specimen) => specimen.title === title)
    ]!;

  // A short answer is its headline and lead alone.
  const short = reply("A short answer");
  expect(
    short.querySelector(
      "[data-reply-actions], [data-reply-checks], [data-reply-details]",
    ),
  ).toBeNull();
  expect(short.textContent).toContain("A single press always moves one card.");

  // Written with actions in the middle, drawn with them first and the fold last.
  const delivered = reply("A change ready to merge");
  const pieces = [
    ...delivered.querySelectorAll(
      "[data-reply-actions], [data-reply-change], [data-reply-checks], [data-reply-facts], [data-reply-delivery], [data-reply-details]",
    ),
  ].map((element) =>
    [...element.attributes]
      .map((attribute) => attribute.name)
      .find((name) => name.startsWith("data-reply-")),
  );
  expect(pieces).toEqual([
    "data-reply-actions",
    "data-reply-change",
    "data-reply-checks",
    "data-reply-facts",
    "data-reply-delivery",
    "data-reply-details",
  ]);
  const actions = delivered.querySelector("[data-reply-actions]")!;
  expect(actions.textContent).toContain("Needs you");
  expect(actions.querySelector("[data-reply-actions-count]")?.textContent).toBe(
    "2 steps",
  );
  expect(actions.querySelector("[data-reply-caution]")).not.toBeNull();
  expect(
    slot.getAllByRole("button", {
      name: "Copy git merge --ff-only fix/queue-held-key",
    }).length,
  ).toBe(1);

  // Every check passed: counted tiles, and the list folded behind its scope.
  const checks = delivered.querySelector("[data-reply-checks]")!;
  expect(
    [...checks.querySelectorAll("[data-reply-tile]")].map((tile) => [
      tile.getAttribute("data-reply-tile"),
      tile.textContent,
    ]),
  ).toEqual([
    ["good", "checks passed3 of 3"],
    ["good", "tests passed, 1 skipped1,077"],
  ]);
  const fold = checks.querySelector<HTMLDetailsElement>(
    "[data-reply-checks-fold]",
  )!;
  expect(fold.open).toBe(false);
  expect(fold.querySelector("summary")?.textContent).toContain(
    "CI has not run",
  );
  expect(checks.querySelectorAll("[data-reply-check-status]")).toHaveLength(3);

  const delivery = delivered.querySelector("[data-reply-delivery]")!;
  expect(
    [...delivery.querySelectorAll("[data-reply-stage-status]")].map((mark) =>
      mark.getAttribute("data-reply-stage-status"),
    ),
  ).toEqual(["done", "done", "pending", "pending"]);
  expect(
    delivery.querySelector("[data-reply-delivery-count]")?.textContent,
  ).toBe("2 of 4 done");
  expect(
    delivery.querySelector('[data-reply-delivery-note="pending"]')?.textContent,
  ).toContain("Waiting for your merge");

  // A failed check turns its tile red and keeps the list open.
  const failure = reply("A failure report");
  expect(
    failure.querySelector("[data-reply-tile]")?.getAttribute("data-reply-tile"),
  ).toBe("bad");
  expect(failure.querySelector("[data-reply-checks-fold]")).toBeNull();
  expect(
    failure.querySelector('[data-reply-check-item="failed"]')?.textContent,
  ).toContain("Failed");
  expect(failure.querySelector('[data-reply-action="decide"]')).not.toBeNull();

  const explanation = reply("An explanation");
  expect(
    explanation.querySelector("[data-reply-table-count]")?.textContent,
  ).toBe("2 Stale, 2 Current");
  const folds = [
    ...explanation.querySelectorAll<HTMLDetailsElement>("[data-reply-details]"),
  ];
  expect(folds.map((item) => item.open)).toEqual([false, false]);
  expect(
    folds.map((item) => item.querySelector("summary")?.textContent),
  ).toEqual([
    "Reproduce it2 list items",
    "Why the closure goes stale1 code block",
  ]);

  const shows = (text: string) =>
    expect(slot.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
  for (const text of [
    "A held key re-read a stale index and skipped several cards",
    "Replay fixture",
    // the bare directive, rendered by bb
    "::inline-vis",
    // the part the schema rejects stays readable
    "Component not displayed",
    // a component outside the set shows its text
    "It keeps one listener per burst.",
    // an older block's own card fields
    "Ready for review",
    "Hold ↓ on a queue of four and confirm the card stops two ahead",
  ])
    shows(text);
  slot.lifecycle.unmount();
});

it("opens from the queue's secondary menu and returns with Back", async () => {
  const slot = await mount("");
  const more = slot.getByRole("button", { name: "More" });
  fireEvent.pointerDown(more, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await slot.findByRole("menuitem", { name: "Gallery" }));
  await waitFor(() =>
    expect(slot.getByRole("heading", { level: 1 }).textContent).toBe("Gallery"),
  );
  fireEvent.click(slot.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(slot.getByRole("button", { name: "More" })).toBeTruthy(),
  );
  slot.lifecycle.unmount();
});
