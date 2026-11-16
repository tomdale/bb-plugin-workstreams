/*
 * BB changes the new-thread composer's scope when its project changes, which
 * remounts the routing model. Two transfers carry the topic into the
 * replacement:
 *
 * - When Workstreams moves the composer to the topic's project, the selected
 *   topic travels only while that change is in flight, with its original
 *   provenance and preview so automatic choices still title and file the
 *   submitted thread. The project marker travels too, so the replacement does
 *   not report a supplied project as an independent choice.
 * - When you choose another project yourself, a topic you picked travels to
 *   the next model for the same draft in another project, marked as a
 *   project for this thread only. An automatic topic does not: the new
 *   project gets a fresh preview. The old model's release and the new one's
 *   creation happen in one render, so the transfer expires shortly after.
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

/** How long a picked topic waits for its replacement model. */
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

/** Keeps a picked topic for the draft's next model, in case its project changed. */
export function carryPickedTopic(
  draftKey: string,
  projectId: string | null,
  state: NewWorkState,
) {
  if (!isPicked(state.identity)) return;
  const transfer = {
    draftKey,
    projectId,
    choice: {
      identity: state.identity,
      decision: state.decision,
      suppliedProjectId: null,
      projectOverride: true,
    },
  };
  carried = transfer;
  setTimeout(() => {
    if (carried === transfer) carried = null;
  }, CARRY_MS);
}

/** The topic a new model for this draft and project starts with, if any. */
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
