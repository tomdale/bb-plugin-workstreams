import { QUESTION_CARD_CLASS } from "./question-presentation.tsx";
/**
 * The AskUserQuestion card, drawn above the composer where the recap card
 * goes, in the recap card's style.
 *
 * BB mounts a plugin's form only inside its pending-interaction shell, and
 * only that mount receives `submit`, `cancel`, and the host's answer
 * shortcuts. So the form stays mounted there and renders through a portal
 * into an anchor the `QuestionAnchor` composer banner provides; while it
 * does, styles.css hides the shell (it holds only the `ws-question-portaled`
 * marker). Without an anchor, as in a composer that shows no banners, the
 * form renders inside the shell as usual.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  useComposer,
  useRpc,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { interactionPayloadSchema } from "../../server/questions/contracts.ts";
import { QuestionForm } from "./question-form.tsx";
import { usePendingQuestion } from "./pending.ts";
import { useSidebarThread } from "../useStableSidebarThreads.ts";
import type { RpcContract } from "../../server/contract.ts";
import type { JsonValue } from "@get-bb/plugin-sdk";

/** Banner anchors by thread; one composer per thread shows banners. */
const anchors = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
function setAnchor(threadId: string, node: HTMLElement | null) {
  if (node) anchors.set(threadId, node);
  else if (anchors.has(threadId)) anchors.delete(threadId);
  else return;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function useAnchor(threadId: string): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => anchors.get(threadId) ?? null,
    () => null,
  );
}

/**
 * The composer banner that holds the card. It goes first in the stack, in
 * the recap card's place; the recap hides while a question is pending.
 *
 * A card outlives its turn so an interrupted question stays answerable. It
 * does not outlive the user writing their own message instead, which
 * supersedes the question; that send closes the card.
 *
 * Dismiss hides the card and leaves the question open, as a recap card's
 * dismissal does: Show question brings it back, and the agent keeps waiting
 * until the user answers or sends a message.
 */
export function QuestionAnchor() {
  const composer = useComposer();
  const { scope } = composer;
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const pending = usePendingQuestion(threadId);
  const native = useSidebarThread(threadId)?.hasPendingInteraction === true;
  const rpc = useRpc<RpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recover = async (
    value: Parameters<typeof rpc.call<"question_recover">>[1]["value"],
    dismiss: boolean,
  ) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.call("question_recover", {
        threadId: pending.threadId,
        id: pending.id,
        value,
        dismiss,
      });
    } catch {
      setError("Couldn't send your answer.");
      setBusy(false);
    }
  };
  const recoverable = Boolean(pending?.recoverable) && !native;
  const showsCard = recoverable && !pending?.hidden;
  const answersInOwnWords = recoverable || Boolean(pending?.hidden);
  useEffect(() => {
    if (!answersInOwnWords || !pending) return;
    // A recovered or dismissed card leaves the composer free to send, so a
    // submission here is the user answering the thread in their own words.
    return composer.onSubmitted(() => {
      void rpc
        .call(recoverable ? "question_recover" : "question_answer", {
          threadId: pending.threadId,
          id: pending.id,
          value: null,
          dismiss: true,
        })
        // A question resolved elsewhere simply closes on the next poll.
        .catch(() => undefined);
    });
  }, [composer, pending, rpc, recoverable, answersInOwnWords]);
  const setHidden = (hidden: boolean) => {
    if (!pending) return;
    setError(null);
    void rpc
      .call("question_hide", {
        threadId: pending.threadId,
        id: pending.id,
        hidden,
      })
      .catch(() =>
        setError(
          hidden
            ? "Couldn't dismiss the question."
            : "Couldn't show the question.",
        ),
      );
  };
  const anchorRef = useCallback(
    (node: HTMLElement | null) => {
      if (!threadId) return;
      setAnchor(threadId, node);
      return () => setAnchor(threadId, null);
    },
    [threadId],
  );
  return (
    <div ref={anchorRef} className="contents">
      {showsCard && pending ? (
        <div
          className={QUESTION_CARD_CLASS}
          role="region"
          aria-label="Question needs your answer"
          data-ws-question-card=""
        >
          <QuestionForm
            key={pending.id}
            persistenceKey={pending.id}
            questions={pending.payload.questions}
            disabled={busy}
            cancelDisabled={busy}
            onSubmit={(answers) => void recover({ answers }, false)}
            onCancel={() => setHidden(true)}
            error={error}
          />
        </div>
      ) : null}
      {pending?.hidden ? (
        // Like Show recap: a zero-height anchor whose button floats over the
        // thread's bottom edge and takes no space of its own.
        <div className="relative mx-auto h-0 w-full max-w-4xl">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute bottom-3 right-1 h-8 gap-2 rounded-full border-border bg-background px-3.5 text-xs font-medium text-foreground shadow-md hover:bg-accent max-md:pointer-coarse:h-10"
            onClick={() => setHidden(false)}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-current text-(--ws-needs-input-text)"
            />
            Show question
          </Button>
          {error ? (
            <p role="alert" className="sr-only">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function QuestionInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => interactionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const anchor = useAnchor(interaction.threadId);
  const pending = usePendingQuestion(interaction.threadId);
  const rpc = useRpc<RpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleCancel = () => {
    setBusy(true);
    setError(null);
    void cancel()
      .catch(() => setError("Couldn't dismiss the question."))
      .finally(() => setBusy(false));
  };
  /** Dismiss hides the card; the question stays open (see QuestionAnchor). */
  const handleDismiss = () => {
    if (!pending) return handleCancel();
    setError(null);
    void rpc
      .call("question_hide", {
        threadId: pending.threadId,
        id: pending.id,
        hidden: true,
      })
      .catch(() => setError("Couldn't dismiss the question."));
  };
  const alert = error ? (
    <p role="alert" className="mt-2 text-xs text-(--ws-failed-text)">
      {error}
    </p>
  ) : null;
  const body = parsed.success ? (
    <>
      <QuestionForm
        key={interaction.id}
        persistenceKey={
          typeof (interaction.payload as { durableId?: unknown }).durableId ===
          "string"
            ? (interaction.payload as { durableId: string }).durableId
            : undefined
        }
        questions={parsed.data.questions}
        disabled={busy}
        cancelDisabled={busy}
        onSubmit={(answers) => {
          setBusy(true);
          setError(null);
          void submit(
            JSON.parse(JSON.stringify({ answers })) as JsonValue,
          ).catch(() => {
            setError("Couldn't send your answer.");
            setBusy(false);
          });
        }}
        onCancel={handleDismiss}
        error={error}
      />
    </>
  ) : (
    <>
      <p className="text-[14px] text-muted-foreground max-md:pointer-coarse:text-base">
        This question could not be displayed.
      </p>
      {alert}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={busy}
        onClick={handleCancel}
      >
        Dismiss
      </Button>
    </>
  );
  if (!anchor) return <div className="text-foreground">{body}</div>;
  return (
    <>
      <span className="ws-question-portaled" hidden />
      {pending?.hidden
        ? null
        : createPortal(
            <div
              className={QUESTION_CARD_CLASS}
              role="region"
              aria-label="Question needs your answer"
              data-ws-question-card=""
              // First in the composer stack, like the recap card it replaces.
              style={{ order: -1 }}
            >
              {body}
            </div>,
            anchor,
          )}
    </>
  );
}
