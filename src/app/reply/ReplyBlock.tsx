/**
 * The `:::reply` block: the agent's reply body, drawn as part of bb's own
 * message in the recap card's type, labels, and markers, but without the
 * card's colored frame (only the docked card has one). It shows prose only;
 * the recap tool stays the source for the card and the sidebar. A reply that
 * ended without its closing `:::` line shows bb's own rendering of the block,
 * the same Markdown readers see without the plugin.
 */
import { useId, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { ExperimentalMessageBlockProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  CHECK,
  Glyph,
  LABEL_CLASS,
  RecapText,
} from "../composer/RecapCard.tsx";
import {
  DETAILS_LABEL,
  replySchema,
  type ReplyItem,
  type ReplySection,
} from "../../domain/reply.ts";

/** The message's own type, so the body reads as part of the message. */
const INHERIT = "text-[length:inherit] leading-[inherit]";
const LABEL = cn(LABEL_CLASS, "m-0 text-muted-foreground");
const DOT = "M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z";
const CIRCLE = "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z";

/**
 * Markdown that is a single paragraph renders through the recap card's line
 * renderer, which also draws thread chips and commit hashes; anything with
 * block structure renders through bb's Markdown.
 */
function ReplyText({ markdown }: { markdown: string }) {
  const block = /\n[ \t]*\n|^[ \t]*([-*+] |\d+[.)] |#|>|```|~~~|\|)/m.test(
    markdown,
  );
  return block ? (
    <Markdown content={markdown} className={cn("min-w-0", INHERIT)} />
  ) : (
    <RecapText text={markdown} typeClass={INHERIT} />
  );
}

function marker(item: ReplyItem, label: string) {
  const checked =
    item.checked ??
    (label === "Done" ? true : label === "Not done" ? false : null);
  if (checked === true)
    return {
      path: CHECK,
      name: "Done",
      className: "text-emerald-700 dark:text-emerald-300",
    };
  if (checked === false)
    return {
      path: CIRCLE,
      name: "Not done",
      className: "text-muted-foreground",
    };
  return {
    path: DOT,
    name: null,
    filled: true,
    className: "text-muted-foreground",
  };
}

function Items({ items, label }: { items: ReplyItem[]; label: string }) {
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {items.map((item, index) => {
        const mark = marker(item, label);
        return (
          <li
            key={index}
            data-reply-item={mark.name ?? "plain"}
            className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 max-md:pointer-coarse:grid-cols-[1.125rem_minmax(0,1fr)]"
          >
            <Glyph
              path={mark.path}
              filled={mark.filled}
              className={cn(
                "mt-[0.3em] h-3.5 w-3.5 max-md:pointer-coarse:h-4 max-md:pointer-coarse:w-4",
                mark.className,
              )}
            />
            {mark.name ? <span className="sr-only">{mark.name}: </span> : null}
            <ReplyText markdown={item.markdown} />
          </li>
        );
      })}
    </ul>
  );
}

function Section({ section }: { section: ReplySection }) {
  return (
    <section data-reply-section={section.label} className="mt-3">
      <h3 className={LABEL}>{section.label}</h3>
      {section.items ? (
        <Items items={section.items} label={section.label} />
      ) : section.markdown ? (
        <ReplyText markdown={section.markdown} />
      ) : null}
    </section>
  );
}

/** Folded by default; the plugin draws the fold because raw `<details>` arrives as text. */
function Details({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section data-reply-section={DETAILS_LABEL} className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          LABEL,
          "-ml-0.5 inline-flex cursor-pointer items-center gap-1 rounded px-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <Icon
          name="ChevronRight"
          aria-hidden
          className={cn(
            "size-3 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        {DETAILS_LABEL}
      </button>
      <div id={id} hidden={!open} className="mt-1 text-muted-foreground">
        {open ? <ReplyText markdown={markdown} /> : null}
      </div>
    </section>
  );
}

export function ReplyBlock({
  data,
  status,
  Original,
}: ExperimentalMessageBlockProps) {
  if (status === "unclosed") return <Original />;
  const reply = replySchema.safeParse(data);
  if (!reply.success) return null;
  const { lead, sections, details } = reply.data;
  return (
    <div data-reply-block="" className="my-1 min-w-0 text-foreground">
      {lead ? <ReplyText markdown={lead} /> : null}
      {sections.map((section, index) => (
        <Section key={`${index}-${section.label}`} section={section} />
      ))}
      {details ? <Details markdown={details} /> : null}
    </div>
  );
}
