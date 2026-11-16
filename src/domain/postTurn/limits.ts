/**
 * Bounds on one composition of an enhanced document. The presentation model
 * gets one tool, `preview_document`, and these limits; it cannot call
 * anything else, and the loop ends at whichever limit it meets first.
 */
export const PRESENTATION_LIMITS = {
  /** `preview_document` calls in one composition, successful or not. */
  previews: 3,
  /** Model calls: one per preview, the final answer, and one spare. */
  modelCalls: 5,
  /** The whole composition, from the first model call to the last preview. */
  deadlineMs: 150_000,
  /** One preview: launch excluded, both captures included. */
  previewTimeoutMs: 20_000,
  /** Output tokens per model call. */
  maxTokens: 8_000,
  /** A longer final response is left as it is. */
  responseChars: 24_000,
  titleChars: 300,
} as const;

/** How the server waits on the host: the deadline plus Chrome's launch and close. */
export const PRESENTATION_HOST_TIMEOUT_MS =
  PRESENTATION_LIMITS.deadlineMs + 15_000;
