// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { registerReplyBlock } from "../../src/app/reply/register.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PREFS = { required: true, corrections: 3, layout: "full" };

/**
 * The published SDK's test host has no message-block slot, like upstream
 * bb. `fork` gives the app one, as the tomdale/bb fork does.
 */
async function mount({
  fork = true,
  prefs = PREFS,
}: { fork?: boolean; prefs?: Record<string, unknown> } = {}) {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  if (fork)
    registerReplyBlock({
      slots: { experimental_messageBlock: () => {} },
    } as unknown as PluginAppBuilder);
  const section = app.settingsSections.find((s) => s.id === "recap")!;
  return renderSlot(
    section,
    {},
    {
      rpc: {
        recapPrefs: () => ({ prefs }),
        setRecapPrefs: (input: unknown) => ({
          prefs: { ...prefs, ...(input as { patch: object }).patch },
        }),
      },
    },
  );
}

it("saves a layout pick immediately", async () => {
  const slot = await mount();
  fireEvent.click(await slot.findByRole("radio", { name: /Compact/ }));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "setRecapPrefs")?.input,
    ).toEqual({ patch: { layout: "minimal" } }),
  );
});

it("keeps each hidden layout radio inside its positioned label", async () => {
  // An unpositioned label leaves the radio's containing block outside the
  // settings scroller, and focusing it scrolls BB's page frame out of view.
  const slot = await mount();
  const radios = await slot.findAllByRole("radio");
  expect(radios.length).toBeGreaterThan(0);
  for (const radio of radios)
    expect(radio.closest("label")?.className).toMatch(/(^|\s)relative(\s|$)/);
});

it("disables reminders when agents don't end turns with a recap", async () => {
  const slot = await mount();
  fireEvent.click(
    await slot.findByRole("switch", { name: "End turns with a recap" }),
  );
  expect(await slot.findByText(/don't get the recap tool/)).toBeTruthy();
  expect(
    slot.getByRole("button", { name: "Increase Reminders per turn" }),
  ).toHaveProperty("disabled", true);
  expect(
    slot.getByRole("button", { name: "Decrease Reminders per turn" }),
  ).toHaveProperty("disabled", true);
});

it("keeps structured replies off until switched on", async () => {
  const slot = await mount();
  const toggle = await slot.findByRole("switch", {
    name: "Structured replies",
  });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(
    slot.getByText("Off: agents report each turn through the recap tool."),
  ).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "setRecapPrefs")?.input,
    ).toEqual({ patch: { replies: true } }),
  );
  expect(await slot.findByText(/one block with typed components/)).toBeTruthy();
});

it.each([false, true])(
  "leaves structured replies out on a bb without the slot (stored on: %s)",
  async (replies) => {
    const slot = await mount({ fork: false, prefs: { ...PREFS, replies } });
    await slot.findByRole("switch", { name: "End turns with a recap" });
    expect(
      slot.queryByRole("switch", { name: "Structured replies" }),
    ).toBeNull();
    expect(slot.queryByText(/Structured replies/)).toBeNull();
    expect(slot.queryByText(/reply blocks/)).toBeNull();
  },
);

it("previews the recap card in each state and the chosen layout", async () => {
  const slot = await mount();
  const carousel = await slot.findByRole("region", { name: "Recap preview" });
  const visible = () =>
    Array.from(carousel.querySelectorAll('[aria-roledescription="slide"]'))
      .filter((s) => !s.hasAttribute("aria-hidden"))
      .map((s) => s.textContent);
  expect(visible()).toHaveLength(1);
  expect(visible()[0]).toMatch(/Complete.*Added dark mode/);
  fireEvent.click(slot.getByRole("button", { name: "Next example" }));
  expect(visible()[0]).toMatch(/Ready for Review.*Added dark mode/);
  expect(visible()[0]).toContain("Open Settings → Appearance and choose Dark");
  expect(carousel.querySelectorAll('ul[aria-label="Links"]')).toHaveLength(0);
  fireEvent.click(slot.getByRole("button", { name: "Next example" }));
  expect(visible()[0]).toMatch(/Waiting/);
  expect(visible()[0]).not.toContain("Nothing needed");
  fireEvent.click(slot.getByRole("button", { name: "Next example" }));
  expect(visible()[0]).toMatch(/Complete/);

  fireEvent.click(slot.getByRole("radio", { name: /Compact/ }));
  // Compact keeps the task title alongside its countdown.
  fireEvent.click(slot.getByRole("button", { name: "Previous example" }));
  await waitFor(() =>
    expect(visible()[0]).not.toMatch(/Theme behavior agreed/),
  );
  expect(visible()[0]).toMatch(/Waiting.*theme toggle.*2:00/);
  expect(visible()[0]).not.toContain("Adding dark mode");
});
