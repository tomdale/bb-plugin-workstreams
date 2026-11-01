export const QUESTION_INSTRUCTIONS = `Use the available question-card tool (AskUserQuestion or the provider's native tool) for required clarification, missing user-supplied information, decisions, or approvals. Wait for the answer. Resolve workspace facts and routine implementation choices yourself.
Explain findings and reasoning before calling. Put essential decision context in the always-visible question text or a context/details field when supported; reserve option previews for selected artifacts. Longer explanations belong in the preceding message.
Follow the available tool's name and schema. Offer distinct, useful answers with concise consequences; put the recommendation first and label it "(Recommended)". Use freeform input without invented suggestions when supported. Group related questions; allow multiple selections only when answers can coexist.
Dismissed, expired, failed, or empty questions provide no answer or approval. Continue only independent work and report what remains blocked. Request credentials through the secure secrets mechanism. Optional follow-ups after completed work are not blocking questions.`;

export const TOOL_DESCRIPTION = `Ask the user for input required to proceed and wait for their answer. Use for blocking clarification, missing user-supplied information, decisions, and approvals; resolve workspace facts and routine choices yourself with sensible defaults.

Supply 1-4 questions with up to 4 distinct answers each; use options: [] for a genuinely freeform answer. Cards always include freeform input with image and file attachments, so omit an "Other" option. Use multiSelect: true when several answers can apply.

Option previews show concrete artifacts (UI sketches, code, diagrams, configurations) in a monospace block when selected, for single-select questions only. Use them when the user must visually compare artifacts; ordinary preference questions need only labels and descriptions.`;

export const NOT_UNIQUE_MESSAGE =
  "Question texts must be unique, option labels must be unique within each question";
