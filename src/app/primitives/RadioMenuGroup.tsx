import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MENU_ITEM_CLASS } from "./menu.ts";

/** The check that marks a selected item, in a slot that keeps labels aligned. */
export function CheckSlot() {
  return (
    <span className="inline-flex size-4 items-center justify-center">
      <DropdownMenu.ItemIndicator>
        <Icon name="Check" className="size-3.5" />
      </DropdownMenu.ItemIndicator>
    </span>
  );
}

/** A dropdown menu's single choice among `options`, as labeled radio items. */
export function RadioMenuGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu.RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
    >
      {options.map(([option, name]) => (
        <DropdownMenu.RadioItem
          key={option}
          value={option}
          className={cn(MENU_ITEM_CLASS, "gap-2")}
        >
          <CheckSlot />
          {name}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}
