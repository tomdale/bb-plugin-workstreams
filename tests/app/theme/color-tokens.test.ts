// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installColorTokens } from "../../../src/app/theme/colorTokens.ts";
import { DEFAULT_COLORS, THEME_COLORS } from "../../../src/domain/colors.ts";

const PROBES_PER_ROOT = Object.keys(THEME_COLORS).length * 2;

let uninstall: (() => void) | undefined;
let reads: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  reads = vi.spyOn(window, "getComputedStyle");
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

it("resolves one palette for the roots of a theme scope at install", () => {
  expect(reads.mock.calls.length).toBe(PROBES_PER_ROOT);
});

it("resolves a palette for each theme scope", () => {
  uninstall?.();
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="dark"><div data-bb-plugin="workstreams"></div></div>',
  );
  reads.mockClear();
  uninstall = installColorTokens({ ...DEFAULT_COLORS, vivid: true });
  expect(reads.mock.calls.length).toBe(2 * PROBES_PER_ROOT);
});

it("ignores style writes on a root's ancestor that hand down no color", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => scroller.style.setProperty("padding-top", "4px")),
  ).toBe(0);
});

it("resolves the palette again when an ancestor hands down a variable", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => scroller.style.setProperty("--background", "red")),
  ).toBe(PROBES_PER_ROOT);
});

it("reads nothing when a root joins a scope that is already resolved", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => {
      const root = document.createElement("div");
      root.dataset.bbPlugin = "workstreams";
      scroller.append(root);
    }),
  ).toBe(0);
});

it("reads a root that sets its own theme variables separately", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => {
      const root = document.createElement("div");
      root.dataset.bbPlugin = "workstreams";
      root.style.setProperty("--background", "red");
      scroller.append(root);
    }),
  ).toBe(PROBES_PER_ROOT);
});

it("leaves the style sheet alone when a root joins with the same paints", async () => {
  const sheet = document.querySelector("[data-ws-color-tokens]")!;
  const rewrites = vi.fn();
  new MutationObserver(rewrites).observe(sheet, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  await readsAfter(() => {
    const root = document.createElement("div");
    root.dataset.bbPlugin = "workstreams";
    document.getElementById("scroller")!.append(root);
  });
  await settle();
  expect(rewrites).not.toHaveBeenCalled();
  const ids = [...document.querySelectorAll<HTMLElement>("[data-bb-plugin]")]
    .map((root) => root.dataset.wsPalette)
    .filter(Boolean);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
});

it("resolves the scope's palette again when its theme changes", async () => {
  expect(
    await readsAfter(() => {
      const scope = document.querySelector(".light")!;
      scope.classList.replace("light", "dark");
    }),
  ).toBe(PROBES_PER_ROOT);
});
