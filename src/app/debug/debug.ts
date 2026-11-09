/** Debug mode: the preference and what an inspector can open. */
import type { Prefs } from "../../domain/prefs.ts";
import type { TraceLink } from "../../domain/trace.ts";
import { usePrefsRealtime, usePrefsSelector } from "../prefs.ts";

/**
 * The diagnostics Debug mode can turn on. Each names one surface: which
 * switches exist is a settings question, so this only maps a surface to the
 * preference that guards it.
 */
export type DebugSurface =
  /** Recorded calls listed in Activity. */
  | "activity"
  /** The bug buttons that open a decision's recorded calls. */
  | "inspect"
  /** The composer's routing disclosure. */
  | "composer"
  /** Raw agent output and syntax diagnosis on assistant replies. */
  | "replies"
  /** The Workstreams Debug section in a thread's Info tab and context card. */
  | "threadInfo";

const SWITCHES = {
  activity: "debugActivity",
  inspect: "debugInspect",
  composer: "debugComposer",
  replies: "debugReplies",
  threadInfo: "debugThreadInfo",
} as const satisfies Record<DebugSurface, keyof Prefs["advanced"]>;

/**
 * Whether Debug mode shows `surface`: the master switch governs every
 * surface, and that surface's own switch can narrow it further.
 */
export function useDebugMode(surface: DebugSurface): boolean {
  usePrefsRealtime();
  return usePrefsSelector((prefs) => {
    const advanced = prefs?.advanced;
    return advanced ? advanced.debug && advanced[SWITCHES[surface]] : false;
  });
}

/**
 * What an inspector shows: specific traces (a decision's own call), or every
 * call linked to a thread, journal entry, proposal, workstream, or run.
 */
export type InspectTarget =
  { traceIds: readonly (string | null | undefined)[] } | { link: TraceLink };

export const traceIdsOf = (target: InspectTarget): string[] | null =>
  "traceIds" in target
    ? target.traceIds.filter((id): id is string => Boolean(id))
    : null;
