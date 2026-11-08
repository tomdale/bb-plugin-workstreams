import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Markdown, useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ExperimentalMessageBlockProps } from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { recapHostFileLink } from "../../domain/recapFileLinks.ts";
import { CARD_LABELS, replySchema, type Reply } from "../../domain/reply.ts";
import { useDebugMode } from "../debug/debug.ts";
import { useGoalContext } from "../goalContext.ts";
import { workstreamColorStyle } from "../../domain/workstreamColor.ts";
import { PLAIN_LIST_CLASS, PlainMarkdown, ReplyPanel } from "./PlainBody.tsx";
import { ReplyDebug, useAssistantMessageText } from "./ReplyDebug.tsx";
import { useDockedTurn } from "./useDockedTurn.ts";

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
  const lastGood = useRef<Reply | null>(null);
  const parsed = replySchema.safeParse(data);
  if (parsed.success) lastGood.current = parsed.data;
  if (status === "unclosed") {
    return debug ? (
      <div data-reply-unclosed="" className="min-w-0 space-y-4">
        <Original />
        <ReplyDebug source={rawSource} status={status} error={error} />
      </div>
    ) : (
      <Original />
    );
  }
  const reply = parsed.success
    ? parsed.data
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
  const md = (content: string | undefined) => (
    <PlainMarkdown content={content} document={workspace?.document} />
  );
  return (
    <div
      data-reply-block=""
      data-reply-docked={
        reply.card && docked !== false ? (docked ? "" : "pending") : undefined
      }
      className="ws-reply-accent min-w-0 space-y-4 text-sm"
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
      <ReplyPanel
        headline={title}
        body={body}
        document={workspace?.document}
        files={workspace?.files ?? null}
      />
      {showCard && card ? (
        <>
          <p>
            {card.state === "complete"
              ? "Complete"
              : card.state === "review"
                ? "Ready for review"
                : card.state === "waiting"
                  ? "Waiting"
                  : card.state}
          </p>
          {card.results.length ? (
            <ul className={`${PLAIN_LIST_CLASS} list-disc`}>
              {card.results.map((item, i) => (
                <li key={i}>
                  {item.checked === false ? <p>Not done:</p> : null}
                  {md(item.markdown)}
                </li>
              ))}
            </ul>
          ) : null}
          {(["review", "waitingOn", "links"] as const)
            .filter((key) => card[key].length)
            .map((key) => (
              <div key={key}>
                {md(`### ${CARD_LABELS[key]}`)}
                <ul className={`${PLAIN_LIST_CLASS} list-disc`}>
                  {card[key].map((line, i) => (
                    <li key={i}>{md(line)}</li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      ) : null}
      {debug ? (
        <ReplyDebug source={rawSource} status={status} error={error} />
      ) : null}
    </div>
  );
}
