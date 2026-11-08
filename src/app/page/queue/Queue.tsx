/**
 * The queue: the Workstreams page shows one thing at a time that needs the
 * user, Up Next's threads in the sidebar's ranking and then the organizer's
 * suggestions. Acting on an item applies at once, leaves a receipt with Undo
 * above the next item, and moves on. When Up Next is clear the page says so
 * and offers the earlier open threads.
 *
 * The order is kept while the page is open (`keepOrder`), so nothing jumps
 * while the user works. The card stack's top edge sits at a fixed share of the
 * page's height and the heading in a fixed place just above it (`layout.ts`);
 * the replies and actions follow the card and the page grows downward. A
 * receipt (drawn in the margin above the heading), Reply, and ⇧ never move
 * anything. Only a new item whose heading wraps to more lines moves the card,
 * gliding down by the difference (`useQueueMotion`); resizing the window moves
 * both with the page's height. The heading and the receipt crossfade to the
 * next ones with a small drift in the direction of travel.
 *
 * The next items wait as a stack of cards behind the card, peeking out above
 * it. Acting moves on to the next. ↓ and → (or J) step to the next item and ↑
 * and ← (or K) to the previous one without acting, as do the footer's arrows,
 * one card at a time while a key is held.
 *
 * Keys: 1–3 send a reply (⇧ edits it first), R reply, S snooze (1–6 in its
 * menu), E archive, O open, U undo, ↓ → skip ahead, ↑ ← skip back.
 */
import { KeyChip } from "../../primitives/KeyChip.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useSidebarThreadActions,
  useRealtime,
  useRpc,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type {
  RpcContract,
  SuggestionsStateWire,
} from "../../../server/contract.ts";
import { keepOrder, planFeed } from "../../../domain/feed.ts";
import type { Row } from "../../../domain/project.ts";
import { isRunning } from "../../../domain/upNext.ts";
import { relativeAge } from "../../../domain/presentation.ts";
import { describeWake, type SnoozeWhen } from "../../../domain/snooze.ts";
import { colorForWorkstream } from "../../../domain/workstreamColor.ts";
import type { RecapFiles } from "../../../domain/recap.ts";
import { prioritizedSet } from "../../home/model.ts";
import { usePrefs } from "../../prefs.ts";
import { useRecapPrefs } from "../../recap/prefs.ts";
import { HashColors } from "../../composer/RecapCard.tsx";
import { CustomSnoozeDialog } from "../../snooze/CustomSnoozeDialog.tsx";
import type { useWorkstreams } from "../../useWorkstreams.ts";
import { actionMessage, cardOf, nextActionsOf } from "./card.ts";
import {
  Answers,
  CardStack,
  Composer,
  Heading,
  SUGGESTION_FRAME,
  SuggestionCard,
  ThreadActions,
  ThreadCard,
  threadFrame,
  type QueueHeading,
  type StackCard,
  type SuggestionMove,
} from "./QueueItem.tsx";
import { HEADING_BLOCK_MIN_HEIGHT, PAGE_TOP } from "./layout.ts";
import { useQueueMotion, type Direction } from "./motion.ts";
import { STACK_WINDOW } from "./stackEngine.ts";
import { useQueueActions, type Receipt } from "./useQueueActions.ts";

type Workstreams = ReturnType<typeof useWorkstreams>;
type Suggestion = SuggestionsStateWire["suggestions"][number];

/** A suggestion's queue key, kept apart from thread ids. */
export const suggestionKey = (id: string) => `suggestion:${id}`;

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const ago = (at: number, now: number) => {
  const age = relativeAge(at, now);
  return age === "now" ? "now" : `${age} ago`;
};

/** The organizer's pending suggestions that can apply now. */
function useSuggestions(ws: Workstreams) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const read = useCallback(async () => {
    try {
      setState((await ws.rpc.call("suggestions", null)).state);
    } catch {
      // The queue still works without suggestions.
    }
  }, [ws.rpc]);
  useEffect(() => {
    void read();
  }, [read]);
  useRealtime("changed", () => void read());
  const ready = useMemo(
    () =>
      (state?.suggestions ?? []).filter(
        (s) => s.status === "pending" && !s.problem && s.change,
      ),
    [state],
  );
  return { ready, all: state?.suggestions ?? [], setState };
}

/** Where each recap's files live, read once per thread for its file links. */
function useRecapFiles(threadId: string | null, hasRecap: boolean) {
  const rpc = useRpc<RpcContract>();
  const [files, setFiles] = useState<Record<string, RecapFiles>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!threadId || !hasRecap || asked.current.has(threadId)) return;
    asked.current.add(threadId);
    rpc
      .call("recapFiles", { threadIds: [threadId] })
      .then(({ files: read }) => setFiles((was) => ({ ...was, ...read })))
      .catch(() => {});
  }, [rpc, threadId, hasRecap]);
  return threadId ? (files[threadId] ?? null) : null;
}

/** Whether ⇧ is held, for the replies' edit state. */
function useShiftHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Shift") setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Shift") setHeld(false);
    };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return held;
}

function suggestionMoves(s: Suggestion): SuggestionMove[] {
  const byTopic = new Map<string, SuggestionMove>();
  for (const move of s.change?.moves ?? []) {
    const leaf = move.to.at(-1);
    const to = leaf?.name ?? "Top level";
    const entry = byTopic.get(to) ?? {
      to,
      created: leaf?.created ?? false,
      threads: [],
    };
    byTopic.set(to, {
      ...entry,
      threads: [...entry.threads, ...move.threads.map((t) => t.title)],
    });
  }
  return [...byTopic.values()];
}

const movingCount = (s: Suggestion) =>
  s.change?.moves.reduce((n, m) => n + m.threads.length + m.carried, 0) ?? 0;

/** The topic a suggestion reshapes: where its threads come from. */
function suggestionPath(s: Suggestion): string | null {
  const from = s.change?.moves.find((m) => m.from)?.from;
  const place = from ?? s.change?.moves[0]?.to.slice(0, -1);
  return place?.length ? place.map((part) => part.name).join(": ") : null;
}

export function Queue({
  ws,
  onTopics,
}: {
  ws: Workstreams;
  /** Opens the topic tree, from the workstream line. */
  onTopics: () => void;
}) {
  const rpc = useRpc<RpcContract>();
  const { prefs } = usePrefs();
  const { prefs: recapPrefs } = useRecapPrefs();
  const threadActions = experimental_useSidebarThreadActions();
  const actions = useQueueActions();
  const suggestions = useSuggestions(ws);
  const shift = useShiftHeld();
  const [earlier, setEarlier] = useState(false);
  const [replying, setReplying] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [customSnooze, setCustomSnooze] = useState(false);
  const { projection, now } = ws;

  const plan = useMemo(
    () =>
      planFeed(projection, {
        ...ws.upNextOptions,
        prioritized: prioritizedSet(ws.server.order, ws.sections),
        groupSort: prefs?.sidebar.groupSort ?? "alphabetical",
        topics: ws.topics,
      }),
    [
      projection,
      ws.upNextOptions,
      ws.server.order,
      ws.sections,
      prefs?.sidebar.groupSort,
      ws.topics,
    ],
  );
  const rowOf = useMemo(() => {
    const rows = new Map<string, Row<PluginSidebarThread>>();
    for (const row of [...plan.upNext, ...plan.earlier])
      rows.set(row.thread.id, row);
    return rows;
  }, [plan]);
  // An item acted on may leave every list (archived), so its last known
  // row is kept for its receipt and for Undo.
  const lastRow = useRef(new Map<string, Row<PluginSidebarThread>>());
  for (const [id, row] of rowOf) lastRow.current.set(id, row);
  const suggestionOf = useMemo(
    () =>
      new Map(suggestions.all.map((s) => [suggestionKey(s.id), s] as const)),
    [suggestions.all],
  );

  // A sent thread's message counts as handled once a turn after it ends.
  const { sent, receipt, cleared } = actions;
  useEffect(() => {
    for (const [id, sentMessage] of sent) {
      const row = rowOf.get(id);
      const holding = receipt?.itemId === id && receipt.holding;
      if (
        !holding &&
        row &&
        !isRunning(row.thread) &&
        row.thread.latestAttentionAt > sentMessage.at
      )
        actions.finishSent(id);
    }
  }, [sent, rowOf, receipt, actions]);

  const live = [
    ...plan.upNext.map((row) => row.thread.id),
    ...suggestions.ready.map((s) => suggestionKey(s.id)),
    ...(earlier ? plan.earlier.map((row) => row.thread.id) : []),
  ];
  const kept = useRef<string[]>([]);
  kept.current = keepOrder(kept.current, live);
  const remaining = kept.current.filter(
    (id) => !cleared.has(id) && (rowOf.has(id) || suggestionOf.has(id)),
  );
  // The item shown: where the user skipped to, else the first left.
  const current =
    cursor && remaining.includes(cursor) ? cursor : (remaining[0] ?? null);
  const position = current ? remaining.indexOf(current) : -1;
  const earlierLeft = plan.earlier.filter(
    (row) => !cleared.has(row.thread.id),
  ).length;

  const thread = current ? rowOf.get(current)?.thread : undefined;
  const suggestion = current ? suggestionOf.get(current) : undefined;
  const card = thread
    ? cardOf(
        thread,
        ws.work(thread),
        ws.server.recaps[thread.id],
        sent.get(thread.id),
        isRunning(thread),
      )
    : null;
  const files = useRecapFiles(thread?.id ?? null, card?.kind === "recap");
  const threadAnswers = card ? nextActionsOf(card).map(actionMessage) : [];
  const answers = suggestion
    ? [`Accept and move ${movingCount(suggestion)} threads`, "Decline"]
    : threadAnswers;

  // The pile: the shown item and the next ones, as cards.
  const pile = current
    ? remaining.slice(position, position + STACK_WINDOW)
    : [];
  const motion = useQueueMotion(current, pile, position > 0);

  /** Shows another item: the next after acting or skipping, or one back. */
  const go = (id: string | null, toward: Direction) => {
    motion.capture(toward);
    setCursor(id);
    setReplying(null);
    setSnoozeOpen(false);
  };
  /** Moves past an item being acted on, to the one after it. */
  const moveOn = (id: string) => {
    const at = remaining.indexOf(id);
    go(remaining[at + 1] ?? remaining[at - 1] ?? null, "forward");
  };
  const skip = (step: 1 | -1) => {
    const next = remaining[position + step];
    const toward = step === 1 ? "forward" : "back";
    // A held key moves one card at a time, and takes no more than two ahead.
    if (next && motion.accept(toward)) go(next, toward);
  };
  const undo = () => {
    const id = actions.undo();
    if (id) go(id, "back");
  };

  const titleOf = (id: string) =>
    (rowOf.get(id) ?? lastRow.current.get(id))?.thread.displayTitle ?? "";

  const send = (id: string, text: string, recapId?: string) => {
    moveOn(id);
    actions.send({ id, title: titleOf(id) }, text, () =>
      recapId
        ? rpc.call("recap_send", { threadId: id, recapId, action: text })
        : rpc.call("threadSend", { threadId: id, text }),
    );
  };
  const archive = (id: string) => {
    moveOn(id);
    actions.apply(
      { itemId: id, kind: "archived", title: titleOf(id), detail: "" },
      () => rpc.call("threadArchive", { threadId: id }),
      () => rpc.call("threadUnarchive", { threadId: id }),
    );
  };
  const snooze = (id: string, when: SnoozeWhen) => {
    const target = rowOf.get(id)?.thread;
    if (!target) return;
    moveOn(id);
    const previous = ws.server.snoozes[id];
    actions.apply(
      {
        itemId: id,
        kind: "snoozed",
        title: target.displayTitle,
        detail: describeWake(when.until, Date.now(), when.events),
      },
      () => ws.setSnoozes([target], when),
      () =>
        ws.setSnoozes(
          [target],
          previous
            ? { until: previous.until, events: previous.events === true }
            : "wake",
        ),
    );
  };
  const decide = (s: Suggestion, decision: "accept" | "decline") => {
    let entryId: string | undefined;
    moveOn(suggestionKey(s.id));
    actions.apply(
      {
        itemId: suggestionKey(s.id),
        kind: decision === "accept" ? "accepted" : "declined",
        title: s.headline,
        detail: "",
      },
      async () => {
        const result = await ws.rpc.call("suggestionsDecide", {
          ids: [s.id],
          decision,
        });
        suggestions.setState(result.state);
        const failure = result.failed[0];
        if (failure) throw new Error(`Couldn't apply: ${failure.reason}`);
        entryId = result.entries[s.id];
      },
      async () => {
        const result = await ws.rpc.call("suggestionsReopen", {
          id: s.id,
          ...(entryId ? { entryId } : {}),
        });
        suggestions.setState(result.state);
      },
    );
  };
  const answer = (index: number, edit: boolean) => {
    if (suggestion) {
      if (index < 2) decide(suggestion, index === 0 ? "accept" : "decline");
      return;
    }
    if (!thread || !card || sent.has(thread.id)) return;
    const text = threadAnswers[index];
    if (text === undefined) return;
    if (edit) return setReplying({ id: thread.id, text });
    send(thread.id, text, card.kind === "recap" ? card.recap.id : undefined);
  };
  const open = (id: string) => {
    try {
      threadActions.open(id);
    } catch (cause) {
      toast.error(message(cause));
    }
  };

  // Keys act on the current item, unless typing, in a dialog, or in a menu.
  const keys = useRef({
    answer,
    archive,
    open,
    thread,
    suggestion,
    undo,
    skip,
  });
  keys.current = { answer, archive, open, thread, suggestion, undo, skip };
  useEffect(() => {
    // The skip key held down; letting it go, or leaving the window, ends the hold.
    let heldKey: string | null = null;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
        )
      )
        return;
      const k = keys.current;
      // The replies and thread actions answer only once they are visible and live.
      const actions = motion.page.current?.querySelector<HTMLElement>(
        '[data-queue-part="actions"]',
      );
      const acting =
        !!actions &&
        !actions.hasAttribute("inert") &&
        Number(actions.style.opacity || 1) >= 0.5;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      const key = event.key.toLowerCase();
      if (key === "u") k.undo();
      else if (key === "arrowdown" || key === "arrowright" || key === "j") {
        // The first press of a key starts the hold; the OS repeats continue it.
        if (!event.repeat) {
          heldKey = key;
          motion.hold("forward");
        }
        k.skip(1);
      } else if (key === "arrowup" || key === "arrowleft" || key === "k") {
        if (!event.repeat) {
          heldKey = key;
          motion.hold("back");
        }
        k.skip(-1);
      } else if (!acting) return;
      else if (digit) k.answer(Number(digit) - 1, event.shiftKey);
      else if (!k.thread || k.suggestion) return;
      else if (key === "r") setReplying({ id: k.thread.id, text: "" });
      else if (key === "s") setSnoozeOpen(true);
      else if (key === "e") k.archive(k.thread.id);
      else if (key === "o") k.open(k.thread.id);
      else return;
      event.preventDefault();
    };
    const onUp = (event: KeyboardEvent) => {
      if (heldKey === null || event.key.toLowerCase() !== heldKey) return;
      heldKey = null;
      motion.release();
    };
    const onBlur = () => {
      heldKey = null;
      motion.release();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hashColors = useMemo(
    () => ({
      digits: recapPrefs?.hashDigits ?? null,
      letters: recapPrefs?.hashLetters ?? null,
    }),
    [recapPrefs?.hashDigits, recapPrefs?.hashLetters],
  );

  const heading: QueueHeading | null = thread
    ? (() => {
        const row = rowOf.get(thread.id);
        const path = plan.place.get(thread.id)?.path ?? [];
        return {
          path: path.length ? path.join(": ") : null,
          color: row?.workstreamId
            ? colorForWorkstream(row.workstreamId, ws.server.catalog)
            : null,
          title: thread.displayTitle,
        };
      })()
    : suggestion
      ? {
          path: suggestionPath(suggestion),
          color: null,
          title: suggestion.headline,
        }
      : null;
  /** An item's card, for the pile. */
  const stackCard = (id: string): StackCard | null => {
    const row = rowOf.get(id)?.thread;
    if (row) {
      const shownCard =
        id === thread?.id
          ? card
          : cardOf(
              row,
              ws.work(row),
              ws.server.recaps[id],
              sent.get(id),
              isRunning(row),
            );
      return shownCard
        ? {
            key: id,
            frame: threadFrame(shownCard),
            node: (
              <ThreadCard
                card={shownCard}
                threadId={id}
                files={id === thread?.id ? files : null}
                age={ago(row.latestAttentionAt, now)}
              />
            ),
          }
        : null;
    }
    const s = suggestionOf.get(id);
    return s
      ? {
          key: id,
          frame: SUGGESTION_FRAME,
          node: (
            <SuggestionCard
              reason={s.reason}
              moving={movingCount(s)}
              moves={suggestionMoves(s)}
            />
          ),
        }
      : null;
  };
  // A card leaving the pile (an item acted on has left the feed) is drawn as
  // it last was until the motion has taken it out of sight.
  const retained = useRef(new Map<string, StackCard>());
  const cards = pile.flatMap((id) => stackCard(id) ?? []);
  for (const card of cards) retained.current.set(card.key, card);
  const leaving = motion
    .held()
    .filter((key) => !pile.includes(key))
    .flatMap((key) => retained.current.get(key) ?? []);
  for (const key of retained.current.keys())
    if (
      !cards.some((c) => c.key === key) &&
      !leaving.some((c) => c.key === key)
    )
      retained.current.delete(key);

  const archiveLeads =
    card?.kind === "recap" &&
    card.recap.state === "complete" &&
    threadAnswers.length === 0;

  return (
    <HashColors.Provider value={hashColors}>
      <div className="relative h-full min-h-0 flex-1">
        <div
          ref={motion.page}
          className="absolute inset-0 overflow-y-auto [container-type:size] [scrollbar-gutter:stable] data-[moving]:overflow-y-hidden"
        >
          <div
            className="mx-auto box-border w-full max-w-[720px] px-5 pb-24 pt-[var(--ws-queue-top)]"
            style={{ "--ws-queue-top": PAGE_TOP } as React.CSSProperties}
          >
            <div ref={motion.content} className="relative">
              <div style={{ minHeight: HEADING_BLOCK_MIN_HEIGHT }}>
                <ReceiptLine receipt={receipt} onUndo={undo} />
                {heading ? (
                  <div key={current} data-queue-part="heading">
                    <Heading
                      heading={heading}
                      onPath={heading.path ? onTopics : undefined}
                    />
                  </div>
                ) : null}
              </div>
              <div ref={motion.unit}>
                {cards.length || leaving.length ? (
                  <CardStack
                    cards={[...cards, ...leaving]}
                    stage={motion.stage}
                  />
                ) : null}
                <div key={`actions:${current}`} data-queue-part="actions">
                  {thread && card ? (
                    <>
                      {replying?.id === thread.id ? (
                        <Composer
                          title={thread.displayTitle}
                          initial={replying.text}
                          onCancel={() => setReplying(null)}
                          onSend={(text) => send(thread.id, text)}
                        />
                      ) : (
                        <>
                          <Answers
                            answers={answers}
                            editable
                            shift={shift}
                            onAnswer={answer}
                          />
                          <ThreadActions
                            archiveLeads={archiveLeads}
                            snoozeOpen={snoozeOpen}
                            now={now}
                            snoozePrefs={ws.snoozePrefs}
                            onSnoozeOpen={setSnoozeOpen}
                            onReply={() =>
                              setReplying({ id: thread.id, text: "" })
                            }
                            onSnooze={(when) => snooze(thread.id, when)}
                            onCustomSnooze={() => setCustomSnooze(true)}
                            onArchive={() => archive(thread.id)}
                            onOpen={() => open(thread.id)}
                          />
                        </>
                      )}
                    </>
                  ) : suggestion ? (
                    <>
                      <Answers
                        answers={answers}
                        editable={false}
                        shift={false}
                        onAnswer={answer}
                      />
                    </>
                  ) : (
                    <div className="text-center">
                      <p className="text-[22px] font-[450] tracking-[-0.015em] text-foreground/75">
                        {earlier
                          ? "Nothing else is open."
                          : "Nothing needs you right now."}
                      </p>
                      {!earlier && earlierLeft > 0 ? (
                        <button
                          type="button"
                          onClick={() => setEarlier(true)}
                          className="mt-3 cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
                        >
                          Go through {earlierLeft} earlier thread
                          {earlierLeft === 1 ? "" : "s"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              {/* The old heading and replies, drawn over the page while they fade. */}
              <div
                ref={motion.ghosts}
                aria-hidden
                className="pointer-events-none absolute inset-0 z-20"
              />
            </div>
          </div>
        </div>
        {remaining.length ? (
          <nav
            aria-label="Queue"
            className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-2 text-[13px] text-muted-foreground/80"
          >
            <SkipButton
              label="Previous"
              icon="ChevronUp"
              disabled={position <= 0}
              onClick={() => skip(-1)}
            />
            <span className="min-w-14 text-center tabular-nums">
              <span className="text-muted-foreground">{position + 1}</span> of{" "}
              {remaining.length}
            </span>
            <SkipButton
              label="Next"
              icon="ChevronDown"
              disabled={position >= remaining.length - 1}
              onClick={() => skip(1)}
            />
          </nav>
        ) : null}
      </div>
      <CustomSnoozeDialog
        open={customSnooze}
        onClose={() => setCustomSnooze(false)}
        onSubmit={(when) => {
          setCustomSnooze(false);
          if (thread) snooze(thread.id, when);
        }}
      />
    </HashColors.Provider>
  );
}

/** Steps through the queue without acting: ← and → (or K and J). */
function SkipButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}

/** The latest action, above the next item, with Undo while it can be. */
function ReceiptLine({
  receipt,
  onUndo,
}: {
  receipt: Receipt | null;
  onUndo: () => void;
}) {
  if (!receipt) return null;
  const title = <span className="text-foreground/80">{receipt.title}</span>;
  const text =
    receipt.kind === "sent" ? (
      <>Sent to {title}</>
    ) : receipt.kind === "archived" ? (
      <>Archived {title}</>
    ) : receipt.kind === "snoozed" ? (
      <>
        Snoozed {title} {receipt.detail}
      </>
    ) : receipt.kind === "accepted" ? (
      <>Accepted {title}</>
    ) : (
      <>Declined {title}</>
    );
  return (
    <div
      role="status"
      data-queue-part="receipt"
      data-receipt-key={`${receipt.itemId}:${receipt.kind}`}
      className={cn(
        "absolute inset-x-0 -top-[30px] flex h-5 min-w-0 items-center gap-3 text-[13px] text-muted-foreground",
      )}
    >
      <span className="min-w-0 truncate">{text}</span>
      {receipt.undoable ? (
        <button
          type="button"
          onClick={onUndo}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-foreground/80 hover:text-foreground"
        >
          Undo <KeyChip>U</KeyChip>
        </button>
      ) : null}
    </div>
  );
}
