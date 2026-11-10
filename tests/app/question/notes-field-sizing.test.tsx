// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InteractionPayload } from "../../../src/server/questions/contracts.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

const payload: InteractionPayload = {
  questions: [
    {
      id: "q0",
      prompt: "Which database should we use?",
      shortLabel: "Database",
      multiSelect: false,
      allowFreeText: false,
      options: [
        { value: "q0o0", label: "Postgres", description: "Needs a server." },
      ],
    },
  ],
};

/** Opens the notes field under the chosen option, in a browser with or without content sizing. */
async function notesField(fieldSizing: boolean) {
  vi.stubGlobal(
    "CSS",
    fieldSizing
      ? {
          supports: (property: string, value: string) =>
            property === "field-sizing" && value === "content",
        }
      : { supports: () => false },
  );
  // The support check runs once, when the module loads.
  const { QuestionInteraction } =
    await import("../../../src/app/question/QuestionCard.tsx");
  const slot = renderSlot(
    { component: QuestionInteraction },
    {
      interaction: {
        id: "pint_test",
        threadId: "thr_test",
        title: "Database",
        payload: payload as never,
        createdAt: 0,
        expiresAt: null,
      },
      submit: async () => undefined,
      cancel: async () => undefined,
    },
    { context: { projectId: "project-test", threadId: "thr_test" } },
  );
  fireEvent.click(slot.getByText("Postgres").closest("button")!);
  const notes = slot.getByLabelText("Database notes") as HTMLTextAreaElement;
  const heights: string[] = [];
  const style = notes.style;
  const set = vi.spyOn(style, "height", "set");
  set.mockImplementation((value: string) => heights.push(value));
  Object.defineProperty(notes, "scrollHeight", { value: 42 });
  return { notes, heights };
}

it("leaves a notes field's height to CSS where the browser sizes it to its text", async () => {
  const { notes, heights } = await notesField(true);
  fireEvent.change(notes, { target: { value: "with pgbouncer" } });
  fireEvent.change(notes, { target: { value: "with pgbouncer\nand a pool" } });
  expect(heights).toEqual([]);
  expect(notes.className).toContain("field-sizing-content");
  expect(notes.className).toContain("min-h-");
});

it("measures a notes field after each edit where CSS cannot size it", async () => {
  const { notes, heights } = await notesField(false);
  fireEvent.change(notes, { target: { value: "with pgbouncer" } });
  expect(heights).toEqual(["auto", "42px"]);
});
