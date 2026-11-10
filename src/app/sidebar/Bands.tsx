import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { CountPill } from "../primitives/CountPill.tsx";
import { type CSSProperties, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  MENU_ITEM_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
  menuSurfaceClass,
} from "../primitives/menu.ts";

import {
  type BandId,
  type BandOptions,
  type BandSortOption,
} from "./useBandOptions.ts";
import { WorkstreamName } from "../WorkstreamName.tsx";
import { useFold } from "./motion.ts";
import { FoldBody, FoldChevron } from "./Fold.tsx";
import { RadioMenuGroup, CheckSlot } from "../primitives/RadioMenuGroup.tsx";
import { rowActionClass } from "./HoverActions.tsx";
import { Hint } from "../Hint.tsx";

/**
 * One workstream's threads in Recent, Snoozed, or Archived when the band
 * groups by workstream: a compact header that folds the group and carries its
 * name and count. `label` is the band's name, for the region's accessible
 * name.
 */
export function BandGroup({
  label,
  name,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const fold = useFold(!collapsed);
  return (
    <section aria-label={`${label} ${name}`} className="px-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[12px] font-medium text-muted-foreground hover:bg-sidebar-accent/60"
      >
        <FoldChevron open={!collapsed} />
        <WorkstreamName name={name} muted className="flex-1 text-[12px]" />
        <span className="tabular-nums">{count}</span>
      </button>
      <FoldBody fold={fold}>{children}</FoldBody>
    </section>
  );
}

/**
 * An overlay band. A plain band collapses from its header. A boxed band is an
 * always-open block spanning the column, with its header inside: `attention`
 * is the Up Next card (`.ws-needs`), `pinned` the quiet card of the threads
 * kept in reach (`.ws-pinned`), and `neutral` the
 * quieter Recent block (`.ws-band-neutral`). Each sets its rows apart from
 * the workstream list below.
 */
export const BOX_STYLES = {
  attention: {
    section: "ws-needs mx-2 mt-0 px-1 pt-1.5 pb-2", // slop-ok: 2 the Up Next band, an established product surface
    heading:
      "ws-needs-heading py-0.5 text-[11px] font-semibold uppercase tracking-wide", // slop-ok: 1 the product's section-label style
  },
  pinned: {
    section: "ws-pinned mx-2 mt-0 px-1 pt-1.5 pb-2", // slop-ok: 2 the Pinned band, the Up Next card's quieter neighbor
    heading: "pb-1 text-[12px] font-medium text-muted-foreground",
  },
  neutral: {
    section: "ws-band-neutral my-1 px-2 py-1", // slop-ok: 2 the neutral band, an established product surface
    heading:
      "py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", // slop-ok: 1 the product's section-label style
  },
} as const;

export function Band({
  title,
  count,
  box,
  badge,
  markless,
  collapsed,
  toggle,
  menu,
  flipKey,
  style,
  children,
}: {
  title: string;
  /** Row total, shown only while the band is collapsed. */
  count?: number;
  box?: "attention" | "pinned" | "neutral";
  /** A small mark after the title. */
  badge?: ReactNode;
  /**
   * No row in a boxed band draws a status mark, so titles sit at the
   * collapsed slot's 14px indent; the header indents to match.
   */
  markless?: boolean;
  collapsed?: boolean;
  toggle?: () => void;
  menu?: ReactNode;
  /** Glides the band when a focus change moves it (see `useFlip`). */
  flipKey?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fold = useFold(collapsed === undefined || !collapsed);
  const heading = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        {title}
        {badge}
      </span>
      {count !== undefined && collapsed ? (
        <span
          className={cn(
            "tabular-nums",
            box === "attention" && "ws-needs-count",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
  if (box) {
    const styles = BOX_STYLES[box];
    return (
      <section
        aria-label={title}
        data-flip-key={flipKey}
        style={style}
        className={styles.section}
      >
        <div className="flex items-center gap-1">
          <h2
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 pr-1.5",
              styles.heading,
              markless ? "pl-3.5" : "pl-1.5",
            )}
          >
            {heading}
          </h2>
          {menu}
        </div>
        <ul className="mt-0.5">{children}</ul>
      </section>
    );
  }
  return (
    <section
      aria-label={title}
      data-flip-key={flipKey}
      style={style}
      className="px-1"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent/60" // slop-ok: 1 the product's section-label style
        >
          <FoldChevron open={!collapsed} />
          {heading}
        </button>
        {menu}
      </div>
      <FoldBody fold={fold}>{children}</FoldBody>
    </section>
  );
}

/**
 * The ⋯ button that opens a section's options, such as its sort. It looks
 * like a row action (`rowActionClass`), but stays in view, dimmed until used,
 * because it is the only way to those options, on touch screens too.
 */
export function SectionMenuTrigger({ label }: { label: string }) {
  return (
    <DropdownMenu.Trigger asChild>
      <Hint label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            rowActionClass,
            "opacity-50 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <Icon name="MoreHorizontal" className="size-3.5" />
        </button>
      </Hint>
    </DropdownMenu.Trigger>
  );
}

export function SidebarViewOptionsMenu({
  sort,
  onChange,
}: {
  sort: "alphabetical" | "activity" | "manual";
  onChange: (sort: "alphabetical" | "activity" | "manual") => void;
}) {
  const options = [
    ["alphabetical", "Name A–Z"],
    ["activity", "Recent activity"],
    ["manual", "Manual order"],
  ] as const;
  return (
    <DropdownMenu.Root>
      <SectionMenuTrigger label="Sort workstreams" />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label="Sort workstreams"
          className={menuSurfaceClass("48")}
        >
          <DropdownMenu.Label className={MENU_LABEL_CLASS}>
            Sort workstreams
          </DropdownMenu.Label>
          <RadioMenuGroup value={sort} options={options} onChange={onChange} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function BandOptionsMenu({
  section,
  options,
  onChange,
}: {
  section: BandId;
  options: BandOptions[BandId];
  onChange: (change: Partial<BandOptions[BandId]>) => void;
}) {
  const label = section[0]!.toUpperCase() + section.slice(1);
  const sortOptions: readonly BandSortOption[] =
    section === "recent"
      ? [
          ["activity", "Recent activity"],
          ["title", "Title A–Z"],
        ]
      : section === "snoozed"
        ? [
            ["wake", "Soonest to wake"],
            ["activity", "Recent activity"],
            ["title", "Title A–Z"],
          ]
        : [
            ["archived", "Archive date"],
            ["activity", "Recent activity"],
            ["title", "Title A–Z"],
          ];
  return (
    <DropdownMenu.Root>
      <SectionMenuTrigger label={`${label} options`} />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={menuSurfaceClass("48")}
        >
          <DropdownMenu.Label className={MENU_LABEL_CLASS}>
            Sort by
          </DropdownMenu.Label>
          <RadioMenuGroup
            value={options.sort}
            options={sortOptions}
            onChange={(sort) => onChange({ sort })}
          />
          <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
          <DropdownMenu.CheckboxItem
            checked={options.grouped}
            onCheckedChange={(checked) =>
              onChange({ grouped: checked === true })
            }
            className={cn(MENU_ITEM_CLASS, "gap-2")}
          >
            <CheckSlot />
            Group by workstream
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
/**
 * The toggle under the focused workstreams that reveals the rest. A quiet
 * link-style control, not a section header: the workstreams it reveals keep
 * their own headers. While closed it carries the hidden threads' counts, as
 * far as the count preferences show them (zero hides a count).
 */
export function LowerToggle({
  open,
  waiting,
  total,
  onToggle,
}: {
  open: boolean;
  /** Threads waiting on the user among the hidden ones; 0 shows none. */
  waiting: number;
  /** Hidden threads; 0 shows no count. */
  total: number;
  onToggle: () => void;
}) {
  const { lowerToggle } = SIDEBAR_GEOMETRY;
  return (
    <button
      type="button"
      data-flip-key="lower-toggle"
      aria-expanded={open}
      aria-label={
        open
          ? undefined
          : [
              "Show other workstreams",
              ...(waiting ? [`${waiting} waiting on you`] : []),
              ...(total
                ? [`${total} ${total === 1 ? "thread" : "threads"}`]
                : []),
            ].join(", ")
      }
      onClick={onToggle}
      className="group/lower flex items-center gap-1.5 self-stretch rounded-sm text-left text-[12px] font-normal leading-[1.2] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      style={{
        marginLeft: lowerToggle.inset,
        marginRight: lowerToggle.inset,
        marginTop: lowerToggle.topMargin,
        marginBottom: lowerToggle.bottomMargin,
        height: lowerToggle.height,
      }}
    >
      <span className="underline-offset-2 group-hover/lower:underline">
        {open ? "Hide other workstreams" : "Show other workstreams"}
      </span>
      {!open && (waiting || total) ? (
        <span
          className="ml-auto flex shrink-0 items-center gap-1"
          aria-hidden="true"
        >
          {waiting ? (
            <CountPill>{waiting}</CountPill> // slop-ok: 2 the product's waiting-count pill, an established header pattern
          ) : null}
          {total ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {total}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
