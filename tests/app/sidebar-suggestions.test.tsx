import { mount } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

it("shows Reorganize on the Workstreams heading while suggestions wait", async () => {
  const slot = await mount(undefined, { pendingSuggestions: 2 });
  await slot.findByRole("button", { name: "Reorganize" });
});

it("hides Reorganize when nothing waits", async () => {
  const slot = await mount();
  await slot.findByRole("heading", { name: "Workstreams" });
  expect(slot.queryByRole("button", { name: "Reorganize" })).toBeNull();
});

it("opens the organization review from the heading", async () => {
  const slot = await mount(undefined, { pendingSuggestions: 1 });
  fireEvent.click(await slot.findByRole("button", { name: "Reorganize" }));
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "home",
    options: { subPath: "organization" },
  });
});
