// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installColorTokens } from "../../../src/app/theme/colorTokens.ts";
import { DEFAULT_COLORS } from "../../../src/domain/colors.ts";

/** One computed style per appearance, however many roots the page holds. */
const READS_PER_THEME = 2;

let uninstall: (() => void) | undefined;
let reads: ReturnType<typeof vi.spyOn>;
let theme: HTMLStyleElement;

/** The system appearance query, which jsdom does not implement. */
const media = Object.assign(new EventTarget(), { matches: false });

beforeEach(() => {
  window.matchMedia = () => media as unknown as MediaQueryList;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  reads = vi.spyOn(window, "getComputedStyle");
  theme = document.createElement("style");
  theme.id = "bb-app-theme";
  theme.textContent = ":root, .light { --success: green; }";
  document.head.append(theme);
  document.body.innerHTML = `
    <div class="light"><div id="scroller">
      <div data-bb-plugin="workstreams" id="first"></div>
      <div data-bb-plugin="workstreams" id="second"></div>
    </div></div>`;
  uninstall = installColorTokens({ ...DEFAULT_COLORS, vivid: true });
});

afterEach(() => {
  uninstall?.();
  vi.restoreAllMocks();
  theme.remove();
  document.body.innerHTML = "";
});

/** Lets the observer deliver its records and the sweep's frame run. */
const settle = () =>
  new Promise<void>((resolve) =>
    setTimeout(() => requestAnimationFrame(() => resolve()), 0),
  );

async function readsAfter(change: () => void): Promise<number> {
  await settle();
  reads.mockClear();
  change();
  await settle();
  return reads.mock.calls.length;
}

const sheet = () =>
  document.querySelector<HTMLStyleElement>("[data-ws-color-tokens]")!;

it("resolves the theme once for the whole page at install", () => {
  expect(reads.mock.calls.length).toBe(READS_PER_THEME);
});

it("reads nothing with vivid colors off", () => {
  uninstall?.();
  reads.mockClear();
  uninstall = installColorTokens({ ...DEFAULT_COLORS, vivid: false });
  theme.textContent = ":root, .light { --success: blue; }";
  expect(reads).not.toHaveBeenCalled();
});

it("reads nothing as roots mount, unmount, restyle, or change appearance", async () => {
  const scroller = document.getElementById("scroller")!;
  const first = document.getElementById("first")!;
  const rewrites = vi.fn();
  new MutationObserver(rewrites).observe(sheet(), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  expect(
    await readsAfter(() => {
      const root = document.createElement("div");
      root.dataset.bbPlugin = "workstreams";
      root.style.setProperty("--background", "red");
      scroller.append(root);
      document.getElementById("second")!.remove();
      scroller.className = "scrolling";
      scroller.style.setProperty("--background", "red");
      scroller.style.setProperty("scroll-padding-top", "4px");
      first.className = "dark";
      document.querySelector(".light")!.classList.replace("light", "dark");
      document.documentElement.classList.add("dark");
      document.title = "Another thread";
    }),
  ).toBe(0);
  expect(rewrites).not.toHaveBeenCalled();
});

it("tags no root: the sheet matches roots by selector", () => {
  for (const root of document.querySelectorAll("[data-bb-plugin]"))
    expect(root.getAttributeNames()).toEqual(["data-bb-plugin", "id"]);
  expect(
    sheet().textContent!.startsWith('[data-bb-plugin="workstreams"], '),
  ).toBe(true);
});

it("resolves the theme again when a theme style sheet is rewritten", async () => {
  expect(
    await readsAfter(() => {
      theme.textContent = ":root, .light { --success: blue; }";
    }),
  ).toBe(READS_PER_THEME);
});

it("resolves the theme again when a style sheet is added or loads", async () => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  expect(await readsAfter(() => document.head.append(link))).toBe(
    READS_PER_THEME,
  );
  expect(await readsAfter(() => link.dispatchEvent(new Event("load")))).toBe(
    READS_PER_THEME,
  );
  link.remove();
});

it("resolves the theme again when a style sheet stops being one", async () => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  document.head.append(link);
  expect(await readsAfter(() => (link.rel = "alternate"))).toBe(
    READS_PER_THEME,
  );
  link.remove();
});

it("resolves the theme again when the system appearance changes", async () => {
  expect(await readsAfter(() => media.dispatchEvent(new Event("change")))).toBe(
    READS_PER_THEME,
  );
});

it.each(["modulepreload", "preload"])(
  "ignores %s links, which are not style sheets",
  async (rel) => {
    const link = document.createElement("link");
    link.rel = rel;
    link.setAttribute("as", "style");
    expect(
      await readsAfter(() => {
        document.head.append(link);
        link.href = "/plugin.css";
        link.dispatchEvent(new Event("load"));
        link.remove();
      }),
    ).toBe(0);
  },
);

it("ignores its own writes", async () => {
  expect(
    await readsAfter(() => {
      sheet().textContent += "\n";
      sheet().dispatchEvent(new Event("load"));
    }),
  ).toBe(0);
});
