// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it, vi } from "vitest";
import { NewThreadRouting } from "../../src/app/composer/NewThreadRouting.tsx";
import type { Preview } from "../../src/server/preview.ts";
import { emptyState } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([1, 2] as const)(
  "profiles 60 edits across %i views of one composer draft",
  { timeout: 30_000 },
  async (views) => {
    const commits = [0, 0];
    const durations = [0, 0];
    function ComposerView({ index }: { index: number }) {
      return (
        <main data-app-composer-role="primary">
          <Profiler
            id={`composer-${index}`}
            onRender={(_id, phase, duration) => {
              if (phase !== "mount") {
                commits[index]! += 1;
                durations[index]! += duration;
              }
            }}
          >
            <NewThreadRouting />
          </Profiler>
          <form data-promptbox="" />
        </main>
      );
    }
    const decision: Preview = {
      id: "preview-parser",
      traceId: "trace-parser",
      confidence: "high",
      reason: "Parser changes",
      subject: "Alpha",
      subjectId: "ent_alpha",
      goal: "Parser diagnostics",
    };
    const draftIdentity = vi.fn(async (_input: unknown) => ({ filed: false }));
    const preview = vi.fn(async () => decision);
    const previewCancel = vi.fn(async () => ({ canceled: true }));
    const options = {
      composer: {
        text: "",
        scope: { kind: "new-thread" as const, projectId: "proj_1" },
        selection: { projectId: "proj_1" },
      },
      rpc: {
        prefs: () => ({
          prefs: {
            advanced: { debugUi: false },
            newWork: { suggestions: true },
          },
        }),
        state: () => emptyState(),
        catalog: () => ({
          entities: [],
          groups: {},
          assignments: {},
          revision: 1,
        }),
        draftIdentity,
        preview,
        previewCancel,
      },
      sdk: { projects: { list: async () => [] } },
    };
    const slots = Array.from({ length: views }, (_, index) =>
      renderSlot({ component: ComposerView }, { index }, options),
    );
    try {
      expect(
        await screen.findAllByRole("button", { name: "Topic: Automatic" }),
      ).toHaveLength(views);
      await act(async () => {});
      commits.fill(0);
      durations.fill(0);
      draftIdentity.mockClear();
      preview.mockClear();
      previewCancel.mockClear();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      for (let index = 1; index <= 60; index++) {
        await slots[0]!.behavior.setComposerText(
          `Improve parser diagnostics ${"x".repeat(index)}`,
        );
        await act(async () => vi.advanceTimersByTimeAsync(40));
      }
      expect(draftIdentity).toHaveBeenCalledTimes(60);
      expect(
        new Set(
          draftIdentity.mock.calls.map(([input]) => JSON.stringify(input)),
        ).size,
      ).toBe(60);
      expect(commits).toEqual([60, 0]);
      expect(preview).not.toHaveBeenCalled();
      expect(previewCancel).not.toHaveBeenCalled();
      console.info(
        `TYPING_PROFILE ${JSON.stringify({ views, edits: 60, reports: draftIdentity.mock.calls.length, commits, reactDurationMs: durations })}`,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(210);
      });
      expect(preview).toHaveBeenCalledTimes(1);
      expect(draftIdentity).toHaveBeenCalledTimes(61);
      expect(
        screen.getAllByRole("button", { name: "Topic: Alpha" }),
      ).toHaveLength(views);
    } finally {
      for (const slot of slots) slot.lifecycle.unmount();
    }
  },
);
