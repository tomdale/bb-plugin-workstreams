import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { BAR_FADE_RATIO } from "../../src/app/goalHeading.ts";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

browserTest.skipIf(browserUnavailable)(
  "keeps the plate and fade at the viewport top when a tall footer pushes the column away",
  { timeout: 30_000 },
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(`
      <style>${styles}
        :root { --background: black; }
        body { margin: 0; }
        .surface { position: relative; }
        .scroller { height: 300px; overflow: auto; }
        .column { height: 700px; display: flex; flex-direction: column; }
        .footer { height: 280px; }
      </style>
      <div class="surface">
        <div class="scroller"><div class="column"><div class="ws-sticky-goal-root" style="margin-bottom: 100px"></div><p>Message</p></div><div class="footer"></div></div>
        <div class="ws-goal-overlay" style="pointer-events:auto">
          <div class="ws-goal-background" style="width:400px; --ws-plate-height:100px; --ws-fade-below-plate:1">
            <div class="ws-sticky-goal" style="height:100px"><div class="ws-sticky-goal__plate"></div></div>
          </div>
        </div>
      </div>`);
    const result = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".scroller")!;
      scroller.scrollTop = scroller.scrollHeight;
      const root = document.querySelector<HTMLElement>(".ws-sticky-goal-root")!;
      const plate = document.querySelector<HTMLElement>(
        ".ws-sticky-goal__plate",
      )!;
      const background = document.querySelector<HTMLElement>(
        ".ws-goal-background",
      )!;
      const barFade = getComputedStyle(background, "::before");
      const barFadeHeight = Number.parseFloat(barFade.height);
      const plateFadeHeight = Number.parseFloat(
        getComputedStyle(background, "::after").height,
      );
      return {
        rootTop: root.getBoundingClientRect().top,
        scrollerTop: scroller.getBoundingClientRect().top,
        plateTop: plate.getBoundingClientRect().top,
        plateBottom: plate.getBoundingClientRect().bottom,
        onTop: document.elementFromPoint(20, 50)?.className,
        fade: getComputedStyle(background, "::after").backgroundImage,
        fadeOpacity: getComputedStyle(background, "::after").opacity,
        plateFadeHeight,
        barFadeHeight,
        barFadeTop: barFade.top,
      };
    });
    expect(result.rootTop).toBeLessThan(result.scrollerTop);
    expect(result.plateTop).toBe(result.scrollerTop);
    expect(result.plateBottom).toBe(result.scrollerTop + 100);
    expect(result.onTop).toBe("ws-sticky-goal__plate");
    expect(result.fade).toContain("linear-gradient");
    expect(result.fadeOpacity).toBe("1");
    // One gradient in two lengths: the bar's shadow is the plate's, shortened.
    expect(result.barFadeHeight / result.plateFadeHeight).toBeCloseTo(
      BAR_FADE_RATIO,
    );
    // The bar's shadow starts one pixel higher, over the title bar's hairline,
    // so the two surfaces meet in the shadow instead of along a rule.
    expect(result.barFadeTop).toBe("-1px");
  },
);

browserTest.skipIf(browserUnavailable)(
  "feathers the heading background gradually in light and dark themes",
  { timeout: 30_000 },
  async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 220 });
    await page.setContent(`
        <style>${styles}
          body { margin: 0; }
          .surface { position: relative; height: 220px; }
        </style>
        <div class="surface">
          <div class="ws-goal-overlay">
            <div class="ws-goal-background" style="width:400px; --ws-plate-height:100px; --ws-fade-below-plate:1">
              <div class="ws-sticky-goal" style="height:100px"><div class="ws-sticky-goal__plate"></div></div>
            </div>
          </div>
        </div>`);
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((theme) => {
        document.documentElement.style.setProperty(
          "--background",
          theme === "dark" ? "black" : "white",
        );
        document.querySelector<HTMLElement>(".surface")!.style.background =
          theme === "dark" ? "white" : "black";
      }, theme);
      // Let the theme's styles reach the compositor before sampling pixels.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      // Sample across whatever length the shadow is, from its first pixel (the
      // plate's own color) to the row past its end (the bare surface), so the
      // assertion is about the shadow's shape, not its size.
      const fadeHeight = await page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(
            document.querySelector<HTMLElement>(".ws-goal-background")!,
            "::after",
          ).height,
        ),
      );
      const rows = [0.02, 0.2, 0.5, 0.75, 1].map(
        (fraction) => 100 + Math.round(fraction * fadeHeight),
      );
      const image = await page.screenshot();
      const samples = await page.evaluate(
        async ({ source, rows }) => {
          const image = new Image();
          image.src = source;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return rows.map((y) => context.getImageData(20, y, 1, 1).data[0]!);
        },
        { source: `data:image/png;base64,${image.toString("base64")}`, rows },
      );
      const contrast = samples.map((value) =>
        theme === "dark" ? value : 255 - value,
      );
      expect(contrast[0]).toBeLessThan(16);
      expect(contrast[4]).toBeGreaterThan(245);
      for (let i = 1; i < contrast.length; i++) {
        expect(contrast[i]! - contrast[i - 1]!).toBeGreaterThan(15);
      }
    }
  },
);

browserTest.skipIf(browserUnavailable)(
  "centers the minimized title's workstream line and text when the group asks for it",
  { timeout: 30_000 },
  async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 200 });
    await page.setContent(`
      <style>${styles}
        body { margin: 0; }
        .ws-goal-overlay__group { position: relative; width: 300px; height: 60px; }
      </style>
      <div class="ws-goal-overlay__group">
        <div class="ws-sticky-goal__workstream" style="transform: scale(0.82)"><i></i><span>Workstream</span></div>
        <div class="ws-sticky-goal__title">A title</div>
      </div>`);
    const measure = () =>
      page.evaluate(() => {
        const group = document.querySelector(".ws-goal-overlay__group")!;
        const line = document.querySelector(".ws-sticky-goal__workstream")!;
        const title = document.querySelector(".ws-sticky-goal__title")!;
        const groupRect = group.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        const lineStyle = getComputedStyle(line);
        return {
          titleAlign: getComputedStyle(title).textAlign,
          lineLeft: Math.round(lineRect.left),
          lineRight: Math.round(lineRect.right),
          groupWidth: Math.round(groupRect.width),
          justify: lineStyle.justifyContent,
          lineInset: `${lineStyle.left}/${lineStyle.right}`,
          offsetFromMiddle: Math.round(
            lineRect.left +
              lineRect.width / 2 -
              (groupRect.left + groupRect.width / 2),
          ),
        };
      });
    const left = await measure();
    await page.evaluate(() =>
      document
        .querySelector(".ws-goal-overlay__group")!
        .setAttribute("data-ws-align", "center"),
    );
    const centered = await measure();
    expect(left.titleAlign).toBe("start");
    expect(centered.titleAlign).toBe("center");
    // The line spans the group so its contents can center, instead of sitting
    // at the icon's optical inset.
    expect(left.justify).toBe("normal");
    expect(centered.justify).toBe("center");
    expect(left.lineInset.startsWith("-2px/")).toBe(true);
    expect(centered.lineInset).toBe("0px/0px");
    // Scaling the compact line shrinks it about its own middle, not its left
    // edge, so the middle stays on the bar's middle.
    expect(Math.abs(centered.offsetFromMiddle)).toBeLessThanOrEqual(1);
    expect(left.offsetFromMiddle).toBeLessThan(-50);
  },
);
