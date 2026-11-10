import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPARKLES_ICON,
  TAG_ICON,
  WORKSTREAM_ICON,
} from "../../src/app/workstream-icon.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const declared: Record<string, string> =
  manifest.bb.branding.experimental_icons;

describe("the plugin's declared icons", () => {
  // BB draws an icon name it doesn't know as a lightning bolt, so every name
  // the UI uses for a Workstreams entity must be declared in the manifest.
  it.each([
    ["workstream", WORKSTREAM_ICON],
    ["tag", TAG_ICON],
    ["sparkles", SPARKLES_ICON],
  ])("declares %s under the name the UI uses", (key, name) => {
    expect(name).toBe(`workstreams/${key}`);
    expect(declared[key]).toBeTruthy();
  });

  it("ships a themable SVG for every declared icon", () => {
    for (const path of Object.values(declared)) {
      const file = resolve(root, path);
      expect(existsSync(file), path).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg, path).toContain("<svg");
      // Drawn in the surrounding text color, not a fixed one.
      expect(svg, path).toContain("currentColor");
      expect(svg, path).not.toMatch(/(?:stroke|fill)="#[0-9a-f]{3,8}"/i);
    }
  });
});

/**
 * Names of BB's own icons that have been seen drawing correctly in the running
 * app. BB draws any other name as a lightning bolt, silently, so a literal
 * `<Icon name>` must be one of these or a declared plugin icon. Add a name
 * here only after seeing it render in BB.
 */
const VERIFIED_BB_ICONS = new Set([
  "Archive",
  "ArrowRight",
  "ArrowTurnBackward",
  "ArrowUp",
  "Bug",
  "Check",
  "ChevronDown",
  "ChildThread",
  "ChevronLeft",
  "ChevronRight",
  "Close",
  "Edit",
  "ExternalLink",
  "Loading",
  "MoreHorizontal",
  "Pin",
  "Plus",
  "Spinner",
  "UserRound",
  "X",
]);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });

describe("icon names in the UI", () => {
  it("are verified BB icons, so none draws as a lightning bolt", () => {
    const unverified: string[] = [];
    for (const file of sources(resolve(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/g)) {
        if (!VERIFIED_BB_ICONS.has(match[1]!)) unverified.push(match[1]!);
      }
    }
    expect(unverified).toEqual([]);
  });
});
