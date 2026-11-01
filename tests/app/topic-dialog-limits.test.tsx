// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { CreateEntityDialog } from "../../src/app/page/CatalogDialogs.tsx";
import { TopicTree } from "../../src/app/page/topics/TopicTree.tsx";

Element.prototype.scrollIntoView ??= () => {};
afterEach(cleanup);

const topic = {
  id: "topic",
  name: "Example",
  parentId: null,
  description: "",
  aliases: [],
};

/** The topic tree's editor, opened on the one topic it lists. */
function mountEditor(call = vi.fn()) {
  renderSlot(
    { component: TopicTree },
    {
      query: "Example",
      ws: {
        server: { catalog: { entities: [topic], assignments: {} } },
        projection: { rowOf: new Map() },
        projects: [],
        rpc: { call },
      } as never,
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Example" }));
  return within(document.body);
}

it("bounds topic name and description fields to their RPC limits", () => {
  renderSlot(
    { component: CreateEntityDialog },
    {
      parentId: null,
      entities: [],
      rpc: { call: vi.fn() } as never,
      onSuccess: vi.fn(),
      onClose: vi.fn(),
    },
  );
  const body = within(document.body);
  expect(body.getByLabelText("Name *").getAttribute("maxlength")).toBe("200");
  expect(body.getByLabelText("Description").getAttribute("maxlength")).toBe(
    "1000",
  );
});

it("bounds the topic editor's name and description to their RPC limits", () => {
  const body = mountEditor();
  expect(body.getByLabelText("Name").getAttribute("maxlength")).toBe("200");
  expect(body.getByLabelText("Description").getAttribute("maxlength")).toBe(
    "1000",
  );
});

it("explains oversized aliases before creating a topic", async () => {
  const call = vi.fn();
  renderSlot(
    { component: CreateEntityDialog },
    {
      parentId: null,
      entities: [],
      rpc: { call } as never,
      onSuccess: vi.fn(),
      onClose: vi.fn(),
    },
  );
  const body = within(document.body);
  fireEvent.change(body.getByLabelText("Name *"), {
    target: { value: "Example" },
  });
  fireEvent.change(body.getByLabelText("Aliases"), {
    target: { value: "a".repeat(81) },
  });
  fireEvent.click(body.getByRole("button", { name: "Create" }));
  expect(await body.findByRole("alert")).toHaveProperty(
    "textContent",
    "Keep each alias to 80 characters or fewer.",
  );
  expect(call).not.toHaveBeenCalled();
});

it("explains oversized aliases before the editor saves a topic", async () => {
  const call = vi.fn();
  const body = mountEditor(call);
  fireEvent.change(body.getByLabelText("Aliases"), {
    target: { value: "a".repeat(81) },
  });
  fireEvent.click(body.getByRole("button", { name: "Save" }));
  expect(await body.findByRole("alert")).toHaveProperty(
    "textContent",
    "Keep each alias to 80 characters or fewer.",
  );
  expect(call).not.toHaveBeenCalled();
});
