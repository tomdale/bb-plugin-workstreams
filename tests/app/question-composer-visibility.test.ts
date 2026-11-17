import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

/** BB's composer shell with the same `[hidden]` rule its stylesheet resets to. */
const shell = (portaled: boolean) => `
  <style>
    [hidden]:where(:not([hidden="until-found"])) { display: none !important; }
    ${styles}
  </style>
  <div data-app-composer="">
    <section data-testid="plugin-interaction-shell">
      ${portaled ? '<span class="ws-question-portaled" hidden></span>' : ""}
    </section>
    <div data-follow-up-composer="" hidden>Composer</div>
  </div>`;

const display = (selector: string) =>
  `getComputedStyle(document.querySelector('${selector}')).display`;

browserTest.skipIf(browserUnavailable)(
  "keeps the composer drawn under a portaled question card",
  async ({ page }) => {
    await page.setContent(shell(true));
    expect(await page.evaluate(display("[data-follow-up-composer]"))).toBe(
      "block",
    );
    expect(
      await page.evaluate(display('[data-testid="plugin-interaction-shell"]')),
    ).toBe("none");
  },
);

browserTest.skipIf(browserUnavailable)(
  "leaves BB hiding the composer for a question that is not portaled",
  async ({ page }) => {
    await page.setContent(shell(false));
    expect(await page.evaluate(display("[data-follow-up-composer]"))).toBe(
      "none",
    );
  },
);
