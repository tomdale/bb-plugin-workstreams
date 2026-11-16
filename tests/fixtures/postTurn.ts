/*
 * Enhanced-document fixtures written for these tests. They follow the shapes
 * of two approved response designs (a deployed change with local checks, and
 * a correction that withdraws earlier advice) with invented content.
 */
import type { EnhancedDocument } from "../../src/domain/postTurn/document.ts";

/** A deployed change: prose, a list, four local checks with a skipped test, and a note. */
export const DEPLOYED_CHANGE: EnhancedDocument = {
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
export const CORRECTION: EnhancedDocument = {
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
