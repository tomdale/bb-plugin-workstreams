import { z } from "zod";
import type { Workstream } from "./topics.ts";
import { PATH_MARK } from "./topic-path.ts";

export const workstreamMigrationInput = z.object({
  resetThreadIds: z.array(z.string().min(1)).max(1000).default([]),
  choices: z
    .array(
      z.object({ threadId: z.string().min(1), workstreamId: z.string().min(1) }),
    )
    .max(1000)
    .default([]),
  newWorkstreams: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((name) => !name.includes(PATH_MARK)),
        description: z.string().trim().max(300),
        parentId: z.string().nullable(),
        aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
      }),
    )
    .max(100)
    .default([]),
});
export type WorkstreamMigrationInput = z.input<typeof workstreamMigrationInput>;
export type WorkstreamMigrationPlan = {
  id: string;
  fingerprint: string;
  workstreams: Workstream[];
  removed: Array<{
    id: string;
    path: string;
    targetId: string;
    projectId: string | null;
    projectSource: Workstream["projectSource"];
  }>;
  changes: Array<{
    threadId: string;
    from: string;
    to: string;
    workstreamId: string;
    source: string;
  }>;
  resets: Array<{ threadId: string; from: string; source: string }>;
  blockers: Array<{ threadId: string | null; workstreamId: string; reason: string }>;
};
