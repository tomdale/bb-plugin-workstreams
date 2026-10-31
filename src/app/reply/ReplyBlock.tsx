/*
 * One reply in the timeline. Its recap fields appear here when their docked
 * card is absent; its explanation and information components stay in the
 * message. Unclosed replies use the host's original rendering.
 */
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Markdown, useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { recapHostFileLink } from "../../domain/recapFileLinks.ts";
import { Icon } from "@/components/ui/icon";
import type { ExperimentalMessageBlockProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { MarkdownDocumentContext, RecapText } from "../composer/RecapCard.tsx";
import {
  CARD_LABELS,
  replySchema,
  type Reply,
  type ReplyCard,
} from "../../domain/reply.ts";
import { Information, ReplyFiles, ReplyText } from "./Information.tsx";
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

function Headline({ text }: { text: string }) {
  return (
    <div
      role="heading"
      aria-level={3}
      data-reply-headline=""
      className="font-medium leading-[1.5]"
    >
      <RecapText
        text={text}
        typeClass="text-[length:inherit] leading-[inherit]"
      />
    </div>
  );
}
function CardPart({ card }: { card: ReplyCard }) {
  return (
    <div className="space-y-3">
      {card.headline ? <Headline text={card.headline} /> : null}
      {card.results.length ? (
        <ul data-reply-results="" className="m-0 list-none space-y-1 p-0">
          {card.results.map((item, i) => (
            <li key={i} className="flex min-w-0 items-start gap-2">
              <Icon
                name={item.checked === false ? "Circle" : "Check"}
                aria-hidden
                className={cn(
                  "mt-[0.3em] size-3.5 shrink-0",
                  item.checked === false
                    ? "text-muted-foreground"
                    : "text-(--ws-complete-text)",
                )}
              />
              {item.checked === false ? (
                <span className="sr-only">Not done: </span>
              ) : null}
              <ReplyText markdown={item.markdown} />
            </li>
          ))}
        </ul>
      ) : null}
      {(["review", "waitingOn", "links"] as const)
        .filter((key) => card[key].length)
        .map((key) => (
          <section key={key}>
            <h3 className="mb-1 mt-0 text-[0.85em] font-medium text-muted-foreground">
              {CARD_LABELS[key]}
            </h3>
            <ul className="m-0 list-none space-y-1 p-0">
              {card[key].map((line, i) => (
                <li key={i}>
                  <ReplyText markdown={line} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

export function ReplyBlock({
  data,
  status,
  message,
  Original,
}: ExperimentalMessageBlockProps) {
  const threadId = message.threadId ?? null;
  const docked = useDockedTurn(threadId, message.turnId ?? null);
  const workspace = useReplyWorkspace(threadId);
  const document = workspace?.document;
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
  const { card, headline, body, kind } = reply;
  const showCard = card && docked === false;
  if (!showCard && !headline && !body.length) return null;
  return (
    <MarkdownDocumentContext.Provider value={document}>
      <ReplyFiles.Provider value={workspace?.files ?? null}>
        <div
          data-reply-block=""
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
            const link = recapHostFileLink(anchor.getAttribute("href") ?? "");
            const target = link
              ? fileTarget(link.path, workspace?.files ?? null)
              : null;
            if (
              link &&
              target &&
              navigate.experimental_openFilePreview({
                target,
                location: link.location,
              })
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          data-reply-kind={kind}
          data-reply-docked={
            card && docked !== false ? (docked ? "" : "pending") : undefined
          }
          className="@container/reply my-2 min-w-0 space-y-6 text-foreground [overflow-wrap:anywhere]"
        >
          {body.map((part, index) =>
            part.type === "context" ? (
              <Information key={`context-${index}`} part={part} />
            ) : null,
          )}
          {showCard ? <CardPart card={card} /> : null}
          {headline ? <Headline text={headline} /> : null}
          {body.map((part, index) =>
            part.type === "context" ? null : (
              <div
                key={index}
                className={cn(
                  "min-w-0",
                  status === "streaming" && "ws-reply-enter",
                )}
              >
                <Information part={part} />
              </div>
            ),
          )}
        </div>
      </ReplyFiles.Provider>
    </MarkdownDocumentContext.Provider>
  );
}
