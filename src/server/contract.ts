import { topicMigrationInput } from "../domain/topicMigration.ts";
import { categoryGenerationSchema } from "../domain/categories.ts";
import type { LayoutNode } from "../domain/layout.ts";
import type { SuggestionChange } from "../domain/suggestion-change.ts";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { questionHistorySchema } from "./questions/history.ts";
import {
  interactionPayloadSchema,
  interactionResponseSchema,
} from "./questions/contracts.ts";
import { z } from "zod";
import { WORK_STATES } from "../domain/analysis.ts";
import { prefsPatchSchema, prefsSchema } from "../domain/prefs.ts";
import { recapPrefsSchema } from "../domain/recapPrefs.ts";
import { recapSchema } from "../domain/recap.ts";
import { snoozePrefsPatchSchema, snoozePrefsSchema } from "../domain/snooze.ts";
import {
  HEX_COLOR,
  SPINNER_COLORS,
  SPINNER_SHAPES,
} from "../domain/spinner.ts";
import {
  TRACE_KINDS,
  linkSchema,
  traceSchema,
  traceSummarySchema,
} from "../domain/trace.ts";
import { entrySchema } from "./journal.ts";

const analysisSchema = z.object({
  recap: z.string(),
  state: z.enum(WORK_STATES),
  needsYou: z.string().nullable(),
  // The title last settled by analysis, separate from the outcome below it.
  goal: z.string().nullable().default(null),
  threadGoal: z.string().nullable().default(null),
  topicError: z.string().optional(),
  revision: z.number(),
  at: z.number(),
  model: z.string(),
  reported: z.boolean().optional(),
  requestsKey: z.string().nullable().optional(),
  traceId: z.string().nullable().default(null),
});

const assignmentProvenanceSchema = z.enum([
  "manual",
  "inherited",
  "full",
  "quick",
]);
const assignmentStatusSchema = z.enum(["assigned", "unresolved"]);

const topicAssignmentSchema = z.object({
  threadId: z.string(),
  entityId: z.string().nullable(),
  status: assignmentStatusSchema,
  provenance: assignmentProvenanceSchema.nullable(),
  label: z.string().nullable(),
  ancestorIds: z.array(z.string()),
  evidence: z.string().nullable(),
  inheritedFrom: z.string().nullable(),
});

const organizerStateGroupMemberSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  topicId: z.string().nullable(),
  topicLabel: z.string().nullable(),
  provenance: assignmentProvenanceSchema.nullable(),
  reason: z.string(),
});

const organizerStateGroupSchema = z.object({
  key: z.string(),
  sectionId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  activeCount: z.number(),
  completedCount: z.number(),
  totalCount: z.number(),
  roots: z.array(organizerStateGroupMemberSchema),
});

const organizerStateNoTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  evidence: z.string().nullable(),
  reason: z.string(),
});

const organizerStateCountsSchema = z.object({
  activeRoots: z.number(),
  completedRoots: z.number(),
  totalRoots: z.number(),
  unresolvedRoots: z.number(),
  activeWorkstreams: z.number(),
});

const organizerStateSchema = z.object({
  status: z.enum(["idle", "classifying", "deriving", "syncing", "failed"]),
  progress: z
    .object({
      stage: z.enum(["classifying", "deriving", "syncing"]),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      cached: z.number().int().nonnegative(),
      unresolved: z.number().int().nonnegative(),
    })
    .nullable(),
  error: z.string().nullable(),
  lastUpdatedAt: z.number().nullable(),
  groups: z.array(organizerStateGroupSchema),
  unresolved: z.array(organizerStateNoTopicSchema),
  counts: organizerStateCountsSchema,
});

export type OrganizerState = z.infer<typeof organizerStateSchema>;
export type OrganizerStateGroup = z.infer<typeof organizerStateGroupSchema>;
export type OrganizerStateUnresolved = z.infer<
  typeof organizerStateNoTopicSchema
>;
export type OrganizerStateCounts = z.infer<typeof organizerStateCountsSchema>;

const draftAncestorSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

const draftSubjectProposalSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  parentId: z.string().nullable().optional(),
  ancestors: z.array(draftAncestorSchema).nullable().optional(),
});

export const reclassificationPlanSchema = z.object({
  id: z.string(),
  at: z.number(),
  definitionKey: z.string(),
  excludedManual: z.number().default(0),
  rows: z.array(
    z.object({
      threadId: z.string(),
      title: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      error: z.string().nullable(),
      evidence: z.string().optional(),
      projectHint: z.string().nullable().optional(),
      assignmentKey: z.string().optional(),
      basis: z.string().optional(),
      traceId: z.string().nullable().optional(),
      answer: z
        .object({
          subjectId: z.string().nullable(),
          proposed: draftSubjectProposalSchema.nullable(),
          scopeShift: z.boolean(),
        })
        .optional(),
    }),
  ),
});
export type ReclassificationPlan = z.infer<typeof reclassificationPlanSchema>;

/**
 * The topic the New thread composer shows for a draft. `automatic` is Quick
 * analysis's preview, with the goal it would title the thread with;
 * `inherited` is the topic of the workstream whose ＋ opened the composer.
 */
const taskIdentitySubmissionSchema = z.object({
  entityId: z.string().min(1).nullable().optional(),
  proposal: draftSubjectProposalSchema.nullable().optional(),
  provenance: z.enum(["manual", "automatic", "inherited"]).optional(),
  sectionId: z.string().min(1).nullable().optional(),
  goal: z.string().max(200).nullable().optional(),
});

export const projectChoiceSchema = z.object({
  projectId: z.string().min(1),
  source: z.enum(["independent", "workstreams"]),
});

const projectSuggestionSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  topic: z.string(),
  fromProject: z.string(),
  toProject: z.string().nullable(),
  reason: z.string(),
  threads: z.array(
    z.object({ id: z.string(), name: z.string(), project: z.string() }),
  ),
});

const entitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parentId: z.string().nullable(),
  aliases: z.array(z.string()),
  projectId: z.string().min(1).nullable().optional(),
  projectSource: z
    .enum(["manual", "learned", "disabled"])
    .nullable()
    .optional(),
  projectRevision: z.number().int().nonnegative().optional(),
});

const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.object({
    topicId: z.string(),
    prefix: z.array(z.string()),
    name: z.string(),
    lists: z.boolean(),
    total: z.number(),
    children: z.array(layoutNodeSchema),
  }),
);

const catalogStateSchema = z.object({
  entities: z.array(entitySchema),
  groups: z.record(z.string(), z.string()),
  assignments: z.record(z.string(), topicAssignmentSchema),
  revision: z.number(),
  layout: z.array(layoutNodeSchema).optional(),
  categories: z.record(z.string(), categoryGenerationSchema).optional(),
});

const topicPlaceSchema = z.array(
  z.object({ name: z.string(), created: z.boolean() }),
);

const suggestionChangeSchema: z.ZodType<SuggestionChange> = z.object({
  op: z.enum([
    "refile",
    "split",
    "file",
    "merge",
    "reparent",
    "rename",
    "create",
  ]),
  moves: z.array(
    z.object({
      from: topicPlaceSchema.nullable(),
      to: topicPlaceSchema,
      threads: z.array(z.object({ id: z.string(), title: z.string() })),
      carried: z.number(),
    }),
  ),
});

const suggestionsStateSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["split", "edit"]),
      summary: z.string(),
      reason: z.string(),
      status: z.enum(["pending", "accepted", "declined", "stale"]),
      at: z.number(),
      decidedAt: z.number().nullable(),
      problem: z.string().nullable(),
      change: suggestionChangeSchema.nullable(),
      headline: z.string(),
      arrivals: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
  ),
  running: z.boolean(),
  lastRunAt: z.number().nullable(),
  error: z.string().nullable(),
});
export type SuggestionsStateWire = z.infer<typeof suggestionsStateSchema>;

const idList = z.array(z.string().min(1)).max(5000);
const spinnerColorSchema = z.union([
  z.enum(SPINNER_COLORS),
  z.string().regex(HEX_COLOR) as z.ZodType<`#${string}`>,
]);
const spinnerSchema = z.object({
  shape: z.enum(SPINNER_SHAPES),
  primary: spinnerColorSchema,
  secondary: z.union([spinnerColorSchema, z.enum(["auto", "none"])]),
});

/** The threads one snooze or wake call takes, up to a sidebar row's worth. */
const snoozeIds = z.array(z.string().min(1)).min(1).max(500);

const snoozeSchema = z.object({
  until: z.number().nullable(),
  events: z.boolean().optional(),
  attentionAt: z.number(),
  at: z.number(),
  pr: z.string().nullable().optional(),
});

const orderSchema = z.object({
  workstreams: z.array(z.string()),
  threads: z.record(z.string(), z.array(z.string())),
  prioritized: z.array(z.string()),
});

/** What a new thread from a composer draft would start with. */
const previewSchema = z.object({
  id: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  /** The topic's label, for display. */
  subject: z.string().nullable(),
  subjectId: z.string().nullable().optional(),
  proposal: draftSubjectProposalSchema.nullable().optional(),
  /** Quick analysis's goal for the new thread, its opening title. */
  goal: z.string().nullable().optional(),
  traceId: z.string().nullable(),
  explanation: z
    .object({ notes: z.array(z.string()), durationMs: z.number() })
    .optional(),
});
export const rpcContract = defineRpcContract({
  reclassificationPreview: {
    input: z.object({ threadIds: z.array(z.string()).min(1).max(100) }),
    output: reclassificationPlanSchema,
  },
  reclassificationApply: {
    input: z.object({ planId: z.string() }),
    output: z.object({ changed: z.number(), skipped: z.number() }),
  },
  question_at: {
    input: z.object({
      threadId: z.string().min(1),
      interactionId: z.string().min(1),
    }),
    output: questionHistorySchema.nullable(),
  },
  question_pending: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z
      .object({
        id: z.string(),
        recoverable: z.boolean(),
        payload: interactionPayloadSchema,
      })
      .nullable(),
  },
  question_recover: {
    input: z.object({
      threadId: z.string().min(1),
      id: z.string().min(1),
      value: interactionResponseSchema.nullable(),
      dismiss: z.boolean(),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * The New thread composer's preview of a draft: Quick analysis's
   * goal and topic for the new thread, or the topic of a mentioned
   * workstream. Changes nothing.
   */
  preview: {
    input: z.object({
      prompt: z.string().min(1).max(20_000),
      pickedProjectId: z.string().nullable().optional(),
      /**
       * The composer draft this preview is for. A newer `preview` or a
       * `previewCancel` for the same draft aborts this one's model call.
       */
      draftKey: z.string().min(1).max(500).nullable().optional(),
    }),
    output: previewSchema,
  },
  /**
   * Aborts the in-flight `preview` for a draft, because its text changed.
   * Returns whether one was running.
   */
  previewCancel: {
    input: z.object({ draftKey: z.string().min(1).max(500) }),
    output: z.object({ canceled: z.boolean() }),
  },
  /**
   * The topic the New thread composer shows for a draft, reported
   * as the draft changes so the dispatch hook can file the thread a plain
   * Enter creates (`ComposedDrafts`). Empty text forgets the draft.
   */
  draftIdentity: {
    input: z.object({
      draftKey: z.string().min(1).max(500),
      text: z.string().max(20_000),
      identity: taskIdentitySubmissionSchema.nullable(),
      projectChoice: projectChoiceSchema.nullable().optional(),
    }),
    output: z.object({ filed: z.boolean() }),
  },
  /**
   * The recap card's contents: the agent's recap for the thread's latest
   * turn, its dismissal state, and whether corrections ran out without one.
   */
  recap_get: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      recap: recapSchema.nullable(),
      dismissed: z.boolean(),
      waitingCancelled: z.boolean(),
      capped: z.boolean(),
      corrections: z.number(),
      /** Where the thread's files live, to resolve the recap's file links. */
      files: z
        .object({
          environmentId: z.string(),
          root: z.string().nullable(),
          hostId: z.string().nullable(),
        })
        .nullable(),
    }),
  },
  /**
   * Hides the current recap card on every client. Dismissing a waiting card
   * also cancels its status check.
   */
  /**
   * What this client's bb can draw. Reply-block recaps start only after a
   * client reports `messageBlocks` (the tomdale/bb fork's slot).
   */
  reportClient: {
    input: z.object({ messageBlocks: z.boolean() }),
    output: z.object({ ok: z.literal(true) }),
  },
  recap_dismiss: {
    input: z.object({ threadId: z.string().min(1), recapId: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * Live state of the agent threads a waiting recap names. Agent threads are
   * usually hidden, so the sidebar's thread list does not carry them.
   * Unreadable threads are left out.
   */
  recap_agents: {
    input: z.object({
      threadIds: z.array(z.string().min(1)).max(20),
    }),
    output: z.object({
      agents: z.array(
        z.object({
          threadId: z.string(),
          projectId: z.string(),
          title: z.string(),
          status: z.string(),
          runtimeStatus: z.string(),
          hasPendingInteraction: z.boolean(),
          isArchived: z.boolean(),
        }),
      ),
    }),
  },

  /** Restores the current recap card on every client. */
  recap_restore: {
    input: z.object({ threadId: z.string().min(1), recapId: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * Sends one of the current recap's suggested next actions as the user's
   * message. `action` must be one the recap still offers.
   */
  recap_send: {
    input: z.object({
      threadId: z.string().min(1),
      recapId: z.string(),
      action: z.string().min(1),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Workstreams' feature-grouped preferences (domain/prefs.ts). */
  prefs: {
    input: z.null(),
    output: z.object({ prefs: prefsSchema }),
  },
  /** Saves a patch and broadcasts the result as the `prefs` realtime event. */
  setPrefs: {
    input: z.object({ patch: prefsPatchSchema }),
    output: z.object({ prefs: prefsSchema }),
  },
  /** Connected machines, for the analysis-machine picker. */
  machines: {
    input: z.null(),
    output: z.object({
      machines: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
  recapPrefs: {
    input: z.null(),
    output: z.object({ prefs: recapPrefsSchema }),
  },
  setRecapPrefs: {
    input: z.object({ patch: recapPrefsSchema.partial() }),
    output: z.object({ prefs: recapPrefsSchema }),
  },
  topicMigrationPreview: {
    input: topicMigrationInput.nullable(),
    output: z.object({
      id: z.string(),
      fingerprint: z.string(),
      topics: z.array(entitySchema),
      removed: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          targetId: z.string(),
          projectId: z.string().nullable(),
          projectSource: z
            .enum(["manual", "learned", "disabled"])
            .nullable()
            .optional(),
        }),
      ),
      changes: z.array(
        z.object({
          threadId: z.string(),
          from: z.string(),
          to: z.string(),
          topicId: z.string(),
          source: z.string(),
        }),
      ),
      blockers: z.array(
        z.object({
          threadId: z.string().nullable(),
          topicId: z.string(),
          reason: z.string(),
        }),
      ),
    }),
  },
  topicMigrationApply: {
    input: z.object({ planId: z.string().min(1) }),
    output: z.object({ backupId: z.string(), changed: z.number() }),
  },
  topicMigrationBackup: {
    input: z.object({ backupId: z.string().min(1) }),
    output: z.unknown(),
  },
  catalog: {
    input: z.null(),
    output: catalogStateSchema,
  },
  catalogCreate: {
    input: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).default(""),
      parentId: z.string().min(1).nullable().optional(),
      aliases: z.array(z.string().max(80)).default([]),
    }),
    output: z.object({ entity: entitySchema }),
  },
  catalogRename: {
    input: z.object({
      entityId: z.string().min(1),
      name: z.string().min(1).max(200),
    }),
    output: z.object({ entity: entitySchema }),
  },
  catalogReparent: {
    input: z.object({
      entityId: z.string().min(1),
      parentId: z.string().min(1).nullable(),
    }),
    output: z.object({ entity: entitySchema }),
  },
  catalogUpdateMetadata: {
    input: z.object({
      entityId: z.string().min(1),
      description: z.string().max(1000).optional(),
      aliases: z.array(z.string().max(80)).optional(),
      projectId: z.string().min(1).nullable().optional(),
      projectAutomatic: z.boolean().optional(),
    }),
    output: z.object({ entity: entitySchema }),
  },
  projectSuggestions: {
    input: z.null(),
    output: z.object({ suggestions: z.array(projectSuggestionSchema) }),
  },
  projectSuggestionDecide: {
    input: z.object({
      id: z.string().min(1),
      decision: z.enum(["accept", "decline"]),
    }),
    output: z.object({ entry: entrySchema }),
  },
  catalogMerge: {
    input: z.object({
      sourceEntityId: z.string().min(1),
      targetEntityId: z.string().min(1),
    }),
    output: z.object({ target: entitySchema }),
  },
  /** Chooses an existing leaf within the user's destination group and sets it manually. */
  taskMove: {
    input: z.object({
      threadId: z.string().min(1),
      entityId: z.string().min(1),
    }),
    output: z.object({ assignment: topicAssignmentSchema }),
  },
  /** Sets a thread's topic yourself; null means it has no topic. */
  taskAssign: {
    input: z.object({
      threadId: z.string().min(1),
      entityId: z.string().min(1).nullable(),
    }),
    output: z.object({ assignment: topicAssignmentSchema }),
  },
  /**
   * Hands a thread's topic back to Workstreams ("Automatic") and settles it
   * now with Full analysis.
   */
  taskReclassify: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ assignment: topicAssignmentSchema }),
  },
  state: {
    input: z.null(),
    output: z.object({
      analysis: z.record(z.string(), analysisSchema),
      /** Agent recaps for each thread's latest turn, dismissed ones included. */
      recaps: z.record(z.string(), recapSchema).default({}),
      /** Ids of the recaps above whose docked card is dismissed. */
      dismissedRecaps: z.array(z.string()).default([]),
      /** Recent visible population, shared across clients and reloads. */
      lastPopulatedAt: z.record(z.string(), z.number()).default({}),
      /** The sidebar's drag-and-drop order. */
      order: orderSchema,
      /** Snoozed threads, by id (see domain/snooze.ts). */
      snoozes: z.record(z.string(), snoozeSchema).default({}),
      /** The snooze presets every menu lists, and which one a click uses. */
      snoozePrefs: snoozePrefsSchema,
      /** Organizing suggestions waiting for your decision. */
      pendingSuggestions: z.number().default(0),
      catalog: catalogStateSchema.default({
        entities: [],
        groups: {},
        assignments: {},
        revision: 1,
      }),
      organization: organizerStateSchema.default({
        status: "idle",
        progress: null,
        error: null,
        lastUpdatedAt: null,
        groups: [],
        unresolved: [],
        counts: {
          activeRoots: 0,
          completedRoots: 0,
          totalRoots: 0,
          unresolvedRoots: 0,
          activeWorkstreams: 0,
        },
      }),
    }),
  },
  /**
   * Snoozes threads until a time, until a wake event (`until: null`), or
   * (`events`) until whichever comes first, with one change notification. Snoozing again replaces the
   * earlier snooze. A thread that is archived or gone is skipped; the call
   * fails only when none of them can be snoozed. Returns the snoozes stored.
   */
  snooze: {
    input: z.object({
      threadIds: snoozeIds,
      until: z.number().int().positive().nullable(),
      /** A timed snooze also ends at the first enabled wake event. */
      events: z.boolean().optional(),
    }),
    output: z.object({ snoozes: z.record(z.string(), snoozeSchema) }),
  },
  /** Saves the Snooze settings section's changes and tells every client. */
  setSnoozePrefs: {
    input: z.object({ patch: snoozePrefsPatchSchema }),
    output: z.object({ prefs: snoozePrefsSchema }),
  },
  /** Wakes snoozed threads now; returns the ones that were snoozed. */
  unsnooze: {
    input: z.object({ threadIds: snoozeIds }),
    output: z.object({ woke: z.array(z.string()) }),
  },
  /**
   * Stores the sidebar's arrangement: every workstream top to bottom, the
   * prioritized workstreams (a set), or one group's root threads (a section
   * id or "unsorted") top to bottom.
   */
  reorder: {
    input: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("workstreams"), ids: idList }),
      z.object({ kind: z.literal("prioritized"), ids: idList }),
      z.object({
        kind: z.literal("threads"),
        groupId: z.string().min(1),
        ids: idList,
      }),
    ]),
    output: z.object({ order: orderSchema }),
  },
  /** The working indicator's style, chosen in the plugin's settings section. */
  spinner: {
    input: z.null(),
    output: z.object({ spinner: spinnerSchema }),
  },
  /** Stores the working indicator's style and pushes it to every client. */
  setSpinner: {
    input: z.object({ spinner: spinnerSchema }),
    output: z.object({ spinner: spinnerSchema }),
  },
  /** The recap whose Archive button may show: the thread has no outstanding work. */
  archiveStatus: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ recapId: z.string().nullable() }),
  },
  /** Archives the thread from its recap, rechecking outstanding work first. */
  archive: {
    input: z.object({ threadId: z.string().min(1), recapId: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * The Workstreams page queue's actions on a thread. `threadSend` sends the
   * user's message (queued behind a turn underway); `threadArchive` archives
   * the thread with its delegates, and `threadUnarchive` brings it back, for
   * Undo.
   */
  threadSend: {
    input: z.object({
      threadId: z.string().min(1),
      text: z.string().trim().min(1).max(20_000),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
  threadArchive: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  threadUnarchive: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  /**
   * Where each thread's files live, to resolve file links in its recap on
   * the Workstreams page queue; threads without an environment, or unreadable, are left out.
   */
  recapFiles: {
    input: z.object({ threadIds: z.array(z.string().min(1)).max(200) }),
    output: z.object({
      files: z.record(
        z.string(),
        z.object({
          environmentId: z.string(),
          root: z.string().nullable(),
          hostId: z.string().nullable(),
        }),
      ),
    }),
  },
  organization: {
    input: z
      .object({
        action: z.enum(["get", "rebuild"]).optional(),
      })
      .nullable()
      .default(null),
    output: z.object({ state: organizerStateSchema }),
  },
  suggestions: {
    input: z.null().default(null),
    output: z.object({ state: suggestionsStateSchema }),
  },
  /** Asks for splits and a tidy pass now. */
  suggestionsRun: {
    input: z.null().default(null),
    output: z.object({ state: suggestionsStateSchema }),
  },
  suggestionsDecide: {
    input: z.object({
      ids: z.array(z.string().min(1)).min(1).max(100),
      decision: z.enum(["accept", "decline"]),
    }),
    output: z.object({
      applied: z.array(z.string()),
      failed: z.array(z.object({ id: z.string(), reason: z.string() })),
      /** Each accepted suggestion's Activity entry, for Undo. */
      entries: z.record(z.string(), z.string()),
      state: suggestionsStateSchema,
    }),
  },
  /**
   * Undoes a decision just made: an accepted suggestion's Activity entry is
   * undone (`entryId`, from `suggestionsDecide`), and the suggestion waits
   * for review again.
   */
  suggestionsReopen: {
    input: z.object({ id: z.string().min(1), entryId: z.string().optional() }),
    output: z.object({ state: suggestionsStateSchema }),
  },
  journal: {
    input: z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
        before: z.number().optional(),
        external: z.boolean().optional(),
      })
      .nullable(),
    output: z.object({
      entries: z.array(
        // Debug traces of the model calls behind each entry.
        entrySchema.extend({ traceIds: z.array(z.string()) }),
      ),
    }),
  },
  undo: {
    input: z.object({ entryId: z.string().min(1) }),
    output: z.object({ entry: entrySchema }),
  },
  refresh: { input: z.null(), output: z.object({ changed: z.boolean() }) },
  /**
   * Debug traces, newest first: the given ids, the calls linked
   * to one thread, entry, proposal, workstream, or organizing run, or the
   * latest of every kind.
   */
  traces: {
    input: z.object({
      ids: z.array(z.string()).max(500).optional(),
      link: linkSchema.optional(),
      kind: z.enum(TRACE_KINDS).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      /** Page cursor: the last trace of the previous page. */
      before: z.object({ at: z.number(), id: z.string() }).optional(),
    }),
    output: z.object({ traces: z.array(traceSummarySchema) }),
  },
  /** One trace in full: prompt, reasoning, response, parsed result, links. */
  trace: {
    input: z.object({ id: z.string().min(1) }),
    output: z.object({ trace: traceSchema.nullable() }),
  },
  /** Sends a trace's prompt to its model again; changes nothing else. */
  traceReplay: {
    input: z.object({ id: z.string().min(1) }),
    output: z.object({ trace: traceSchema }),
  },
  traceClear: {
    input: z.null(),
    output: z.object({ removed: z.number() }),
  },
});

export type RpcContract = typeof rpcContract;
