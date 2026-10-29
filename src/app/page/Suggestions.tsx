/**
 * Organizing suggestions on the Organization tab, in the sidebar's terms:
 * groups and the threads in them. Each is a headline naming what moves and
 * where, the change in a line or two, and its reason in one. They are listed
 * by what accepting does: moves threads (biggest first), tidies groups
 * without moving a thread, or can't apply anymore (collapsed). Nothing
 * changes until you accept one; a declined suggestion isn't proposed again.
 */
import { useCallback, useEffect, useState } from "react";
import { useRealtime, type useRpc } from "@get-bb/plugin-sdk/app";
import type {
  RpcContract,
  SuggestionsStateWire,
} from "../../server/contract.ts";
import { relativeAgeLabel } from "../../domain/presentation.ts";
import { ghostButton, primaryButton, secondaryButton } from "./controls.ts";
import { movesThreads } from "../../domain/suggestion-change.ts";
import { SuggestionChangeBody } from "./SuggestionChange.tsx";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;
type Suggestion = SuggestionsStateWire["suggestions"][number];

const DECIDED: Record<Exclude<Suggestion["status"], "pending">, string> = {
  accepted: "Accepted",
  declined: "Declined",
  stale: "Not applied",
};

export function Suggestions({
  rpc,
  onChanged,
}: {
  rpc: Rpc;
  /** An accepted suggestion changed topics. */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      setState((await rpc.call("suggestions", null)).state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);
  useEffect(() => {
    void read();
  }, [read]);
  useRealtime("changed", () => void read());

  const act = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      void read();
    }
  };
  const decide = (ids: string[], decision: "accept" | "decline") =>
    act(async () => {
      const result = await rpc.call("suggestionsDecide", { ids, decision });
      setState(result.state);
      if (decision === "accept" && result.applied.length) onChanged?.();
      return result.failed.length
        ? result.failed.map((f) => `Couldn't apply: ${f.reason}`).join(" ")
        : null;
    });
  const ask = () =>
    act(async () => {
      const result = await rpc.call("suggestionsRun", null);
      setState(result.state);
      return result.state.suggestions.some((s) => s.status === "pending")
        ? null
        : "No suggestions: your groups look tidy.";
    });

  if (!state) return null;
  const pending = state.suggestions.filter((s) => s.status === "pending");
  const recent = state.suggestions
    .filter((s) => s.status !== "pending")
    .slice(0, 5);
  const ready = pending.filter((s) => !s.problem);
  const weight = (s: Suggestion) =>
    s.change?.moves.reduce((n, m) => n + m.threads.length + m.carried, 0) ?? 0;
  // A thread suggestion whose threads are gone still lists with the moves.
  const tidies = (s: Suggestion) =>
    s.change !== null &&
    !["refile", "split", "file"].includes(s.change.op) &&
    !movesThreads(s.change);
  const moving = ready
    .filter((s) => !tidies(s))
    .sort((a, b) => weight(b) - weight(a));
  const tidying = ready.filter(tidies);
  const stale = pending.filter((s) => s.problem);
  const running = busy || state.running;

  return (
    <section
      aria-label="Organizing suggestions"
      className="rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-sm font-semibold">Suggestions</h2>
          <p className="text-xs text-muted-foreground">
            Nothing changes until you accept one.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ready.length > 1 ? (
            <button
              type="button"
              className={secondaryButton}
              disabled={running}
              onClick={() =>
                void decide(
                  ready.map((s) => s.id),
                  "accept",
                )
              }
            >
              Accept all {ready.length}
            </button>
          ) : null}
          <button
            type="button"
            className={ghostButton}
            disabled={running}
            onClick={() => void ask()}
          >
            {state.running ? "Asking…" : "Ask now"}
          </button>
        </div>
      </div>
      {pending.length ? (
        <>
          {moving.length ? (
            <SuggestionList
              title="Moves threads"
              suggestions={moving}
              running={running}
              decide={decide}
            />
          ) : null}
          {tidying.length ? (
            <SuggestionList
              title="Tidies groups"
              note="no threads move"
              suggestions={tidying}
              running={running}
              decide={decide}
            />
          ) : null}
          {stale.length ? (
            <details className="group/stale mt-5">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground [&::-webkit-details-marker]:hidden">
                Out of date ({stale.length})
                <span className="font-normal tracking-normal normal-case">
                  · the groups changed since; ask again for fresh ones
                </span>
              </summary>
              <ul className="mt-1 divide-y divide-border">
                {stale.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-x-4 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground">{s.headline}</p>
                      <p className="text-muted-foreground/70">{s.problem}</p>
                    </div>
                    <button
                      type="button"
                      className={ghostButton}
                      disabled={running}
                      aria-label={`Decline: ${s.headline}`}
                      onClick={() => void decide([s.id], "decline")}
                    >
                      Decline
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No suggestions right now
          {state.lastRunAt
            ? `; last checked ${relativeAgeLabel(state.lastRunAt, Date.now())}`
            : ""}
          .
        </p>
      )}
      {recent.length ? (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer list-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            Recently decided ({recent.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {recent.map((s) => (
              <li key={s.id}>
                <span className="font-medium">
                  {DECIDED[s.status as keyof typeof DECIDED]}:
                </span>{" "}
                {s.summary}
                {s.status === "stale" && s.problem ? ` (${s.problem})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 text-xs">
        {message ?? ""}
      </p>
      {error || state.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error ?? `The last run failed: ${state.error}`}
        </p>
      ) : null}
    </section>
  );
}

function SuggestionList({
  title,
  note,
  suggestions,
  running,
  decide,
}: {
  title: string;
  note?: string;
  suggestions: Suggestion[];
  running: boolean;
  decide: (ids: string[], decision: "accept" | "decline") => Promise<void>;
}) {
  return (
    <section aria-label={title} className="mt-5">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title} ({suggestions.length})
        {note ? (
          <span className="font-normal tracking-normal normal-case">
            {" "}
            · {note}
          </span>
        ) : null}
      </h3>
      <ul className="divide-y divide-border">
        {suggestions.map((s) => (
          <li key={s.id} className="py-3">
            <div className="flex items-center gap-x-4">
              <h4 className="min-w-0 flex-1 text-[13px] font-medium">
                {s.headline}
              </h4>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className={ghostButton}
                  disabled={running}
                  aria-label={`Decline: ${s.headline}`}
                  onClick={() => void decide([s.id], "decline")}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={running}
                  aria-label={`Accept: ${s.headline}`}
                  onClick={() => void decide([s.id], "accept")}
                >
                  Accept
                </button>
              </div>
            </div>
            {s.change ? (
              <div className="mt-1">
                <SuggestionChangeBody change={s.change} />
              </div>
            ) : null}
            {s.reason ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                {s.reason}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
