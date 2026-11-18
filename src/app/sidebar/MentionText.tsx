import { ThreadTitle } from "@get-bb/plugin-sdk/app";
import { splitThreadMentions } from "../../domain/threadMentions.ts";

/**
 * One line of a row's text with each `@thread:<id>` mention replaced by that
 * thread's title. The row is one link, so a mention is words rather than a
 * chip of its own. BB draws nothing for a thread its sidebar doesn't hold,
 * such as a deleted one, and the mention then reads "another thread"
 * (`.ws-row-mention`).
 */
export function MentionText({ text }: { text: string }) {
  const parts = splitThreadMentions(text);
  if (parts.length === 1 && typeof parts[0] === "string") return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={index} className="ws-row-mention">
            <ThreadTitle threadId={part.threadId} />
          </span>
        ),
      )}
    </>
  );
}
