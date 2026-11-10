import type { ComponentProps, ComponentType, ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_HIGHLIGHT_TEXT_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
  menuSurfaceClass,
} from "../primitives/menu.ts";
import {
  describeWake,
  snoozeChoices,
  wakeTime,
  type SnoozePrefs,
  type SnoozeWhen,
  type ThreadSnooze,
} from "../../domain/snooze.ts";

/**
 * The snooze choices in a menu: every preset with when it would wake, the
 * Custom… item, and, for a snoozed thread, its wake time and Wake now.
 * Shared by the thread header's dropdown, the sidebar's hover menus, and the
 * row's right-click menu, which draw items with different primitives (`kit`).
 *
 * `now` only labels the choices; a choice's wake time is worked out when it
 * is chosen, since a menu can sit open, or `now` lag, past a preset's time.
 */
export function SnoozeMenuItems({
  heading,
  now,
  prefs,
  snooze,
  onSnooze,
  onWake,
  onCustom,
  numbered = false,
  kit = dropdownMenuKit,
}: {
  kit?: MenuKit;
  /** Shows each preset's number key (1–6), for a menu that handles them. */
  numbered?: boolean;
  /** Names what the choices snooze, above them ("Snooze 4 threads"). */
  heading?: string;
  now: number;
  /** The presets to list, and the one-click default, marked while not snoozed. */
  prefs: SnoozePrefs;
  /**
   * The thread's current snooze, which hides the default's mark; with
   * `onWake`, the menu also says when it wakes and offers Wake now.
   */
  snooze?: ThreadSnooze;
  onSnooze: (when: SnoozeWhen) => void;
  onWake?: () => void;
  /** Opens the Custom… dialog (see `CustomSnoozeDialog`). */
  onCustom: () => void;
}) {
  const { Item: MenuItem, Label, Separator } = kit;
  return (
    <>
      {heading ? <Label>{heading}</Label> : null}
      {snooze && onWake ? (
        <>
          <Label>
            Snoozed {describeWake(snooze.until, now, snooze.events)}
          </Label>
          <MenuItem onSelect={onWake}>Wake now</MenuItem>
          <Separator />
        </>
      ) : null}
      {snoozeChoices(prefs.presets, now).map((choice, index) => (
        <MenuItem
          key={choice.id}
          onSelect={() =>
            onSnooze({
              until: wakeTime(choice.rule, Date.now()),
              events: choice.events,
            })
          }
        >
          {numbered ? (
            <span className="mr-2.5 w-2 text-[11px] tabular-nums text-muted-foreground">
              {index + 1}
            </span>
          ) : null}
          <span className="flex-1">
            {choice.label}
            {choice.id === prefs.default && !snooze ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                (default)
              </span>
            ) : null}
          </span>
          {choice.hint ? (
            <span className="ml-4 text-xs text-muted-foreground">
              {choice.hint}
            </span>
          ) : null}
        </MenuItem>
      ))}
      <Separator />
      <MenuItem onSelect={onCustom}>Custom…</MenuItem>
    </>
  );
}

/** Snooze menus sample the clock when their portal actually renders. */
export function CurrentSnoozeMenuItems(
  props: Omit<ComponentProps<typeof SnoozeMenuItems>, "now">,
) {
  return <SnoozeMenuItems {...props} now={Date.now()} />;
}

export const snoozeMenuContentClass = menuSurfaceClass("60");

/** The item primitives a snooze menu is drawn with. */
export type MenuKit = {
  Item: ComponentType<{ onSelect: () => void; children: ReactNode }>;
  Label: ComponentType<{ children: ReactNode }>;
  Separator: ComponentType;
};

export const menuItemClass = cn(MENU_ITEM_CLASS, "w-full text-left");

/** Items inside a Radix dropdown menu. */
const dropdownMenuKit: MenuKit = {
  Item: ({ onSelect, children }) => (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(menuItemClass, MENU_ITEM_HIGHLIGHT_TEXT_CLASS)}
    >
      {children}
    </DropdownMenu.Item>
  ),
  Label: ({ children }) => (
    <DropdownMenu.Label className={MENU_LABEL_CLASS}>
      {children}
    </DropdownMenu.Label>
  ),
  Separator: () => <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />,
};

const plainItemClass = `${menuItemClass} border-0 bg-transparent text-inherit hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground`;

/**
 * Plain `role="menuitem"` buttons, for a menu that manages its own focus
 * (the sidebar's hover menu). Hover and focus both highlight an item.
 */
export const plainMenuKit: MenuKit = {
  Item: ({ onSelect, children }) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onSelect}
      className={plainItemClass}
    >
      {children}
    </button>
  ),
  Label: ({ children }) => <div className={MENU_LABEL_CLASS}>{children}</div>,
  Separator: () => <div role="separator" className={MENU_SEPARATOR_CLASS} />,
};
