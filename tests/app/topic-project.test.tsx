// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TopicTree } from "../../src/app/page/topics/TopicTree.tsx";
import { chooseOption } from "./select.ts";

Element.prototype.scrollIntoView ??= () => {};
afterEach(cleanup);

it.each([
  {
    initial: null,
    source: null,
    option: "Example project",
    expected: "project",
    automatic: false,
  },
  {
    initial: "project",
    source: "manual",
    option: "No associated project",
    expected: null,
    automatic: false,
  },
  {
    initial: null,
    source: "disabled",
    option: "Automatic",
    expected: null,
    automatic: true,
  },
  {
    initial: "project",
    source: "learned",
    option: "Example project",
    expected: "project",
    automatic: false,
  },
])(
  "saves a topic's project as $expected from its editor",
  async ({ initial, source, option, expected, automatic }) => {
    const call = vi.fn(async () => ({}));
    const topic = {
      id: "topic",
      name: "Example",
      parentId: null,
      description: "",
      aliases: [],
      projectId: initial,
      projectSource: source,
    };
    renderSlot(
      { component: TopicTree },
      {
        query: "Example",
        ws: {
          server: { catalog: { entities: [topic], assignments: {} } },
          projection: { rowOf: new Map() },
          projects: [{ id: "project", name: "Example project" }],
          rpc: { call },
        } as never,
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Example" }));
    chooseOption(screen.getByRole("combobox", { name: "Project" }), option);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("catalogUpdateMetadata", {
        entityId: "topic",
        description: "",
        aliases: [],
        projectId: expected,
        ...(automatic ? { projectAutomatic: true } : {}),
      }),
    );
  },
);
