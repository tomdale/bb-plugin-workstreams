export const QUESTION_INSTRUCTIONS = `Use the available question-card tool (AskUserQuestion or the provider's native tool) for required clarification, missing user-supplied information, decisions, or approvals. Wait for the answer. Resolve workspace facts and routine implementation choices yourself.
Explain findings and reasoning before calling. Put essential decision context in the always-visible question text or a context/details field when supported. When the user is approving or reviewing specific content (a PR or issue title and body, a comment, a commit message, a diff, a file), show that exact content in AskUserQuestion's artifacts, or, with a native tool that has none, in its question text or in the reply that ends the turn. Text written earlier in the turn may never reach the user, so a question refers only to content the card or that reply shows. Reserve option previews for comparing alternatives.
Follow the available tool's name and schema. Offer distinct, useful answers with concise consequences; put the recommendation first and label it "(Recommended)". Use freeform input without invented suggestions when supported. Group related questions; allow multiple selections only when answers can coexist.
Dismissed, expired, failed, or empty questions provide no answer or approval. Continue only independent work and report what remains blocked. Request credentials through the secure secrets mechanism. Optional follow-ups after completed work are not blocking questions.`;

export const TOOL_DESCRIPTION = `Ask the user for input required to proceed and wait for their answer. Use for blocking clarification, missing user-supplied information, decisions, and approvals; resolve workspace facts and routine choices yourself with sensible defaults.

Supply 1-4 questions with up to 4 distinct answers each; use options: [] for a genuinely freeform answer. Cards always include freeform input with image and file attachments, so omit an "Other" option. Use multiSelect: true when several answers can apply.

Artifacts show the exact content a question asks the user to approve or review (a PR title and body, a review comment, a commit message, a patch, a file) in full and always visible, rendered as Markdown, a diff, highlighted code, or plain text. A question that says "as written" or "as shown" carries that content as an artifact.

Option previews show one option's concrete form (a UI sketch, code, a diagram, a configuration) in a monospace block when that option is selected, for single-select questions only. Use them when the user must visually compare alternatives; ordinary preference questions need only labels and descriptions.`;

export const NOT_UNIQUE_MESSAGE =
  "Question texts must be unique, option labels must be unique within each question";
