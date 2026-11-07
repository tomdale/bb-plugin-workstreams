// @vitest-environment jsdom
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QuestionHistoryCard } from "../../../src/app/question/QuestionHistory.tsx";
import { questionResultRecord } from "../../../src/server/questions/history.ts";

installTestPluginRuntime();
afterEach(cleanup);

function mountScroller(initialMax: number, initialTop: number) {
  const scroller = document.createElement("div");
  scroller.className = "thread-scrollbar";
  document.body.append(scroller);
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
  const view = render(<QuestionHistoryCard record={record} />, {
    container: scroller,
  });
  const button = view.getByRole("button");
  let scrollTop = initialTop;
  const positions: number[] = [];
  let cachedMax = initialMax;
  let previous = initialTop;
  let input = false;
  let attached = initialMax - initialTop <= 4;
  let wheelEvents = 0;
  const max = () =>
    button.getAttribute("aria-expanded") === "true"
      ? initialMax + 400
      : initialMax;
  Object.defineProperties(scroller, {
    clientHeight: { get: () => 500 },
    scrollHeight: { get: () => max() + 500 },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(max(), Math.max(0, value));
        positions.push(scrollTop);
      },
    },
  });
  scroller.addEventListener("wheel", () => {
    input = true;
    wheelEvents++;
  });
  scroller.addEventListener("scroll", () => {
    if (scrollTop === previous) return;
    if (!input && max() !== cachedMax) {
      cachedMax = max();
      if (attached) scrollTop = cachedMax;
    } else if (attached && scrollTop < previous && cachedMax - scrollTop > 4) {
      cachedMax = max();
      attached = cachedMax - scrollTop <= 4;
    }
    previous = scrollTop;
  });
  return {
    scroller,
    button,
    top: () => scrollTop,
    attached: () => attached,
    wheelEvents: () => wheelEvents,
    positions,
  };
}

it.each([0, 200])(
  "preserves the bottom reading position when a card grows from scroll range %s",
  (initialMax) => {
    const { scroller, button, top, attached, wheelEvents, positions } =
      mountScroller(initialMax, initialMax);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(top()).toBe(initialMax);
    expect(attached()).toBe(false);
    expect(wheelEvents()).toBe(1);
    if (initialMax > 0) expect(positions).toEqual([initialMax - 5, initialMax]);
    fireEvent.click(button);
    expect(wheelEvents()).toBe(1);
    scroller.remove();
  },
);

it("leaves a reader who has scrolled away from the bottom alone", () => {
  const { scroller, button, top, wheelEvents } = mountScroller(200, 100);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(top()).toBe(100);
  expect(wheelEvents()).toBe(0);
  scroller.remove();
});
