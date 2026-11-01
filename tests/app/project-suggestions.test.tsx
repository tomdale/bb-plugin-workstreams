// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ProjectSuggestions } from "../../src/app/page/topics/ProjectSuggestions.tsx";

afterEach(cleanup);
const suggestion = {
  id: "suggestion",
  entityId: "topic",
  topic: "Parser",
  fromProject: "One",
  toProject: null,
  reason: "Independent roots use different projects.",
  threads: [{ id: "thread", name: "Fix tabs", project: "Two" }],
};

it.each(["accept", "decline"] as const)(
  "reviews a project correction with %s",
  async (decision) => {
    let pending = [suggestion];
    const call = vi.fn(async (method: string) => {
      if (method === "projectSuggestions") return { suggestions: pending };
      if (method === "projectSuggestionDecide") {
        pending = [];
        return { entry: { id: "entry" } };
      }
      if (method === "undo") return {};
      throw new Error(method);
    });
    renderSlot(
      { component: ProjectSuggestions },
      { ws: { rpc: { call } } as never },
    );
    expect(await screen.findByText("Parser")).toBeTruthy();
    fireEvent.click(screen.getByText("Supporting threads"));
    fireEvent.click(screen.getByRole("button", { name: "Fix tabs" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: decision === "accept" ? "Accept" : "Decline",
      }),
    );
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("projectSuggestionDecide", {
        id: "suggestion",
        decision,
      }),
    );
    await waitFor(() => expect(screen.queryByText("Parser")).toBeNull());
    if (decision === "accept") {
      fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(call).toHaveBeenCalledWith("undo", { entryId: "entry" }),
      );
      await screen.findByText("Project association restored.");
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("region", { name: "Project associations" }),
        ),
      );
    } else expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  },
);

it("reports stale-decision failures without claiming the correction applied", async () => {
  const call = vi.fn(async (method: string) => {
    if (method === "projectSuggestions") return { suggestions: [suggestion] };
    throw new Error("This project suggestion is out of date.");
  });
  renderSlot(
    { component: ProjectSuggestions },
    { ws: { rpc: { call } } as never },
  );
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "This project suggestion is out of date.",
  );
  expect(screen.queryByText("Project association updated.")).toBeNull();
});
