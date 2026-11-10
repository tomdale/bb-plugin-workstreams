import { readFileSync } from "node:fs";
import { expect } from "vitest";
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
        barShadow: getComputedStyle(background, "::before").content,
      };
    });
    expect(result.rootTop).toBeLessThan(result.scrollerTop);
    expect(result.plateTop).toBe(result.scrollerTop);
    expect(result.plateBottom).toBe(result.scrollerTop + 100);
    expect(result.onTop).toBe("ws-sticky-goal__plate");
    expect(result.fade).toContain("linear-gradient");
    expect(result.fadeOpacity).toBe("1");
    expect(result.plateFadeHeight).toBe(192);
    // The title bar has no shadow of its own: only the plate casts one.
    expect(result.barShadow).toBe("none");
  },
);

browserTest.skipIf(browserUnavailable)(
  "feathers the heading background gradually in light and dark themes",
  { timeout: 30_000 },
  async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 400 });
    await page.setContent(`
        <style>${styles}
          body { margin: 0; }
          .surface { position: relative; height: 400px; }
        </style>
        <div class="surface">
          <div class="ws-goal-overlay">
            <div class="ws-goal-background" style="width:400px; --ws-plate-height:75px; --ws-fade-below-plate:1">
              <div class="ws-sticky-goal" style="height:100px"><div class="ws-sticky-goal__plate" style="transform:scaleY(.75)"></div></div>
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
      const fadeStart = 75;
      const rows = [
        fadeStart - 1,
        fadeStart,
        fadeStart + 1,
        ...[0.02, 0.2, 0.5, 0.75, 1].map(
          (fraction) => fadeStart + Math.round(fraction * fadeHeight),
        ),
      ];
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
      // The shortened solid plate and its translated gradient meet without a
      // step in either theme, then the gradient keeps falling off.
      expect(Math.max(...contrast.slice(0, 3))).toBeLessThanOrEqual(6);
      const falloff = contrast.slice(3);
      expect(falloff[0]).toBeLessThan(16);
      expect(falloff[4]).toBeGreaterThan(245);
      for (let i = 1; i < falloff.length; i++) {
        expect(falloff[i]! - falloff[i - 1]!).toBeGreaterThan(15);
      }
    }
  },
);

browserTest.skipIf(browserUnavailable)(
  "left aligns the minimized workstream line and text within a centered slot",
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
    expect(left.titleAlign).toBe("start");
    expect(left.justify).toBe("normal");
    expect(left.lineInset.startsWith("-2px/")).toBe(true);
    // The compact line scales from its left edge even when the slot itself is
    // centered in the title bar.
    expect(left.offsetFromMiddle).toBeLessThan(-50);
  },
);
