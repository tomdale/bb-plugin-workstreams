import { cn } from "@/lib/utils";

/**
 * Class strings for the Radix menus Workstreams draws itself (dropdown and
 * context menus, row and page menus). BB's own menus come from the registry;
 * these match their surface so a plugin menu sits beside them unnoticed.
 */

/** Tailwind needs each class spelled out, so widths are listed rather than built. */
const MENU_WIDTH = {
  "48": "min-w-48",
  "52": "min-w-52",
  "56": "min-w-56",
  "60": "min-w-60",
} as const;

export type MenuWidth = keyof typeof MENU_WIDTH;

/** The popover surface of a menu: width, border, fill, and shadow. */
export function menuSurfaceClass(width: MenuWidth, extra?: string): string {
  return cn(
    "z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md",
    MENU_WIDTH[width],
    extra,
  );
}

/** One menu row: the shape and highlight shared by every item kind. */
export const MENU_ITEM_CLASS =
  "flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent";

/** The accent text color Radix items take while highlighted. */
export const MENU_ITEM_HIGHLIGHT_TEXT_CLASS =
  "data-[highlighted]:text-accent-foreground";

/** A disabled item stays visible but inert. */
export const MENU_ITEM_DISABLED_CLASS =
  "data-[disabled]:cursor-default data-[disabled]:opacity-50";

/** A menu's muted caption row. */
export const MENU_LABEL_CLASS = "px-2 py-1.5 text-xs text-muted-foreground";

/** The hairline between menu groups. */
export const MENU_SEPARATOR_CLASS = "my-1 h-px bg-border";
