/**
 * A specimen sheet for reply blocks: a short transcript whose replies together
 * use every part a block accepts, plus the two states an agent cannot author
 * on purpose. Each block is read and drawn by the same code that draws one in
 * a thread, so the gallery cannot drift from the message surface.
 */
import { parse } from "../../domain/reply.ts";
import { onlyReplyBlock } from "../../domain/replyText.ts";
import { PlainMarkdown } from "../reply/PlainBody.tsx";
import { ReplyBlock } from "../reply/ReplyBlock.tsx";
import { SPECIMENS, type GalleryMessage } from "./gallery.ts";

/** The transcript is not a thread: no workspace, nothing docked. */
const MESSAGE = {
  id: "gallery",
  threadId: "",
  turnId: null,
  projectId: null,
} as const;

const AgentReply = ({ block, index }: { block: string; index: number }) => {
  const read = onlyReplyBlock(block);
  const parsed =
    read?.status === "closed" ? parse(read, { status: read.status }) : null;
  // bb's own rendering of the block, which a block falls back to while it is
  // still arriving or has no closing line.
  const Original = () => (
    <PlainMarkdown content={read?.source ?? block} document={undefined} />
  );
  return (
    <ReplyBlock
      data={parsed?.ok ? parsed.data : null}
      error={parsed && !parsed.ok ? parsed.error : null}
      status={read?.status ?? "unclosed"}
      source={block}
      index={index}
      message={{ ...MESSAGE }}
      Original={Original}
    />
  );
};

const Message = ({
  message,
  index,
}: {
  message: GalleryMessage;
  index: number;
}) =>
  message.from === "user" ? (
    <p
      className="mt-4 rounded-lg border border-border bg-state-hover/60 px-3 py-2 text-[13px] leading-6" // slop-ok: 3 stands in for BB's own user message bubble
    >
      {message.text}
    </p>
  ) : (
    <div className="mt-4" data-gallery-reply="">
      <AgentReply block={message.block} index={index} />
      {/* slop-ok: 2 the Gallery's existing caption naming the parts each reply uses */}
      <p className="mt-3 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
        Uses {message.features.join(", ")}
      </p>
    </div>
  );

export function Gallery() {
  return (
    <div data-gallery="">
      <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
        Replies that together use every part a reply block accepts.
      </p>
      {SPECIMENS.map((specimen) => (
        <section key={specimen.title} className="mt-8">
          <h2 className="text-[13px] font-semibold tracking-tight">
            {specimen.title}
          </h2>
          <p className="mt-1 text-[12.5px] leading-6 text-muted-foreground">
            {specimen.intro}
          </p>
          {specimen.messages.map((message, index) => (
            <Message key={index} message={message} index={index} />
          ))}
        </section>
      ))}
    </div>
  );
}
