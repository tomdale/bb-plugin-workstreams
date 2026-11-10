/**
 * The organizing suggestions on the Workstreams heading: a count ("2
 * suggestions") in a fixed-width slot that opens them in a flyaway below the
 * heading. The flyaway floats over the workstreams, so the list under it
 * never moves, and Up Next above it is untouched.
 *
 * Each suggestion is drawn as the sidebar rows it touches, before and after
 * accepting (`SuggestionPreview`), with Decline and Accept beside it; its
 * headline ("Merge Payments into Billing") names the row for screen readers
 * and the buttons. The flyaway is wider than the sidebar, so both sides have
 * room. A decision applies at once and leaves a line in its place with Undo
 * for a few seconds, as in Topics; Activity keeps Undo after that. Closing
 * (Escape, Close, or a click outside) decides nothing: the rest keep waiting.
 *
 * Only suggestions that can apply now are listed. Those the tree has since
 * outgrown stay pending, as everywhere else, and are counted at the foot,
 * beside the way to Topics, where they can be dismissed.
 *
 * The count is the server's pending count (`pendingSuggestions`), so it
 * includes out-of-date suggestions; the list is read only while open.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SuggestionsStateWire } from "../../server/contract.ts";
import { keepOrder } from "../../domain/feed.ts";
import type { useWorkstreams } from "../useWorkstreams.ts";
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
  const anchor = useRef<HTMLDivElement>(null);
  // The count stays while the flyaway is open, so focus has somewhere to
  // return on close even after the last decision.
  const shown = count > 0 || open;
  const slot = (
    // Fixed width, so the count's changing text never moves the heading.
    <span className="flex w-[92px] shrink-0 justify-end">
      {shown ? (
        <PopoverTrigger asChild>
          <button
            type="button"
            // A transparent border is the chip: the border-box (what the
            // hover background paints and the pointer hits) grows 3px up,
            // 2px down and 8px sideways around the text, and the matching
            // negative margin keeps the layout box on the heading's line,
            // so the row never moves and the rest-state text stays on the
            // label's baseline.
            className="ws-suggestions-action -mx-2 -mb-[2px] -mt-[3px] flex shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md border-transparent border-x-8 border-b-2 border-t-[3px] text-[12px] leading-4 font-medium tabular-nums transition-colors"
          >
            {count > 0 ? suggestionCountLabel(count) : "No suggestions"}
          </button>
        </PopoverTrigger>
      ) : null}
    </span>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild ref={anchor} tabIndex={-1}>
        {children(slot)}
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        aria-label={TITLE}
        mobileTitle={TITLE}
        // Focus the flyaway itself, so Tab reaches the suggestions first and
        // no control looks selected before the user picks one.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // With nothing left, the count is gone: focus its heading instead.
          if (count > 0) return;
          event.preventDefault();
          anchor.current?.focus();
        }}
        // Wider than the sidebar, over the thread beside it, so both sides of
        // each suggestion have room for their names.
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 text-[13px]"
      >
        <SuggestionList
          rpc={rpc}
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

function SuggestionList({
  rpc,
  colors,
  onClose,
  onOpenTopics,
}: {
  rpc: Rpc;
  colors?: PreviewColors;
  onClose: () => void;
  onOpenTopics: () => void;
}) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(
    new Map(),
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const kept = useRef<string[]>([]);
  const close = useRef<HTMLButtonElement>(null);
  const read = useCallback(async () => {
    try {
      setState((await rpc.call("suggestions", null)).state);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [rpc]);
  useEffect(() => {
    void read();
  }, [read]);
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
          onClick={onClose}
          className={TEXT_BUTTON}
        >
          Close
        </button>
      </div>
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
    <li className={cn(ROW, "flex items-center gap-2 py-2")}>
      {preview ? (
        <>
          <span className="sr-only">{headline}</span>
          <SuggestionPreview preview={preview} colors={colors} />
        </>
      ) : (
        <span className="min-w-0 flex-1 font-medium leading-4">{headline}</span>
      )}
      <span className="-mr-1 flex shrink-0 items-center gap-0.5 self-start">
        <Hint label="Decline">
          <button
            type="button"
            aria-label={`Decline: ${headline}`}
            onClick={() => onDecide("decline")}
            className={rowActionClass}
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </button>
        </Hint>
        <Hint label="Accept">
          <button
            type="button"
            aria-label={`Accept: ${headline}`}
            onClick={() => onDecide("accept")}
            className={cn(rowActionClass, "text-foreground")}
          >
            <Icon name="Check" className="size-3.5" aria-hidden />
          </button>
        </Hint>
      </span>
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
