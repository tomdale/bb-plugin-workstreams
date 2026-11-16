/**
 * The final-response contract for a root-thread session while Enhanced
 * responses is on, delivered where a reply-block session gets its reply
 * contract. The agent writes its meaning in plain Markdown and chooses no
 * layout; Workstreams composes the enhanced document afterward from that text.
 */
export const RESPONSE_INSTRUCTIONS = `Write the turn's final response as plain Markdown for a reader returning from other work. Lead with the answer or outcome, then the facts that support it. Keep each qualification beside the claim it limits, and keep uncertainty stated as uncertainty. Name sources exactly, such as file paths, commands, commit hashes, and thread links, and quote a short excerpt when the exact words matter. Report what you checked, where, and the actual results, and what you did not check. Say what is done, what is not, and who acts next. Workstreams lays the response out from this text, so write no \`:::reply\` block or \`workstreams\` fences. A request that fixes the output, such as one word or exact text, is answered with that text alone.`;

/** Whether a response is a reply block, which the experiment does not enhance. */
export function isReplyBlock(text: string): boolean {
  return /^:{3,}reply(?:[\s{]|$)/m.test(text);
}
