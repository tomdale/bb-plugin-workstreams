import { z } from "zod";
import type { Topic } from "./topics.ts";

export const topicMigrationInput = z.object({
  resetThreadIds: z.array(z.string().min(1)).max(1000).default([]),
  choices: z
    .array(
      z.object({ threadId: z.string().min(1), topicId: z.string().min(1) }),
    )
    .max(1000)
    .default([]),
  newTopics: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((name) => !name.includes(":")),
        description: z.string().trim().max(300),
        parentId: z.string().nullable(),
        aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      }),
    )
    .max(100)
    .default([]),
});
export type TopicMigrationInput = z.input<typeof topicMigrationInput>;
export type TopicMigrationPlan = {
  id: string;
  fingerprint: string;
  topics: Topic[];
  removed: Array<{
    id: string;
    path: string;
    targetId: string;
    projectId: string | null;
    projectSource: Topic["projectSource"];
  }>;
  changes: Array<{
    threadId: string;
    from: string;
    to: string;
    topicId: string;
    source: string;
  }>;
  resets: Array<{ threadId: string; from: string; source: string }>;
  blockers: Array<{ threadId: string | null; topicId: string; reason: string }>;
};
