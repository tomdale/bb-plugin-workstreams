import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/home/home.css", import.meta.url),
  "utf8",
);

describe.skipIf(browserUnavailable)(
  "Home browser layout",
  { timeout: 30_000 },
  () => {
    browserTest(
      "uses the space above Up Next instead of BB's Recent-list spacer",
      async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.setContent(`<style>
          html, body { margin: 0; height: 100%; }
          .region { position: relative; height: 844px; }
          .viewport { position: absolute; inset: 314px 0 0; overflow-y: auto; }
          .content { display: flex; min-height: 100%; flex-direction: column; justify-content: flex-end; }
          .composer { position: absolute; inset: auto 0 0; height: 188px; }
        </style><style>${styles}</style>
        <div class="region">
          <div class="viewport" data-testid="root-compose-compact-scroll-viewport">
            <div class="content" data-testid="root-compose-compact-scroll-content">
              <div data-testid="root-compose-compact-leading-spacer" style="height: 314px"></div>
              <div>
                <div data-root-compose-mobile-recents style="height: 240px"></div>
                <div data-testid="plugin-homepage-sections">
                  <section>
                    <h2>Workstreams</h2>
                    <div data-bb-plugin-root>
                      <div class="ws-home" data-ws-home="takeover">
                        <section class="ws-home-up-next ws-needs" style="height: 360px"></section>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
              <div data-testid="root-compose-compact-bottom-spacer" style="height: 188px"></div>
            </div>
          </div>
          <div class="composer" data-testid="root-compose-compact-composer"></div>
        </div>`);

        const geometry = await page.evaluate(() => {
          const rect = (testId: string) =>
            document
              .querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
              .getBoundingClientRect();
          const viewport = document.querySelector<HTMLElement>(
            '[data-testid="root-compose-compact-scroll-viewport"]',
          )!;
          const home = document.querySelector<HTMLElement>(".ws-home")!;
          return {
            leadingSpacerDisplay: getComputedStyle(
              document.querySelector<HTMLElement>(
                '[data-testid="root-compose-compact-leading-spacer"]',
              )!,
            ).display,
            homeTop: home.getBoundingClientRect().top,
            upNextBottom: document
              .querySelector<HTMLElement>(".ws-home-up-next")!
              .getBoundingClientRect().bottom,
            composerTop: rect("root-compose-compact-composer").top,
            overflow: viewport.scrollHeight - viewport.clientHeight,
          };
        });

        expect(geometry.leadingSpacerDisplay).toBe("none");
        expect(geometry.homeTop).toBe(56);
        expect(geometry.upNextBottom).toBeLessThan(geometry.composerTop);
        expect(geometry.overflow).toBe(0);
      },
    );
  },
);
