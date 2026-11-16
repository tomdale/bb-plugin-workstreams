/**
 * Snooze as a BB thread action, so BB's thread menus and plugins that show
 * BB's thread actions (the Quick Actions ring, see `QuickActionsOffer.tsx`)
 * offer the user's presets and snooze through the same `snoozeThreads` as
 * this plugin's own menus. Its choices are the presets in their order, after
 * Wake now for a snoozed thread. Running it without a choice snoozes with the
 * default preset, which `detail` names while the thread is awake. BB's thread
 * action choices carry only a label, so these show no wake times.
 *
 * The SDK this plugin builds against predates thread action registrations,
 * so the slot's shape is declared here, and BB builds without the slot skip
 * the registration.
 */
import { toast } from "sonner";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  defaultPreset,
  describeWake,
  isSnoozed,
  presetLabel,
  presetWhen,
  type SnoozePrefs,
  type ThreadSnooze,
} from "../../domain/snooze.ts";
import {
  useSharedServerActions,
  useSharedServerStateSelector,
} from "../serverState.ts";
import { useSidebarThreadsById } from "../useStableSidebarThreads.ts";
import { snoozeThreads, wakeThreads } from "./actions.ts";

type ThreadActionChoice = { id: string; label: string };

/** One thread's evaluated action, as BB's thread action slot takes it. */
export type SnoozeThreadAction = {
  label: string;
  detail?: string;
  icon: string;
  choices: {
    hint?: string;
    items: readonly ThreadActionChoice[];
  };
  run(input: { value?: string }): void;
};

type ThreadActionRegistration<Data> = {
  id: string;
  title: string;
  icon: string;
  group: string;
  useData(input: { threadIds: readonly string[] }): Data;
  item(input: {
    thread: { id: string };
    data: Data;
  }): SnoozeThreadAction | null;
};

type SlotsWithThreadAction = {
  experimental_threadAction?<Data>(
    registration: ThreadActionRegistration<Data>,
  ): void;
};

/** The choice that wakes a snoozed thread now. */
export const WAKE_NOW_CHOICE = "wake-now";

/** The registration id; BB keys the action `<plugin id>/snooze`. */
export const SNOOZE_ACTION_ID = "snooze";

/** BB's state group, beside Pin and Mark read. */
const STATE_GROUP = "1_state";

export type SnoozeActionData = {
  prefs: SnoozePrefs;
  snoozes: Readonly<Record<string, ThreadSnooze>>;
  setSnoozes: ReturnType<typeof useSharedServerActions>["setSnoozes"];
  /** The threads BB is showing actions for that the sidebar lists. */
  listed: ReadonlyMap<string, PluginSidebarThread>;
};

/**
 * Snooze for one thread, or null for a thread the sidebar doesn't list
 * (hidden or archived), which has nowhere to be snoozed out of.
 */
export function snoozeThreadAction(
  threadId: string,
  data: SnoozeActionData,
  now: number,
): SnoozeThreadAction | null {
  const thread = data.listed.get(threadId);
  if (!thread) return null;
  const { prefs, setSnoozes } = data;
  const stored = data.snoozes[threadId];
  const snooze = isSnoozed(stored, now) ? stored : undefined;
  const presets = prefs.presets.map((preset) => ({
    id: preset.id,
    label: presetLabel(preset),
  }));
  return {
    label: "Snooze",
    icon: "Clock",
    detail: snooze ? undefined : presetLabel(defaultPreset(prefs)),
    choices: {
      hint: snooze
        ? `Snoozed ${describeWake(snooze.until, now, snooze.events)}`
        : undefined,
      items: snooze
        ? [{ id: WAKE_NOW_CHOICE, label: "Wake now" }, ...presets]
        : presets,
    },
    run: ({ value }) => {
      if (value === WAKE_NOW_CHOICE) {
        wakeThreads(setSnoozes, [thread]);
        return;
      }
      const preset =
        value === undefined
          ? defaultPreset(prefs)
          : prefs.presets.find((candidate) => candidate.id === value);
      if (!preset) {
        toast.error("That snooze option was removed. Choose another.");
        return;
      }
      snoozeThreads(setSnoozes, [thread], presetWhen(preset, Date.now()), {
        previous: () => snooze,
      });
    },
  };
}

function useSnoozeActionData({
  threadIds,
}: {
  threadIds: readonly string[];
}): SnoozeActionData {
  const prefs = useSharedServerStateSelector((server) => server.snoozePrefs);
  const snoozes = useSharedServerStateSelector((server) => server.snoozes);
  const { setSnoozes } = useSharedServerActions();
  const listed = useSidebarThreadsById(threadIds);
  return { prefs, snoozes, setSnoozes, listed };
}

/** Registers Snooze on BB builds that take plugin thread actions. */
export function registerSnoozeThreadAction(app: { slots: object }): void {
  (app.slots as SlotsWithThreadAction).experimental_threadAction?.({
    id: SNOOZE_ACTION_ID,
    title: "Snooze",
    icon: "Clock",
    group: STATE_GROUP,
    useData: useSnoozeActionData,
    item: ({ thread, data }) => snoozeThreadAction(thread.id, data, Date.now()),
  });
}
