/**
 * The snooze button a thread row and a workstream header show: a click
 * snoozes with the default preset, and resting the pointer on the button
 * opens the menu of every choice. Its name, which is also its tooltip, says
 * when a click would wake what it snoozes.
 *
 * That wake time is read from the shared clock, so the minute the name gives
 * moves by itself: only this button re-renders, not the row or header listing
 * it. A click works the deadline out again as it happens, so it takes the
 * time of the click rather than the one last drawn.
 */
import type { ReactNode } from "react";
import {
  defaultPreset,
  describeWake,
  presetWhen,
  type SnoozePrefs,
  type SnoozeWhen,
  type ThreadSnooze,
} from "../../domain/snooze.ts";
import { useClock } from "../clock.ts";
import { SnoozeIcon, WakeIcon } from "../snooze/icons.tsx";
import { HoverMenuButton } from "./HoverActions.tsx";

/** What a snooze button does, and how its name starts, before its sizing. */
export type SnoozeActionSpec =
  | {
      kind: "snooze";
      /**
       * What a click snoozes, before the wake time the name adds: "Snooze",
       * "Snooze 3 threads in Alpha".
       */
      action: string;
      /** The presets the menu offers, and the default a click uses. */
      prefs: SnoozePrefs;
      onSnooze: (when: SnoozeWhen) => void;
      /** The hover menu's choices. */
      menu: ReactNode;
    }
  | {
      kind: "wake";
      /** The snooze a click ends, whose wake time its name gives. */
      snooze: ThreadSnooze;
      onWake: () => void;
      /** The hover menu's choices, led by Wake now. */
      menu: ReactNode;
    };

/**
 * The button itself. A workstream header passes `compact` for its shorter
 * row; a thread row passes what its geometry decided.
 */
export function SnoozeAction(props: SnoozeActionSpec & { compact?: boolean }) {
  return props.kind === "wake" ? (
    <WakeSnoozeAction {...props} />
  ) : (
    <DefaultSnoozeAction {...props} />
  );
}

function DefaultSnoozeAction({
  action,
  prefs,
  onSnooze,
  menu,
  compact,
}: Extract<SnoozeActionSpec, { kind: "snooze" }> & { compact?: boolean }) {
  const preset = defaultPreset(prefs);
  const wake = useClock((now) => {
    const when = presetWhen(preset, now);
    return describeWake(when.until, now, when.events);
  });
  return (
    <HoverMenuButton
      compact={compact}
      label={`${action} ${wake}`}
      onClick={() => onSnooze(presetWhen(preset, Date.now()))}
      menu={menu}
    >
      <SnoozeIcon className="size-3.5" />
    </HoverMenuButton>
  );
}

function WakeSnoozeAction({
  snooze,
  onWake,
  menu,
  compact,
}: Extract<SnoozeActionSpec, { kind: "wake" }> & { compact?: boolean }) {
  const label = useClock(
    (now) =>
      `Wake now (snoozed ${describeWake(snooze.until, now, snooze.events)})`,
  );
  return (
    <HoverMenuButton
      compact={compact}
      label={label}
      onClick={onWake}
      menu={menu}
    >
      <WakeIcon className="size-3.5" />
    </HoverMenuButton>
  );
}
