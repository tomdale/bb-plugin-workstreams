import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import type { usePendingQuestion } from "./pending.ts";
import { QuestionForm } from "./question-form.tsx";

type Pending = NonNullable<ReturnType<typeof usePendingQuestion>>;

export function QueueQuestion({
  pending,
  projectId,
  onAnswered,
}: {
  pending: Pending;
  projectId: string;
  onAnswered: (dismissed: boolean) => void;
}) {
  const rpc = useRpc<RpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (
    value: Parameters<typeof rpc.call<"question_answer">>[1]["value"],
    dismiss: boolean,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Dismissing hides the card and leaves the question open, as the
      // thread's own card does.
      if (dismiss)
        await rpc.call("question_hide", {
          threadId: pending.threadId,
          id: pending.id,
          hidden: true,
        });
      else
        await rpc.call("question_answer", {
          threadId: pending.threadId,
          id: pending.id,
          value,
          dismiss,
        });
      onAnswered(dismiss);
    } catch {
      setError(
        dismiss
          ? "Couldn't dismiss the question."
          : "Couldn't send your answer.",
      );
      setBusy(false);
    }
  };
  return (
    <section
      data-queue-question
      role="region"
      aria-label="Question needs your answer"
    >
      <QuestionForm
        persistenceKey={pending.id}
        projectId={projectId}
        questions={pending.payload.questions}
        disabled={busy}
        cancelDisabled={busy}
        error={error}
        onSubmit={(answers) => void answer({ answers }, false)}
        onCancel={() => void answer(null, true)}
      />
    </section>
  );
}
