// @vitest-environment jsdom
import type { PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlainBody } from "../../src/app/reply/PlainBody.tsx";
import { COMPONENT_EXAMPLES } from "../../src/domain/replyExamples.ts";
import type { ReplyComponent } from "../../src/domain/replyComponents.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  const { default: Markdown } = await import("react-markdown");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) =>
      React.createElement(Markdown, { children: props.content }),
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const send = vi.fn();
function draw(
  part: ReplyComponent,
  scope: PluginComposerScope = { kind: "thread", threadId: "t1" },
  text = "",
) {
  return renderSlot(
    { component: PlainBody },
    {
      part,
      document: undefined,
      files: { root: "/work/shop", environmentId: "env1", hostId: "host1" },
      threadId: "t1",
    },
    {
      composer: { scope, text },
      sdk: { threads: { send } },
      openFilePreview: () => true,
    },
  );
}
type Actions = Extract<ReplyComponent, { type: "actions" }>;
const actions = (items: Actions["items"]): Actions => ({
  type: "actions",
  title: "Next actions",
  items,
});

it("renders table headers, Markdown cells, scope, and an empty state", () => {
  const view = draw({
    type: "table",
    title: "Results",
    scope: "Amounts in cents",
    columns: ["Case", "Discount"],
    rows: [
      ["**Ten percent**", "100"],
      ["Twenty percent", "200"],
    ],
  });
  expect(screen.getByRole("table", { name: "Results" })).toBeDefined();
  expect(screen.getAllByRole("columnheader").map((e) => e.textContent)).toEqual(
    ["Case", "Discount"],
  );
  expect(view.container.querySelector("strong")?.textContent).toBe(
    "Ten percent",
  );
  expect(screen.getAllByRole("cell").map((e) => e.textContent)).toEqual([
    "Ten percent",
    "100",
    "Twenty percent",
    "200",
  ]);
  expect(screen.getByText("Amounts in cents")).toBeDefined();
  cleanup();
  draw({ type: "table", title: "Empty", columns: ["Case"], rows: [] });
  expect(screen.getByText("No rows")).toBeDefined();
});

it("retains a complete reference list and uses native file and web targets", () => {
  const view = draw({
    type: "references",
    title: "All references",
    items: [
      {
        label: "Implementation",
        location: "src/coupon.ts",
        line: 12,
        endLine: 16,
      },
      {
        label: "Commit",
        location: "https://github.com/example/repo/commit/abc1234",
        detail: "Pinned source",
      },
      ...Array.from({ length: 38 }, (_, i) => ({
        label: `Artifact ${i}`,
        detail: `Purpose ${i}`,
      })),
    ],
  });
  expect(
    view.container.querySelectorAll("[data-reply-reference]"),
  ).toHaveLength(40);
  const file = screen.getByRole("link", { name: "Implementation" });
  expect(file.getAttribute("href")).toContain("coupon.ts");
  fireEvent.click(file);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "workspace",
        environmentId: "env1",
        path: "src/coupon.ts",
      },
      location: { kind: "range", startLine: 12, endLine: 16 },
    },
  });
  expect(
    screen.getByRole("link", { name: "Commit" }).getAttribute("href"),
  ).toBe("https://github.com/example/repo/commit/abc1234");
  expect(screen.getByText("Purpose 37")).toBeDefined();
});

it("keeps file targets readable when no workspace can open them", () => {
  const view = renderSlot(
    { component: PlainBody },
    {
      part: {
        type: "references",
        title: "Files",
        items: [
          {
            label: "Calculation",
            location: "src/coupon.ts",
            line: 12,
            endLine: 16,
          },
        ],
      },
      document: undefined,
      files: null,
    },
  );
  expect(view.container.textContent).toContain("src/coupon.ts:12–16");
  expect(view.container.querySelector("a")).toBeNull();
});

it("renders thread references as native thread links without dropping their role", () => {
  draw({
    type: "references",
    title: "Owners",
    items: [{ label: "Implementation owner", threadId: "thr_review_owner" }],
  });
  expect(screen.getByText("Implementation owner")).toBeDefined();
  expect(
    screen.getByRole("link", { name: "thr_review_owner" }).getAttribute("href"),
  ).toContain("/threads/thr_review_owner");
});

it("shows every review step and its requirements and expected result without pass controls", () => {
  const view = draw({
    type: "review",
    title: "Review the change",
    scope: "Use the recorded version",
    steps: Array.from({ length: 9 }, (_, i) => ({
      title: `Step ${i + 1}`,
      requires: `Setup ${i + 1}`,
      detail: `Do ${i + 1}`,
      expected: `Result ${i + 1}`,
    })),
  });
  expect(screen.getAllByRole("listitem")).toHaveLength(9);
  expect(
    view.container.querySelectorAll("[data-reply-step-field=requires]"),
  ).toHaveLength(9);
  expect(
    view.container.querySelectorAll("[data-reply-step-field=expected]"),
  ).toHaveLength(9);
  expect(screen.getByText("Result 9")).toBeDefined();
  expect(view.container.querySelector("button,input")).toBeNull();
  expect(view.container.textContent).not.toContain("Passed");
});

it("adds a full request to the matching thread draft without sending or replacing existing text", () => {
  const view = draw(
    actions([
      {
        title: "Review the caller",
        message: "Check the caller's units",
        owner: "Reviewer",
        condition: "Before implementation",
        permission: "Read-only",
        recommended: true,
      },
    ]),
    { kind: "thread", threadId: "t1" },
    "Existing draft",
  );
  expect(
    view.container.querySelector("[data-reply-action-request]")?.textContent,
  ).toBe("Check the caller's units");
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(view.inspection.composer.text).toBe(
    "Existing draft\n\nCheck the caller's units",
  );
  expect(view.inspection.composer.submits).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  expect(view.inspection.composer.focusCount).toBe(1);
  for (const text of [
    "Reviewer",
    "Before implementation",
    "Read-only",
    "Recommended",
  ])
    expect(screen.getByText(text)).toBeDefined();
});

it.each<PluginComposerScope>([
  { kind: "thread", threadId: "other" },
  { kind: "new-thread", projectId: null },
  { kind: "queued-message", threadId: "t1", queuedMessageId: "q1" },
])(
  "does not write a request into an unrelated or editing draft: %s",
  (scope) => {
    const view = draw(
      actions([{ title: "Request work", message: "Do the requested work" }]),
      scope,
      "Keep me",
    );
    const button = screen.getByRole("button", { name: "Add to message" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(view.inspection.composer.text).toBe("Keep me");
    expect(view.inspection.composer.submits).toEqual([]);
  },
);

it("keeps action staging tied to the original thread inside groups", () => {
  const view = draw({
    type: "group",
    relationship: "supporting",
    children: [
      { type: "text", body: "Summary" },
      actions([{ title: "Ask", message: "Question" }]),
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to message" }));
  expect(view.inspection.composer.text).toBe("Question");
});

it("uses one shared panel for report components inside a supporting group", () => {
  const view = draw({
    type: "group",
    relationship: "supporting",
    children: [
      { type: "text", body: "Summary" },
      COMPONENT_EXAMPLES.table as Extract<ReplyComponent, { type: "table" }>,
      COMPONENT_EXAMPLES.references as Extract<
        ReplyComponent,
        { type: "references" }
      >,
      COMPONENT_EXAMPLES.review as Extract<ReplyComponent, { type: "review" }>,
      actions([{ title: "Ask", message: "Question" }]),
    ],
  });
  expect(view.container.querySelectorAll("[data-reply-panel]")).toHaveLength(1);
  for (const type of ["table", "references", "review", "actions"])
    expect(view.container.querySelector(`[data-reply-${type}]`)).not.toBeNull();
});

it("copies the exact request without submitting it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = draw(
    actions([{ title: "Review", message: "Review\nwith all conditions" }]),
  );
  expect(
    view.container.querySelector("[data-reply-action-request]")?.textContent,
  ).toBe("Review\nwith all conditions");
  fireEvent.click(screen.getByRole("button", { name: "Copy request" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copied" })).toBeDefined(),
  );
  expect(writeText).toHaveBeenCalledWith("Review\nwith all conditions");
  expect(view.inspection.composer.text).toBe("");
  expect(view.inspection.composer.submits).toEqual([]);
});

it("reports clipboard failures and leaves requests and drafts intact", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(Error("Denied")) },
  });
  const view = draw(
    actions([{ title: "Review", message: "Review the change" }]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy request" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not copy the request",
    ),
  );
  expect(view.inspection.composer.text).toBe("");
  expect(screen.getByRole("button", { name: "Copy request" })).toBeDefined();
});

it("renders all next actions and leaves already-owned work as information without controls", () => {
  const view = draw(
    actions(
      Array.from({ length: 8 }, (_, i) => ({
        title: `Option ${i + 1}`,
        owner: i === 7 ? "Another thread" : "User",
        message: i === 7 ? undefined : `Request ${i + 1}`,
      })),
    ),
  );
  expect(view.container.querySelectorAll("[data-reply-action]")).toHaveLength(
    8,
  );
  expect(
    screen.getAllByRole("button", { name: "Add to message" }),
  ).toHaveLength(7);
  expect(screen.getByText("Another thread")).toBeDefined();
});
