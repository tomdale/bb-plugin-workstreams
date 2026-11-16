/** A topic as calls that choose one read it, and a checked topic answer. */
import type { DraftSubjectProposal } from "./topics.ts";

export type Entity = {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  aliases: readonly string[];
};

/** A checked topic answer: an existing topic, a new one, or neither. */
export type TopicAnswer = {
  subjectId: string | null;
  proposed: DraftSubjectProposal | null;
};
