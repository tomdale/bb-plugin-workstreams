import type { Page } from "playwright-core";

export async function settleEntranceAnimations(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const animations = document.getAnimations();
    await Promise.all(animations.map((animation) => animation.ready));
    for (const animation of animations)
      if (Number.isFinite(animation.effect!.getComputedTiming().endTime))
        animation.finish();
    for (let frame = 0; frame < 3; frame++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  });
}
