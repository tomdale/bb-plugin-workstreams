import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { QuestionShortcut } from "./question-form-host.tsx";

export const QUESTION_CARD_CLASS =
  "@container/question relative mx-auto mb-3 w-full min-w-0 max-w-4xl rounded-lg border border-(--ws-needs-you-border) bg-(--ws-needs-you-surface) px-4 py-3 text-foreground";

// The card's type scale, largest to smallest: the question (in the card's
// amber accent, which replaces a separate state label; a lighter amber than
// the border so it stays legible as text), option labels, details,
// then option descriptions. On a phone (a viewport under 768px with a coarse
// pointer) the text follows BB's own rule and takes the next token up: the
// question is 22px, labels `text-base`, the timeline's size, and the
// rest `text-sm`. The answer field must be at least 16px or iOS zooms the page
// when it takes focus.
export const PROMPT_CLASS =
  "text-[20px] leading-[1.3] text-(--ws-needs-you-text) max-md:pointer-coarse:text-[22px] [text-wrap:pretty]";
// The renderer's root sets its own size and color, so the root takes the
// prompt's here, and code chips stay in the foreground color for legibility.
export const MARKDOWN_CLASS =
  "!text-inherit !text-[length:inherit] !leading-[inherit] [&_*]:!text-inherit [&_*]:!text-[length:inherit] [&_*]:!leading-[inherit] [&_p]:!m-0 [&_code]:!rounded [&_code]:!px-[3px] [&_code]:!py-px [&_code]:!text-[0.923em] [&_code]:!text-foreground";
// The host renderer gives every element its own color, size, and margins, as
// it does for chat messages. Details are context for the choice below them, so
// they sit a step below the question and the option labels in size and compact
// spacing, at full brightness so they stay easy to read. Top-level list text
// lines up with the option labels (see OPTION_TEXT_INDENT), bold stays below
// the question's weight, and headings sit tight to their paragraphs.
export const DETAILS_CLASS =
  "!text-[length:inherit] !leading-[inherit] [&_*]:!text-[length:inherit] [&_*]:!leading-[inherit] [&_p]:!mb-1.5 [&_ul]:!mb-1.5 [&_ol]:!mb-1.5 [&_li]:!mb-0.5 [&_ul]:!pl-6 [&_ol]:!pl-6 [&_li_ul]:!pl-5 [&_li_ol]:!pl-5 [&_strong]:!font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:!mt-2 [&_:is(h1,h2,h3,h4,h5,h6)]:!mb-1 [&_:last-child]:!mb-0 [&_code]:!rounded [&_code]:!px-[3px] [&_code]:!py-px [&_code]:!text-[0.923em]";
// Agents put paths and URLs in option text; wrap them rather than overflow.
// Footer buttons match the details text size, and reach 44px on a phone.
export const LABEL_CLASS =
  "text-[13.5px] leading-[1.4] max-md:pointer-coarse:text-base [overflow-wrap:anywhere]";
const DESCRIPTION_CLASS =
  "text-[12px] leading-[1.45] max-md:pointer-coarse:text-sm [text-wrap:pretty] [overflow-wrap:anywhere]";
// The radio (14px, 18px on a phone) plus its 10px gap: where option text
// starts. Details lists, option previews, and the answer field align to it.
export const OPTION_TEXT_INDENT = "ml-6 max-md:pointer-coarse:ml-7";

interface QuestionOptionRowProps {
  checked: boolean;
  label: string;
  description?: string;
  multiSelect: boolean;
  onSelect?: () => void;
  readOnly?: boolean;
  shortcut?: QuestionShortcut;
  /** Single-select rows form a radio group with one tab stop. */
  tabStop?: boolean;
}

export function QuestionOptionRow({
  checked,
  readOnly = false,
  label,
  description,
  multiSelect,
  onSelect,
  shortcut,
  tabStop,
}: QuestionOptionRowProps) {
  const Row = readOnly ? "div" : "button";
  return (
    <Row
      type={readOnly ? undefined : "button"}
      role={readOnly ? undefined : multiSelect ? "checkbox" : "radio"}
      aria-checked={readOnly ? undefined : checked}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      tabIndex={readOnly ? undefined : tabStop ? 0 : -1}
      onClick={readOnly ? undefined : onSelect}
      // The row's padding extends its hover fill and focus outline 8px past
      // the content edge, while the radio and label stay on it. A phone row
      // reaches the 44px touch target.
      className={cn(
        readOnly
          ? "cursor-default"
          : "cursor-pointer hover:bg-state-hover hover:duration-0",
        "group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 disabled:cursor-default disabled:hover:bg-transparent max-md:pointer-coarse:py-[11px]",
      )}
    >
      <span
        className={cn(
          "mt-[2.5px] flex size-3.5 shrink-0 items-center justify-center border transition-colors duration-150 motion-reduce:transition-none max-md:pointer-coarse:mt-[2px] max-md:pointer-coarse:size-[18px]",
          multiSelect ? "rounded" : "rounded-full",
          checked
            ? "border-(--ws-needs-you-strong) bg-(--ws-needs-you-strong) text-(--ws-needs-you-on-strong)"
            : readOnly
              ? "border-foreground/55"
              : "border-foreground/55 group-hover:border-foreground/80",
        )}
      >
        {checked ? (
          multiSelect ? (
            <Icon name="Check" className="size-2.5" aria-hidden />
          ) : (
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
          )
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium text-foreground", LABEL_CLASS)}>
          {label}
          {readOnly && checked ? (
            <span className="sr-only"> (Selected)</span>
          ) : null}
        </span>
        {description ? (
          <span
            className={cn(
              "mt-px block text-muted-foreground",
              DESCRIPTION_CLASS,
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
      {shortcut ? (
        <kbd
          aria-hidden="true"
          className="mt-px shrink-0 text-xs font-medium tabular-nums text-muted-foreground max-md:pointer-coarse:hidden"
        >
          {shortcut.label}
        </kbd>
      ) : null}
    </Row>
  );
}

export function QuestionOptionPreview({ preview }: { preview: string }) {
  return (
    <pre
      className={cn(
        "mb-1 mt-1 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-foreground max-md:pointer-coarse:text-xs",
        OPTION_TEXT_INDENT,
      )}
      style={{ maxHeight: "220px" }}
    >
      {preview}
    </pre>
  );
}
