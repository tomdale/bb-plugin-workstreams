// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Repair } from "../../src/app/page/RepairPreview.tsx";
afterEach(cleanup);
it("shows a read-only preview before an explicit apply and reports skipped corrections", async () => {
  const applied = vi.fn();
  const call = vi.fn(async (method: string) =>
    method === "repairPreview"
      ? {
          id: "plan",
          at: 1,
          definitionKey: "tree",
          rows: [
            {
              threadId: "t",
              title: "Pipeline audit",
              from: "Alpha",
              to: "Beta",
              error: null,
            },
          ],
        }
      : { changed: 0, skipped: 1 },
  );
  render(
    <Repair rpc={{ call } as never} threadIds={["t"]} onApplied={applied} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview moves" }));
  await screen.findByText("Pipeline audit: Alpha → Beta");
  expect(screen.getByRole("status").textContent).toContain(
    "1 move ready for review",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(applied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply the preview" }));
  await screen.findByText(/Moved 0 threads; skipped 1/);
  expect(call).toHaveBeenLastCalledWith("repairApply", {
    planId: "plan",
  });
  expect(applied).toHaveBeenCalledOnce();
});
