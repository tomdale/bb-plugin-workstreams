/*
 * A reply's article keeps its answer and explanation together whether its
 * compact recap is docked or historical. Historical recap fields close the
 * article rather than interrupting its opening. Unclosed replies use the host.
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
import { articleOpening, replyState } from "./opening.ts";

const KIND_LABELS = {
  answer: "Answer",
  investigation: "Investigation",
  change: "Change",
  recommendation: "Recommendation",
  proposal: "Proposal",
  status: "Status",
  handoff: "Handoff",
} as const;

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

function Headline({ text, prominent }: { text: string; prominent: boolean }) {
  return (
    <h2
      data-reply-headline=""
      className={cn(
        "m-0 leading-[1.28]",
        prominent
          ? "text-[1.5em] font-semibold tracking-[-0.025em] @min-[32rem]/reply:text-[1.9em]"
          : "text-[length:inherit] font-medium",
      )}
    >
      <RecapText
        text={text}
        typeClass="text-[length:inherit] leading-[inherit]"
      />
    </h2>
  );
}
function CardPart({ card }: { card: ReplyCard }) {
  if (
    ![card.results, card.review, card.waitingOn, card.links].some(
      (items) => items.length,
    )
  )
    return null;
  const state = replyState(card.state);
  return (
    <footer
      data-reply-recap=""
      className={cn(
        "space-y-3 rounded-lg border border-border p-4 text-[0.9em]",
        state?.frame,
      )}
    >
      {state ? (
        <p className={cn("m-0 text-[0.85em] font-medium", state.text)}>
          {state.label}
        </p>
      ) : null}
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
    </footer>
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
  const title = headline ?? card?.headline;
  const content = body.filter((part) => part.type !== "context");
  const substantive = content.length > 0;
  const opening =
    title && substantive ? articleOpening(content) : { body: content };
  const showCard = card && docked === false;
  const showHeadline = title && (substantive || !card || docked === false);
  const state = replyState(card?.state);
  if (!showHeadline && !showCard && !body.length) return null;
  return (
    <MarkdownDocumentContext.Provider value={document}>
      <ReplyFiles.Provider value={workspace?.files ?? null}>
        <article
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
          className="@container/reply my-2 min-w-0 space-y-7 text-foreground [overflow-wrap:anywhere]"
        >
          {body.map((part, index) =>
            part.type === "context" ? (
              <Information key={`context-${index}`} part={part} />
            ) : null,
          )}
          {showHeadline ? (
            <header className="space-y-2.5">
              {substantive && (kind || state) ? (
                <div
                  data-reply-cue=""
                  className="flex flex-wrap items-baseline gap-2 text-[0.8em] font-medium text-muted-foreground"
                >
                  {kind ? <span>{KIND_LABELS[kind]}</span> : null}
                  {kind && state ? <span aria-hidden>·</span> : null}
                  {state ? (
                    <span className={state.text}>{state.label}</span>
                  ) : null}
                </div>
              ) : null}
              <Headline text={title} prominent={substantive} />
              {opening.lead ? (
                <div
                  data-reply-lead=""
                  className="text-[1.1em] leading-[1.65] text-muted-foreground"
                >
                  <ReplyText markdown={opening.lead} />
                </div>
              ) : null}
            </header>
          ) : null}
          {opening.body.map((part, index) => (
            <div
              key={index}
              className={cn(
                "min-w-0",
                status === "streaming" && "ws-reply-enter",
              )}
            >
              <Information part={part} />
            </div>
          ))}
          {showCard ? <CardPart card={card} /> : null}
        </article>
      </ReplyFiles.Provider>
    </MarkdownDocumentContext.Provider>
  );
}
