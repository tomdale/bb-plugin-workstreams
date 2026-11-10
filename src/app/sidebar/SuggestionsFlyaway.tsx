/**
 * The organizing suggestions on the Workstreams heading: a count ("2
 * suggestions") in a fixed-width slot that opens them in a flyaway to the right of
 * the count. The flyaway floats over the workstreams, so the list under it
 * never moves, and Up Next above it is untouched.
 *
 * Each suggestion starts with its headline ("Merge Payments into Billing"),
 * dimmed, beside Decline and Accept, then draws the sidebar rows it touches
 * before and after accepting (`SuggestionPreview`). The flyaway is as wide as
 * its suggestions need, at least the sidebar's width, so a headline and both
 * sides of a drawing fit without truncating. A decision applies at once and
 * leaves a line in its place with Undo
 * for a few seconds, as in Topics; Activity keeps Undo after that. Closing
 * (Escape, the header's ✕, or a click outside) decides nothing: the rest keep
 * waiting.
 *
 * Only suggestions that can apply now are listed. Those the tree has since
 * outgrown stay pending, as everywhere else, and are counted at the foot,
 * beside the way to Topics, where they can be dismissed.
 *
 * The count is the server's pending count (`pendingSuggestions`), so it
 * includes out-of-date suggestions. The list is read when the pointer or focus
 * reaches the count and while the flyaway is open, not otherwise.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";
import type { SuggestionsStateWire } from "../../server/contract.ts";
import { keepOrder } from "../../domain/feed.ts";
import type { useWorkstreams } from "../useWorkstreams.ts";
import { SPARKLES_ICON } from "../workstream-icon.ts";
import { Hint } from "../Hint.tsx";
import { rowActionClass } from "./HoverActions.tsx";
import { SuggestionPreview, type PreviewColors } from "./SuggestionPreview.tsx";

type Rpc = ReturnType<typeof useWorkstreams>["rpc"];
type Suggestion = SuggestionsStateWire["suggestions"][number];
type Decided = {
  decision: "accept" | "decline";
  /** Kept for the line, since a decided suggestion may leave the state. */
  headline: string;
  /** The accepted suggestion's Activity entry, for Undo. */
  entryId?: string;
};

/** How long a decision's line, with Undo, stays in its suggestion's place. */
const DECIDED_MS = 6_000;

const TITLE = "Organizing suggestions";

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Threads moved, the measure Topics also lists suggestions by. */
const weight = (s: Suggestion) =>
  s.change?.moves.reduce((n, m) => n + m.threads.length + m.carried, 0) ?? 0;

export const suggestionCountLabel = (count: number) =>
  count === 1 ? "1 suggestion" : `${count} suggestions`;

/** How recently read suggestions still count as current when the list opens. */
const FRESH_MS = 1_000;

/**
 * The suggestions the flyaway lists, held above the list so they outlive it:
 * the pointer reaching the count reads them before the click, and the list
 * then opens at its final size. Opening on "Loading…" instead would draw a
 * small panel that jumps to full size, taking its caret with it as the
 * panel slides clear of the window's edge.
 */
function useSuggestionFeed(rpc: Rpc) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const [loadError, setLoadError] = useState(false);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    readAt.current = Date.now();
    try {
      setState((await rpc.call("suggestions", null)).state);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [rpc]);
  /** Reads unless a read just began; what the pointer and the list share. */
  const refresh = useCallback(() => {
    if (Date.now() - readAt.current >= FRESH_MS) void read();
  }, [read]);
  return { state, setState, loadError, read, refresh };
}
type Feed = ReturnType<typeof useSuggestionFeed>;

/**
 * Wraps the Workstreams heading, which anchors the flyaway, and hands it the
 * count to place in its row.
 */
export function SuggestionsFlyaway({
  rpc,
  colors,
  count,
  onOpenTopics,
  children,
}: {
  rpc: Rpc;
  /** The workstream colors landing rows take. */
  colors?: PreviewColors;
  /** Organizing suggestions waiting for a decision. */
  count: number;
  onOpenTopics: () => void;
  /** The heading row, given the count's slot. */
  children: (slot: ReactNode) => ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const compact = useIsCompactViewport();
  const trigger = useRef<HTMLButtonElement>(null);
  const feed = useSuggestionFeed(rpc);
  // The count stays while the flyaway is open, so focus has somewhere to
  // return on close even after the last decision.
  const shown = count > 0 || open;
  const slot = (
    // Fixed width, so the count's changing text never moves the heading.
    <span className="flex w-[92px] shrink-0 justify-end">
      {shown ? (
        <PopoverTrigger asChild>
          <button
            ref={trigger}
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
        </PopoverTrigger>
      ) : null}
    </span>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Scrim shown={open} />
      {children(slot)}
      <PopoverContent
        align="start"
        side="right"
        // Close enough that the caret nearly touches the count it belongs to.
        sideOffset={4}
        aria-label={TITLE}
        mobileTitle={TITLE}
        // Focus the flyaway itself, so Tab reaches the suggestions first and
        // no control looks selected before the user picks one.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // With nothing left the count is gone; focus returns to the trigger.
          if (count > 0) return;
          event.preventDefault();
          trigger.current?.focus();
        }}
        // As wide as its suggestions need, over the thread beside it, so a
        // headline and both sides of a drawing have room for their names; no
        // narrower than the sidebar's own width, and capped so one long name
        // cannot fill the window.
        // Room for the caret outside the panel, so no clipping here. The open
        // animation scales from the caret, not the panel's centre: scaled
        // about the centre, a tall panel's near edge, and the caret on it,
        // would slide several pixels while it opens.
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-max min-w-[360px] max-w-[min(40rem,calc(100vw-1rem))] origin-[var(--radix-popover-content-transform-origin)] flex-col p-0 text-[13px]"
      >
        {/* Points at the count, level with it wherever the flyaway lands. The
            drawer needs none, and no popper context to draw one from. */}
        {compact ? null : (
          <PopoverPrimitive.Arrow width={10} height={5} asChild aria-hidden>
            <svg viewBox="0 0 10 5" className="overflow-visible">
              <path d="M-.5 -1H10.5L5 5Z" className="fill-popover" />
              <path
                d="M0 0L5 5L10 0"
                className="fill-none stroke-border"
                strokeWidth={1}
              />
            </svg>
          </PopoverPrimitive.Arrow>
        )}
        <SuggestionList
          rpc={rpc}
          feed={feed}
          colors={colors}
          onClose={() => setOpen(false)}
          onOpenTopics={() => {
            setOpen(false);
            onOpenTopics();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Dims the app behind the open flyaway, as BB's dialogs do. It stays mounted
 * so it fades both ways on opacity alone, and takes the pointer only while
 * shown: a click on it closes the flyaway (an outside click) without reaching
 * the control underneath. Compact viewports open the flyaway as a drawer,
 * which brings its own backdrop.
 */
function Scrim({ shown }: { shown: boolean }) {
  const compact = useIsCompactViewport();
  const still = usePrefersReducedMotion();
  if (compact || typeof document === "undefined") return null;
  // Styled inline: it sits outside the plugin's scoped styles, and it must
  // not wear BB's portaled-overlay marker while it waits, hidden.
  return createPortal(
    <div
      aria-hidden
      data-ws-flyaway-scrim={shown ? "shown" : "hidden"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgb(0 0 0 / 0.4)",
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? "auto" : "none",
        transition: still ? undefined : "opacity 80ms ease-out",
      }}
    />,
    document.body,
  );
}

function SuggestionList({
  rpc,
  feed,
  colors,
  onClose,
  onOpenTopics,
}: {
  rpc: Rpc;
  feed: Feed;
  colors?: PreviewColors;
  onClose: () => void;
  onOpenTopics: () => void;
}) {
  const { state, setState, loadError, read, refresh } = feed;
  const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(
    new Map(),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const kept = useRef<string[]>([]);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useRealtime("changed", () => void read());
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const pending = (state?.suggestions ?? []).filter(
    (s) => s.status === "pending",
  );
  const ready = pending.filter((s) => !s.problem && s.change);
  const stale = pending.length - ready.length;
  const byId = new Map(ready.map((s) => [s.id, s] as const));
  // Suggestions keep their place while the flyaway is open, a decided one
  // included.
  kept.current = keepOrder(kept.current, [
    ...[...ready].sort((a, b) => weight(b) - weight(a)).map((s) => s.id),
    ...decided.keys(),
  ]);

  const open2 = ready.filter((s) => !decided.has(s.id)).length;
  const forget = (ids: readonly string[]) =>
    setDecided((was) => {
      const next = new Map(was);
      for (const id of ids) next.delete(id);
      return next;
    });
  const settle = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        forget([id]);
      }, DECIDED_MS),
    );
  };
  const decide = async (s: Suggestion, decision: Decided["decision"]) => {
    setDecided((was) =>
      new Map(was).set(s.id, { decision, headline: s.headline }),
    );
    try {
      const result = await rpc.call("suggestionsDecide", {
        ids: [s.id],
        decision,
      });
      setState(result.state);
      if (result.applied.includes(s.id)) {
        setDecided((was) =>
          new Map(was).set(s.id, {
            decision,
            headline: s.headline,
            entryId: result.entries[s.id],
          }),
        );
        settle(s.id);
      } else forget([s.id]);
      for (const failure of result.failed)
        toast.error(`Couldn't apply: ${failure.reason}`);
    } catch (cause) {
      toast.error(message(cause));
      forget([s.id]);
    }
  };
  const decideAll = async (decision: Decided["decision"]) => {
    const targets = ready.filter((s) => !decided.has(s.id));
    for (const s of targets) await decide(s, decision);
  };
  const undo = async (id: string) => {
    const entry = decided.get(id);
    if (!entry) return;
    clearTimeout(timers.current.get(id));
    forget([id]);
    // Undo leaves with its line; keep focus in the flyaway.
    requestAnimationFrame(() => {
      if (lostFocus()) close.current?.focus();
    });
    try {
      const result = await rpc.call("suggestionsReopen", {
        id,
        ...(entry.entryId ? { entryId: entry.entryId } : {}),
      });
      setState(result.state);
    } catch (cause) {
      toast.error(message(cause));
      void read();
    }
  };

  const rows = kept.current.flatMap((id) => {
    const done = decided.get(id);
    if (done)
      return [
        <DecidedRow key={id} decided={done} onUndo={() => void undo(id)} />,
      ];
    const s = byId.get(id);
    return s
      ? [
          <SuggestionRow
            key={id}
            suggestion={s}
            colors={colors}
            onDecide={(decision) => void decide(s, decision)}
          />,
        ]
      : [];
  });

  return (
    <>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1.5">
        <h2 className="m-0 truncate text-[13px] font-medium">{TITLE}</h2>
        <button
          ref={close}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={HEADER_CLOSE}
        >
          <Icon name="X" className="size-3.5" aria-hidden />
        </button>
      </div>
      {open2 > 1 ? (
        <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border px-1.5">
          <button
            type="button"
            onClick={() => void decideAll("decline")}
            className={cn(TEXT_BUTTON, REJECT_TEXT)}
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => void decideAll("accept")}
            className={cn(TEXT_BUTTON, ACCEPT_TEXT)}
          >
            Accept all
          </button>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-0">
          {rows}
        </ul>
      ) : (
        <p
          role="status"
          className="m-0 px-3 py-7 text-center text-muted-foreground"
        >
          {loadError
            ? "Couldn't load suggestions"
            : state
              ? "No suggestions waiting"
              : "Loading…"}
        </p>
      )}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border pl-3 pr-1.5 text-xs text-muted-foreground">
        <span className="truncate">{stale ? `${stale} out of date` : ""}</span>
        <button type="button" onClick={onOpenTopics} className={TEXT_BUTTON}>
          Open Topics
        </button>
      </div>
    </>
  );
}

/** The focused control left the page, as a decided row's buttons do. */
const lostFocus = () =>
  !document.activeElement || document.activeElement === document.body;

const TEXT_BUTTON =
  "h-6 shrink-0 cursor-pointer rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/** The header's dismiss, as BB's overlays draw it: an icon, named for nobody who can see it. */
const HEADER_CLOSE =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

const ACCEPT_TEXT =
  "text-[var(--ws-complete-text)] hover:text-[var(--ws-complete-text)]";
const REJECT_TEXT = "text-destructive hover:text-destructive";

const ROW = "border-b border-border/60 px-3 last:border-b-0";

function SuggestionRow({
  suggestion,
  colors,
  onDecide,
}: {
  suggestion: Suggestion;
  colors?: PreviewColors;
  onDecide: (decision: Decided["decision"]) => void;
}) {
  const { headline, preview } = suggestion;
  return (
    <li className={cn(ROW, "pb-2 pt-1")}>
      <div className="flex min-h-6 items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate leading-4",
            preview ? "text-[12px] text-muted-foreground" : "font-medium",
          )}
        >
          {headline}
        </span>
        <span className="-mr-1 flex shrink-0 items-center gap-0.5">
          <Hint label="Decline">
            <button
              type="button"
              aria-label={`Decline: ${headline}`}
              onClick={() => onDecide("decline")}
              className={cn(rowActionClass, REJECT_TEXT)}
            >
              <Icon name="X" className="size-3.5" aria-hidden />
            </button>
          </Hint>
          <Hint label="Accept">
            <button
              type="button"
              aria-label={`Accept: ${headline}`}
              onClick={() => onDecide("accept")}
              className={cn(rowActionClass, ACCEPT_TEXT)}
            >
              <Icon name="Check" className="size-3.5" aria-hidden />
            </button>
          </Hint>
        </span>
      </div>
      {preview ? <SuggestionPreview preview={preview} colors={colors} /> : null}
    </li>
  );
}

function DecidedRow({
  decided,
  onUndo,
}: {
  decided: Decided;
  onUndo: () => void;
}) {
  const undo = useRef<HTMLButtonElement>(null);
  // The decision's buttons leave with the row; Undo takes their focus.
  useEffect(() => {
    if (lostFocus()) undo.current?.focus();
  }, []);
  return (
    <li className={cn(ROW, "flex min-h-9 items-center gap-2 py-2")}>
      <span
        role="status"
        className="min-w-0 flex-1 truncate leading-4 text-muted-foreground"
      >
        {decided.decision === "accept"
          ? `✓ ${decided.headline}`
          : `Declined: ${decided.headline}`}
      </span>
      <button
        ref={undo}
        type="button"
        onClick={onUndo}
        className="shrink-0 cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Undo
      </button>
    </li>
  );
}
