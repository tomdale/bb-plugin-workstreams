import { describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

describe.skipIf(browserUnavailable)("gallery build", () => {
  browserTest.concurrent(
    "opens the built gallery from disk with the app defaults",
    async ({ page }) => {
      const root = fileURLToPath(new URL("../../", import.meta.url));
      const output = mkdtempSync(join(tmpdir(), "workstreams-gallery-"));
      try {
        const vite = `${root}node_modules/vite/bin/vite.js`;
        const config = `${root}gallery/vite.config.ts`;
        for (const galleryPage of ["gallery", "sidebar"]) {
          await promisify(execFile)(
            process.execPath,
            [vite, "build", "--config", config, "--outDir", output],
            {
              cwd: root,
              env: {
                ...process.env,
                NO_COLOR: "1",
                GALLERY_PAGE: galleryPage,
              },
            },
          );
        }
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`file://${output}/index.html#recap-card`);
        await page
          .getByRole("heading", { name: "Recap card", exact: true })
          .waitFor();
        await page
          .getByRole("navigation", { name: "Design system" })
          .getByRole("link", { name: /Sidebar playground/ })
          .click();
        await page.locator("#after .ws-row").first().waitFor();
        expect(await page.locator("#rowHeight").inputValue()).toBe(
          String(SIDEBAR_GEOMETRY.row.rootHeight),
        );
        expect(await page.locator("#childRowHeight").inputValue()).toBe(
          String(SIDEBAR_GEOMETRY.row.childHeight),
        );
        expect(await page.locator("#font_category_color").inputValue()).toBe(
          "default",
        );
        await page.getByRole("link", { name: "Design system" }).click();
        await page
          .getByRole("heading", { name: "Introduction", exact: true })
          .waitFor();
        expect(errors).toEqual([]);
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
