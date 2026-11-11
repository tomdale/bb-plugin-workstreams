/**
 * The organizing suggestions' review, inside the modal the Workstreams count
 * opens (`SuggestionsChip`). It reads as one statement: on the left a plain
 * sentence for each pending change; on the right the selected change's
 * sentence as a title, Decline and Accept at its end, and below it the two
 * small sidebars, now and after accepting that one change
 * (`SuggestionMiniatures`).
 *
 * A decision applies at once. Its row keeps its place, so nothing below it
 * moves: it turns into a line with Undo for a few seconds, then dims, until
 * the modal closes, and the highlight moves on to the next change. When the
 * last one is decided and its Undo has gone, the modal closes. Closing any
 * other way (Escape, the ✕, the scrim) decides nothing: the rest keep waiting.
 *
 * Keys: A accepts and D declines the selected change, U undoes the latest
 * decision, J and K (or the arrow keys in the list) step between changes. On
 * a compact viewport the list is a drop-down under the title and the buttons
 * sit above the drawing.
 *
 * Only suggestions that can apply now are offered. One the tree has since
 * outgrown, while the modal is open, stays in its place, dimmed and out of
 * date, with its buttons off; the rest are counted at the foot, where Topics
 * can dismiss them.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import { keepOrder } from "../../domain/feed.ts";
import { Hint } from "../Hint.tsx";
import { DebugThreadButton } from "../debug/DebugThreadButton.tsx";
import { suggestionSubject } from "../debug/subjects.ts";
import {
  MENU_ITEM_CLASS,
  MENU_SEPARATOR_CLASS,
  menuSurfaceClass,
} from "../primitives/menu.ts";
import { useUnscopedChanged } from "../useChanged.ts";
import { SuggestionMiniatures } from "./SuggestionMiniatures.tsx";
import {
  miniature,
  miniatureBase,
  type Miniature,
  type SidebarView,
} from "./suggestionMiniatures.ts";
import type { Feed, Rpc, Suggestion } from "./useSuggestionFeed.ts";

type Decision = "accept" | "decline";
type Decided = {
  decision: Decision;
  /** Kept for the line, since a decided suggestion may leave the state. */
  headline: string;
  /** The server has answered. */
  done: boolean;
  /** Undo is on offer. */
  live: boolean;
  /** The accepted suggestion's Activity entry, for Undo. */
  entryId?: string;
};

/** How long a decision's line keeps its Undo. */
const DECIDED_MS = 6_000;

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Threads moved, the measure Topics also lists suggestions by. */
const weight = (s: Suggestion) =>
  s.change?.moves.reduce((n, m) => n + m.threads.length + m.carried, 0) ?? 0;

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A row of the list, in the order its suggestion first appeared. */
type Item =
  | { id: string; kind: "open"; suggestion: Suggestion }
  /** Decided here; its line stays. */
  | { id: string; kind: "decided"; decided: Decided }
  /** Listed before; the tree has since outgrown it. */
  | { id: string; kind: "outdated"; headline: string };

/** A key on a button, as the design draws it. */
function Key({ children, filled }: { children: string; filled?: boolean }) {
  // A touch screen has no keys to press; the hint is for the keyboard.
  if (useIsCompactViewport()) return null;
  return (
    <kbd
      aria-hidden
      className={cn(
        "min-w-[18px] rounded px-1 text-center font-sans text-[11px] leading-4 font-medium ring-1 ring-inset",
        filled
          ? "text-background/70 ring-background/30"
          : "text-muted-foreground ring-border",
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Slides the highlight to the selected row, and sets it in place at once
 * when the row only moved because the list did (a resize, a decision above).
 */
function useSlidingHighlight(
  list: RefObject<HTMLElement | null>,
  highlight: RefObject<HTMLElement | null>,
  selected: string | null,
) {
  const still = usePrefersReducedMotion();
  const last = useRef<string | null | undefined>(undefined);
  const place = useCallback(
    (animate: boolean) => {
      const el = highlight.current;
      if (!el) return;
      const row = [
        ...(list.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? []),
      ].find((candidate) => candidate.dataset.pick === selected);
      if (!row) {
        el.style.opacity = "0";
        return;
      }
      el.style.transition = animate && !still ? "" : "none";
      el.style.opacity = "1";
      el.style.top = `${row.offsetTop}px`;
      el.style.height = `${row.offsetHeight}px`;
    },
    [list, highlight, selected, still],
  );
  // Every render: a row can move with no change of selection.
  useLayoutEffect(() => {
    place(last.current !== undefined && last.current !== selected);
    last.current = selected;
  });
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => place(false));
    watch.observe(el);
    return () => watch.disconnect();
  }, [list, place]);
}

export function SuggestionsReview({
  rpc,
  feed,
  sidebar,
  focusInitial,
  onClose,
  onOpenTopics,
}: {
  rpc: Rpc;
  feed: Feed;
  sidebar: SidebarView;
  /** Set to a function that focuses the selected suggestion. */
  focusInitial: MutableRefObject<() => void>;
  onClose: () => void;
  onOpenTopics: () => void;
}) {
  const { state, setState, loadError, read, refresh } = feed;
  const compact = useIsCompactViewport();
  const portalScope = usePortalScopeProps();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(
    new Map(),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The live receipts, oldest first; U undoes the last. */
  const receipts = useRef<string[]>([]);
  const kept = useRef<string[]>([]);
  /** Every suggestion offered here, so one that goes can stay as a line. */
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    refresh();
  }, [refresh]);
  useUnscopedChanged(() => void read());
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
  const readyById = new Map(ready.map((s) => [s.id, s] as const));
  for (const s of ready) seen.current.set(s.id, s.headline);
  kept.current = keepOrder(kept.current, [
    ...[...ready].sort((a, b) => weight(b) - weight(a)).map((s) => s.id),
    ...decided.keys(),
    ...[...seen.current.keys()].filter(
      (id) => !readyById.has(id) && !decided.has(id),
    ),
  ]);
  const items: Item[] = kept.current.flatMap((id): Item[] => {
    const done = decided.get(id);
    if (done) return [{ id, kind: "decided", decided: done }];
    const suggestion = readyById.get(id);
    if (suggestion) return [{ id, kind: "open", suggestion }];
    return [{ id, kind: "outdated", headline: seen.current.get(id) ?? "" }];
  });
  const open = items.filter(
    (item): item is Extract<Item, { kind: "open" }> => item.kind === "open",
  );
  const current =
    items.find((item) => item.id === selected && item.kind !== "decided") ??
    open[0] ??
    null;
  const selectedId = current?.id ?? null;
  const live = receipts.current.filter((id) => decided.get(id)?.live);
  const latestReceipt = live.at(-1);

  useSlidingHighlight(list, highlight, selectedId);

  // The drawing of the selected change; it needs the sidebar's own data.
  const base = useMemo(
    () => miniatureBase(sidebar),
    // The sidebar's pieces, not the object, which is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sidebar.projection,
      sidebar.catalog,
      sidebar.sort,
      sidebar.manualOrder,
      sidebar.sections,
      sidebar.now,
    ],
  );
  const delta = current?.kind === "open" ? current.suggestion.delta : null;
  const drawing: Miniature | null = useMemo(
    () => (base && delta ? miniature({ ...base, delta }) : null),
    [base, delta],
  );

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  /** Focus goes to the selected suggestion, or the drop-down on a compact viewport. */
  const focusSelected = useCallback(() => {
    requestAnimationFrame(() => {
      const row = [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? []),
      ].find((el) => el.dataset.pick === selectedIdRef.current);
      (row ?? trigger.current ?? accept.current)?.focus({
        preventScroll: true,
      });
    });
  }, []);
  focusInitial.current = focusSelected;
  useEffect(() => {
    // Radix focuses the dialog itself, and the drawer has no such hook.
    if (compact) focusSelected();
  }, [compact, focusSelected]);

  const forget = (ids: readonly string[]) => {
    for (const id of ids) {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
    }
    receipts.current = receipts.current.filter((id) => !ids.includes(id));
    setDecided((was) => {
      const next = new Map(was);
      for (const id of ids) next.delete(id);
      return next;
    });
  };
  const settle = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        receipts.current = receipts.current.filter((other) => other !== id);
        setDecided((was) => {
          const entry = was.get(id);
          return entry ? new Map(was).set(id, { ...entry, live: false }) : was;
        });
      }, DECIDED_MS),
    );
  };
  /** The undecided change after `id` in the list, else the first other one. */
  const nextAfter = (id: string) => {
    const at = open.findIndex((item) => item.id === id);
    const rest = open.filter((item) => item.id !== id);
    return (rest[at] ?? rest[0])?.id ?? null;
  };

  const decide = async (list: readonly Suggestion[], decision: Decision) => {
    if (list.length === 0) return;
    const ids = list.map((s) => s.id);
    setDecided((was) => {
      const next = new Map(was);
      for (const s of list)
        next.set(s.id, {
          decision,
          headline: s.headline,
          done: false,
          live: false,
        });
      return next;
    });
    const following = list.length === 1 ? nextAfter(ids[0]!) : null;
    setSelected(following);
    if (following) focusAccept();
    try {
      const result = await rpc.call("suggestionsDecide", { ids, decision });
      setState(result.state);
      const applied = list.filter((s) => result.applied.includes(s.id));
      setDecided((was) => {
        const next = new Map(was);
        for (const s of list)
          if (result.applied.includes(s.id))
            next.set(s.id, {
              decision,
              headline: s.headline,
              done: true,
              live: true,
              entryId: result.entries[s.id],
            });
          else next.delete(s.id);
        return next;
      });
      for (const s of applied) {
        receipts.current = [...receipts.current, s.id];
        settle(s.id);
      }
      setAnnouncement(
        `${decision === "accept" ? "Accepted" : "Declined"}: ${
          applied.length === 1
            ? applied[0]!.headline
            : plural(applied.length, "suggestion")
        }. Undo is available.`,
      );
      if (applied.length && !following) focusUndo(applied.at(-1)!.id);
      for (const failure of result.failed)
        toast.error(`Couldn't apply: ${failure.reason}`);
    } catch (cause) {
      toast.error(message(cause));
      forget(ids);
    }
  };
  const focusAccept = () =>
    requestAnimationFrame(() => accept.current?.focus({ preventScroll: true }));
  const focusUndo = (id: string) =>
    requestAnimationFrame(() =>
      [...(root.current?.querySelectorAll<HTMLElement>("[data-undo]") ?? [])]
        .find((el) => el.dataset.undo === id)
        ?.focus({ preventScroll: true }),
    );

  const undo = async (id: string) => {
    const entry = decided.get(id);
    if (!entry?.live) return;
    forget([id]);
    setSelected(id);
    setAnnouncement(`Undone: ${entry.headline}.`);
    focusSelected();
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

  // The last decision's Undo has gone: nothing is left to review or undo.
  const settled =
    decided.size > 0 &&
    open.length === 0 &&
    [...decided.values()].every((entry) => entry.done && !entry.live);
  useEffect(() => {
    if (settled) onClose();
  }, [settled, onClose]);

  const step = (dir: 1 | -1) => {
    if (open.length === 0) return;
    const at = open.findIndex((item) => item.id === selectedId);
    const next = open[(at + dir + open.length) % open.length]!;
    setSelected(next.id);
    if (!compact)
      requestAnimationFrame(() =>
        [...(root.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? [])]
          .find((el) => el.dataset.pick === next.id)
          ?.focus({ preventScroll: true }),
      );
    setAnnouncement(`Showing ${next.suggestion.headline}`);
  };
  const decideAll = (decision: Decision) =>
    void decide(
      open.map((item) => item.suggestion),
      decision,
    );

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    // Keys from inside the review, or from the dialog around it or the page
    // when no control holds focus (a button left); never from a menu or a field.
    const mine =
      root.current?.contains(target) ||
      ((target === document.body || target.contains(root.current)) &&
        root.current?.closest('[role="dialog"]'));
    if (
      !mine ||
      target.closest('textarea, input, [contenteditable="true"], [role="menu"]')
    )
      return;
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      target.closest("[data-list]")
    ) {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    const key = event.key.toLowerCase();
    if (!["a", "d", "u", "j", "k"].includes(key)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (key === "j") step(1);
    else if (key === "k") step(-1);
    else if (key === "u") {
      if (latestReceipt) void undo(latestReceipt);
    } else if (current?.kind === "open")
      void decide([current.suggestion], key === "a" ? "accept" : "decline");
  };

  // The modal holds focus, so the keys are the document's while it is open;
  // the handler it calls is the latest render's.
  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", listen);
    return () => document.removeEventListener("keydown", listen);
  }, []);

  const canDecide = current?.kind === "open";
  const title =
    current?.kind === "open"
      ? current.suggestion.headline
      : current?.kind === "outdated"
        ? current.headline
        : "";
  const position = open.findIndex((item) => item.id === selectedId);

  const menu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Hint label="More actions">
          <button
            type="button"
            aria-label="More actions"
            className={ICON_BUTTON}
          >
            <Icon name="MoreHorizontal" className="size-4" aria-hidden />
          </button>
        </Hint>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...portalScope}
          align="end"
          sideOffset={4}
          className={menuSurfaceClass("48")}
        >
          {open.length > 1 ? (
            <>
              <DropdownMenu.Item
                className={MENU_ITEM_CLASS}
                onSelect={() => decideAll("accept")}
              >
                Accept all
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={MENU_ITEM_CLASS}
                onSelect={() => decideAll("decline")}
              >
                Reject all
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
            </>
          ) : null}
          <DropdownMenu.Item
            className={MENU_ITEM_CLASS}
            onSelect={onOpenTopics}
          >
            Open Topics
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const rows = items.map((item) => {
    if (item.kind === "decided")
      return (
        <DecidedRow
          key={item.id}
          id={item.id}
          decided={item.decided}
          latest={item.id === latestReceipt}
          onUndo={() => void undo(item.id)}
        />
      );
    const outdated = item.kind === "outdated";
    const headline = outdated ? item.headline : item.suggestion.headline;
    return (
      <li key={item.id}>
        <button
          type="button"
          data-pick={item.id}
          aria-current={item.id === selectedId}
          tabIndex={item.id === selectedId ? 0 : -1}
          onClick={() => setSelected(item.id)}
          className={cn(
            ROW,
            "cursor-pointer text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            outdated && "text-muted-foreground/70",
          )}
        >
          {headline}
          {outdated ? <span className="sr-only"> (out of date)</span> : null}
        </button>
      </li>
    );
  });

  const decideButtons = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1.5",
        compact && "flex-1 pb-1.5",
        !current && "invisible",
      )}
    >
      {current?.kind === "open" ? (
        <DebugThreadButton
          subject={suggestionSubject(current.suggestion, "the sidebar")}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={!canDecide}
        aria-label={title ? `Decline: ${title}` : "Decline"}
        aria-keyshortcuts="D"
        onClick={() =>
          current?.kind === "open" &&
          void decide([current.suggestion], "decline")
        }
        className={cn(
          "h-7 gap-2 px-3 text-[13px] text-foreground",
          compact && "h-[34px] flex-1",
        )}
      >
        Decline
        <Key>D</Key>
      </Button>
      <Button
        ref={accept}
        type="button"
        disabled={!canDecide}
        aria-label={title ? `Accept: ${title}` : "Accept"}
        aria-keyshortcuts="A"
        onClick={() =>
          current?.kind === "open" &&
          void decide([current.suggestion], "accept")
        }
        className={cn(
          "h-7 gap-2 px-3 text-[13px] font-medium",
          compact && "h-[34px] flex-1",
        )}
      >
        <Icon name="Check" className="!size-3.5" aria-hidden />
        Accept
        <Key filled>A</Key>
      </Button>
    </div>
  );

  const stage =
    current?.kind === "open" ? (
      drawing ? (
        <SuggestionMiniatures
          key={current.id}
          model={drawing}
          compact={compact}
          summary={`${current.suggestion.headline}. ${
            drawing.flows.length
              ? drawing.flows
                  .map(
                    (f) =>
                      `${plural(f.threads.length, "thread")} to ${
                        f.to.prefix ? `${f.to.prefix}: ` : ""
                      }${f.to.name}`,
                  )
                  .join("; ") + "."
              : "No thread in the sidebar moves."
          }`}
        />
      ) : (
        <Placeholder>
          {base
            ? "The sidebar can't be drawn for this suggestion."
            : "Loading…"}
        </Placeholder>
      )
    ) : current?.kind === "outdated" ? (
      <Placeholder>This suggestion is out of date</Placeholder>
    ) : (
      <Placeholder>
        {loadError
          ? "Couldn't load suggestions"
          : state
            ? "No suggestions waiting"
            : "Loading…"}
      </Placeholder>
    );

  const listBody = items.length ? (
    <div ref={list} data-list="" className="relative">
      <div
        ref={highlight}
        aria-hidden
        className="absolute inset-x-0 rounded-md bg-state-hover opacity-0 transition-[top,height] duration-[180ms] ease-[cubic-bezier(.2,.7,.2,1)]"
      />
      <ul aria-label="Pending suggestions" className="m-0 list-none p-0">
        {rows}
      </ul>
    </div>
  ) : null;

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col text-[13px]">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 border-b border-border pl-4 pr-2",
          compact ? "h-9" : "h-10",
        )}
      >
        <DialogTitle className="m-0 mr-auto text-[13px] leading-none font-medium tracking-normal">
          Organizing suggestions
        </DialogTitle>
        {menu}
        <Hint label="Close">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={ICON_BUTTON}
          >
            <Icon name="X" className="size-4" aria-hidden />
          </button>
        </Hint>
      </div>
      <div className={cn("flex min-h-0 flex-1", compact && "flex-col")}>
        {compact ? (
          <div className="relative shrink-0 border-b border-border px-2 py-1.5">
            {items
              .filter((item) => item.kind === "decided")
              .map((item) =>
                item.decided.live ? (
                  <ul key={item.id} className="m-0 list-none p-0">
                    <DecidedRow
                      id={item.id}
                      decided={item.decided}
                      latest={false}
                      onUndo={() => void undo(item.id)}
                    />
                  </ul>
                ) : null,
              )}
            {current ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    ref={trigger}
                    type="button"
                    className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-[7px] text-left text-[13px] leading-[18px] text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1">{title}</span>
                    {open.length > 1 && position >= 0 ? (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {position + 1} of {open.length}
                      </span>
                    ) : null}
                    <Icon
                      name="ChevronDown"
                      className="mt-0.5 size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    {...portalScope}
                    align="start"
                    sideOffset={2}
                    collisionPadding={8}
                    className={cn(
                      menuSurfaceClass("48"),
                      "max-h-[min(340px,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto",
                    )}
                  >
                    {items
                      .filter((item) => item.kind !== "decided")
                      .map((item) => (
                        <DropdownMenu.Item
                          key={item.id}
                          className={cn(
                            MENU_ITEM_CLASS,
                            "items-start py-[7px] text-[13px] leading-[18px]",
                            item.kind === "outdated" &&
                              "text-muted-foreground/70",
                          )}
                          onSelect={() => setSelected(item.id)}
                        >
                          {item.kind === "open"
                            ? item.suggestion.headline
                            : item.kind === "outdated"
                              ? item.headline
                              : null}
                        </DropdownMenu.Item>
                      ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </div>
        ) : (
          <div className="flex w-[424px] shrink-0 flex-col border-r border-border">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {listBody}
            </div>
            {open.length > 1 ? (
              <div className="mx-1.5 flex shrink-0 gap-1 border-t border-border px-1 pb-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => decideAll("accept")}
                  className={TEXT_BUTTON}
                >
                  Accept all
                </button>
                <button
                  type="button"
                  onClick={() => decideAll("decline")}
                  className={TEXT_BUTTON}
                >
                  Reject all
                </button>
              </div>
            ) : null}
          </div>
        )}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            compact ? "px-3 pb-1.5 pt-2" : "pb-2.5 pl-5 pr-4 pt-3.5",
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-start gap-4",
              compact ? "mb-1" : "mb-2.5 border-b border-border pb-3.5 pt-0.5",
            )}
          >
            <h3
              key={selectedId ?? "none"}
              className={cn(
                "m-0 min-w-0 flex-1 animate-in fade-in-0 text-[15px] leading-[22px] font-semibold text-pretty duration-150 motion-reduce:animate-none",
                compact && "hidden",
              )}
            >
              {title}
            </h3>
            {decideButtons}
          </div>
          {stage}
        </div>
      </div>
      {stale > 0 ? (
        <div className="flex h-9 shrink-0 items-center border-t border-border px-4 text-xs text-muted-foreground">
          {stale} out of date
        </div>
      ) : null}
    </div>
  );
}

const ROW =
  "relative block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] leading-[18px] text-pretty";

const ICON_BUTTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-state-active data-[state=open]:text-foreground";

const TEXT_BUTTON =
  "h-6 shrink-0 cursor-pointer rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function Placeholder({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="m-auto text-center text-xs text-muted-foreground"
    >
      {children}
    </p>
  );
}

/**
 * A decided suggestion's line. It keeps the row's place and height; Undo
 * leaves when its time is up, and the line dims.
 */
function DecidedRow({
  id,
  decided,
  latest,
  onUndo,
}: {
  id: string;
  decided: Decided;
  latest: boolean;
  onUndo: () => void;
}) {
  const declined = decided.decision === "decline";
  return (
    <li
      className={cn(
        "relative flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] leading-[18px] animate-in fade-in-0 duration-150 motion-reduce:animate-none",
        decided.live ? "text-muted-foreground" : "text-muted-foreground/70",
      )}
    >
      <Icon
        name={declined ? "X" : "Check"}
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          !declined && "text-[var(--ws-complete-text)]",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "min-w-0 flex-1 text-pretty",
          declined && "line-through decoration-muted-foreground/50",
        )}
      >
        <span className="sr-only">
          {declined ? "Declined: " : "Accepted: "}
        </span>
        {decided.headline}
      </span>
      {decided.live ? (
        <button
          type="button"
          data-undo={id}
          onClick={onUndo}
          className="flex h-[18px] shrink-0 cursor-pointer items-center gap-1.5 rounded px-1 text-xs text-(--ws-suggestions-text) hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Undo
          {latest ? <Key>U</Key> : null}
        </button>
      ) : null}
    </li>
  );
}
