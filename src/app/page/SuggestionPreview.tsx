/**
 * The part of the sidebar a suggestion changes, now and after accepting,
 * side by side. Groups read like sidebar headers, ancestors dimmed before
 * their names; threads that move are highlighted on both sides so each one
 * can be followed from its group now to its group after.
 */
import type {
  PreviewGroup,
  SuggestionPreview,
} from "../../domain/suggestion-preview.ts";
import { cn } from "@/lib/utils";

export function SidebarPreview({ preview }: { preview: SuggestionPreview }) {
  return (
    <div className="@container/preview">
      <div className="grid grid-cols-2 gap-2 @max-[34rem]/preview:grid-cols-1">
        <Pane label="Now" groups={preview.before} />
        <Pane label="After accepting" groups={preview.after} />
      </div>
    </div>
  );
}

function Pane({
  label,
  groups,
}: {
  label: string;
  groups: readonly PreviewGroup[];
}) {
  return (
    <section
      aria-label={label}
      className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5 text-xs"
    >
      <h4 className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
      </h4>
      <div className="space-y-2">
        {groups.map((group, index) => (
          <Group key={index} group={group} prefix={[]} />
        ))}
      </div>
    </section>
  );
}

/**
 * A group and what it holds. A context group with one group below it folds
 * into that group's dimmed prefix, the way the sidebar draws ancestors.
 */
function Group({
  group,
  prefix,
}: {
  group: PreviewGroup;
  prefix: readonly string[];
}) {
  if (
    group.context &&
    group.groups.length === 1 &&
    group.threads.length === 0 &&
    group.others === 0
  )
    return <Group group={group.groups[0]!} prefix={[...prefix, group.name]} />;
  const empty =
    !group.context &&
    group.collapsed === null &&
    group.threads.length === 0 &&
    group.groups.length === 0 &&
    group.others === 0;
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={cn(
            "min-w-0 break-words",
            group.context || group.collapsed !== null
              ? "text-muted-foreground"
              : "font-medium text-foreground",
            group.removed && "line-through",
            group.unfiled && "italic",
          )}
        >
          {prefix.map((name) => (
            <span key={name} className="font-normal text-muted-foreground/70">
              {name}
              <span aria-hidden> › </span>
            </span>
          ))}
          {group.name}
        </span>
        {group.created ? <Badge>New</Badge> : null}
        {group.moved ? <Badge>Moved</Badge> : null}
        {group.removed ? <Badge>Removed</Badge> : null}
        {group.renamedFrom ? (
          <span className="text-muted-foreground">was {group.renamedFrom}</span>
        ) : null}
        {group.collapsed !== null ? (
          <span className="text-muted-foreground">
            · {group.collapsed} {group.collapsed === 1 ? "thread" : "threads"}
          </span>
        ) : null}
      </p>
      {group.threads.length || group.more || empty ? (
        <ul className="mt-0.5 space-y-px">
          {group.threads.map((thread) => (
            <li
              key={thread.id}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded px-1 py-px",
                thread.moved
                  ? "bg-foreground/[0.07] font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  thread.moved ? "bg-foreground" : "bg-muted-foreground/50",
                )}
              />
              <span className="min-w-0 truncate">
                {thread.moved ? <span className="sr-only">Moves: </span> : null}
                {thread.title}
              </span>
            </li>
          ))}
          {group.more ? (
            <li className="px-1 text-muted-foreground">
              {group.more} more {group.more === 1 ? "thread" : "threads"}
            </li>
          ) : null}
          {empty ? (
            <li className="px-1 italic text-muted-foreground">No threads</li>
          ) : null}
        </ul>
      ) : null}
      {group.groups.length || group.others ? (
        <div className="mt-1 ml-1 space-y-1 border-l border-border pl-2.5">
          {group.groups.map((child, index) => (
            <Group key={index} group={child} prefix={[]} />
          ))}
          {group.others ? (
            <p className="text-muted-foreground">
              {group.others} other {group.others === 1 ? "group" : "groups"}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-border px-1 py-px text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </span>
  );
}
