/*
 * BB changes the new-thread composer's scope when its project changes, which
 * remounts the routing model. Carry the selected topic into that replacement
 * only while the project change is in flight; keep its original provenance
 * and preview so automatic choices still title and file the submitted thread.
 */
import type { NewWorkState } from "./new-work.ts";

type Choice = Pick<NewWorkState, "identity" | "decision">;
let pending: { projectId: string; choice: Choice } | null = null;

export function preserveProjectChoice(projectId: string, choice: Choice) {
  const transfer = { projectId, choice };
  pending = transfer;
  return () => {
    if (pending === transfer) pending = null;
  };
}

export function takeProjectChoice(
  projectId: string | null,
): Choice | undefined {
  if (pending?.projectId !== projectId) return undefined;
  const choice = pending.choice;
  pending = null;
  return choice;
}
