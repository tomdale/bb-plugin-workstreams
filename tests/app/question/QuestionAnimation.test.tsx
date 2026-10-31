// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { questionResultRecord } from "../../../src/server/questions/history.ts";
import { QuestionHistoryCard } from "../../../src/app/question/QuestionHistory.tsx";

await loadPluginApp(() => import("../../../src/app/index.tsx"));
const record = questionResultRecord(
  {
    questions: [
      {
        question: "Which layout?",
        header: "Layout",
        options: [{ label: "Rows", description: "Compact" }],
        multiSelect: false,
      },
    ],
    answers: { "Which layout?": "Rows" },
  },
  "question",
  null,
)!;

let animations: Array<{
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
}>;
beforeEach(() => {
  animations = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      const animation = { onfinish: null, cancel: vi.fn() };
      animations.push(animation);
      return animation;
    }),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.hasAttribute("data-ws-question-history")
        ? this.querySelector("[data-ws-question-details]")
          ? 320
          : 120
        : this.hasAttribute("data-ws-question-summary")
          ? 80
          : this.hasAttribute("data-ws-question-details")
            ? 280
            : 0;
      return {
        height,
        width: 400,
        top: 0,
        left: 0,
        right: 400,
        bottom: height,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

it("animates both directions, retaining inert details until the collapse finishes", () => {
  const view = render(<QuestionHistoryCard record={record} />);
  const button = view.getByRole("button");
  fireEvent.click(button);
  const card = view.getByRole("region");
  const wrapper = card.parentElement!;
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(wrapper.style.height).toBe("320px");
  expect(card.style.overflow).toBe("hidden");
  act(() => animations[0]!.onfinish!());
  expect(wrapper.style.height).toBe("");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(
    view.container
      .querySelector("[data-ws-question-details]")
      ?.hasAttribute("inert"),
  ).toBe(true);
  act(() => animations[1]!.onfinish!());
  expect(view.container.querySelector("[data-ws-question-details]")).toBeNull();
  expect(card.style.overflow).toBe("");
});

it("reverses an interrupted collapse and restores styles on unmount", () => {
  const view = render(<QuestionHistoryCard record={record} />);
  const button = view.getByRole("button");
  fireEvent.click(button);
  act(() => animations[0]!.onfinish!());
  fireEvent.click(button);
  fireEvent.click(button);
  expect(animations[1]!.cancel).toHaveBeenCalledOnce();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(
    view.container
      .querySelector("[data-ws-question-details]")
      ?.hasAttribute("inert"),
  ).toBe(false);
  view.unmount();
});

it("changes state immediately when reduced motion is requested", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const view = render(<QuestionHistoryCard record={record} />);
  const button = view.getByRole("button");
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(view.container.querySelector("[data-ws-question-details]")).toBeNull();
  expect(animations).toHaveLength(0);
});
