import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { UNSORTED_ID, type Group, type Row } from "../../domain/project.ts";
import { categoryRows } from "../../domain/categoryRows.ts";
import type { WorkstreamNode } from "../../domain/groups.ts";
import { shortWake, type ThreadSnooze } from "../../domain/snooze.ts";
import {
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { WorkstreamName } from "../WorkstreamName.tsx";
import type { WorkView } from "../useWorkstreams.ts";
import { hasStatusMark } from "../sidebar/presentation.ts";
import { FocusIcon } from "../sidebar/FocusIcon.tsx";
import { CountPill } from "../primitives/CountPill.tsx";
import { StatusDot } from "../primitives/StatusDot.tsx";
import { HomeRow } from "./HomeRow.tsx";
import {
  descendantCount,
  startsOpen,
  unfoldedRows,
  type HomePlan,
} from "./model.ts";

type Thread = PluginSidebarThread;
type CountWhen = "always" | "collapsed" | "never";

/** What every Home list needs to draw a row. */
export type HomeEnv = {
  now: number;
  work: (thread: Thread) => WorkView;
  snoozeOf: (thread: Thread) => ThreadSnooze | undefined;
  showAge: boolean;
  threadCount: CountWhen;
  waitingCount: CountWhen;
  colorOf: (sectionId: string, topicId?: string | null) => TopicColor;
  isOpen: (id: string, byDefault: boolean) => boolean;
  toggle: (id: string, byDefault: boolean) => void;
  setAll: (ids: readonly string[], open: boolean) => void;
};

const groupKey = (id: string) => `group:${id}`;
const treeKey = (id: string) => `thread:${id}`;
const DORMANT_KEY = "fold:dormant";
const SNOOZED_KEY = "fold:snoozed";

const showsCount = (when: CountWhen, collapsed: boolean) =>
  when === "always" || (when === "collapsed" && collapsed);

/**
 * Everything below Up Next: the workstreams that have threads, focused
 * ones first, then the rest, Unfiled, a Dormant fold, and a Snoozed fold.
 * While a workstream is focused the rest wait behind a toggle, as in the
 * sidebar. Groups start closed except focused ones (see `startsOpen`), and
 * Expand all opens every group at once.
 */
export function WorkstreamGroups({
  plan,
  env,
}: {
  plan: HomePlan<Thread>;
  env: HomeEnv;
}) {
  const [showLower, setShowLower] = useState(false);
  // Without a focused workstream there is no toggle, and the next time one
  // is focused the rest start hidden again.
  useEffect(() => {
    if (!plan.tiered) setShowLower(false);
  }, [plan.tiered]);
  const lowerShown = !plan.tiered || showLower;
  const visibleGroups = [
    ...plan.pinned,
    ...(lowerShown
      ? [...plan.populated, ...(plan.unfiled ? [plan.unfiled] : [])]
      : []),
  ];
  const allOpen = visibleGroups.every((group) =>
    env.isOpen(groupKey(group.id), startsOpen(plan, group)),
  );
  const renderGroup = (group: Group<Thread>, muted = false) => (
    <GroupSection
      key={group.id}
      group={group}
      open={env.isOpen(groupKey(group.id), startsOpen(plan, group))}
      onToggle={() => env.toggle(groupKey(group.id), startsOpen(plan, group))}
      muted={muted}
      env={env}
    />
  );
  const lowerWaiting =
    env.waitingCount !== "never" && plan.lowerCounts.needsYou > 0;
  const lowerTotal = env.threadCount !== "never" && plan.lowerCounts.total > 0;
  const hasGroups = visibleGroups.length > 0 || plan.hasLower;
  const snoozedMarks = plan.snoozed.some((row) =>
    hasStatusMark(row.thread, env.work(row.thread)),
  );
  return (
    <>
      {hasGroups ? (
        <section aria-label="Workstreams" className="ws-home-groups">
          <div className="ws-home-section-head">
            <h2>Workstreams</h2>
            {visibleGroups.length > 1 ? (
              <button
                type="button"
                className="ws-home-text-button"
                onClick={() =>
                  env.setAll(
                    visibleGroups.map((group) => groupKey(group.id)),
                    !allOpen,
                  )
                }
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            ) : null}
          </div>
          {plan.pinned.map((group) => renderGroup(group))}
          {plan.tiered && plan.hasLower ? (
            <button
              type="button"
              className="ws-home-lower-toggle"
              aria-expanded={showLower}
              aria-label={
                !showLower
                  ? [
                      "Show other workstreams",
                      ...(lowerWaiting
                        ? [`${plan.lowerCounts.needsYou} waiting on you`]
                        : []),
                      ...(lowerTotal
                        ? [
                            `${plan.lowerCounts.total} ${plan.lowerCounts.total === 1 ? "thread" : "threads"}`,
                          ]
                        : []),
                    ].join(", ")
                  : undefined
              }
              onClick={() => setShowLower(!showLower)}
            >
              <span>
                {showLower
                  ? "Hide other workstreams"
                  : "Show other workstreams"}
              </span>
              {!showLower && (lowerWaiting || lowerTotal) ? (
                <span className="ws-home-counts" aria-hidden="true">
                  {lowerWaiting ? (
                    <CountPill size="roomy">
                      {plan.lowerCounts.needsYou}
                    </CountPill>
                  ) : null}
                  {lowerTotal ? (
                    <span className="ws-home-total">
                      {plan.lowerCounts.total}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          ) : null}
          {lowerShown ? (
            <>
              {plan.populated.map((group) => renderGroup(group))}
              {plan.unfiled ? renderGroup(plan.unfiled, true) : null}
              {plan.dormant.length > 0 ? (
                <Fold
                  id={DORMANT_KEY}
                  title="Dormant"
                  count={plan.dormant.length}
                  unit="workstream"
                  env={env}
                >
                  {plan.dormant.map((group) => (
                    <GroupSection
                      key={group.id}
                      group={group}
                      open={env.isOpen(groupKey(group.id), false)}
                      onToggle={() => env.toggle(groupKey(group.id), false)}
                      muted
                      env={env}
                    />
                  ))}
                </Fold>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {plan.snoozed.length > 0 ? (
        <Fold
          id={SNOOZED_KEY}
          title="Snoozed"
          count={plan.snoozed.filter((row) => row.depth === 0).length}
          unit="thread"
          env={env}
          standalone
        >
          <ul className="ws-home-rows" role="list">
            {plan.snoozed.map((row) => {
              const snooze = env.snoozeOf(row.thread);
              return (
                <HomeRow
                  key={row.thread.id}
                  thread={row.thread}
                  work={env.work(row.thread)}
                  now={env.now}
                  variant="snoozed"
                  depth={row.depth}
                  showMarkSlot={snoozedMarks}
                  showAge={env.showAge}
                  trailing={
                    snooze ? shortWake(snooze.until, env.now) : undefined
                  }
                />
              );
            })}
          </ul>
        </Fold>
      ) : null}
    </>
  );
}

/** The groups drawn inline under `group`, in order, theirs included. */
const inlineGroups = (
  group: WorkstreamNode<Thread>,
): WorkstreamNode<Thread>[] =>
  group.subgroups
    .filter((sub) => sub.inline)
    .flatMap((sub) => [sub, ...inlineGroups(sub)]);

/**
 * A workstream: a header that opens and closes its threads, then those of
 * its subgroups drawn inline, each labeled with its subgroup, then its other
 * subgroups (see `arrangeGroups`), which start open and fold on their own.
 */
function GroupSection({
  group,
  open,
  onToggle,
  muted,
  env,
  nested = false,
}: {
  group: Group<Thread> | WorkstreamNode<Thread>;
  open: boolean;
  onToggle: () => void;
  muted: boolean;
  env: HomeEnv;
  /** A subgroup: indented, without a dot, and not sticky. */
  nested?: boolean;
}) {
  const isUnfiled = group.id === UNSORTED_ID;
  const subgroups =
    "subgroups" in group ? group.subgroups.filter((sub) => !sub.inline) : [];
  // Its own rows, then each inline group's, labeled with that group's name.
  const blocks = [
    { group, label: undefined as string | undefined },
    ...("subgroups" in group ? inlineGroups(group) : []).map((sub) => ({
      group: sub,
      label: sub.label.split(/:\s*/).at(-1),
    })),
  ].flatMap(({ group: source, label }) =>
    categoryRows(
      source.rows,
      "categories" in source ? source.categories : undefined,
    ).map((category) => ({
      rows: category.rows,
      label,
      heading: category.name
        ? label
          ? `${label} · ${category.name}`
          : category.name
        : undefined,
    })),
  );
  const rows = open
    ? blocks.flatMap((block) =>
        unfoldedRows(
          block.rows,
          (row) => !env.isOpen(treeKey(row.thread.id), true),
        ).map((row, index) => ({
          row,
          label: block.label,
          heading: index === 0 ? block.heading : undefined,
        })),
      )
    : [];
  const descendants = new Map(
    open
      ? blocks.flatMap((block) =>
          block.rows.map(
            (row, index) =>
              [row.thread.id, descendantCount(block.rows, index)] as const,
          ),
        )
      : [],
  );
  return (
    <section
      aria-label={group.name}
      className="ws-home-group"
      data-open={open || undefined}
      data-muted={muted || undefined}
      data-prioritized={group.prioritized || undefined}
      data-nested={nested || undefined}
    >
      <h3 className="ws-home-group-head">
        <button type="button" aria-expanded={open} onClick={onToggle}>
          <Icon name="ChevronRight" className="ws-home-chevron" aria-hidden />
          {nested ? null : isUnfiled ? (
            <StatusDot size="md" hollow />
          ) : (
            <StatusDot
              size="md"
              workstream
              style={
                workstreamColorStyle(
                  env.colorOf(
                    group.id,
                    "topicId" in group ? group.topicId : undefined,
                  ),
                ) as React.CSSProperties
              }
            />
          )}
          <WorkstreamName
            name={"label" in group ? group.label : group.name}
            muted={muted}
            className="ws-home-group-name"
          />
          {group.prioritized && !nested ? (
            <>
              <FocusIcon filled className="ws-home-flag-icon" />
              <span className="sr-only">, focused</span>
            </>
          ) : null}
          <span className="ws-home-counts">
            {showsCount(env.waitingCount, !open) && group.needsYou > 0 ? (
              <CountPill size="roomy">
                <span aria-hidden="true">{group.needsYou}</span>
                <span className="sr-only">
                  , {group.needsYou} waiting on you
                </span>
              </CountPill>
            ) : null}
            {showsCount(env.threadCount, !open) && group.total > 0 ? (
              <span className="ws-home-total">
                <span aria-hidden="true">{group.total}</span>
                <span className="sr-only">
                  , {group.total} {group.total === 1 ? "thread" : "threads"}
                </span>
              </span>
            ) : null}
          </span>
        </button>
      </h3>
      {open ? (
        <ul className="ws-home-rows" role="list">
          {rows.map(({ row, label, heading }) => {
            const children = descendants.get(row.thread.id) ?? 0;
            return (
              <Fragment key={row.thread.id}>
                {heading ? (
                  <li className="list-none px-2 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">
                    <h4 className="m-0 truncate">{heading}</h4>
                  </li>
                ) : null}
                <HomeRow
                  thread={row.thread}
                  work={env.work(row.thread)}
                  now={env.now}
                  variant="group"
                  depth={row.depth}
                  showMarkSlot
                  showAge={env.showAge}
                  trailing={label}
                  disclosure={
                    row.hasChildren
                      ? {
                          open: env.isOpen(treeKey(row.thread.id), true),
                          count: children,
                          toggle: () =>
                            env.toggle(treeKey(row.thread.id), true),
                        }
                      : undefined
                  }
                />
              </Fragment>
            );
          })}
        </ul>
      ) : null}
      {open
        ? subgroups.map((sub) => (
            <GroupSection
              key={sub.id}
              group={sub}
              open={env.isOpen(groupKey(sub.id), true)}
              onToggle={() => env.toggle(groupKey(sub.id), true)}
              muted={muted}
              env={env}
              nested
            />
          ))
        : null}
    </section>
  );
}

/** A closed-by-default band: Dormant workstreams, or Snoozed threads. */
function Fold({
  id,
  title,
  count,
  unit,
  env,
  standalone = false,
  children,
}: {
  id: string;
  title: string;
  count: number;
  /** What the count counts, for assistive technology. */
  unit: string;
  env: HomeEnv;
  /** Drawn on its own, outside the Workstreams list. */
  standalone?: boolean;
  children: ReactNode;
}) {
  const open = env.isOpen(id, false);
  return (
    <section
      aria-label={title}
      className="ws-home-group ws-home-fold-section"
      data-open={open || undefined}
      data-standalone={standalone || undefined}
      data-muted=""
    >
      <h3 className="ws-home-group-head">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => env.toggle(id, false)}
        >
          <Icon name="ChevronRight" className="ws-home-chevron" aria-hidden />
          <StatusDot size="md" hollow />
          <span className="ws-home-group-name">{title}</span>
          <span className="ws-home-counts">
            <span className="ws-home-total">
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">
                , {count} {unit}
                {count === 1 ? "" : "s"}
              </span>
            </span>
          </span>
        </button>
      </h3>
      {open ? children : null}
    </section>
  );
}
