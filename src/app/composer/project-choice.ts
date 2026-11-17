/*
 * BB changes the new-thread composer's scope when its project changes, which
 * remounts the routing model. Two transfers carry the workstream into the
 * replacement:
 *
 * - When Workstreams moves the composer to the workstream's project, the
 *   selected workstream travels only while that change is in flight, with its
 *   original provenance and preview so automatic choices still title and move
 *   the submitted thread. The project marker travels too, so the replacement
 *   does not report a supplied project as an independent choice.
 * - When you choose another project yourself, the next model for the same
 *   draft in another project records that you chose it, so Quick analysis
 *   never moves it. A workstream you picked travels too, with the project as
 *   this thread's own. An automatic workstream does not: the new project gets
 *   a fresh preview. The old model's release and the new one's creation
 *   happen in one render, so the transfer expires shortly after.
 */
import { isPicked, type NewWorkState } from "./new-work.ts";

type Choice = Pick<
  NewWorkState,
  "identity" | "decision" | "suppliedProjectId" | "projectOverride"
>;
let pending: { projectId: string | null; choice: Choice } | null = null;
let carried: {
  draftKey: string;
  projectId: string | null;
  choice: Choice;
} | null = null;

/** How long a carried choice waits for its replacement model. */
const CARRY_MS = 1000;

export function preserveProjectChoice(
  projectId: string | null,
  choice: Choice,
) {
  const transfer = { projectId, choice };
  pending = transfer;
  return () => {
    if (pending === transfer) pending = null;
  };
}

/**
 * Keeps the draft's choices for its next model, in case you changed its
 * project: the project as yours, and a workstream you picked.
 */
export function carryAcrossProjectChange(
  draftKey: string,
  projectId: string | null,
  state: NewWorkState,
) {
  const picked = isPicked(state.identity);
  const transfer = {
    draftKey,
    projectId,
    choice: {
      identity: picked ? state.identity : null,
      decision: picked ? state.decision : null,
      suppliedProjectId: null,
      projectOverride: true,
    },
  };
  carried = transfer;
  setTimeout(() => {
    if (carried === transfer) carried = null;
  }, CARRY_MS);
}

/** The workstream a new model for this draft and project starts with, if any. */
export function takeProjectChoice(
  projectId: string | null,
  draftKey?: string,
): Choice | undefined {
  const transfer = carried?.draftKey === draftKey ? carried : null;
  if (transfer) carried = null;
  if (pending?.projectId === projectId) {
    const choice = pending.choice;
    pending = null;
    return choice;
  }
  if (transfer && transfer.projectId !== projectId) return transfer.choice;
  return undefined;
}
