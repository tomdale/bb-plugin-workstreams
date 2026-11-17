/**
 * A workstream's tracked pull requests, above its threads. Each row reads like
 * GitHub's own list: the branch glyph, the number and title, then the
 * repository and an explicit status word on the line below. A workstream with
 * none draws nothing, so its threads sit where they always did.
 *
 * The list selects its own pull requests from the shared store, so a poll that
 * changes one pull request renders that row and no other part of the sidebar.
 */
import { memo, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TrackedPullRequest } from "../../domain/pullRequests.ts";
import { useClock } from "../clock.ts";
import {
  isStale,
  pullRequestShape,
  pullRequestsOf,
  repositoryName,
  rowLabel,
  statusWord,
  PULL_REQUEST_RANK,
} from "../pullRequests/model.ts";
import { useOpenPullRequest } from "../pullRequests/route.ts";
import { usePullRequestSelector } from "../pullRequests/store.ts";
import { PULL_REQUEST_ICON } from "../workstream-icon.ts";
import type { PullRequestScopes } from "./pullRequestGroups.ts";

/** What the sidebar tells its pull request lists: who draws what, and how to open one. */
export type PullRequestPlacement = {
  readonly scopes: PullRequestScopes;
  readonly open: (id: string) => void;
};

export function PullRequestList({
  groupId,
  placement,
}: {
  groupId: string;
  placement: PullRequestPlacement;
}) {
  const scope = placement.scopes[groupId];
  const key = scope?.join("\n") ?? "";
  const items = usePullRequestSelector(
    (state) =>
      scope?.length ? pullRequestsOf(state.items, new Set(scope)) : [],
    key,
  );
  if (items.length === 0) return null;
  const digits = Math.max(...items.map((pr) => String(pr.number).length));
  return (
    <li className="list-none [&:last-child>ul]:mb-0">
      {/* 12px below the list separates it from the threads; a workstream
          with no pull requests draws no list, so adds none, and a list with
          nothing after it needs no space below. */}
      <ul
        aria-label="Pull requests"
        className="mb-3 mt-[3px] grid gap-0.5"
        style={{ "--ws-pr-digits": digits } as CSSProperties}
      >
        {items.map((pr) => (
          <PullRequestRow key={pr.id} pr={pr} open={placement.open} />
        ))}
      </ul>
    </li>
  );
}

const PullRequestRow = memo(function PullRequestRow({
  pr,
  open,
}: {
  pr: TrackedPullRequest;
  open: (id: string) => void;
}) {
  const current = useOpenPullRequest(pr.id);
  const word = useClock((now) => statusWord(pr, now));
  const label = useClock((now) => rowLabel(pr, now));
  const stale = isStale(pr);
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => open(pr.id)}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        data-status={pr.status}
        data-attention={PULL_REQUEST_RANK[pr.status] < 2 ? "" : undefined}
        className={cn("ws-row ws-pr-row", current && "ws-row-active")}
      >
        <span className="ws-pr-mark" aria-hidden>
          <Icon
            name={PULL_REQUEST_ICON[pullRequestShape(pr.status)]}
            aria-hidden
            className="size-2.5"
          />
        </span>
        <span className="ws-pr-number" aria-hidden>
          #{pr.number}
        </span>
        <span className="ws-pr-title ws-text-thread" aria-hidden>
          {pr.title}
        </span>
        <span className="ws-pr-meta" aria-hidden>
          <span className="ws-pr-repository">
            {repositoryName(pr.repository)}
          </span>
          <span className="ws-pr-status" data-stale={stale ? "" : undefined}>
            {stale ? "Can’t refresh" : word}
          </span>
        </span>
      </button>
    </li>
  );
});
