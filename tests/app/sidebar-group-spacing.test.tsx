// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A thread quiet long enough for its workstream to be dormant. */
const quietThread = (id: string, sectionId: string, title: string) =>
  sidebarThread(id, {
    sectionId,
    title,
    latestAttentionAt: Date.now() - 60 * 24 * 3_600_000,
  });

describe("dormant workstream spacing", () => {
  it("spaces a group by the fold above it, not by its own", async () => {
    const slot = await mount(
      [
        quietThread("a1", "sec_a", "Alpha task"),
        quietThread("b1", "sec_b", "Beta task"),
      ],
      { settings: { showRecent: false, showForYou: false } },
    );
    fireEvent.click(
      await waitFor(() => slot.getByRole("button", { name: /^Dormant/ })),
    );
    const group = (name: string) => slot.getByRole("region", { name });
    const toggle = async (name: string) => {
      const header = within(group(name)).getByRole("button", { name });
      const folded = header.getAttribute("aria-expanded");
      fireEvent.click(header);
      await waitFor(() =>
        expect(header.getAttribute("aria-expanded")).not.toBe(folded),
      );
    };
    // Both dormant workstreams start folded, so the second one leads tight,
    // and the first one leads a list with no gap at all.
    await waitFor(() => expect(group("Beta").style.marginTop).toBe(""));
    expect(group("Alpha").style.marginTop).toBe("");

    // An open workstream above separates it from the one below.
    await toggle("Alpha");
    await waitFor(() =>
      expect(group("Beta").style.marginTop).toBe(
        `${SIDEBAR_GEOMETRY.gaps.item}px`,
      ),
    );

    // Folding it again closes the gap.
    await toggle("Alpha");
    await waitFor(() => expect(group("Beta").style.marginTop).toBe(""));

    // The next group's own fold never adds a gap above it.
    await toggle("Beta");
    await waitFor(() => expect(group("Beta").style.marginTop).toBe(""));
    slot.lifecycle.unmount();
  });
});
