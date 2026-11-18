import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { CountPill } from "../primitives/CountPill.tsx";
import { useRef, type CSSProperties, type ReactNode, type Ref } from "react";
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
  BAND_LABELS,
  type BandId,
  type BandOptions,
  type BandSortOption,
} from "./useBandOptions.ts";
import { WorkstreamName } from "../WorkstreamName.tsx";
import { useFold } from "./motion.ts";
import { FoldBody, FoldChevron, useFoldFocusRestore } from "./Fold.tsx";
import { RadioMenuGroup, CheckSlot } from "../primitives/RadioMenuGroup.tsx";
import { rowActionClass } from "./HoverActions.tsx";
import { Hint } from "../Hint.tsx";
import { needYouLabel } from "../../domain/presentation.ts";

/**
 * One workstream's threads in Recents, Snoozed, or Archived when the band
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
  const section = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLUListElement | null>(null);
  useFoldFocusRestore({
    open: !collapsed,
    root: () => section.current,
    contents: () => bodyRef.current,
  });
  return (
    <section ref={section} aria-label={`${label} ${name}`} className="px-1">
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
      <FoldBody fold={fold} listRef={bodyRef}>
        {children}
      </FoldBody>
    </section>
  );
}

/**
 * The heading over one of the sidebar's sections (Recents, Workstreams,
 * Dormant, Snoozed, Archived): an uppercase label on the sidebar itself. The
 * label folds the section, with the chevron after it as on a workstream's
 * header, and a folded section shows its count at the far end. The section's
 * controls follow. A card's title, by contrast, sits inside its card in title
 * case.
 */
export function SectionHeading({
  title,
  collapsed,
  toggle,
  count,
  children,
}: {
  title: string;
  collapsed: boolean;
  toggle: () => void;
  /** What the section holds, shown only while it is folded. */
  count?: number;
  /** Controls drawn at the heading's far end. */
  children?: ReactNode;
}) {
  const { sectionHeading } = SIDEBAR_GEOMETRY;
  return (
    <div
      className="flex items-center gap-3"
      style={{
        height: sectionHeading.height,
        marginTop: sectionHeading.topMargin,
        marginBottom: sectionHeading.bottomMargin,
        paddingLeft: sectionHeading.leftInset,
      }}
    >
      <h2 className="flex min-w-0 flex-1 items-center">
        {/* The label style sits on the button: buttons reset the text
            transform and font they would otherwise inherit. */}
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="ws-text-section flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm text-left text-muted-foreground hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {title}
          <FoldChevron open={!collapsed} />
          {count !== undefined && collapsed ? (
            // The rows' right padding, so a count ends where their ages do.
            <span className="ml-auto pr-2 font-normal tabular-nums">
              {count}
            </span>
          ) : null}
        </button>
      </h2>
      {children}
    </div>
  );
}

/**
 * A sidebar section: its heading, then contents that open and close with the
 * heading's fold. A section with a `label` is a region by that name; the
 * Workstreams section is not one, since each workstream inside it is.
 */
export function Section({
  label,
  heading,
  open,
  list = true,
  flipKey,
  style,
  children,
}: {
  label?: string;
  heading: ReactNode;
  open: boolean;
  /** Contents are list items; otherwise they stack in a plain column. */
  list?: boolean;
  /** Glides the section when a focus change moves it (see `useFlip`). */
  flipKey?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fold = useFold(open);
  const root = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  useFoldFocusRestore({
    open,
    root: () => root.current,
    contents: () => bodyRef.current,
  });
  const Root = label ? "section" : "div";
  return (
    <Root
      ref={root as Ref<HTMLElement & HTMLDivElement>}
      aria-label={label}
      data-flip-key={flipKey}
      style={style}
    >
      {heading}
      <FoldBody
        fold={fold}
        listRef={bodyRef}
        list={list}
        listClassName={list ? undefined : "flex flex-col"}
      >
        {children}
      </FoldBody>
    </Root>
  );
}

/**
 * A band of the list. A plain band is a folding sidebar section (see
 * `Section`). A boxed band is an
 * always-open block spanning the column, with its header inside: `attention`
 * is the Up Next card (`.ws-needs`), and `pinned` the quiet Pinned card
 * (`.ws-pinned`). Each sets its rows apart from the workstream list. A card's
 * title is title case, unlike the uppercase `SectionHeading`.
 */
export const BOX_STYLES = {
  attention: {
    section: "ws-needs mx-2 mt-0 px-1 pt-1.5 pb-[5px]", // slop-ok: 2 the Up Next band, an established product surface
    heading: "ws-needs-heading py-0.5 text-[12px] font-semibold",
  },
  pinned: {
    section: "ws-pinned mx-2 mt-0 px-1 pt-1.5 pb-2", // slop-ok: 2 the Pinned band, the Up Next card's quieter neighbor
    heading: "pb-1 text-[12px] font-semibold text-muted-foreground",
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
  /** A plain band's total, shown only while it is folded. */
  count?: number;
  box?: "attention" | "pinned";
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
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {title}
              {badge}
            </span>
          </h2>
          {menu}
        </div>
        <ul className="mt-0.5">{children}</ul>
      </section>
    );
  }
  const open = !collapsed;
  return (
    <Section
      label={title}
      open={open}
      flipKey={flipKey}
      style={style}
      heading={
        <SectionHeading
          title={title}
          collapsed={!open}
          toggle={toggle ?? (() => {})}
          count={count}
        >
          {menu}
        </SectionHeading>
      }
    >
      {children}
    </Section>
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
  const label = BAND_LABELS[section];
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
            Show by workstream
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
  needsYou,
  total,
  onToggle,
}: {
  open: boolean;
  /** Threads awaiting the user among the hidden ones; 0 shows none. */
  needsYou: number;
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
              ...(needsYou ? [needYouLabel(needsYou)] : []),
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
      {!open && (needsYou || total) ? (
        <span
          className="ml-auto flex shrink-0 items-center gap-1"
          aria-hidden="true"
        >
          {needsYou ? (
            <CountPill>{needsYou}</CountPill> // slop-ok: 2 the product's need-you count pill, an established header pattern
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
