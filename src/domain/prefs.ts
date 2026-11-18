/**
 * Workstreams' general preferences, grouped by the feature each one belongs
 * to. Stored in plugin storage rather than BB's declarative settings, because
 * the settings page draws its own controls (BB's model picker, previews,
 * machine picker) and saves each change immediately.
 *
 * Recap, snooze, and working-indicator preferences keep their own stores.
 */
import { z } from "zod";
import { colorChoiceSchema, DEFAULT_COLORS } from "./colors.ts";
import {
  UP_NEXT_FRESH_WINDOWS,
  UP_NEXT_LIMIT,
  UP_NEXT_MAX,
  type UpNextFreshWindow,
} from "./upNext.ts";

/**
 * A model Workstreams calls. `gateway` names an AI Gateway model directly
 * (`google/gemini-3.1-flash-lite`) and always runs as one direct completion.
 * `provider` is a BB provider/model pick from BB's model picker: a Pi
 * `vercel-ai-gateway/<model>` pick also runs as a direct completion, and any
 * other pick runs in a hidden BB worker thread, which is several seconds
 * slower per call.
 */
export const modelChoiceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("gateway"),
    model: z.string().min(1).max(200),
    reasoningLevel: z.string().min(1).max(50).optional(),
    serviceTier: z.string().min(1).max(50).optional(),
  }),
  z.object({
    kind: z.literal("provider"),
    providerId: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    reasoningLevel: z.string().min(1).max(50),
    serviceTier: z.string().min(1).max(50).optional(),
  }),
]);
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

/** The Pi model-id prefix whose picks run as direct gateway completions. */
const PI_GATEWAY_PREFIX = "vercel-ai-gateway/";

/**
 * The AI Gateway model a choice runs directly, or null when it needs a BB
 * worker thread.
 */
export function gatewayModel(choice: ModelChoice): string | null {
  if (choice.kind === "gateway") return choice.model;
  if (choice.providerId === "pi" && choice.model.startsWith(PI_GATEWAY_PREFIX))
    return choice.model.slice(PI_GATEWAY_PREFIX.length);
  return null;
}

/** Eval-tested defaults (see eval/). */
export const DEFAULT_MODELS = {
  /**
   * Names a new thread and chooses its workstream from its first request,
   * and answers every other closed workstream choice.
   */
  newThread: {
    kind: "gateway",
    model: "openai/gpt-6.1-sol",
    reasoningLevel: "none",
  },
  /**
   * Guesses a draft's workstream in the composer as you type, so
   * it must answer in about a second and cost little per call. The start
   * call sets the title and settles the workstream after send on the
   * new-thread model.
   */
  composer: {
    kind: "gateway",
    model: "google/gemini-3.1-flash-lite",
    reasoningLevel: "none",
  },
  /** Settles a thread's title, goal, status, and workstream when a turn ends. */
  turnEnd: {
    kind: "gateway",
    model: "openai/gpt-6.1-sol",
    reasoningLevel: "none",
  },
  /** Arranges a collection's threads into categories. */
  category: {
    kind: "gateway",
    model: "anthropic/claude-sonnet-5.5",
    reasoningLevel: "medium",
  },
  /** Reviewed changes to the workstreams and groups. */
  suggestion: {
    kind: "gateway",
    model: "anthropic/claude-sonnet-5.5",
    reasoningLevel: "medium",
  },
} as const satisfies Record<string, ModelChoice>;

export const RECENT_LIMIT = { min: 1, max: 20, fallback: 5 } as const;

/** Up Next's row count before Show more: one through its Show-more ceiling. */
export const UP_NEXT_SHOWN = {
  min: 1,
  max: UP_NEXT_MAX,
  fallback: UP_NEXT_LIMIT,
} as const;

const recentLimit = z
  .number()
  .int()
  .transform((n) => Math.min(RECENT_LIMIT.max, Math.max(RECENT_LIMIT.min, n)));

const upNextShown = z
  .number()
  .int()
  .transform((n) =>
    Math.min(UP_NEXT_SHOWN.max, Math.max(UP_NEXT_SHOWN.min, n)),
  );

const freshWindows = Object.keys(UP_NEXT_FRESH_WINDOWS) as [
  UpNextFreshWindow,
  ...UpNextFreshWindow[],
];

const countVisibility = z.enum(["always", "collapsed", "never"]);

/**
 * Each feature group's fields, strict. Patches validate against these; the
 * stored shape (`prefsSchema`) falls back to defaults field by field, so one
 * bad stored value never resets its neighbors.
 */
/** A spend threshold in USD; null is off. */
const spendThreshold = z.number().positive().max(1_000_000).nullable();
/** A request-count threshold; null is off. */
const callsThreshold = z.number().int().positive().max(1_000_000).nullable();

const GROUPS = {
  sidebar: {
    /** The Up Next section: threads awaiting the user. */
    showUpNext: [z.boolean(), true],
    /** The Recents section: the most recently active threads. */
    showRecent: [z.boolean(), true],
    /** The Snoozed fold: threads temporarily put aside. */
    showSnoozed: [z.boolean(), true],
    /** The Archived fold: threads kept after completion. */
    showArchived: [z.boolean(), true],
    /** Up Next and the workstreams replace BB's Recent list on a phone's Home. */
    phoneHome: [z.boolean(), true],
    /** How workstream groups are ordered in the sidebar. */
    groupSort: [z.enum(["alphabetical", "activity", "manual"]), "alphabetical"],
    /** How many threads the Recents section shows. */
    recentLimit: [recentLimit, RECENT_LIMIT.fallback],
    /** Thread ages on rows: always, on hover or focus, or never. */
    timestamps: [z.enum(["show", "hover", "hide"]), "show"],
    /** When workstream headers show their thread count. */
    threadCount: [countVisibility, "collapsed"],
    /** When workstream headers show how many threads need you. */
    needsYouCount: [countVisibility, "collapsed"],
  },
  upNext: {
    /** How many rows Up Next shows before Show more. */
    shown: [upNextShown, UP_NEXT_SHOWN.fallback],
    /** Rank unread threads above every other thread. */
    unreadFirst: [z.boolean(), true],
    /**
     * Top up Up Next's rows with recently active threads that are read and not
     * awaiting the user. Off, it lists only threads that are unread or
     * awaiting the user (see `selectUpNext`).
     */
    fill: [z.boolean(), true],
    /**
     * Rank threads whose turn ended within this window above older ones; off
     * ranks by tier and attention alone.
     */
    freshWindow: [z.enum(freshWindows), "off"],
  },
  threads: {
    /** Title untitled threads with their goal and retitle them as work moves on. */
    autoTitle: [z.boolean(), true],
    /** How the large and compact goal headings change as the timeline scrolls. */
    headingTransition: [
      z.enum(["fade", "scroll", "morph", "stagger", "flip", "rack", "cascade"]),
      "fade",
    ],
    /**
     * How the scroll carries the choreographed title transitions: direct
     * follows the scroll position; latch follows it for a short way, then a
     * spring finishes the handoff.
     */
    headingHandoff: [z.enum(["direct", "latch"]), "latch"],
    /** Whether the heading minimizes into the title bar on scroll or stays over the thread. */
    headingScroll: [z.enum(["minimize", "float"]), "minimize"],
    /** Where the heading's text sits: aligned with the messages, or centered. */
    headingAlign: [z.enum(["left", "center"]), "left"],
    /** A link to the parent thread in child threads' headers. */
    showParentLink: [z.boolean(), false],
    /** An icon-only Archive button in thread headers. */
    showArchiveButton: [z.boolean(), true],
  },
  newWork: {
    /** Preview a draft's workstream and title in the composer while you type. */
    organizeAsYouWrite: [z.boolean(), true],
  },
  analysis: {
    /**
     * Names new threads and chooses their workstreams: a thread's first
     * request, a move into a multi-workstream group, workstream repair, and
     * the categories fit check.
     */
    newThreadModel: [modelChoiceSchema, DEFAULT_MODELS.newThread],
    /** Guesses a draft's workstream in the composer as you type. */
    composerModel: [modelChoiceSchema, DEFAULT_MODELS.composer],
    /** Updates a thread's title, goal, status, and workstream when a turn ends. */
    turnEndModel: [modelChoiceSchema, DEFAULT_MODELS.turnEnd],
  },
  organize: {
    /** Suggest splits and other changes to the workstreams and groups for review. */
    suggestions: [z.boolean(), true],
    /** The model that writes those suggestions. */
    suggestionModel: [modelChoiceSchema, DEFAULT_MODELS.suggestion],
    /** The model that arranges a collection's threads into categories. */
    categoryModel: [modelChoiceSchema, DEFAULT_MODELS.category],
  },
  /** Workstreams' color tokens (domain/colors.ts): a BB theme color or a custom color each. */
  colors: {
    vivid: [z.boolean(), true],
    complete: [colorChoiceSchema, DEFAULT_COLORS.complete],
    review: [colorChoiceSchema, DEFAULT_COLORS.review],
    waiting: [colorChoiceSchema, DEFAULT_COLORS.waiting],
    needsInput: [colorChoiceSchema, DEFAULT_COLORS.needsInput],
    failed: [colorChoiceSchema, DEFAULT_COLORS.failed],
    automatic: [colorChoiceSchema, DEFAULT_COLORS.automatic],
  },
  /**
   * Warnings and hard caps on what Workstreams' model calls spend (see
   * `domain/usage.ts`). A blank threshold (`null`) is off. A cap pauses every
   * Workstreams model call until its window resets, a resume, or a higher cap;
   * warnings only mark the Usage page.
   */
  usage: {
    hourSpendWarn: [spendThreshold, 3],
    hourSpendCap: [spendThreshold, 10],
    daySpendWarn: [spendThreshold, 10],
    daySpendCap: [spendThreshold, 30],
    monthSpendWarn: [spendThreshold, null],
    monthSpendCap: [spendThreshold, null],
    /** Requests in the last hour, which also counts calls with no reported cost. */
    hourCallsWarn: [callsThreshold, 150],
    hourCallsCap: [callsThreshold, 500],
    /** Flag what looks wrong in recent usage (`detectUsageFlags`). */
    detectors: [z.boolean(), true],
  },
  advanced: {
    /** The machine whose Pi key runs gateway calls; "" picks the only one. */
    hostId: [z.string(), ""],
    /**
     * The project Workstreams' own worker threads run in, for model calls
     * that need one; "" uses the first project.
     */
    workerProjectId: [z.string(), ""],
    /**
     * Record each model call's prompt, reasoning, and response as a trace.
     * Independent of the debug UI, so toggling what the app shows keeps the
     * record running.
     */
    debugRecord: [z.boolean(), true],
    /** The debug UI's master switch: the `debug*` surfaces below appear while it is on. */
    debugUi: [z.boolean(), false],
    /** The bug buttons that open a decision's recorded calls. */
    debugInspect: [z.boolean(), true],
    /** Recorded calls listed in Activity, with their filters and cost. */
    debugActivity: [z.boolean(), true],
    /** The composer's routing disclosure for a new thread. */
    debugComposer: [z.boolean(), true],
    /** Raw agent output and syntax diagnosis on assistant replies. */
    debugReplies: [z.boolean(), true],
    /** The Workstreams debug section in a thread's Info tab and context card. */
    debugThreadInfo: [z.boolean(), true],
    /**
     * The button beside an AI-generated result that starts a thread about it,
     * carrying the suggestion and the model calls behind it.
     */
    debugDiscuss: [z.boolean(), true],
    /**
     * The project a debug thread starts in, so its agent can read the prompts
     * and code it is asked about; "" uses the home project.
     */
    debugProjectId: [z.string(), ""],
  },
} as const satisfies Record<
  string,
  Record<string, readonly [z.ZodType, unknown]>
>;

type Groups = typeof GROUPS;
type Fields<G extends keyof Groups> = {
  -readonly [K in keyof Groups[G]]: Groups[G][K] extends readonly [
    infer S extends z.ZodType,
    unknown,
  ]
    ? z.output<S>
    : never;
};
export type Prefs = { [G in keyof Groups]: Fields<G> };

/** One feature group's fields to change; omitted groups and fields stay. */
export type PrefsPatch = { [G in keyof Prefs]?: Partial<Prefs[G]> };

function group<G extends keyof Groups>(name: G, strict: boolean) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, [schema, fallback]] of Object.entries(GROUPS[name]) as [
    string,
    readonly [z.ZodType, unknown],
  ][])
    shape[key] = strict ? schema.optional() : schema.catch(fallback);
  return strict ? z.object(shape).strict().optional() : z.object(shape);
}

const groupNames = Object.keys(GROUPS) as (keyof Groups)[];

export const prefsSchema = z.object(
  Object.fromEntries(groupNames.map((g) => [g, group(g, false)])),
) as unknown as z.ZodType<Prefs>;

export const prefsPatchSchema = z
  .object(Object.fromEntries(groupNames.map((g) => [g, group(g, true)])))
  .strict() as unknown as z.ZodType<PrefsPatch>;

export function parsePrefs(raw: unknown): Prefs {
  const value = raw && typeof raw === "object" ? raw : {};
  const groups = { ...(value as Record<string, unknown>) };
  // Categories were arranged by the suggestions model before they had their
  // own, so a saved suggestions model carries over to them.
  const organize = groups.organize;
  if (organize && typeof organize === "object") {
    const saved = organize as Record<string, unknown>;
    if (
      saved.categoryModel === undefined &&
      saved.suggestionModel !== undefined
    )
      groups.organize = { ...saved, categoryModel: saved.suggestionModel };
  }
  // Debug mode used to be one switch, which also recorded. Recording now has
  // its own switch, and the old value carried the debug UI.
  const advanced = groups.advanced;
  if (advanced && typeof advanced === "object") {
    const saved = advanced as Record<string, unknown>;
    if (saved.debug !== undefined && saved.debugUi === undefined)
      groups.advanced = { ...saved, debugUi: saved.debug };
  }
  // Existing theme-scheme preferences use normal colors; explicit vivid choices take precedence.
  const colors = groups.colors;
  if (colors && typeof colors === "object") {
    const saved = colors as Record<string, unknown>;
    if (saved.vivid === undefined && saved.scheme === "theme")
      groups.colors = { ...saved, vivid: false };
  }
  const parsed = prefsSchema.parse(
    Object.fromEntries(
      groupNames.map((g) => {
        const v = groups[g];
        return [g, v && typeof v === "object" ? v : {}];
      }),
    ),
  );
  return parsed;
}

/** Applies `patch` group by group, then re-parses so values stay in range. */
export function mergePrefs(base: Prefs, patch: PrefsPatch): Prefs {
  return parsePrefs(
    Object.fromEntries(groupNames.map((g) => [g, { ...base[g], ...patch[g] }])),
  );
}
