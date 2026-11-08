import type { ReactNode } from "react";
import { CHECK, Glyph, LABEL_CLASS, MARK_ROW_CLASS } from "../recap/marks.tsx";
import { CARD_LABELS, type ReplyCard } from "../../domain/reply.ts";
import { ROW_NAME_CLASS } from "./type.ts";

/*
 * Replies written before the recap tool carry the card's own fields inside the
 * block. They are drawn plainly: the card's rows as labelled rows, with no
 * frame, no tint and no actions. Rebuilding the card here would put a second
 * bordered, state-tinted object on screen, and it would look clickable when it
 * is not.
 */

const DASH = "M4.5 8H11.5";
const RING = "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z";
const ARROW = "M3.5 8h9M9 4.5 12.5 8 9 11.5";

/** How a card state reads as a sentence when its state line is drawn. */
const STATE_WORDS: Record<string, string> = {
  complete: "Complete",
  review: "Ready for review",
  waiting: "Waiting",
};

export const legacyStateWord = (state: string): string =>
  STATE_WORDS[state] ?? state;

type Md = (content: string | undefined) => ReactNode;

/** A row of the card's own: a mark, then the text it reports. */
function MarkedRow({ path, text }: { path?: string; text: ReactNode }) {
  return (
    <div className={`${MARK_ROW_CLASS} min-w-0`}>
      {path ? (
        <Glyph
          path={path}
          className="mt-[0.2em] h-3.5 w-3.5 text-muted-foreground"
        />
      ) : null}
      <div className={`min-w-0 ${ROW_NAME_CLASS} [&_p]:m-0`}>{text}</div>
    </div>
  );
}

export function LegacyCard({ card, md }: { card: ReplyCard; md: Md }) {
  const done = card.results.filter((item) => item.checked !== false);
  const notDone = card.results.filter((item) => item.checked === false);
  const list = (items: string[], path?: string) =>
    items.length ? (
      <div className="min-w-0 space-y-0.5">
        {items.map((item, i) => (
          <MarkedRow key={i} path={path} text={md(item)} />
        ))}
      </div>
    ) : null;
  const blocks: [string, ReactNode][] = [
    [
      "Done",
      list(
        done.map((item) => item.markdown),
        CHECK,
      ),
    ],
    [
      "Not done",
      list(
        notDone.map((item) => item.markdown),
        DASH,
      ),
    ],
    [
      CARD_LABELS.review,
      card.review.length ? (
        <div className="min-w-0 space-y-0.5">
          {card.review.map((item, i) => (
            <MarkedRow
              key={i}
              text={
                <span className="flex min-w-0 gap-x-1.5">
                  <span
                    aria-hidden="true"
                    className="text-[11px] font-medium leading-[20px] tabular-nums text-muted-foreground"
                  >
                    {i + 1}.
                  </span>
                  <span className="min-w-0">{md(item)}</span>
                </span>
              }
            />
          ))}
        </div>
      ) : null,
    ],
    [CARD_LABELS.waitingOn, list(card.waitingOn, RING)],
    [
      CARD_LABELS.links,
      card.links.length ? (
        <div className="min-w-0 space-y-0.5">
          {card.links.map((link, i) => (
            <div key={i} className={`min-w-0 ${ROW_NAME_CLASS} [&_p]:m-0`}>
              {md(link)}
            </div>
          ))}
        </div>
      ) : null,
    ],
    [CARD_LABELS.next, list(card.next, ARROW)],
  ].filter(([, value]) => Boolean(value)) as [string, ReactNode][];
  return (
    <div data-reply-legacy="" className="@container/legacy min-w-0">
      <dl className="m-0 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 @max-[26rem]/legacy:grid-cols-1">
        {blocks.map(([label, value]) => (
          <div
            key={label}
            data-reply-legacy-row={label.toLowerCase().replaceAll(" ", "-")}
            className="col-span-full grid grid-cols-subgrid gap-x-3 @max-[26rem]/legacy:grid-cols-1"
          >
            <dt
              className={`${LABEL_CLASS} whitespace-nowrap text-muted-foreground`}
            >
              {label}
            </dt>
            <dd className="m-0 min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
