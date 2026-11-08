import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);
const duration = 12_840;
const reference = `
  .reference::after {
    width: auto;
    right: 0;
    background-size: 300% 100%;
    animation-name: reference-shimmer;
  }
  @keyframes reference-shimmer {
    0% { background-position: 125% 0; }
    39.25%, 100% { background-position: -25% 0; }
  }
`;

browserTest.skipIf(browserUnavailable)(
  "preserves the Up Next gradient sweep on a composited layer",
  { timeout: 30_000 },
  async ({ page }) => {
    for (const width of [240, 420]) {
      for (const background of ["#141414", "#ffffff"]) {
        await page.setContent(`<style>${styles}${reference}
          body { margin: 0; background: ${background}; }
          .ws-needs {
            --sidebar: ${background}; --ws-needs-you-band: #e2b659;
            width: ${width}px; height: 160px; box-sizing: border-box;
          }
        </style><div class="ws-needs reference"></div><div class="ws-needs candidate"></div>`);
        const frames = await page.evaluate(
          async ({ duration }) => {
            const reference = document.querySelector(".reference")!;
            const candidate = document.querySelector(".candidate")!;
            const animations = document.getAnimations();
            for (const animation of animations) animation.pause();
            const shimmer = animations.find(
              (animation) =>
                (animation as CSSAnimation).animationName ===
                "ws-needs-shimmer",
            )!;
            const keyframes = (shimmer.effect as KeyframeEffect).getKeyframes();
            const samples = [];
            for (let time = 0; time <= 5050; time += 50) {
              for (const animation of animations) animation.currentTime = time;
              const original = getComputedStyle(reference, "::after");
              const replacement = getComputedStyle(candidate, "::after");
              const cardWidth = candidate.clientWidth;
              const position =
                Number.parseFloat(original.backgroundPositionX) / 100;
              const expected = -2 * cardWidth * position;
              const actual = new DOMMatrixReadOnly(replacement.transform).m41;
              samples.push(Math.abs(expected - actual));
            }
            for (const animation of animations)
              animation.currentTime = duration * 0.16;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            return {
              maximumError: Math.max(...samples),
              keyframeProperties: keyframes.flatMap(Object.keys),
            };
          },
          { duration },
        );
        expect(frames.maximumError).toBeLessThan(0.03);
        expect(frames.keyframeProperties).toContain("transform");
        expect(frames.keyframeProperties).not.toContain("backgroundPositionX");
        const original = await page.locator(".reference").screenshot();
        const replacement = await page.locator(".candidate").screenshot();
        const difference = await page.evaluate(
          async (sources) => {
            const images = await Promise.all(
              sources.map(async (source) => {
                const image = new Image();
                image.src = source;
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d")!;
                context.drawImage(image, 0, 0);
                return context.getImageData(0, 0, image.width, image.height)
                  .data;
              }),
            );
            let sum = 0;
            for (let i = 0; i < images[0]!.length; i++)
              sum += Math.abs(images[0]![i]! - images[1]![i]!);
            return sum / images[0]!.length;
          },
          [original, replacement].map(
            (image) => `data:image/png;base64,${image.toString("base64")}`,
          ),
        );
        expect(difference).toBeLessThan(0.6);
      }
    }
  },
);

browserTest.skipIf(browserUnavailable)(
  "does not recalculate styles on each shimmer frame and honors reduced motion",
  { timeout: 15_000 },
  async ({ page }) => {
    await page.setContent(`<style>${styles}
      .ws-needs { --ws-needs-you-band: orange; width: 280px; height: 160px; }
      </style><div class="ws-needs"></div>`);
    await page.waitForTimeout(1100);
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Performance.enable");
      let paints = 0;
      client.on("Tracing.dataCollected", ({ value }) => {
        paints += value.filter(
          (event) => event.name === "Paint" && event.ph === "X",
        ).length;
      });
      await client.send("Tracing.start", {
        categories: "devtools.timeline",
        transferMode: "ReportEvents",
      });
      const before = await client.send("Performance.getMetrics");
      await page.waitForTimeout(1000);
      const after = await client.send("Performance.getMetrics");
      const finished = new Promise<void>((resolve) =>
        client.once("Tracing.tracingComplete", () => resolve()),
      );
      await client.send("Tracing.end");
      await finished;
      expect(paints).toBeLessThanOrEqual(4);
      const value = (metrics: typeof before, name: string) =>
        metrics.metrics.find((metric) => metric.name === name)!.value;
      expect(value(after, "LayoutCount") - value(before, "LayoutCount")).toBe(
        0,
      );
      expect(
        value(after, "RecalcStyleCount") - value(before, "RecalcStyleCount"),
      ).toBeLessThanOrEqual(2);
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await page.locator(".ws-needs").evaluate((element) => ({
          display: getComputedStyle(element, "::after").display,
          animation: getComputedStyle(element, "::after").animationName,
        })),
      ).toEqual({ display: "none", animation: "none" });
    } finally {
      await client.detach();
    }
  },
);
