/**
 * The organizing suggestions on the Workstreams heading: a count ("2
 * suggestions") in a fixed-width slot that opens them in a modal
 * (`SuggestionsReview`), or in a bottom drawer on a compact viewport. The slot
 * keeps the count's changing text from moving the heading, and Up Next above
 * it is untouched.
 *
 * The count is the server's pending count (`pendingSuggestions`), so it
 * includes out-of-date suggestions. The list is read when the pointer or focus
 * reaches the count and while the modal is open, not otherwise, so the modal
 * opens complete (see `useSuggestionFeed`).
 */
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { SPARKLES_ICON } from "../workstream-icon.ts";
import { SuggestionsReview } from "./SuggestionsReview.tsx";
import type { SidebarView } from "./suggestionMiniatures.ts";
import { useSuggestionFeed, type Rpc } from "./useSuggestionFeed.ts";

export const suggestionCountLabel = (count: number) =>
  count === 1 ? "1 suggestion" : `${count} suggestions`;

/**
 * Wraps the Workstreams heading, which anchors the modal, and hands it the
 * count to place in its row.
 */
export function SuggestionsChip({
  rpc,
  sidebar,
  count,
  onOpenTopics,
  children,
}: {
  rpc: Rpc;
  /** What the sidebar holds, which the review draws its miniatures from. */
  sidebar: SidebarView;
  /** Organizing suggestions waiting for a decision. */
  count: number;
  onOpenTopics: () => void;
  /** The heading row, given the count's slot. */
  children: (slot: ReactNode) => ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const compact = useIsCompactViewport();
  const feed = useSuggestionFeed(rpc);
  /** Puts focus on the selected suggestion, which the review registers. */
  const focusInitial = useRef<() => void>(() => {});
  // The count stays while the review is open, so focus has somewhere to
  // return on close even after the last decision.
  const shown = count > 0 || open;
  const slot = (
    <span className="flex w-[92px] shrink-0 justify-end">
      {shown ? (
        <DialogTrigger asChild>
          <button
            type="button"
            onPointerEnter={feed.refresh}
            onFocus={feed.refresh}
            onPointerDown={feed.refresh}
            // A transparent border is the chip: the border-box (what the
            // hover background paints and the pointer hits) grows 3px up,
            // 2px down and 8px sideways around the text, and the matching
            // negative margin keeps the layout box on the heading's line,
            // so the row never moves and the rest-state text stays on the
            // label's baseline.
            className="ws-suggestions-action -mx-2 -mb-[2px] -mt-[3px] flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border-transparent border-x-8 border-b-2 border-t-[3px] text-[12px] leading-4 font-medium tabular-nums transition-colors"
          >
            <Icon
              name={SPARKLES_ICON}
              className="mr-1 size-3 shrink-0"
              aria-hidden
            />
            {count > 0 ? suggestionCountLabel(count) : "No suggestions"}
          </button>
        </DialogTrigger>
      ) : null}
    </span>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children(slot)}
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        data-ws-suggestions=""
        // Focus the selected suggestion, so the keys work at once and the
        // first suggestion shows as selected, not as the header's menu.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusInitial.current();
        }}
        // Over the whole window up to 1040 by 640, whatever the content:
        // the review fills its size, so nothing resizes as it changes.
        className={cn(
          "flex max-w-none flex-col gap-0 overflow-hidden p-0 duration-100",
          compact
            ? "h-[min(78dvh,620px)] w-auto"
            : "h-[min(640px,calc(100dvh-3rem))] w-[min(1040px,calc(100vw-4rem))]",
        )}
      >
        <SuggestionsReview
          rpc={rpc}
          feed={feed}
          sidebar={sidebar}
          focusInitial={focusInitial}
          onClose={() => setOpen(false)}
          onOpenTopics={() => {
            setOpen(false);
            onOpenTopics();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
