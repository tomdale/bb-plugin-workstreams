import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Markdown, useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ExperimentalMessageBlockProps } from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { recapHostFileLink } from "../../domain/recapFileLinks.ts";
import { replySchema, type Reply } from "../../domain/reply.ts";
import { useDebugMode } from "../debug/debug.ts";
import { useGoalContext } from "../goalContext.ts";
import { workstreamColorStyle } from "../../domain/workstreamColor.ts";
import { shareJson } from "../structuralSharing.ts";
import { PlainBody, PlainMarkdown } from "./PlainBody.tsx";
import { ReplyDebug, useAssistantMessageText } from "./ReplyDebug.tsx";
import { useDockedTurn } from "./useDockedTurn.ts";
import { LegacyCard, legacyStateWord } from "./LegacyCard.tsx";
import { BODY_CLASS } from "./type.ts";

type Document = ComponentProps<typeof Markdown>["experimental_document"];

/** File references resolve in the message's workspace, not the plugin package. */
function useReplyWorkspace(threadId: string | null) {
  const sdk = useSdk();
  const [loaded, setLoaded] = useState<{
    threadId: string;
    document: Document;
    files: RecapFiles;
  } | null>(null);
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    void sdk.threads
      .get({ threadId, include: "environment" })
      .then((thread) => {
        const environment = "environment" in thread ? thread.environment : null;
        if (!live || !environment || typeof environment.path !== "string")
          return;
        setLoaded({
          threadId,
          files: {
            environmentId: environment.id,
            root: environment.path,
            hostId: environment.hostId ?? null,
          },
          document: {
            threadId,
            rootPath: environment.path,
            target: {
              kind: "workspace",
              environmentId: environment.id,
              path: "__reply__.md",
            },
          },
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [threadId, sdk]);
  return loaded?.threadId === threadId ? loaded : null;
}

export function ReplyBlock({
  data,
  error,
  status,
  source,
  message,
  Original,
}: ExperimentalMessageBlockProps) {
  const threadId = message.threadId ?? null;
  const docked = useDockedTurn(threadId, message.turnId ?? null);
  const workspace = useReplyWorkspace(threadId);
  const workstream = useGoalContext(threadId)?.workstream ?? null;
  const debug = useDebugMode();
  const fullMessage = useAssistantMessageText(
    debug && status !== "streaming" ? message.id : null,
  );
  const rawSource = fullMessage ?? source;
  const navigate = useBbNavigate();
  const md = useCallback(
    (content: string | undefined) => (
      <PlainMarkdown content={content} document={workspace?.document} />
    ),
    [workspace?.document],
  );
  const lastGood = useRef<Reply | null>(null);
  const parsed = useMemo(() => replySchema.safeParse(data), [data]);
  if (parsed.success) {
    // Streaming parses produce fresh trees even for parts that did not change.
    // Keep those parts at their old identity so memoized bodies can skip them.
    lastGood.current = shareJson(lastGood.current, parsed.data);
  }
  if (status === "unclosed") {
    return debug ? (
      <div data-reply-unclosed="" className={`min-w-0 space-y-4 ${BODY_CLASS}`}>
        <Original />
        <ReplyDebug source={rawSource} status={status} error={error} />
      </div>
    ) : (
      <Original />
    );
  }
  const reply = parsed.success
    ? lastGood.current
    : status === "streaming"
      ? lastGood.current
      : null;
  if (!reply) {
    return debug && status !== "streaming" ? (
      <ReplyDebug source={rawSource} status={status} error={error} />
    ) : null;
  }
  const { card, headline, body } = reply;
  const showCard = !!card && docked === false;
  const title = headline ?? (showCard ? card?.headline : undefined);
  if (!title && !body.length && !showCard) return null;
  // `BODY_CLASS` on the container is what keeps an unsized label at the size of
  // the prose it labels, rather than at the browser default.
  return (
    <div
      data-reply-block=""
      data-reply-docked={
        reply.card && docked !== false ? (docked ? "" : "pending") : undefined
      }
      className={`ws-reply-accent min-w-0 space-y-4 ${BODY_CLASS}`}
      style={workstream ? workstreamColorStyle(workstream.color) : undefined}
      onClickCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        )
          return;
        const anchor =
          event.target instanceof Element
            ? event.target.closest("a[href]")
            : null;
        if (!anchor || !event.currentTarget.contains(anchor)) return;
        const href = anchor.getAttribute("href") ?? "";
        const link = recapHostFileLink(href);
        const target = link
          ? fileTarget(link.path, workspace?.files ?? null)
          : null;
        if (
          target &&
          navigate.experimental_openFilePreview({
            target,
            location: link?.location ?? null,
          })
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {/* An old reply keeps the card's state as a small muted line above what
          it reports, rather than as a second card in the transcript. */}
      {showCard && card ? (
        <p
          data-reply-legacy-state={card.state}
          className="m-0 text-[11px] font-medium leading-[17.6px] text-muted-foreground"
        >
          {legacyStateWord(card.state)}
        </p>
      ) : null}
      {title ? md(`# ${title}`) : null}
      {body.map((part, i) => (
        <PlainBody
          key={i}
          part={part}
          document={workspace?.document}
          files={workspace?.files ?? null}
          threadId={threadId}
        />
      ))}
      {showCard && card ? <LegacyCard card={card} md={md} /> : null}
      {debug ? (
        <ReplyDebug source={rawSource} status={status} error={error} />
      ) : null}
    </div>
  );
}
