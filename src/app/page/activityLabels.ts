/**
 * How Activity names what Workstreams recorded: the action, what it means, how
 * the change stands, and who made it. Shared by the Activity log and a
 * thread's own activity list, so one entry reads the same in both and a debug
 * thread about it says the same thing.
 */
import type { JournalEntry } from "../../server/journal.ts";

export const ACTION_LABEL: Record<JournalEntry["action"], string> = {
  "thread-started": "Thread started",
  "thread-moved": "Thread moved",
  "title-updated": "Title updated",
  "workstream-created": "Workstream created",
  "workstream-renamed": "Workstream renamed",
  "workstream-removed": "Workstream removed",
  "categories-updated": "Categories updated",
  "suggestion-accepted": "Suggestion accepted",
  "project-learned": "Project learned",
  "change-undone": "Change undone",
};

export const ACTION_HELP: Record<JournalEntry["action"], string> = {
  "thread-started":
    "A thread started from New thread, in the workstream Workstreams chose for it.",
  "thread-moved":
    "One or more threads moved to another workstream, by you, by Workstreams, or outside Workstreams.",
  "title-updated":
    "A thread was given its title, from its opening request or after a turn.",
  "workstream-created": "A workstream was added to the sidebar.",
  "workstream-renamed": "A workstream’s name changed.",
  "workstream-removed":
    "A workstream left the sidebar, or one Workstreams had found was removed because nothing used it. Its threads are not deleted.",
  "categories-updated":
    "A workstream's categories changed. No thread changed workstream.",
  "suggestion-accepted":
    "You accepted an organizing suggestion, which changed your workstreams and groups or moved a thread.",
  "project-learned": "A workstream’s project was learned, set, or kept.",
  "change-undone": "A previous change was reversed.",
};

export const ENTRY_STATUS: Record<
  JournalEntry["status"],
  { label: string; description: string }
> = {
  applied: {
    label: "Applied",
    description:
      "This organization change was applied. It does not mean the thread’s work is complete.",
  },
  partial: {
    label: "Partially applied",
    description:
      "Some parts of this change were applied; others could not be completed. Check the event details.",
  },
  failed: {
    label: "Failed",
    description:
      "This change could not be applied. Check the event details for the failure.",
  },
  undone: {
    label: "Undone",
    description: "This change was reversed by a later undo event.",
  },
  declined: {
    label: "Declined",
    description: "This suggestion was declined without applying the change.",
  },
};

export const SOURCE_LABEL: Record<JournalEntry["source"], string> = {
  you: "You",
  workstreams: "Workstreams",
  outside: "Outside Workstreams",
};
