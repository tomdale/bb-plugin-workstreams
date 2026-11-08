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
  const change = slot.container.querySelector("[data-reply-change]");
  expect(change?.querySelector("[data-reply-change-pair]")).not.toBeNull();
  expect(change?.textContent).toContain("Before");
  expect(change?.textContent).toContain("After");
  const checks = slot.container.querySelector("[data-reply-checks]");
  expect(checks?.querySelectorAll("[data-reply-check-status]")).toHaveLength(3);
  const totals = checks?.querySelector('[aria-label="Reported test totals"]');
  expect(
    totals?.querySelector('[data-reply-test-total="passed"]')?.textContent,
  ).toContain("8");
  expect(
    totals?.querySelector('[data-reply-test-total="failed"]')?.textContent,
  ).toContain("0");
  expect(
    totals?.querySelector('[data-reply-test-total="skipped"]')?.textContent,
  ).toContain("1");
  const delivery = slot.container.querySelector("[data-reply-delivery]");
  expect(
    [...(delivery?.querySelectorAll("[data-reply-stage-status]") ?? [])].map(
      (mark) => mark.getAttribute("data-reply-stage-status"),
    ),
  ).toEqual(["done", "pending", "not-started", "unknown"]);
  const shows = (text: string) =>
    expect(slot.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
  for (const text of [
    // context, prose, sequence, comparison, group
    "Queue card keyboard handling",
    "A held key is one gesture",
    "Replay fixture",
    "Reproduce it",
    "Passed",
    "Two ways to read the position",
    "Recommended",
    "Read the index from a ref",
    // the folded Details section
    "Details",
    // change, checks, delivery, recommendation, details component
    "Before",
    "After",
    "A held key re-read a stale index and skipped several cards",
    "Local suite",
    "Where the fix stands",
    "The plugin reloads after merge",
    "Merge after one pass on a real queue",
    "Why a ref and not state",
    // the bare directive, rendered by bb
    "::inline-vis",
    // the part the schema rejects stays readable
    "Component not displayed",
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
