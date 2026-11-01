import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  parsePrefs,
  prefsPatchSchema,
} from "../../src/domain/prefs.ts";
import { DEFAULT_COLORS } from "../../src/domain/colors.ts";
import { openDatabase, setMeta } from "../../src/server/db.ts";
import { loadPrefs, savePrefs, seedPrefs } from "../../src/server/prefs.ts";
import { fakeWorld } from "./fake-bb.ts";

describe("Workstreams prefs", () => {
  it("defaults the new sidebar visibility preferences on", () => {
    expect(parsePrefs({}).sidebar).toMatchObject({
      showForYou: true,
      showRecent: true,
      showSnoozed: true,
      showArchived: true,
      recentLimit: 5,
      groupSort: "alphabetical",
      timestamps: "show",
      threadCount: "collapsed",
      waitingCount: "collapsed",
    });
  });

  it("validates timestamp choices and preserves neighboring preferences", async () => {
    const world = await fakeWorld();
    const db = openDatabase(world.bb);
    for (const timestamps of ["show", "hover", "hide"] as const) {
      savePrefs(db, { sidebar: { timestamps } });
      expect(loadPrefs(db).sidebar.timestamps).toBe(timestamps);
    }
    expect(
      prefsPatchSchema.safeParse({ sidebar: { timestamps: "invalid" } })
        .success,
    ).toBe(false);
    expect(
      parsePrefs({ sidebar: { timestamps: "invalid", showRecent: false } })
        .sidebar,
    ).toMatchObject({ timestamps: "show", showRecent: false });
    await world.harness.lifecycle.dispose();
  });

  it("defaults title transitions to fade and persists each validated choice", async () => {
    expect(parsePrefs({}).threads.headingTransition).toBe("fade");
    expect(
      parsePrefs({
        threads: { headingTransition: "bad", showParentLink: true },
      }).threads,
    ).toMatchObject({
      headingTransition: "fade",
      showParentLink: true,
    });
    expect(
      prefsPatchSchema.safeParse({ threads: { headingTransition: "bad" } })
        .success,
    ).toBe(false);
    const world = await fakeWorld();
    const db = openDatabase(world.bb);
    // A stored retired choice falls back without resetting neighboring fields.
    setMeta(
      db,
      "prefs",
      JSON.stringify({
        threads: { headingTransition: "hybrid", showParentLink: true },
      }),
    );
    expect(loadPrefs(db).threads).toMatchObject({
      headingTransition: "fade",
      showParentLink: true,
    });
    expect(
      prefsPatchSchema.safeParse({ threads: { headingTransition: "hybrid" } })
        .success,
    ).toBe(false);
    for (const headingTransition of ["scroll", "fade"] as const) {
      savePrefs(db, { threads: { headingTransition } });
      expect(loadPrefs(db).threads).toMatchObject({
        headingTransition,
        showParentLink: true,
      });
    }
    await world.harness.lifecycle.dispose();
  });

  it("shows the header Archive button unless it is turned off", async () => {
    expect(parsePrefs({}).threads.showArchiveButton).toBe(true);
    // Preferences stored before the button existed carry no value for it.
    expect(
      parsePrefs({ threads: { showParentLink: true } }).threads,
    ).toMatchObject({ showParentLink: true, showArchiveButton: true });

    const world = await fakeWorld();
    const db = openDatabase(world.bb);
    savePrefs(db, { threads: { showArchiveButton: false } });
    expect(loadPrefs(db).threads).toMatchObject({
      showArchiveButton: false,
      showParentLink: false,
      autoTitle: true,
    });
    expect(
      prefsPatchSchema.safeParse({ threads: { showArchiveButton: "no" } })
        .success,
    ).toBe(false);
    await world.harness.lifecycle.dispose();
  });

  it("merges patches, clamps Recent limits, and seeds only once", async () => {
    const world = await fakeWorld();
    const db = openDatabase(world.bb);
    db.prepare("DELETE FROM ws_meta WHERE key = 'prefs'").run();
    const seeded = seedPrefs(db);
    expect(seeded.analysis.quickModel).toEqual(DEFAULT_MODELS.quick);
    expect(
      savePrefs(db, {
        sidebar: { recentLimit: 100, showSnoozed: false, showArchived: false },
      }).sidebar,
    ).toMatchObject({
      recentLimit: 20,
      showSnoozed: false,
      showArchived: false,
    });
    expect(seedPrefs(db).analysis.quickModel).toEqual(
      seeded.analysis.quickModel,
    );
    expect(loadPrefs(db).sidebar).toMatchObject({
      recentLimit: 20,
      showSnoozed: false,
      showArchived: false,
    });
    await world.harness.lifecycle.dispose();
  });

  it("moves the models of preferences saved before the two analyses", () => {
    const prefs = parsePrefs({
      newWork: {
        suggestionsModel: { kind: "gateway", model: "google/quick" },
      },
      organize: { model: { kind: "gateway", model: "openai/full" } },
    });
    expect(prefs.analysis).toEqual({
      quickModel: { kind: "gateway", model: "google/quick" },
      fullModel: { kind: "gateway", model: "openai/full" },
      placementModel: DEFAULT_MODELS.placement,
    });
  });
});
