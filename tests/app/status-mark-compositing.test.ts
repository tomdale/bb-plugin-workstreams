import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
import { settleEntranceAnimations } from "./animation-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);
const reference = `
  .reference { overflow: visible; }
  .reference::before {
    content: "\\280B";
    width: auto;
    height: auto;
    align-self: auto;
    margin-top: 0;
    white-space: normal;
    animation-name: ws-braille-reference;
  }
  @keyframes ws-braille-reference {
    0% { content: "\\280B"; }
    10% { content: "\\2819"; }
    20% { content: "\\2839"; }
    30% { content: "\\2838"; }
    40% { content: "\\283C"; }
    50% { content: "\\2834"; }
    60% { content: "\\2826"; }
    70% { content: "\\2827"; }
    80% { content: "\\2807"; }
    90% { content: "\\280F"; }
  }
`;
const mark = (className: string) =>
  `<span class="ws-mark ws-spin ws-spin-braille ${className}" style="--ws-spin-primary: #141414"></span>`;

browserTest.skipIf(browserUnavailable)(
  "moves the Braille strip through the original glyphs in sync",
  { timeout: 30_000 },
  async ({ page }) => {
    await page.setContent(`<style>${styles}${reference}
      body { margin: 0; background: white; }
      .ws-mark { margin: 4px; vertical-align: top; }
    </style>${mark("reference")}${Array.from({ length: 8 }, () => mark("candidate")).join("")}`);
    // Setting startTime on a paused animation cancels the pause and starts it
    // running, so the clock is held through pause() and ready alone. A running
    // animation keeps advancing between setting currentTime and sampling it,
    // and a delayed frame moves the sample into the next step.
    await page.evaluate(async () => {
      const animations = document.getAnimations();
      for (const animation of animations) animation.pause();
      await Promise.all(animations.map((animation) => animation.ready));
    });

    const animationProperties = await page.evaluate(() => {
      const animation = document
        .getAnimations()
        .find(
          (candidate) =>
            (candidate as CSSAnimation).animationName === "ws-braille",
        )!;
      const before = getComputedStyle(
        document.querySelector(".candidate")!,
        "::before",
      );
      return {
        keyframes: (animation.effect as KeyframeEffect)
          .getKeyframes()
          .flatMap(Object.keys),
        duration: before.animationDuration,
        timing: before.animationTimingFunction,
      };
    });
    expect(animationProperties.keyframes).toContain("transform");
    for (const property of ["content", "width", "height", "top", "left"])
      expect(animationProperties.keyframes).not.toContain(property);
    expect(animationProperties.duration).toBe("0.8s");
    expect(animationProperties.timing).toBe("steps(1)");

    const comparisons = [];
    for (let frame = 0; frame < 10; frame++) {
      const { drifted, samples, boxes } = await page.evaluate(
        async (time) => {
          for (const animation of document.getAnimations())
            animation.currentTime = time;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const drifted = document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState !== "paused" ||
                animation.currentTime !== time,
            )
            .map((animation) => ({
              playState: animation.playState,
              currentTime: animation.currentTime,
            }));
          const samples = Array.from(
            document.querySelectorAll(".candidate"),
          ).map((candidate) => {
            const strip = getComputedStyle(candidate, "::before");
            const host = candidate.getBoundingClientRect();
            const glyph =
              strip.transform === "none"
                ? 0
                : Math.round(-new DOMMatrixReadOnly(strip.transform).m42 / 12);
            return {
              content: strip.content,
              glyph: glyph || 0,
              clipped:
                host.width === 14 &&
                host.height === 14 &&
                getComputedStyle(candidate).overflow === "hidden",
            };
          });
          const boxes = ["reference", "candidate"].map((className) => {
            const box = document
              .querySelector(`.${className}`)!
              .getBoundingClientRect();
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            };
          });
          return { drifted, samples, boxes };
        },
        frame * 80 + 20,
      );
      expect(drifted).toEqual([]);
      expect(samples.map((sample) => sample.glyph)).toEqual(
        Array.from({ length: 8 }, () => frame),
      );
      expect(new Set(samples.map((sample) => sample.content)).size).toBe(1);
      expect(samples.every((sample) => sample.clipped)).toBe(true);
      // One capture includes both main-thread content and the compositor
      // transform; separate screenshots can straddle their frame commits.
      comparisons.push({ boxes, screenshot: await page.screenshot() });
    }

    const differences = await page.evaluate(
      async (comparisons) => {
        const differences = [];
        for (const { boxes, source } of comparisons) {
          const image = new Image();
          image.src = source;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const images = boxes.map(
            (box) =>
              context.getImageData(box.x, box.y, box.width, box.height).data,
          );
          let sum = 0;
          for (let index = 0; index < images[0]!.length; index++)
            sum += Math.abs(images[0]![index]! - images[1]![index]!);
          differences.push(sum / images[0]!.length);
        }
        return differences;
      },
      comparisons.map(({ boxes, screenshot }) => ({
        boxes,
        source: `data:image/png;base64,${screenshot.toString("base64")}`,
      })),
    );
    expect(Math.max(...differences), JSON.stringify(differences)).toBeLessThan(
      0.6,
    );
  },
);

browserTest.skipIf(browserUnavailable)(
  "keeps Braille frames off layout and paint and honors reduced motion",
  { timeout: 15_000 },
  async ({ page }) => {
    await page.setContent(`<style>${styles}
      body { margin: 0; background: white; }
      .ws-mark { margin: 4px; --ws-spin-primary: #141414; }
    </style>${Array.from({ length: 8 }, () => mark("")).join("")}`);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.startTime = 0;
    });
    await settleEntranceAnimations(page);
    const client = await page.context().newCDPSession(page);
    try {
      await client.send("Performance.enable");
      const events: Record<string, string>[] = [];
      client.on("Tracing.dataCollected", ({ value }) => events.push(...value));
      await client.send("Tracing.start", {
        categories: "devtools.timeline",
        transferMode: "ReportEvents",
      });
      const before = await client.send("Performance.getMetrics");
      await page.waitForTimeout(800);
      const after = await client.send("Performance.getMetrics");
      const finished = new Promise<void>((resolve) =>
        client.once("Tracing.tracingComplete", () => resolve()),
      );
      await client.send("Tracing.end");
      await finished;
      const value = (metrics: typeof before, name: string) =>
        metrics.metrics.find((metric) => metric.name === name)!.value;
      expect(value(after, "LayoutCount") - value(before, "LayoutCount")).toBe(
        0,
      );
      expect(
        value(after, "RecalcStyleCount") - value(before, "RecalcStyleCount"),
      ).toBe(0);
      expect(
        Object.fromEntries(
          ["UpdateLayoutTree", "Layout", "Paint"].map((name) => [
            name,
            events.filter((event) => event.name === name && event.ph === "X")
              .length,
          ]),
        ),
      ).toEqual({ UpdateLayoutTree: 0, Layout: 0, Paint: 0 });

      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await page
          .locator(".ws-spin-braille")
          .first()
          .evaluate((element) => ({
            animation: getComputedStyle(element, "::before").animationName,
            transform: getComputedStyle(element, "::before").transform,
          })),
      ).toEqual({ animation: "none", transform: "none" });
    } finally {
      await client.detach();
    }
  },
);
