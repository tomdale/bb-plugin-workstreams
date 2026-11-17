/**
 * A tracked pull request, read-only: its status and why, the checks with their
 * results and durations, the description, and the facts around it. The one
 * way out is "Open on GitHub", which hands the canonical address to BB's
 * browser preference; nothing here merges, closes, or reviews.
 *
 * A failed read never blanks the view. It shows the last status GitHub gave,
 * with a banner naming the machine that reads the pull request and the
 * reason it can't. A merged or closed one says when it leaves the sidebar.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ThreadTitle,
  UrlLink,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type {
  PullRequestCheck,
  TrackedPullRequest,
} from "../../../domain/pullRequests.ts";
import type { RpcContract } from "../../../server/contract.ts";
import { relativeAgeLabel } from "../../../domain/presentation.ts";
import { useNow } from "../../useWorkstreams.ts";
import { useSidebarThread } from "../../useStableSidebarThreads.ts";
import {
  CHECK_STATE_LABEL,
  checkDuration,
  isSettled,
  isStale,
  pullRequestShape,
  safeExternalUrl,
  sortChecks,
  statusDetail,
  statusHeading,
} from "../../pullRequests/model.ts";
import {
  usePullRequest,
  usePullRequestRefresh,
  usePullRequestSelector,
} from "../../pullRequests/store.ts";
import { setOpenPullRequest } from "../../pullRequests/route.ts";
import {
  CHECK_FAILED_ICON,
  CHECK_PASSED_ICON,
  PULL_REQUEST_ICON,
} from "../../workstream-icon.ts";
import { BackButton } from "../overview/Overview.tsx";

const TEXT = "text-[13px] leading-[1.45]";
const HEADING = "m-0 mb-1.5 mt-7 text-[13px] font-semibold leading-[1.3]";

/** The page around a pull request: the back control, then what `children` say. */
function Frame({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="@container/pr mx-auto box-border w-full max-w-3xl px-5 pb-16 pt-6 md:px-8">
        <BackButton onClick={onBack} />
        {children}
      </div>
    </div>
  );
}

export function PullRequestView({
  id,
  onBack,
}: {
  /** A tracked pull request's id, as the sidebar row opens it. */
  id: string;
  onBack: () => void;
}) {
  const pr = usePullRequest(id);
  const status = usePullRequestSelector((state) => state.status);
  const refresh = usePullRequestRefresh();
  // The sidebar marks the pull request whose view is open.
  useEffect(() => {
    setOpenPullRequest(id);
    return () => setOpenPullRequest(null);
  }, [id]);
  // Opening a pull request asks the server to read it now, so the view starts
  // from the freshest status rather than the last poll's.
  useEffect(() => {
    void refresh(id);
  }, [id, refresh]);

  if (!pr) {
    const message =
      status === "loading"
        ? "Loading pull request…"
        : status === "error"
          ? "Couldn’t load pull requests."
          : "This pull request is no longer tracked. A merged or closed one leaves the sidebar after an hour.";
    return (
      <Frame onBack={onBack}>
        <p
          role={status === "error" ? "alert" : "status"}
          className={cn("mt-10 text-muted-foreground", TEXT)}
        >
          {message}
        </p>
      </Frame>
    );
  }
  return (
    <Frame onBack={onBack}>
      <PullRequestDetail pr={pr} />
    </Frame>
  );
}

function PullRequestDetail({ pr }: { pr: TrackedPullRequest }) {
  const now = useNow(30_000);
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening a pull request from the sidebar moves reading to its title.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [pr.id]);
  const url = safeExternalUrl(pr.url);
  const stale = isStale(pr);
  const settled = isSettled(pr);
  const files = `${pr.changedFiles} ${pr.changedFiles === 1 ? "file" : "files"}`;
  return (
    <article aria-labelledby={`pr-title-${pr.id}`} className="mt-3">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-[1_1_15rem]">
          <h1
            ref={heading}
            id={`pr-title-${pr.id}`}
            tabIndex={-1}
            className="m-0 text-[15px] font-semibold leading-[1.35] tracking-tight [overflow-wrap:anywhere] outline-none"
          >
            {pr.title}
          </h1>
          <p className="m-0 mt-0.5 text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
            {pr.repository} #{pr.number}
          </p>
        </div>
        {url ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <UrlLink href={url}>Open on GitHub</UrlLink>
          </Button>
        ) : null}
      </header>

      <div
        data-status={pr.status}
        className="mt-5 grid grid-cols-[16px_minmax(0,1fr)] gap-x-2"
      >
        {/* slop-ok: 1 the requested design pairs the status shape, tone, and word */}
        <span
          className={cn("mt-px flex size-4 items-center", statusToneClass(pr))}
        >
          <Icon
            name={PULL_REQUEST_ICON[pullRequestShape(pr.status)]}
            aria-hidden
            className="size-4"
          />
        </span>
        <div className={TEXT}>
          <p className="m-0 font-semibold leading-[18px]">
            {statusHeading(pr, now)}
          </p>
          <p className="m-0 mt-0.5 max-w-[60ch] text-muted-foreground [text-wrap:pretty]">
            {statusDetail(pr, now)}
          </p>
          {stale ? <RefreshError pr={pr} /> : null}
        </div>
      </div>

      <h2 className={HEADING}>Checks</h2>
      <Checks checks={pr.checks} now={now} />

      <h2 className={HEADING}>Description</h2>
      {pr.body.trim() ? (
        <p
          className={cn(
            "m-0 max-w-[60ch] whitespace-pre-wrap [overflow-wrap:anywhere]",
            TEXT,
          )}
        >
          {pr.body}
        </p>
      ) : (
        <p className={cn("m-0 text-muted-foreground", TEXT)}>No description.</p>
      )}

      <h2 className={HEADING}>Details</h2>
      <dl
        className={cn(
          "m-0 grid grid-cols-1 gap-x-3 gap-y-0 @sm/pr:grid-cols-[7.5rem_minmax(0,1fr)] @sm/pr:gap-y-1.5",
          TEXT,
        )}
      >
        <Fact label="Branch">
          <code className="font-mono text-[12px]">{pr.headRefName}</code> into{" "}
          <code className="font-mono text-[12px]">{pr.baseRefName}</code>
        </Fact>
        <Fact label="Changes">
          {files}, <span className="tabular-nums">+{pr.additions}</span>{" "}
          <span className="tabular-nums">−{pr.deletions}</span>
        </Fact>
        <Fact label="Tracked from">
          <TrackingThread threadId={pr.threadId} />
        </Fact>
        {stale || settled ? null : (
          <Fact label="Checked">
            {pr.lastSuccessAt
              ? relativeAgeLabel(pr.lastSuccessAt, now)
              : "Not yet"}
          </Fact>
        )}
      </dl>
    </article>
  );
}

const statusToneClass = (pr: TrackedPullRequest) =>
  ({
    ready: "text-[color:var(--ws-complete-text)]",
    failing: "text-[color:var(--ws-failed-text)]",
    running: "text-warning-text",
    merged: "text-[color:var(--ws-pr-merged)]",
    waiting: "text-muted-foreground",
    draft: "text-muted-foreground",
    closed: "text-muted-foreground",
  })[pr.status];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="mt-2 text-muted-foreground first:mt-0 @sm/pr:mt-0">
        {label}
      </dt>
      <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

/** The thread that linked the pull request, as a link that opens it. */
function TrackingThread({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const thread = useSidebarThread(threadId);
  if (!thread)
    return (
      <span className="text-muted-foreground">
        A thread that’s no longer listed
      </span>
    );
  return (
    <button
      type="button"
      onClick={() => navigate.toThread(threadId)}
      className="cursor-pointer rounded-sm text-left text-foreground underline decoration-foreground/35 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ThreadTitle threadId={threadId} />
    </button>
  );
}

/**
 * The last read failed, so everything above is from the last one that worked.
 * The machine's name comes from the connected machines when it is among them.
 */
function RefreshError({ pr }: { pr: TrackedPullRequest }) {
  const rpc = useRpc<RpcContract>();
  const [machine, setMachine] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void rpc
      .call("machines", null)
      .then(({ machines }) => {
        if (active)
          setMachine(machines.find((m) => m.id === pr.hostId)?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rpc, pr.hostId]);
  const since = pr.lastSuccessAt
    ? new Date(pr.lastSuccessAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <p
      role="alert"
      className="m-0 mt-2 max-w-[60ch] text-warning-text [text-wrap:pretty]"
    >
      <span className="font-semibold">
        Can’t refresh{since ? ` since ${since}` : ""}.
      </span>{" "}
      {machine ? `${machine} reads this pull request. ` : ""}
      {pr.error}
    </p>
  );
}

function Checks({
  checks,
  now,
}: {
  checks: readonly PullRequestCheck[];
  now: number;
}) {
  if (checks.length === 0)
    return <p className={cn("m-0 text-muted-foreground", TEXT)}>No checks.</p>;
  return (
    <ul aria-label="Checks" className="m-0 grid list-none p-0">
      {sortChecks(checks).map((check) => (
        <CheckRow key={check.id} check={check} now={now} />
      ))}
    </ul>
  );
}

function CheckRow({ check, now }: { check: PullRequestCheck; now: number }) {
  const url = safeExternalUrl(check.url);
  const duration = checkDuration(check, now);
  const name = url ? (
    <UrlLink
      href={url}
      className="underline decoration-current/35 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {check.name}
    </UrlLink>
  ) : (
    check.name
  );
  return (
    <li
      data-state={check.state}
      className={cn(
        "grid min-h-[26px] grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2",
        TEXT,
        check.state === "failed" ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {/* slop-ok: 1 a check's result is a shape and a word as well as a tone */}
      <CheckGlyph state={check.state} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      <span className="text-[12px] tabular-nums">
        {CHECK_STATE_LABEL[check.state]}
        {duration ? ` ${duration}` : ""}
      </span>
    </li>
  );
}

/** A check's result as a shape as well as a color: tick, cross, spinner, or empty ring. */
function CheckGlyph({ state }: { state: PullRequestCheck["state"] }) {
  const box = "flex size-[14px] items-center justify-center";
  switch (state) {
    case "passed":
      return (
        <span className={cn(box, "text-muted-foreground")}>
          <Icon name={CHECK_PASSED_ICON} aria-hidden className="size-[13px]" />
        </span>
      );
    case "failed":
      return (
        <span className={cn(box, "text-[color:var(--ws-failed-text)]")}>
          <Icon name={CHECK_FAILED_ICON} aria-hidden className="size-[13px]" />
        </span>
      );
    case "running":
      return (
        <span className={cn(box, "text-warning-text")}>
          <Icon
            name="Loading"
            aria-hidden
            className="size-[13px] animate-spin motion-reduce:animate-none"
          />
        </span>
      );
    case "unknown":
      return (
        <span className={box}>
          <span
            aria-hidden
            className="size-[9px] rounded-full border border-muted-foreground"
          />
        </span>
      );
  }
}
