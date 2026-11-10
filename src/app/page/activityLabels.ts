/**
 * How Activity names what Workstreams recorded: the action, what it means, how
 * the change stands, and who made it. Shared by the Activity log and a
 * thread's own activity list, so one entry reads the same in both and a debug
 * thread about it says the same thing.
 */
import type { JournalEntry } from "../../server/journal.ts";

export const ACTION_LABEL: Record<JournalEntry["action"], string> = {
  move: "Move",
  "create-workstream": "New workstream",
  "rename-workstream": "Rename",
  "delete-workstream": "Delete",
  undo: "Undo",
  batch: "Reorganize",
  categories: "Categories",
  "edit-workstream": "Edit",
  "project-association": "Project",
  route: "New thread",
  retitle: "Updated title",
  "remove-topic": "Removed topic",
  suggestion: "Suggestion",
};

export const ACTION_HELP: Record<JournalEntry["action"], string> = {
  move: "A thread was moved to another workstream.",
  "create-workstream": "A workstream was created to group related threads.",
  "rename-workstream": "A workstream’s name was changed.",
  "delete-workstream": "A workstream was removed. Its threads are not deleted.",
  undo: "A previous Workstreams change was reversed.",
  batch: "Several organization changes were applied together.",
  categories:
    "The current thread collection's categories changed without changing topic assignments.",
  "edit-workstream": "A workstream’s description or settings were changed.",
  "project-association":
    "A topic’s associated project was learned, changed, or reviewed.",
  route: "A new request was placed in a thread and workstream.",
  retitle:
    "A thread was given its goal as its title, from its opening request or after a turn.",
  "remove-topic":
    "Topics Workstreams had discovered were removed because no thread or workstream used them.",
  suggestion:
    "You accepted an organizing suggestion, which changed the topic tree or a thread's topic.",
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
  dismissed: {
    label: "Dismissed",
    description: "This suggestion was declined without applying the change.",
  },
};

export const SOURCE_LABEL: Record<JournalEntry["source"], string> = {
  user: "you",
  external: "outside Workstreams",
  router: "router",
  handoff: "handoff",
  auto: "automatic",
  bootstrap: "bootstrap",
};
