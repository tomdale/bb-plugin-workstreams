/**
 * The Topics view: the organizer's health, the organizing suggestions waiting
 * for a decision, and the topic tree.
 *
 * Each suggestion is a block of rows (Thread or Group · Now · After) in one
 * grid, so the columns align down the page: **Threads move** lists those that
 * change threads' groups, **Groups change** those that only reshape the tree,
 * and **Out of date** (collapsed) those that can't apply now. Accept and
 * Decline show on the focused or hovered block. A decision applies at once
 * and leaves a line in its place with Undo; `j`/`k` move between blocks and
 * `a`/`d`/`u` accept, decline, and undo. Threads with no topic follow the
 * suggestions, each with a topic picker.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePortalScopeProps } from "@/lib/portal-scope";
import type {
  OrganizerState,
  SuggestionsStateWire,
} from "../../../server/contract.ts";
import { relativeAge } from "../../../domain/presentation.ts";
import { keepOrder } from "../../../domain/feed.ts";
import {
  ledgerKind,
  ledgerRows,
  type LedgerRow,
} from "../../../domain/ledger.ts";
import { ghostButton, primaryButton, secondaryButton } from "../controls.ts";
import { TaskIdentity } from "../../task/TaskIdentity.tsx";
import { Reclassification } from "../Reclassification.tsx";
import type { useWorkstreams } from "../../useWorkstreams.ts";
import { TopicTree } from "./TopicTree.tsx";
import { ProjectSuggestions } from "./ProjectSuggestions.tsx";

type Workstreams = ReturnType<typeof useWorkstreams>;
type Suggestion = SuggestionsStateWire["suggestions"][number];
type Decided = {
  decision: "accept" | "decline";
  /** The accepted suggestion's Activity entry, for Undo. */
  entryId?: string;
};

/** How long a decision's line, with Undo, stays in its block's place. */
const DECIDED_MS = 6_000;

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

function useOrganizer(ws: Workstreams) {
  const [organizer, setOrganizer] = useState<OrganizerState | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsStateWire | null>(
    null,
  );
  const read = useCallback(async () => {
    const [o, s] = await Promise.allSettled([
      ws.rpc.call("organization", { action: "get" }),
      ws.rpc.call("suggestions", null),
    ]);
    if (o.status === "fulfilled") setOrganizer(o.value.state);
    if (s.status === "fulfilled") setSuggestions(s.value.state);
  }, [ws.rpc]);
  useEffect(() => {
    void read();
  }, [read]);
  useRealtime("changed", () => void read());
  const working =
    organizer?.status === "classifying" ||
    organizer?.status === "deriving" ||
    organizer?.status === "syncing" ||
    suggestions?.running === true;
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void read(), 1000);
    return () => clearInterval(timer);
  }, [working, read]);
  return { organizer, suggestions, setSuggestions, read, working };
}

export function TopicsTab({ ws, query }: { ws: Workstreams; query: string }) {
  const { organizer, suggestions, setSuggestions, read } = useOrganizer(ws);
  const [decided, setDecided] = useState<ReadonlyMap<string, Decided>>(
    new Map(),
  );
  const [focus, setFocus] = useState<string | null>(null);
  const [showStale, setShowStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [repairs, setRepairs] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const last = useRef<string | null>(null);
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const pending = (suggestions?.suggestions ?? []).filter(
    (s) => s.status === "pending",
  );
  const byId = new Map(
    (suggestions?.suggestions ?? []).map((s) => [s.id, s] as const),
  );
  const ready = pending.filter((s) => !s.problem && s.change);
  const stale = pending.filter((s) => s.problem);
  // Blocks keep their place while the page is open, a decided one included.
  const kept = useRef<string[]>([]);
  const weight = (s: Suggestion) =>
    s.change?.moves.reduce((n, m) => n + m.threads.length + m.carried, 0) ?? 0;
  const live = [
    ...[...ready].sort((a, b) => weight(b) - weight(a)).map((s) => s.id),
    ...[...decided.keys()],
  ];
  kept.current = keepOrder(kept.current, live);
  const listed = kept.current
    .map((id) => byId.get(id))
    .filter((s): s is Suggestion => s?.change != null);
  const threads = listed.filter((s) => ledgerKind(s.change!) === "threads");
  const groups = listed.filter((s) => ledgerKind(s.change!) === "groups");
  const open = (list: Suggestion[]) => list.filter((s) => !decided.has(s.id));
  const order = [...threads, ...groups].map((s) => s.id);
  const focusable = order.filter((id) => !decided.has(id));
  const focused =
    focus && focusable.includes(focus) ? focus : (focusable[0] ?? null);

  const settle = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setDecided((was) => {
          const next = new Map(was);
          next.delete(id);
          return next;
        });
      }, DECIDED_MS),
    );
  };
  const decide = async (ids: string[], decision: "accept" | "decline") => {
    if (!ids.length) return;
    const after = order.slice(order.indexOf(ids.at(-1)!) + 1);
    setFocus(after.find((id) => !decided.has(id) && !ids.includes(id)) ?? null);
    setDecided((was) => {
      const next = new Map(was);
      for (const id of ids) next.set(id, { decision });
      return next;
    });
    last.current = ids.at(-1)!;
    try {
      const result = await ws.rpc.call("suggestionsDecide", { ids, decision });
      setSuggestions(result.state);
      setDecided((was) => {
        const next = new Map(was);
        for (const id of ids)
          if (result.applied.includes(id))
            next.set(id, { decision, entryId: result.entries[id] });
          else next.delete(id);
        return next;
      });
      for (const id of result.applied) settle(id);
      for (const failure of result.failed)
        toast.error(`Couldn't apply: ${failure.reason}`);
    } catch (cause) {
      toast.error(message(cause));
      setDecided((was) => {
        const next = new Map(was);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };
  const undo = async (id: string) => {
    const entry = decided.get(id);
    if (!entry) return;
    clearTimeout(timers.current.get(id));
    setDecided((was) => {
      const next = new Map(was);
      next.delete(id);
      return next;
    });
    setFocus(id);
    try {
      const result = await ws.rpc.call("suggestionsReopen", {
        id,
        ...(entry.entryId ? { entryId: entry.entryId } : {}),
      });
      setSuggestions(result.state);
    } catch (cause) {
      toast.error(message(cause));
      void read();
    }
  };
  const rerun = async () => {
    setBusy(true);
    try {
      const result = await ws.rpc.call("suggestionsRun", null);
      setSuggestions(result.state);
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const rebuild = async () => {
    setBusy(true);
    try {
      const result = await ws.rpc.call("organization", { action: "rebuild" });
      void result;
      void read();
    } catch (cause) {
      toast.error(message(cause));
    } finally {
      setBusy(false);
    }
  };

  // Keys: the focused block's decisions, unless typing or in a dialog.
  const keys = useRef({ focusable, focused, decide, undo });
  keys.current = { focusable, focused, decide, undo };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
        )
      )
        return;
      const { focusable, focused, decide, undo } = keys.current;
      const at = focused ? focusable.indexOf(focused) : -1;
      if (event.key === "j" || event.key === "k") {
        const next =
          event.key === "j"
            ? focusable[Math.min(focusable.length - 1, at + 1)]
            : focusable[Math.max(0, at - 1)];
        if (next) setFocus(next);
      } else if ((event.key === "a" || event.key === "d") && focused)
        void decide([focused], event.key === "a" ? "accept" : "decline");
      else if (event.key === "u" && last.current) void undo(last.current);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unresolved = organizer?.unresolved ?? [];
  const ledger = (
    title: string,
    note: string | null,
    subject: string,
    list: Suggestion[],
    extra?: React.ReactNode,
  ) =>
    list.length || extra ? (
      <section aria-label={title} className="mt-8">
        <h2 className="mb-1.5 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
            {open(list).length + (extra ? unresolved.length : 0)}
            {note ? ` · ${note}` : ""}
          </span>
        </h2>
        <div
          className={cn(
            GRID,
            "px-2 pb-1 pl-[19px] text-[11px] text-muted-foreground/70 max-[560px]:hidden",
          )}
        >
          <span>{subject}</span>
          <span>Now</span>
          <span>After</span>
        </div>
        <div className="-mx-2">
          {list.map((s) =>
            decided.has(s.id) ? (
              <DecidedLine
                key={s.id}
                suggestion={s}
                decided={decided.get(s.id)!}
                onUndo={() => void undo(s.id)}
              />
            ) : (
              <Block
                key={s.id}
                suggestion={s}
                focused={focused === s.id}
                onFocus={() => setFocus(s.id)}
                onDecide={(decision) => void decide([s.id], decision)}
              />
            ),
          )}
          {extra}
        </div>
      </section>
    ) : null;

  return (
    <div className="mt-6 text-[13px]">
      <Health
        organizer={organizer}
        suggestions={suggestions}
        busy={busy}
        readyCount={open(listed).length}
        onAcceptAll={() =>
          void decide(
            open(listed).map((s) => s.id),
            "accept",
          )
        }
        onRerun={() => void rerun()}
        onRebuild={() => void rebuild()}
        onRepairs={() => setRepairs(true)}
      />
      {ledger(
        "Threads move",
        null,
        "Thread",
        threads,
        unresolved.length ? (
          <>
            {unresolved.map((task) => (
              <div
                key={task.id}
                className={cn(
                  GRID,
                  BLOCK,
                  "border-t border-border first:border-t-0",
                )}
              >
                <span className="min-w-0 font-medium">{task.title}</span>
                <span className="truncate italic text-muted-foreground/70">
                  Unfiled
                </span>
                <span className="min-w-0">
                  <TaskIdentity threadId={task.id} />
                </span>
                {task.reason ? (
                  <p className="col-span-full mt-1 text-xs text-muted-foreground">
                    {task.reason}
                  </p>
                ) : null}
              </div>
            ))}
          </>
        ) : undefined,
      )}
      {ledger("Groups change", "no threads move", "Group", groups)}
      {stale.length ? (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showStale}
            onClick={() => setShowStale(!showStale)}
            className="cursor-pointer py-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            {stale.length} out of date
          </button>
          {showStale ? (
            <ul className="mt-1">
              {stale.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 py-1 text-xs text-muted-foreground/80"
                >
                  <span className="min-w-0 flex-1">
                    {s.headline} · {s.problem}
                  </span>
                  <button
                    type="button"
                    className={ghostButton}
                    onClick={() => void decide([s.id], "decline")}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ProjectSuggestions ws={ws} />
      <TopicTree ws={ws} query={query} />
      <p className="mt-7 text-[11px] text-muted-foreground/70 max-md:pointer-coarse:hidden">
        <Kbd>j</Kbd> <Kbd>k</Kbd> move · <Kbd>a</Kbd> accept · <Kbd>d</Kbd>{" "}
        decline · <Kbd>u</Kbd> undo
      </p>
      <RepairsDialog
        open={repairs}
        onOpenChange={setRepairs}
        ws={ws}
        threadIds={[
          ...(organizer?.groups ?? []).flatMap((g) => g.roots.map((r) => r.id)),
          ...unresolved.map((r) => r.id),
        ]}
        onApplied={() => void read()}
      />
    </div>
  );
}

/** One grid for every block, so Now and After align down the page. */
const GRID =
  "grid grid-cols-[minmax(0,1fr)_9.5rem_13.5rem] items-baseline gap-x-4 max-[560px]:grid-cols-[auto_minmax(0,1fr)]";
const BLOCK = "relative gap-y-[3px] rounded-md px-2 py-2.5 pl-[19px]";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[3px] border border-border px-1 font-sans">
      {children}
    </kbd>
  );
}

function Block({
  suggestion,
  focused,
  onFocus,
  onDecide,
}: {
  suggestion: Suggestion;
  focused: boolean;
  onFocus: () => void;
  onDecide: (decision: "accept" | "decline") => void;
}) {
  const rows: LedgerRow[] = ledgerRows(suggestion.change!);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={suggestion.headline}
      aria-current={focused || undefined}
      onClick={onFocus}
      className={cn(
        GRID,
        BLOCK,
        "group/block border-t border-border first:border-t-0",
        focused && "bg-state-hover",
      )}
    >
      {rows.length > 1 ? (
        <span
          aria-hidden
          className="absolute bottom-[42px] left-2 top-3.5 border-l border-border"
        />
      ) : null}
      {rows.map((row, index) => (
        <LedgerLine key={index} row={row} />
      ))}
      <div className="col-span-full mt-1 flex min-h-[26px] items-center gap-3">
        <p className="m-0 min-w-0 flex-1 text-xs text-muted-foreground">
          {suggestion.reason}
          {suggestion.arrivals.length ? (
            <span>
              {" "}
              Also files {suggestion.arrivals.map((t) => t.title).join(", ")},
              which joined since.
            </span>
          ) : null}
        </p>
        <div
          className={cn(
            "shrink-0 items-center gap-1",
            focused
              ? "flex"
              : "hidden group-hover/block:flex group-focus-within/block:flex pointer-coarse:flex",
          )}
        >
          <button
            type="button"
            className={ghostButton}
            aria-label={`Decline: ${suggestion.headline}`}
            onClick={(event) => {
              event.stopPropagation();
              onDecide("decline");
            }}
          >
            Decline
          </button>
          <button
            type="button"
            className={focused ? primaryButton : secondaryButton}
            aria-label={`Accept: ${suggestion.headline}`}
            onClick={(event) => {
              event.stopPropagation();
              onDecide("accept");
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

function LedgerLine({ row }: { row: LedgerRow }) {
  return (
    <>
      <span className="min-w-0 font-medium max-[560px]:col-span-full">
        {row.subject}
      </span>
      <span
        className={cn(
          "truncate text-muted-foreground/70",
          row.unfiled && "italic",
        )}
      >
        {row.now}
      </span>
      <span className="truncate text-foreground">
        <span aria-hidden className="mr-2 text-muted-foreground/70">
          →
        </span>
        <span className="sr-only">to </span>
        {row.verb ? (
          <span className="text-muted-foreground/70">{row.verb} </span>
        ) : null}
        {row.after}
        {row.created ? (
          <span className="ml-1.5 text-[11px] text-(--ws-complete-strong)">
            new
          </span>
        ) : null}
      </span>
    </>
  );
}

function DecidedLine({
  suggestion,
  decided,
  onUndo,
}: {
  suggestion: Suggestion;
  decided: Decided;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-t border-border px-2 py-2.5 pl-[11px] text-muted-foreground/70 first:border-t-0"
    >
      <span className="min-w-0 truncate">
        {decided.decision === "accept"
          ? `✓ ${suggestion.headline}`
          : `Declined: ${suggestion.headline}`}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Undo
      </button>
    </div>
  );
}

function Health({
  organizer,
  suggestions,
  busy,
  readyCount,
  onAcceptAll,
  onRerun,
  onRebuild,
  onRepairs,
}: {
  organizer: OrganizerState | null;
  suggestions: SuggestionsStateWire | null;
  busy: boolean;
  readyCount: number;
  onAcceptAll: () => void;
  onRerun: () => void;
  onRebuild: () => void;
  onRepairs: () => void;
}) {
  const portalScope = usePortalScopeProps();
  const status = organizer?.status ?? "idle";
  const progress = organizer?.progress;
  const working =
    status === "classifying" || status === "deriving" || status === "syncing";
  const asking = suggestions?.running === true;
  const at = suggestions?.lastRunAt ?? organizer?.lastUpdatedAt ?? null;
  const text =
    status === "classifying"
      ? `Analyzing threads ${progress?.completed ?? 0} of ${progress?.total ?? 0}`
      : working
        ? "Updating workstreams"
        : status === "failed"
          ? `Organizing stopped${organizer?.error ? `: ${organizer.error}` : ""}`
          : asking
            ? "Asking for suggestions…"
            : `Workstreams up to date${at ? ` · last checked ${relativeAge(at, Date.now())} ago`.replace(" now ago", " just now") : ""}`;
  return (
    <div className="flex flex-wrap items-center gap-2 gap-y-1 text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "failed"
            ? "bg-(--ws-failure)"
            : working || asking
              ? "animate-pulse bg-(--ws-waiting)"
              : "bg-(--ws-complete)",
        )}
      />
      <span role="status" className="min-w-0">
        {text}
      </span>
      <span className="flex-1" />
      {readyCount > 1 ? (
        <button
          type="button"
          className={ghostButton}
          disabled={busy}
          onClick={onAcceptAll}
        >
          Accept all {readyCount}
        </button>
      ) : null}
      <button
        type="button"
        className={ghostButton}
        disabled={busy || asking || working}
        onClick={status === "failed" ? onRebuild : onRerun}
      >
        {status === "failed" ? "Try again" : "Re-run"}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="More organizing actions"
            className={cn(ghostButton, "px-1.5")}
          >
            <Icon name="MoreHorizontal" className="size-4" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            {...portalScope}
            align="end"
            sideOffset={4}
            className="z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-md"
          >
            <DropdownMenu.Item
              disabled={busy || working}
              onSelect={onRebuild}
              className="cursor-pointer rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
            >
              Rebuild
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={onRepairs}
              className="cursor-pointer rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent"
            >
              Review automatic topics…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function RepairsDialog({
  open,
  onOpenChange,
  ws,
  threadIds,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ws: Workstreams;
  threadIds: string[];
  onApplied: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Review automatic topics</DialogTitle>
          <DialogDescription>
            Preview topic repairs for automatically filed threads.
          </DialogDescription>
        </DialogHeader>
        <Reclassification
          rpc={ws.rpc}
          threadIds={threadIds}
          onApplied={onApplied}
        />
      </DialogContent>
    </Dialog>
  );
}
