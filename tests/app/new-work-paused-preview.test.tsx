// @vitest-environment jsdom
/*
 * The composer's preview while a spend cap pauses Workstreams: the server
 * refuses the call and says why. The draft's model asks once and keeps the
 * reason, and the Debug disclosure shows it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  NewWork,
  previewFailure,
  type NewWorkDeps,
  type NewWorkState,
} from "../../src/app/composer/new-work.ts";
import { NewWorkDebug } from "../../src/app/composer/NewWorkDebug.tsx";
import { SHORT_PAUSE_MS } from "../../src/app/composer/timing.ts";
import type { Preview } from "../../src/server/preview.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What the preview RPC rejects with at a reached cap (`pauseMessage`). */
const PAUSED =
  "Workstreams is paused: today's spend reached the $30.00 limit. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.";

const answered: Preview = {
  id: "d_billing",
  confidence: "high",
  reason: "Fits billing",
  subject: "Billing",
  workstreamId: "ws_billing",
  title: "Invoice layout",
  traceId: null,
};

function setup(route: (prompt: string) => Promise<Preview>) {
  const deps = {
    route: vi.fn(route),
    cancelRoute: vi.fn(),
  } satisfies NewWorkDeps;
  // The model logs each preview it could not get.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return { deps, newWork: new NewWork(deps) };
}
const paused = async (): Promise<Preview> => {
  throw new Error(PAUSED);
};

type Event = NewWorkState["events"][number];
let ids = 0;
const event = (
  status: Event["status"],
  error: string | null = null,
  kind: Event["kind"] = "classify",
): Event => ({
  id: ++ids,
  at: ids,
  kind,
  status,
  durationMs: status === "pending" ? null : 1,
  input: null,
  output: null,
  error,
});

describe("previewFailure", () => {
  it("is null before any preview", () => {
    expect(previewFailure([])).toBeNull();
  });

  it("is the reason the newest preview failed with", () => {
    expect(
      previewFailure([event("ok"), event("failed", "model offline")]),
    ).toBe("model offline");
  });

  it("is null once a later preview answered", () => {
    expect(previewFailure([event("failed", PAUSED), event("ok")])).toBeNull();
  });

  it("is null while a later preview runs", () => {
    expect(
      previewFailure([event("failed", PAUSED), event("pending")]),
    ).toBeNull();
  });

  it("looks past previews a newer draft superseded, whatever they ended with", () => {
    expect(
      previewFailure([
        event("failed", PAUSED),
        event("superseded", "Canceled: the draft changed."),
        event("superseded"),
      ]),
    ).toBe(PAUSED);
    expect(
      previewFailure([event("ok"), event("superseded", "Canceled")]),
    ).toBeNull();
  });

  it("looks past a workstream picked after the preview failed", () => {
    expect(
      previewFailure([
        event("failed", PAUSED),
        event("ok", null, "select-identity"),
      ]),
    ).toBe(PAUSED);
  });
});

describe("a preview refused by a spend pause", () => {
  it("is asked once, not retried as a canceled preview is", async () => {
    vi.useFakeTimers();
    const { deps, newWork } = setup(paused);
    newWork.observe("Fix invoice billing layout");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(deps.route).toHaveBeenCalledTimes(1);
    // Well past every retry a canceled preview would get.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.route).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the draft with no preview and keeps the pause's reason", async () => {
    vi.useFakeTimers();
    const { newWork } = setup(paused);
    newWork.observe("Fix invoice billing layout");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    const state = newWork.snapshot();
    expect(state).toMatchObject({
      classifying: false,
      decision: null,
      identity: null,
    });
    expect(state.events.map((e) => [e.kind, e.status, e.error])).toEqual([
      ["classify", "failed", PAUSED],
    ]);
    expect(previewFailure(state.events)).toBe(PAUSED);
  });

  it("previews again when the draft changes, and an answer clears the reason", async () => {
    vi.useFakeTimers();
    let refusing = true;
    const { deps, newWork } = setup(async () => {
      if (refusing) throw new Error(PAUSED);
      return answered;
    });
    newWork.observe("Fix invoice billing layout");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(previewFailure(newWork.snapshot().events)).toBe(PAUSED);

    refusing = false;
    newWork.observe("Fix invoice billing layout and totals");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(deps.route).toHaveBeenCalledTimes(2);
    expect(previewFailure(newWork.snapshot().events)).toBeNull();
    expect(newWork.snapshot().identity?.workstreamId).toBe("ws_billing");
  });
});

describe("the composer's Debug disclosure", () => {
  const prefs = {
    prefs: {
      advanced: { debugUi: true, debugComposer: true, debugDiscuss: false },
    },
  };
  /** Mounts the disclosure, opened, over the draft's model. */
  async function mount(newWork: NewWork) {
    await renderSlot(
      { component: NewWorkDebug },
      { newWork },
      { settings: {}, rpc: { prefs: () => prefs } as never },
    );
    const disclosure = document.querySelector("details")!;
    disclosure.open = true;
    return {
      summary: () => disclosure.querySelector("summary")!.textContent,
      status: () => within(disclosure).queryByRole("status"),
    };
  }
  /** Types `text` and waits out its preview. */
  const type = (newWork: NewWork, text: string) =>
    act(async () => {
      newWork.observe(text);
      await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    });

  it("shows no failure before a preview, or after one answered", async () => {
    const { newWork } = setup(async () => answered);
    const debug = await mount(newWork);
    expect(debug.summary()).toContain("No preview yet");
    expect(debug.status()).toBeNull();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(newWork, "Fix invoice billing layout");
    expect(debug.summary()).toContain("New thread about Billing");
    expect(debug.status()).toBeNull();
  });

  it("gives the pause as why the draft has no preview", async () => {
    const { newWork } = setup(paused);
    const debug = await mount(newWork);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(newWork, "Fix invoice billing layout");
    expect(debug.summary()).toContain(PAUSED);
    expect(debug.summary()).not.toContain("No preview yet");
    expect(debug.status()?.textContent).toBe(
      `The latest preview gave no answer: ${PAUSED}`,
    );
    expect(
      screen.getByText("No preview has finished for this draft yet."),
    ).toBeTruthy();
  });

  it("gives the pause above an earlier preview's result, and drops it when a preview answers again", async () => {
    let refusing = false;
    const { newWork } = setup(async () => {
      if (refusing) throw new Error(PAUSED);
      return answered;
    });
    const debug = await mount(newWork);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await type(newWork, "Fix invoice billing layout");

    refusing = true;
    await type(newWork, "Fix invoice billing layout and totals");
    expect(debug.summary()).toContain(PAUSED);
    expect(debug.summary()).not.toContain("New thread about Billing");
    expect(debug.status()?.textContent).toContain(PAUSED);
    // The result below it is the earlier preview's, which the field keeps.
    expect(screen.getByText("Fits billing")).toBeTruthy();

    refusing = false;
    await type(newWork, "Fix invoice billing layout, totals and tax");
    expect(debug.summary()).toContain("New thread about Billing");
    expect(debug.status()).toBeNull();
  });
});
