import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Markdown, useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ExperimentalMessageBlockProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { recapHostFileLink } from "../../domain/recapFileLinks.ts";
import { CARD_LABELS, replySchema, type Reply } from "../../domain/reply.ts";
import { useDebugMode } from "../debug/debug.ts";
import { Code } from "../debug/Inspector.tsx";
import { PLAIN_LIST_CLASS, PlainBody, PlainMarkdown } from "./PlainBody.tsx";
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
  status,
  source,
  message,
  Original,
}: ExperimentalMessageBlockProps) {
  const threadId = message.threadId ?? null;
  const docked = useDockedTurn(threadId, message.turnId ?? null);
  const workspace = useReplyWorkspace(threadId);
  const debug = useDebugMode();
  const navigate = useBbNavigate();
  const lastGood = useRef<Reply | null>(null);
  const parsed = replySchema.safeParse(data);
  if (parsed.success) lastGood.current = parsed.data;
  if (status === "unclosed") return <Original />;
  const reply = parsed.success
    ? parsed.data
    : status === "streaming"
      ? lastGood.current
      : null;
  if (!reply) return null;
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
      className="min-w-0 space-y-4"
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
      {title ? md(`# ${title}`) : null}
      {body.map((part, i) => (
        <PlainBody
          key={i}
          part={part}
          document={workspace?.document}
          files={workspace?.files ?? null}
        />
      ))}
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
        <details
          data-reply-raw=""
          className="group/raw text-xs text-muted-foreground"
        >
          <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1.5 rounded py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <Icon name="Bug" aria-hidden className="size-3.5 shrink-0" />
            <span>Raw agent output</span>
            <span
              aria-hidden
              className="inline-block transition-transform group-open/raw:rotate-90"
            >
              ›
            </span>
          </summary>
          <div className="mt-1.5 text-foreground">
            <Code content={source} label="Raw agent output" />
          </div>
        </details>
      ) : null}
    </div>
  );
}
