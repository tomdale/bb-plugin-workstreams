// @vitest-environment jsdom
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionArtifacts } from "../../../src/app/question/QuestionArtifacts.tsx";
import { QuestionHistoryCard } from "../../../src/app/question/QuestionHistory.tsx";
import { questionResultRecord } from "../../../src/server/questions/history.ts";
import type { InteractionArtifact } from "../../../src/server/questions/contracts.ts";

type Runtime = { pluginSdkApp: Record<string, unknown> };
const runtime = () =>
  (globalThis as unknown as { __bbPluginRuntime: Runtime }).__bbPluginRuntime;

beforeEach(installTestPluginRuntime);
afterEach(cleanup);

const twoFiles = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
].join("\n");

const artifacts: InteractionArtifact[] = [
  { title: "Body", format: "markdown", content: "## Story\n\nShips it." },
  { title: "Change", format: "diff", content: twoFiles },
  {
    title: "Config",
    format: "code",
    path: "infra/main.tf",
    content: 'resource "x" "y" {}',
  },
  { title: "Title", format: "text", content: "Add the project" },
];

describe("QuestionArtifacts", () => {
  const slide = (view: ReturnType<typeof render>) =>
    view.container.querySelector<HTMLElement>("[data-ws-question-artifact]")!;
  const next = (view: ReturnType<typeof render>) =>
    fireEvent.click(view.getByRole("button", { name: "Next artifact" }));

  it("shows one artifact at a time, each with BB's renderer for its format", () => {
    const view = render(<QuestionArtifacts artifacts={artifacts} />);
    const carousel = view.getByRole("region", { name: "Artifacts" });
    expect(carousel.getAttribute("aria-roledescription")).toBe("carousel");
    expect(
      view.container.querySelectorAll("[data-ws-question-artifact]"),
    ).toHaveLength(1);
    expect(carousel.textContent).toContain("1 of 4");
    expect(within(slide(view)).getByText(/Ships it\./)).toBeTruthy();

    next(view);
    expect(slide(view).getAttribute("aria-label")).toBe("2 of 4: Change");
    expect(
      within(slide(view))
        .getAllByTestId("bb-diff")
        .map((diff) => diff.dataset.path),
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(
      within(slide(view)).getAllByTestId("bb-diff")[0]?.textContent,
    ).toContain("+new");

    next(view);
    expect(within(slide(view)).getByTestId("bb-source-code").dataset.path).toBe(
      "infra/main.tf",
    );
    expect(carousel.textContent).toContain("infra/main.tf");

    next(view);
    expect(slide(view).querySelector("pre")?.textContent).toBe(
      "Add the project",
    );
    // The last artifact wraps around to the first.
    next(view);
    expect(slide(view).getAttribute("aria-label")).toBe("1 of 4: Body");
  });

  it("moves with the arrow keys and the previous button", () => {
    const view = render(<QuestionArtifacts artifacts={artifacts} />);
    const previous = view.getByRole("button", { name: "Previous artifact" });
    fireEvent.click(previous);
    expect(slide(view).getAttribute("aria-label")).toBe("4 of 4: Title");
    fireEvent.keyDown(previous, { key: "ArrowRight" });
    expect(slide(view).getAttribute("aria-label")).toBe("1 of 4: Body");
    fireEvent.keyDown(previous, { key: "ArrowLeft" });
    expect(slide(view).getAttribute("aria-label")).toBe("4 of 4: Title");
  });

  it("shows a lone artifact without navigation", () => {
    const view = render(
      <QuestionArtifacts artifacts={artifacts.slice(0, 1)} />,
    );
    expect(view.getByRole("region", { name: "Body" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Next artifact" })).toBeNull();
    expect(view.container.textContent).not.toContain("1 of 1");
  });

  it("scrolls a long artifact in place without trapping the wheel", () => {
    const view = render(<QuestionArtifacts artifacts={artifacts} />);
    const panel = view.getByRole("region", { name: "Artifacts" });
    expect(panel.className).toMatch(/max-h-\[/);
    expect(slide(view).className).toContain("overflow-y-auto");
    // Overscroll passes to the card, so a wheel over an artifact with nothing
    // left to scroll moves the card.
    const contained = [...view.container.querySelectorAll("*")].filter((el) =>
      /\boverscroll-/.test(el.getAttribute("class") ?? ""),
    );
    expect(contained).toEqual([]);
  });

  it("shows diffs and code as text on a BB without the viewers", () => {
    const host = runtime();
    const full = host.pluginSdkApp;
    const {
      experimental_Diff: _diff,
      experimental_SourceCode: _source,
      ...older
    } = full;
    host.pluginSdkApp = older;
    try {
      const view = render(<QuestionArtifacts artifacts={artifacts} />);
      next(view);
      expect(view.queryByTestId("bb-diff")).toBeNull();
      expect(slide(view).querySelector("pre")?.textContent).toBe(twoFiles);
      next(view);
      expect(view.queryByTestId("bb-source-code")).toBeNull();
    } finally {
      host.pluginSdkApp = full;
    }
  });

  it("appear in an answered question's record", () => {
    const record = questionResultRecord(
      {
        questions: [
          {
            question: "Post this comment?",
            header: "Comment",
            artifacts: [
              {
                title: "Comment",
                format: "markdown",
                content: "Would it make sense to stop polling?",
              },
            ],
            options: [
              { label: "Post it", description: "Add it to the review" },
            ],
            multiSelect: false,
          },
        ],
        answers: { "Post this comment?": "Post it" },
      },
      "question",
      null,
    )!;
    const view = render(<QuestionHistoryCard record={record} />);
    view.getByRole("button").click();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(
          view.getByRole("region", { name: "Comment" }).textContent,
        ).toContain("Would it make sense to stop polling?");
        resolve();
      }, 0),
    );
  });
});
