/** The debug UI's preferences, and what an inspector can open. */
import type { DebugCalls } from "../../domain/debug-thread.ts";
import type { Prefs } from "../../domain/prefs.ts";
import { usePrefsRealtime, usePrefsSelector } from "../prefs.ts";

/**
 * The diagnostics the debug UI can show. Each names one surface: which
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
  | "threadInfo"
  /** The button that starts a thread about an AI-generated result. */
  | "discuss";

const SWITCHES = {
  activity: "debugActivity",
  inspect: "debugInspect",
  composer: "debugComposer",
  replies: "debugReplies",
  threadInfo: "debugThreadInfo",
  discuss: "debugDiscuss",
} as const satisfies Record<DebugSurface, keyof Prefs["advanced"]>;

/**
 * Whether the debug UI shows `surface`: its master switch governs every
 * surface, and that surface's own switch can narrow it further. Recording is
 * a separate preference, so turning the UI off keeps traces coming.
 */
export function useDebugMode(surface: DebugSurface): boolean {
  usePrefsRealtime();
  return usePrefsSelector((prefs) => {
    const advanced = prefs?.advanced;
    return advanced ? advanced.debugUi && advanced[SWITCHES[surface]] : false;
  });
}

/**
 * What an inspector shows: specific traces (a decision's own call), or every
 * call linked to a thread, journal entry, proposal, workstream, or run.
 */
export type InspectTarget = DebugCalls;

export const traceIdsOf = (target: InspectTarget): string[] | null =>
  "traceIds" in target
    ? target.traceIds.filter((id): id is string => Boolean(id))
    : null;
