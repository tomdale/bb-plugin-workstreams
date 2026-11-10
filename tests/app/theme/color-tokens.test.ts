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

it("resolves every root's palette once at install", () => {
  expect(reads.mock.calls.length).toBe(2 * PROBES_PER_ROOT);
});

it("ignores style writes on a root's ancestor that hand down no color", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => scroller.style.setProperty("padding-top", "4px")),
  ).toBe(0);
});

it("resolves every palette again when an ancestor hands down a variable", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => scroller.style.setProperty("--background", "red")),
  ).toBe(2 * PROBES_PER_ROOT);
});

it("resolves only a new root's palette when a root joins the page", async () => {
  const scroller = document.getElementById("scroller")!;
  expect(
    await readsAfter(() => {
      const root = document.createElement("div");
      root.dataset.bbPlugin = "workstreams";
      scroller.append(root);
    }),
  ).toBe(PROBES_PER_ROOT);
});

it("resolves every palette again when the theme scope changes", async () => {
  expect(
    await readsAfter(() => {
      const scope = document.querySelector(".light")!;
      scope.classList.replace("light", "dark");
    }),
  ).toBe(2 * PROBES_PER_ROOT);
});
