// The `clip-path` that `useSlotList` writes on a row another row passes over,
// drawn by a real browser: the covered band shows what is behind the row, and
// the bands around it keep the row's own pixels.
import { expect } from "vitest";
import { clipPathShowing } from "../../src/app/sidebar/motion.ts";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

browserTest.skipIf(browserUnavailable)(
  "hides exactly the covered bands of a slot",
  { timeout: 15_000 },
  async ({ page }) => {
    const covered = [
      [[10, 20]],
      [
        [0, 8],
        [30, 42],
      ],
      [
        [8, 14],
        [12, 22],
        [26, 31],
      ],
      [[0, 42]],
    ] as const;
    for (const bands of covered) {
      await page.setContent(`<style>
        body { margin: 0; background: rgb(0, 0, 255); }
        #slot { width: 20px; height: 42px; background: rgb(255, 0, 0); clip-path: ${clipPathShowing(42, bands)}; }
      </style><div id="slot"></div>`);
      const shown = await page.evaluate(async () => {
        const rows: boolean[] = [];
        for (let y = 0; y < 42; y++) {
          // Row `y` of the slot is red where it draws and blue where the page shows through.
          const [hit] = document.elementsFromPoint(10, y + 0.5);
          rows.push(hit?.id === "slot");
        }
        return rows;
      });
      const hidden = Array.from({ length: 42 }, (_, y) =>
        bands.some(([from, to]) => y >= from && y < to),
      );
      expect(shown).toEqual(hidden.map((band) => !band));
      const pixels = await page.screenshot({
        clip: { x: 0, y: 0, width: 20, height: 42 },
      });
      const red = await page.evaluate(async (png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, image.width, image.height).data;
        const scale = image.height / 42;
        return Array.from(
          { length: 42 },
          (_, y) =>
            data[(Math.floor((y + 0.5) * scale) * image.width + 5) * 4]! > 127,
        );
      }, pixels.toString("base64"));
      expect(red).toEqual(shown);
    }
  },
);
