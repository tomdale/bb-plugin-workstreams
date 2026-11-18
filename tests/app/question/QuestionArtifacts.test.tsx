// @vitest-environment jsdom
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, render, within } from "@testing-library/react";
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
  it("renders each format with BB's renderer for it", () => {
    const view = render(<QuestionArtifacts artifacts={artifacts} />);
    const body = view.getByRole("region", { name: "Body" });
    expect(within(body).getByText(/Ships it\./)).toBeTruthy();
    const diffs = within(
      view.getByRole("region", { name: "Change" }),
    ).getAllByTestId("bb-diff");
    expect(diffs.map((diff) => diff.dataset.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(diffs[0]?.textContent).toContain("+new");
    const code = within(
      view.getByRole("region", { name: "Config" }),
    ).getByTestId("bb-source-code");
    expect(code.dataset.path).toBe("infra/main.tf");
    expect(view.getByRole("region", { name: "Config" }).textContent).toContain(
      "infra/main.tf",
    );
    expect(
      view.getByRole("region", { name: "Title" }).querySelector("pre")
        ?.textContent,
    ).toBe("Add the project");
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
      expect(view.queryByTestId("bb-diff")).toBeNull();
      expect(view.queryByTestId("bb-source-code")).toBeNull();
      expect(
        view.getByRole("region", { name: "Change" }).querySelector("pre")
          ?.textContent,
      ).toBe(twoFiles);
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
