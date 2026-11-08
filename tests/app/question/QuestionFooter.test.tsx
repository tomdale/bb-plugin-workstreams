// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from "node:stream/web";
import { compile } from "tailwindcss";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import { ThreadCard } from "../../../src/app/page/queue/QueueItem.tsx";
import { QuestionForm } from "../../../src/app/question/question-form.tsx";
import { QUESTION_CARD_CLASS } from "../../../src/app/question/question-presentation.tsx";
import { payload } from "./submission-fixture.ts";

Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream });
const { browserTest, browserUnavailable } =
  await import("../browser-fixture.ts");

const require = createRequire(import.meta.url);
const theme = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
const preflight = readFileSync(
  require.resolve("tailwindcss/preflight.css"),
  "utf8",
);
afterEach(cleanup);

browserTest.skipIf(browserUnavailable)(
  "aligns queue and thread question footers without clipping their buttons",
  { timeout: 30_000 },
  async ({ browser }) => {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width === 390,
      });
      const page = await context.newPage();
      try {
        for (const layout of ["queue", "thread"] as const) {
          for (const step of ["single", "first", "last"] as const) {
            function Card() {
              const form = (
                <QuestionForm
                  questions={
                    step === "single"
                      ? [payload.questions[0]!]
                      : payload.questions
                  }
                  disabled={false}
                  cancelDisabled={false}
                  onSubmit={() => {}}
                  onCancel={() => {}}
                />
              );
              return layout === "queue" ? (
                <div data-test-card>
                  <ThreadCard
                    card={{ kind: "needs", line: null }}
                    threadId="thread"
                    files={null}
                    age="now"
                    question={form}
                  />
                </div>
              ) : (
                <div data-test-card className={QUESTION_CARD_CLASS}>
                  {form}
                </div>
              );
            }
            const slot = renderSlot({ component: Card }, {});
            if (step === "last")
              fireEvent.click(slot.getByRole("button", { name: "Notes" }));
            const classes = [
              ...slot.container.querySelectorAll("[class]"),
            ].flatMap((element) => [...element.classList]);
            const compiler = await compile(`${theme}\n@tailwind utilities;`);
            const css = compiler.build(classes);
            await page.setContent(
              `<style>${preflight}\n${css}\n[data-test-card] { width: ${width === 390 ? 350 : 680}px; margin: 20px; } body { font-family: sans-serif; }</style>${slot.container.innerHTML}`,
            );
            const bounds = await page.evaluate(() => {
              const card =
                document.querySelector<HTMLElement>("[data-test-card]")!;
              const buttons = [
                ...card.querySelectorAll<HTMLButtonElement>("button"),
              ];
              const cancel = buttons.find(
                (button) => button.textContent === "Cancel",
              )!;
              const submit = buttons.find((button) =>
                ["Submit", "Next"].includes(button.textContent!),
              )!;
              const footer = cancel.parentElement!;
              const heading =
                card.querySelector<HTMLElement>('[role="heading"]')!;
              const box = (element: HTMLElement) =>
                element.getBoundingClientRect().toJSON();
              return {
                card: box(card),
                footer: box(footer),
                cancel: box(cancel),
                submit: box(submit),
                heading: box(heading),
                cancelPadding: parseFloat(getComputedStyle(cancel).paddingLeft),
              };
            });
            expect(
              bounds.footer.left - bounds.card.left,
              `${layout} ${width} ${step}: left edge`,
            ).toBeCloseTo(1, 0);
            expect(
              bounds.card.right - bounds.footer.right,
              `${layout} ${width} ${step}: right edge`,
            ).toBeCloseTo(1, 0);
            expect(
              bounds.card.bottom - bounds.footer.bottom,
              `${layout} ${width} ${step}: bottom edge`,
            ).toBeCloseTo(1, 0);
            expect(bounds.cancel.top).toBeCloseTo(bounds.submit.top, 0);
            expect(bounds.cancel.bottom).toBeCloseTo(bounds.submit.bottom, 0);
            expect(bounds.footer.bottom - bounds.cancel.bottom).toBeCloseTo(
              6,
              0,
            );
            expect(bounds.cancel.left + bounds.cancelPadding).toBeCloseTo(
              bounds.heading.left,
              0,
            );
            expect(bounds.card.right - bounds.submit.right).toBeCloseTo(17, 0);
            slot.lifecycle.unmount();
          }
        }
      } finally {
        await context.close();
      }
    }
  },
);
