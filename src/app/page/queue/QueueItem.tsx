/**
 * One item in the queue, the only thing on the page: the workstream and the
 * thread's title above its recap card, then everything the user can do.
 *
 * The card leads; the title above it is quiet context. Under the card come
 * the agent's proposed replies (keys 1–3; ⇧ loads one into the composer to
 * edit first), then a row of thread actions (Reply, Snooze…, Archive, Open).
 * A complete card with no replies leads that row with Archive. A suggestion
 * shows its moves in the card and Accept or Decline as its replies, with no
 * thread actions. Reply replaces the replies and the row in place, so the
 * card doesn't move.
 */
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { ACCENT, RecapSummary, RecapText } from "../../composer/RecapCard.tsx";
import type { RecapFiles } from "../../../domain/recap.ts";
import {
  workstreamColorStyle,
  type TopicColor,
} from "../../../domain/workstreamColor.ts";
import type { SnoozePrefs, SnoozeWhen } from "../../../domain/snooze.ts";
import { SnoozeIcon } from "../../snooze/icons.tsx";
import {
  SnoozeMenuItems,
  snoozeMenuContentClass,
} from "../../snooze/SnoozeMenuItems.tsx";
import { WorkstreamIcon } from "../../WorkstreamIcon.tsx";
import type { QueueCard } from "./card.ts";
import { LEAD as PILE_LEAD } from "./stackEngine.ts";

/** The card scales up as a whole, its type and spacing together (`CONTENT`
 * sets the padding that lands its text 24px in). */
const CARD_ZOOM = 1.15;

/** A key, drawn as an outlined chip; the answers' digits and the buttons' letters match. */
export function KeyChip({
  children,
  bright = false,
  className,
}: {
  children: ReactNode;
  bright?: boolean;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] border px-1 font-sans text-[11px] font-medium not-italic transition-colors max-md:pointer-coarse:hidden",
        bright
          ? "border-foreground/40 text-foreground"
          : "border-border text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export type QueueHeading = {
  /** The workstream path, joined for display ("Vercel Agent: Automations"). */
  path: string | null;
  /** The workstream's topic color, if filed. */
  color: TopicColor | null;
  title: string;
};

/** The workstream and title above the card, quieter than the card itself. */
export function Heading({
  heading,
  onPath,
}: {
  heading: QueueHeading;
  onPath?: () => void;
}) {
  return (
    <div className="mb-0.5">
      {heading.path ? (
        <button
          type="button"
          onClick={onPath}
          style={
            heading.color === null
              ? undefined
              : (workstreamColorStyle(heading.color) as React.CSSProperties)
          }
          data-queue-line="path"
          className="ws-queue-path -ml-0.5 flex max-w-full cursor-pointer items-center gap-1 text-[13px] font-[550] tracking-[0.01em]"
        >
          <WorkstreamIcon className="text-current" />
          <span className="truncate">{heading.path}</span>
        </button>
      ) : null}
      <h1
        data-queue-line="title"
        className="mt-1 text-[22px] font-[450] leading-[1.3] tracking-[-0.015em] text-foreground/75 [text-wrap:balance]"
      >
        {heading.title}
      </h1>
    </div>
  );
}

export type StackCard = {
  /** The queue item, so its card keeps one element as it moves in the pile. */
  key: string;
  /** The item's card content (`ThreadCard` or `SuggestionCard`). */
  node: ReactNode;
  /** Border and surface colours of the card's frame (`threadFrame`). */
  frame: string;
};

/**
 * The shown card with the next ones stacked behind it, each one element for as
 * long as its item is in the pile (`useQueueMotion` poses them). A card is
 * drawn in four layers: `base` (opaque page colour and shadow), `frame` (the
 * border and surface at the card's drawn height, so a card behind a shorter
 * one ends where that one ends), the `content` (always laid out at its natural
 * height and clipped, never reflowed), and `shade` (page colour laid over a
 * card in proportion to its depth). The stage reserves `PILE_LEAD` above the front
 * card for the cards peeking out; the heading's bottom margin shrinks to match.
 */
export function CardStack({
  cards,
  stage,
}: {
  cards: readonly StackCard[];
  stage: Ref<HTMLDivElement>;
}) {
  // Cards keep their place in the DOM so moving one never reorders the others.
  const order = useRef<string[]>([]);
  const keys = new Set(cards.map((card) => card.key));
  order.current = [
    ...order.current.filter((key) => keys.has(key)),
    ...cards
      .map((card) => card.key)
      .filter((key) => !order.current.includes(key)),
  ];
  const stable = [...cards].sort(
    (a, b) => order.current.indexOf(a.key) - order.current.indexOf(b.key),
  );
  return (
    <div ref={stage} data-queue-part="stack" className="ws-stage">
      {stable.map(({ key, node, frame }) => (
        <div
          key={key}
          data-queue-card={key}
          className="ws-stack-card"
          style={{ top: PILE_LEAD, visibility: "hidden" }}
        >
          <div data-card-base className="ws-card-base" />
          <div data-card-frame className={cn("ws-card-frame", frame)} />
          <div data-card-content className="relative">
            {node}
          </div>
          <div data-card-shade className="ws-card-shade" />
        </div>
      ))}
    </div>
  );
}

/** The recap card, or a plain card for a thread without a recap. */
export function ThreadCard({
  card,
  threadId,
  files,
  age,
}: {
  card: QueueCard;
  threadId: string;
  files: RecapFiles | null;
  age: string;
}) {
  return (
    <div style={{ zoom: CARD_ZOOM }} className={CONTENT}>
      {card.kind === "recap" ? (
        <RecapSummary
          recap={card.recap}
          layout="full"
          files={files}
          threadId={threadId}
          clearance=""
          age={age}
        />
      ) : (
        <PlainCard card={card} accentText={accentOf(card).text} age={age} />
      )}
    </div>
  );
}

/**
 * A card's content sits inside its frame's border: the padding is the card's
 * 20px plus the border's 1px, which `CARD_ZOOM` scales to 24px, the column
 * the replies' keys and the action row share.
 */
const CONTENT =
  "@container/recap overflow-hidden px-[21px] pb-[9px] pt-4 text-foreground";

function accentOf(card: QueueCard) {
  return card.kind === "recap"
    ? ACCENT[card.recap.state]
    : card.kind === "needs"
      ? NEEDS
      : card.kind === "failed"
        ? FAILED
        : NEUTRAL;
}

/** The border and surface colours of a thread card's frame. */
export const threadFrame = (card: QueueCard) => accentOf(card).card;

/** A suggestion's frame. */
export const SUGGESTION_FRAME = "border-border";

const NEUTRAL = { card: "border-border", text: "text-muted-foreground" };
const NEEDS = {
  card: "border-(--ws-needs-you-border) bg-(--ws-needs-you-surface)",
  text: "text-(--ws-needs-you-text)",
};
const FAILED = {
  card: "border-[color-mix(in_oklab,var(--ws-failure)_55%,transparent)]",
  text: "text-(--ws-failure-text)",
};

function PlainCard({
  card,
  accentText,
  age,
}: {
  card: Exclude<QueueCard, { kind: "recap" }>;
  accentText: string;
  age: string;
}) {
  const [label, line] =
    card.kind === "sent"
      ? ["Working", `You sent: ${card.sent.text}`]
      : card.kind === "working"
        ? ["Working", card.line]
        : card.kind === "needs"
          ? ["Needs your decision", card.line]
          : card.kind === "failed"
            ? ["Failed", "The last turn failed. Open the thread to see why."]
            : [card.label, card.line];
  return (
    <div className="pb-1">
      <p className={cn("text-[11px] font-medium leading-[1.6]", accentText)}>
        {label}
        <span className="ml-1 font-normal text-muted-foreground">{age}</span>
      </p>
      {line ? (
        <RecapText
          text={line}
          typeClass="text-[13px] font-medium leading-[1.5] text-foreground"
          className="mt-0.5"
        />
      ) : null}
    </div>
  );
}

export type SuggestionMove = {
  /** The topic the threads move to. */
  to: string;
  /** Accepting creates the topic. */
  created: boolean;
  threads: readonly string[];
};

/** A suggestion's card: why, then each topic with the threads moving into it. */
export function SuggestionCard({
  reason,
  moving,
  moves,
}: {
  reason: string;
  moving: number;
  moves: readonly SuggestionMove[];
}) {
  return (
    <div style={{ zoom: CARD_ZOOM }} className={CONTENT}>
      <p className="text-[11px] font-medium leading-[1.6] text-muted-foreground">
        Suggestion
        <span className="ml-1 font-normal text-muted-foreground/80">
          moves {moving} thread{moving === 1 ? "" : "s"}
        </span>
      </p>
      <p className="text-[13px] font-medium leading-[1.5] text-foreground/85">
        {reason}
      </p>
      <div className="mt-1.5 text-[12px] leading-[1.5] [&>section+section]:border-t [&>section+section]:border-border">
        {moves.map((move, index) => (
          <section key={index} className="py-1.5">
            <h3 className="text-[11px] font-medium text-muted-foreground">
              {move.to}
              {move.created ? (
                <span className="ml-1.5 font-normal text-muted-foreground/70">
                  new
                </span>
              ) : null}
            </h3>
            <ul className="mt-0.5 grid gap-0.5">
              {move.threads.map((title, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <span>{title}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The proposed replies: each a full sentence with its number key. Holding
 * ⇧ brightens the keys, since ⇧ with a number (or a click) edits first.
 */
export function Answers({
  answers,
  editable,
  shift,
  onAnswer,
}: {
  answers: readonly string[];
  /** ⇧ edits a reply before sending; suggestions' answers can't be edited. */
  editable: boolean;
  shift: boolean;
  onAnswer: (index: number, edit: boolean) => void;
}) {
  return (
    <div className="group/replies">
      <ol aria-label="Replies" className="m-0 mt-3 grid list-none p-0">
        {answers.map((text, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={(event) => onAnswer(index, editable && event.shiftKey)}
              className="group/answer flex w-full cursor-pointer items-start gap-3.5 rounded-md py-2 pl-6 pr-2.5 text-left text-[15px] leading-[22px] text-foreground/85 transition-colors hover:bg-state-hover/50 hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <KeyChip
                bright={editable && shift}
                className="mt-0.5 w-[18px] px-0 group-hover/answer:border-foreground/40 group-hover/answer:text-foreground"
              >
                {String(index + 1)}
              </KeyChip>
              <span className="min-w-0 [text-wrap:pretty]">{text}</span>
            </button>
          </li>
        ))}
      </ol>
      {editable && answers.length ? (
        <p
          className={cn(
            "mb-0 ml-14 mt-1 text-xs opacity-0 transition-[opacity,color] duration-200 ease-out group-hover/replies:opacity-100 group-has-[:focus-visible]/replies:opacity-100 max-md:pointer-coarse:hidden",
            shift
              ? "text-foreground/70 opacity-100"
              : "text-muted-foreground/80",
          )}
        >
          hold ⇧ to edit before sending
        </p>
      ) : null}
    </div>
  );
}

const ROW_BUTTON =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-md border bg-transparent pl-3 pr-1.5 text-[13px] font-[450] transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-[13px] [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground/70";
const QUIET =
  "border-border/70 text-foreground/70 hover:border-border hover:text-foreground";
const LEAD = "border-border text-foreground hover:border-foreground/30";

function RowButton({
  icon,
  label,
  keyLabel,
  lead = false,
  onClick,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  keyLabel: string;
  lead?: boolean;
  onClick?: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ROW_BUTTON, lead ? LEAD : QUIET)}
      {...rest}
    >
      {icon}
      {label}
      <KeyChip className="ml-3">{keyLabel}</KeyChip>
    </button>
  );
}

/**
 * The thread actions under the replies. Snooze… always opens its menu, at the
 * button, where 1–6 pick a preset; the menu covering the replies is fine,
 * since the user is setting the thread aside.
 */
export function ThreadActions({
  archiveLeads,
  snoozeOpen,
  now,
  snoozePrefs,
  onSnoozeOpen,
  onReply,
  onSnooze,
  onCustomSnooze,
  onArchive,
  onOpen,
}: {
  /** A complete card with nothing to answer: Archive comes first. */
  archiveLeads: boolean;
  snoozeOpen: boolean;
  now: number;
  snoozePrefs: SnoozePrefs;
  onSnoozeOpen: (open: boolean) => void;
  onReply: () => void;
  onSnooze: (when: SnoozeWhen) => void;
  onCustomSnooze: () => void;
  onArchive: () => void;
  onOpen: () => void;
}) {
  const portalScope = usePortalScopeProps();
  const archive = (
    <RowButton
      icon={<Icon name="Archive" />}
      label="Archive"
      keyLabel="E"
      lead={archiveLeads}
      onClick={onArchive}
    />
  );
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
      {archiveLeads ? archive : null}
      <RowButton
        icon={<Icon name="ArrowTurnBackward" fallback="CornerDownLeft" />}
        label="Reply"
        keyLabel="R"
        onClick={onReply}
      />
      <DropdownMenu.Root open={snoozeOpen} onOpenChange={onSnoozeOpen}>
        <DropdownMenu.Trigger asChild>
          <RowButton icon={<SnoozeIcon />} label="Snooze…" keyLabel="S" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            {...portalScope}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className={snoozeMenuContentClass}
            onKeyDown={(event) => {
              const n = Number(event.key);
              const preset = snoozePrefs.presets[n - 1];
              if (!Number.isInteger(n) || !preset) return;
              event.preventDefault();
              const items =
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "[role='menuitem']",
                );
              items[n - 1]?.click();
            }}
          >
            <SnoozeMenuItems
              numbered
              now={now}
              prefs={snoozePrefs}
              onSnooze={onSnooze}
              onCustom={onCustomSnooze}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {archiveLeads ? null : archive}
      <RowButton
        icon={<Icon name="ExternalLink" />}
        label="Open"
        keyLabel="O"
        onClick={onOpen}
      />
    </div>
  );
}

/**
 * Reply, in place of the replies and the action row: Enter sends, ⇧Enter
 * adds a line, and Esc goes back.
 */
export function Composer({
  title,
  initial,
  onSend,
  onCancel,
}: {
  title: string;
  initial: string;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const ready = text.trim().length > 0;
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-foreground/[0.03] pb-2 pl-6 pr-3 pt-3 transition-colors focus-within:border-foreground/25">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (ready) onSend(text.trim());
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        aria-label={`Reply to ${title}`}
        placeholder={`Reply to ${title}`}
        className="block w-full resize-none bg-transparent text-[14px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 max-md:pointer-coarse:hidden">
          <KeyChip>↵</KeyChip> Send
        </span>
        <span className="ml-2 flex items-center gap-1.5 max-md:pointer-coarse:hidden">
          <KeyChip>Esc</KeyChip> Cancel
        </span>
        <button
          type="button"
          aria-label="Send"
          disabled={!ready}
          onClick={() => ready && onSend(text.trim())}
          className="ml-2 flex size-[26px] cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-colors disabled:cursor-default disabled:bg-foreground/15 disabled:text-muted-foreground"
        >
          <Icon name="ArrowUp" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
