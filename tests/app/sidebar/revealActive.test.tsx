// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealThreadRow } from "../../../src/app/sidebar/revealActive.ts";
import { section, sidebarThread } from "../fixtures.ts";
import { mount } from "../sidebar-fixture.tsx";

/** The scroll region's height, from the top of the viewport. */
const VIEW_HEIGHT = 200;
const ROW_HEIGHT = 28;

/**
 * Gives jsdom a layout: `scroller` shows `VIEW_HEIGHT` pixels and tracks
 * `scrollTop`, and each element `place` names sits at a fixed offset in the
 * scrolled content (or, with `sticky`, at a fixed place in the view).
 */
function layOut(scroller: HTMLElement) {
  let scrollTop = 0;
  scroller.style.overflowY = "auto";
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: VIEW_HEIGHT },
    clientTop: { configurable: true, value: 0 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => (scrollTop = value),
    },
  });
  scroller.getBoundingClientRect = () => rect(0, VIEW_HEIGHT);
  const place = (
    element: Element,
    top: number,
    height = ROW_HEIGHT,
    sticky = false,
  ) => {
    element.getBoundingClientRect = () =>
      rect(sticky ? top : top - scrollTop, height);
    element.getClientRects = () =>
      [element.getBoundingClientRect()] as unknown as DOMRectList;
  };
  return { place, scrollTop: () => scrollTop };
}

const rect = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: top,
  }) as DOMRect;

/** A drawn row for `id`, as `Row` marks it. */
function row(id: string, parent: Element): HTMLElement {
  const element = document.createElement("div");
  element.className = "ws-row";
  const anchor = document.createElement("a");
  anchor.dataset.sidebarThreadId = id;
  element.append(anchor);
  parent.append(element);
  return element;
}

describe("revealThreadRow", () => {
  let list: HTMLElement;
  let layout: ReturnType<typeof layOut>;
  beforeEach(() => {
    const scroller = document.createElement("div");
    list = document.createElement("div");
    scroller.append(list);
    document.body.append(scroller);
    layout = layOut(scroller);
  });
  afterEach(() => document.body.replaceChildren());

  it("leaves a row already in view where it is", () => {
    layout.place(row("a", list), 100);
    revealThreadRow(list, "a");
    expect(layout.scrollTop()).toBe(0);
  });

  it("scrolls just far enough to bring a row below the view into it", () => {
    layout.place(row("a", list), 400);
    revealThreadRow(list, "a");
    expect(layout.scrollTop()).toBe(400 + ROW_HEIGHT - VIEW_HEIGHT + 8);
  });

  it("counts a row under the sticky plate as hidden and scrolls it below", () => {
    const plate = document.createElement("div");
    plate.className = "ws-up-next-sticky";
    list.append(plate);
    layout.place(plate, 0, 60, true);
    layout.place(row("a", list), 330);
    list.parentElement!.scrollTop = 300;
    revealThreadRow(list, "a");
    // The row sat at 30, under the plate's 60px; it now sits 8px below it.
    expect(layout.scrollTop()).toBe(300 - (60 - 30) - 8);
  });

  it("counts a row in the fade below the plate as under it", () => {
    const plate = document.createElement("div");
    plate.className = "ws-up-next-sticky";
    plate.style.setProperty("--ws-up-next-heading-gap", "8px");
    list.append(plate);
    layout.place(plate, 0, 60, true);
    layout.place(row("a", list), 362);
    list.parentElement!.scrollTop = 300;
    revealThreadRow(list, "a");
    // The row sat at 62, inside the fade that ends at 68.
    expect(layout.scrollTop()).toBe(300 - (68 - 62) - 8);
  });

  it("is satisfied by any one of the thread's rows in view", () => {
    const plate = document.createElement("div");
    plate.className = "ws-up-next-sticky";
    list.append(plate);
    layout.place(plate, 0, 60, true);
    layout.place(row("a", plate), 20, ROW_HEIGHT, true);
    layout.place(row("a", list), 600);
    revealThreadRow(list, "a");
    expect(layout.scrollTop()).toBe(0);
  });

  it("scrolls to whichever of the thread's rows is nearest", () => {
    layout.place(row("a", list), 900);
    layout.place(row("a", list), 300);
    revealThreadRow(list, "a");
    expect(layout.scrollTop()).toBe(300 + ROW_HEIGHT - VIEW_HEIGHT + 8);
  });

  it("ignores rows in a closing fold and rows not drawn", () => {
    const closing = document.createElement("div");
    closing.dataset.presence = "leave";
    list.append(closing);
    layout.place(row("a", closing), 500);
    row("a", list); // Not laid out: no client rects, as for `display: none`.
    revealThreadRow(list, "a");
    expect(layout.scrollTop()).toBe(0);
  });
});

describe("the thread list", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Thirty rows in Alpha, then Beta's row at the bottom, each row placed
   * by its index among the drawn rows.
   */
  async function mountTall() {
    const threads = [
      ...Array.from({ length: 30 }, (_, index) =>
        sidebarThread(`alpha-${index}`, {
          sectionId: "sec_a",
          title: `Alpha ${index}`,
        }),
      ),
      sidebarThread("beta", { sectionId: "sec_b", title: "Beta task" }),
    ];
    const layout = layOut(document.body);
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (!this.classList.contains("ws-row")) return rect(0, 0);
        const rows = [...document.querySelectorAll(".ws-row")];
        return rect(
          rows.indexOf(this) * ROW_HEIGHT - layout.scrollTop(),
          ROW_HEIGHT,
        );
      },
    );
    const slot = await mount(threads, {
      activeThreadId: null,
      sections: [section("sec_a", "Alpha"), section("sec_b", "Beta")],
    });
    await slot.findByRole("link", { name: /Beta task/ });
    return { slot, layout };
  }

  it("scrolls a thread opened below the view into it", async () => {
    const { slot, layout } = await mountTall();
    expect(layout.scrollTop()).toBe(0);
    act(() => slot.selectThread("beta"));
    await waitFor(() => expect(layout.scrollTop()).toBeGreaterThan(0));
    const beta = slot
      .getByRole("link", { name: /Beta task/ })
      .closest(".ws-row")!
      .getBoundingClientRect();
    expect(beta.bottom).toBeLessThanOrEqual(VIEW_HEIGHT);
  });

  it("leaves the list alone for a thread in a collapsed workstream", async () => {
    const { slot, layout } = await mountTall();
    fireEvent.click(slot.getByRole("button", { name: "Collapse Beta" }));
    await waitFor(() =>
      expect(slot.queryByRole("link", { name: /Beta task/ })).toBeNull(),
    );
    act(() => slot.selectThread("beta"));
    expect(layout.scrollTop()).toBe(0);
  });
});
