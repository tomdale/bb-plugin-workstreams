/** A workstream as calls that choose one read it, and a checked workstream answer. */
import type { DraftWorkstreamProposal } from "./topics.ts";

export type Workstream = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  aliases: readonly string[];
};

/** A checked workstream answer: an existing workstream, a new one, or neither. */
export type WorkstreamAnswer = {
  workstreamId: string | null;
  proposed: DraftWorkstreamProposal | null;
};
