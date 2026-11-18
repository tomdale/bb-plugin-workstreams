/*
 * Enhanced-document fixtures written for these tests. They follow the shapes
 * of three approved response designs (a deployed change with local checks, a
 * correction that withdraws earlier advice, and a plan awaiting approval) with
 * invented content.
 */
import type {
  BlocksDocument,
  PlanDocument,
} from "../../src/domain/postTurn/document.ts";

/** A deployed change: prose, a list, four local checks with a skipped test, and a note. */
export const DEPLOYED_CHANGE: BlocksDocument = {
  version: 1,
  blocks: [
    {
      type: "section",
      title: "Snooze presets now follow you between windows",
      blocks: [
        {
          type: "paragraph",
          text: "A preset saved in one window appears in every open window within a second. Editing a preset no longer resets the snoozes that already use it.",
        },
        {
          type: "list",
          items: [
            "Deleting a preset leaves current snoozes running until they end.",
            [
              "The stored shape is unchanged, so ",
              { code: "snoozePrefs" },
              " needs no migration.",
            ],
          ],
        },
        {
          type: "paragraph",
          text: [
            "I pushed the change to ",
            { code: "main" },
            " and reloaded Workstreams.",
          ],
        },
        {
          type: "checks",
          scope: "local",
          items: [
            { name: "Typecheck", result: "passed" },
            { name: "Build", result: "passed" },
            { name: "Plugin smoke check", result: "passed" },
            {
              name: "Test suite",
              result: "passed",
              totals: { passed: 2104, failed: 0, skipped: 1 },
            },
          ],
        },
        {
          type: "note",
          text: "Windows opened before the reload pick up presets after their next refresh.",
        },
      ],
    },
  ],
};

/** A correction: the withdrawn claim, the revised result, and its sample limit. */
export const CORRECTION: BlocksDocument = {
  version: 1,
  blocks: [
    {
      type: "callout",
      label: "Correction",
      title: "I overstated how often the summary dropped the deadline.",
      text: "This result no longer supports my earlier suggestion to switch summary models.",
    },
    {
      type: "paragraph",
      text: "The original test note never said the date was a deadline, so leaving it out of a one-line summary was a reasonable reading.",
    },
    {
      type: "paragraph",
      text: "I revised the note to state that the date is the filing deadline and ran both models again.",
    },
    {
      type: "table",
      columns: ["Model", "Kept the deadline", "Runs"],
      rows: [
        ["Model A", 5, 5],
        ["Model B", 5, 5],
      ],
      caption: "Five runs per model on the revised note.",
    },
    {
      type: "note",
      text: "These are small samples, not a general reliability comparison.",
    },
  ],
};

/** A plan awaiting approval: four steps, risks, a note, and four replies. */
export const SETTINGS_PLAN: PlanDocument = {
  version: 1,
  plan: {
    title: "Move settings from JSON to SQLite",
    summary:
      "Stop two windows from overwriting each other's settings in the shared JSON blob.",
    steps: [
      {
        title: "Add SQLite storage",
        detail: [
          "Create the ",
          { code: "ws_setting" },
          " table, then write settings to SQLite and JSON for one release.",
        ],
      },
      {
        title: "Switch reads to SQLite",
        detail:
          "On the next release's first launch, copy the JSON values into SQLite.",
      },
      {
        title: "Keep the JSON fallback",
        detail: "Leave the blob unchanged for two releases, then delete it.",
      },
      {
        title: "Remove dual writes",
        detail: "Delete the code that writes to both stores.",
      },
    ],
    risks: [
      "A downgrade after step 2 restores the last JSON values.",
      "Changes made after that copy won't appear in older releases.",
    ],
    notes: [
      {
        label: "Versioned JSON",
        text: "less work, but two windows saving at once could still overwrite each other.",
      },
    ],
    replies: [
      "How will you test the migration?",
      "What if the copy fails?",
      "Keep dual writes through step 3.",
      "Add a rollback for failed copies.",
    ],
  },
};
