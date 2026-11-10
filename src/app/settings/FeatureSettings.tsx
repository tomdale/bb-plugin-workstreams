import { useEffect, useState, type ReactNode } from "react";
import { experimental_useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import {
  RECENT_LIMIT,
  UP_NEXT_SHOWN,
  type Prefs,
  type PrefsPatch,
} from "../../domain/prefs.ts";
import {
  UP_NEXT_FRESH_WINDOWS,
  type UpNextFreshWindow,
} from "../../domain/upNext.ts";
import { usePrefs } from "../prefs.ts";
import { ModelField } from "./ModelField.tsx";
import { SpinnerSettings } from "./SpinnerSettings.tsx";
import {
  CompactSettingRow,
  SectionRows,
  SettingRow,
  SettingSwitch,
  SegmentedControl,
  SettingsGroup,
  SettingsPicker,
  Stepper,
} from "./ui.tsx";

function useFeaturePrefs() {
  const { prefs, save } = usePrefs();
  const [error, setError] = useState<string | null>(null);
  const update = (patch: PrefsPatch) => {
    setError(null);
    void save(patch).catch((cause) => {
      setError(
        cause instanceof Error ? cause.message : "Couldn't save setting.",
      );
    });
  };
  return { prefs, update, error };
}

export function SidebarSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  if (!prefs) return <Loading />;
  const row = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    accessory?: ReactNode,
  ) => (
    <CompactSettingRow
      label={label}
      accessory={accessory}
      control={
        <SettingSwitch
          size="sm"
          label={label}
          checked={checked}
          onChange={onChange}
        />
      }
    />
  );
  const choice = <V extends string>(
    label: string,
    value: V,
    options: readonly { value: V; label: string }[],
    onChange: (value: V) => void,
  ) => (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <p className="min-w-0 truncate text-sm text-foreground">{label}</p>
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
  const countOptions = [
    { value: "always", label: "Always" },
    { value: "collapsed", label: "When collapsed" },
    { value: "never", label: "Never" },
  ] as const;
  return (
    <div className="space-y-4">
      <SettingsSaveError error={error} />
      <SettingsGroup title="Sections">
        <SectionRows compact>
          {row("Up Next", prefs.sidebar.showForYou, (showForYou) =>
            update({ sidebar: { showForYou } }),
          )}
          {row(
            "Recent",
            prefs.sidebar.showRecent,
            (showRecent) => update({ sidebar: { showRecent } }),
            prefs.sidebar.showRecent ? (
              <Stepper
                size="sm"
                label="threads shown"
                value={prefs.sidebar.recentLimit}
                min={RECENT_LIMIT.min}
                max={RECENT_LIMIT.max}
                onChange={(recentLimit) => update({ sidebar: { recentLimit } })}
              />
            ) : null,
          )}
          {row("Snoozed", prefs.sidebar.showSnoozed, (showSnoozed) =>
            update({ sidebar: { showSnoozed } }),
          )}
          {row("Archived", prefs.sidebar.showArchived, (showArchived) =>
            update({ sidebar: { showArchived } }),
          )}
        </SectionRows>
      </SettingsGroup>
      <SettingsGroup title="Home screen">
        <SectionRows compact>
          <SettingRow
            label="Up Next and workstreams on phones"
            description="Replaces BB's Recent list on a phone's Home screen with Up Next over your threads by workstream."
            control={
              <SettingSwitch
                size="sm"
                label="Up Next and workstreams on phones"
                checked={prefs.sidebar.phoneHome}
                onChange={(phoneHome) => update({ sidebar: { phoneHome } })}
              />
            }
          />
        </SectionRows>
      </SettingsGroup>
      <SettingsGroup title="Details">
        <SectionRows compact>
          {choice(
            "Timestamp",
            prefs.sidebar.timestamps,
            [
              { value: "show", label: "Always" },
              { value: "hover", label: "On hover" },
              { value: "hide", label: "Never" },
            ],
            (timestamps) => update({ sidebar: { timestamps } }),
          )}
          {choice(
            "Thread count",
            prefs.sidebar.threadCount,
            countOptions,
            (threadCount) => update({ sidebar: { threadCount } }),
          )}
          {choice(
            "Waiting count",
            prefs.sidebar.waitingCount,
            countOptions,
            (waitingCount) => update({ sidebar: { waitingCount } }),
          )}
        </SectionRows>
      </SettingsGroup>
    </div>
  );
}

/**
 * Which threads Up Next lists, how many rows it shows before Show more, and
 * what comes first. The same order draws the sidebar, the phone Home screen,
 * the queue, and the next Up Next command (see `selectUpNext`).
 *
 * Each label names a setting and stays put; the line under it states what that
 * setting is doing now, so a switch's two sides never move the row the user is
 * aiming at and the section still reads as the list they have.
 */
export function UpNextSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  if (!prefs) return <Loading />;
  const windows: { value: UpNextFreshWindow; label: string }[] = [
    { value: "off", label: "Don't prioritize" },
    { value: "1h", label: "Last hour" },
    { value: "6h", label: "Last 6 hours" },
    { value: "12h", label: "Last 12 hours" },
    { value: "1d", label: "Last day" },
    { value: "3d", label: "Last 3 days" },
    { value: "7d", label: "Last week" },
  ];
  const fillDescription = prefs.upNext.fill
    ? "Threads you have already read fill the rows left after the ones blocked on you."
    : "Skips threads you have read that aren't blocked on you.";
  const unreadDescription = prefs.upNext.unreadFirst
    ? "Unread threads come before read ones."
    : "Every thread ranks by what it's blocked on, so a read question can come before an unread review.";
  const window = windows.find(
    (option) => option.value === prefs.upNext.freshWindow,
  );
  // Inside the window the tiers decide, which is the unread setting's order, so
  // the second sentence follows that setting too.
  const withinWindow = prefs.upNext.unreadFirst
    ? "unread threads come first, then the ones blocked on you."
    : "threads rank by what they're blocked on.";
  const freshDescription =
    window && window.value !== "off"
      ? `Threads whose turn ended in the ${window.label.toLowerCase()} come before older ones. Inside that group, ${withinWindow}`
      : "Threads keep their place, however recently their turn ended.";
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <SettingRow
          label="Threads shown"
          description="How many rows Up Next shows before Show more."
          control={
            <Stepper
              label="threads shown"
              value={prefs.upNext.shown}
              min={UP_NEXT_SHOWN.min}
              max={UP_NEXT_SHOWN.max}
              onChange={(shown) => update({ upNext: { shown } })}
            />
          }
        />
        <SettingRow
          label="Show read threads"
          description={fillDescription}
          control={
            <SettingSwitch
              label="Show read threads"
              checked={prefs.upNext.fill}
              onChange={(next) => update({ upNext: { fill: next } })}
            />
          }
        />
        <SettingRow
          label="Prioritize unread threads"
          description={unreadDescription}
          control={
            <SettingSwitch
              label="Prioritize unread threads"
              checked={prefs.upNext.unreadFirst}
              onChange={(unreadFirst) => update({ upNext: { unreadFirst } })}
            />
          }
        />
        <SettingRow
          label="Prioritize recent threads"
          description={freshDescription}
          control={
            <SettingsPicker
              label="Prioritize recent threads"
              value={prefs.upNext.freshWindow}
              options={windows}
              onChange={(freshWindow) => update({ upNext: { freshWindow } })}
            />
          }
        />
      </SectionRows>
    </div>
  );
}

export function WorkingIndicatorSettings() {
  return (
    <SectionRows>
      <div className="min-w-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          How a working thread is marked in the sidebar.
        </p>
        <div className="mt-3">
          <SpinnerSettings />
        </div>
      </div>
    </SectionRows>
  );
}

export function ThreadsSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  if (!prefs) return <Loading />;
  // A floating heading never becomes the compact title, so the two settings
  // that shape that copy (how it takes over, and where it sits) appear only
  // while the title minimizes.
  const minimizing = prefs.threads.headingScroll === "minimize";
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <ModelField
          label="Full analysis model"
          description="When a turn ends after a new request, settles the thread's goal (its title, while Keep titles current is on), and its status when the agent didn't report one."
          choice={prefs.analysis.fullModel}
          onChange={(fullModel) => update({ analysis: { fullModel } })}
        />
        <SettingRow
          label="Keep titles current"
          description="Title new threads promptly and update titles to follow their current substantive focus. Titles you edit outside Workstreams stay fixed until you clear them."
          control={
            <SettingSwitch
              label="Keep titles current"
              checked={prefs.threads.autoTitle}
              onChange={(autoTitle) => update({ threads: { autoTitle } })}
            />
          }
        />
        <SettingRow
          label="Title on scroll"
          description="Minimize the heading into the title bar as you scroll, or float it over the thread."
          control={
            <SegmentedControl
              label="Title on scroll"
              value={prefs.threads.headingScroll}
              options={[
                { value: "minimize", label: "Minimize" },
                { value: "float", label: "Float" },
              ]}
              onChange={(headingScroll) =>
                update({ threads: { headingScroll } })
              }
            />
          }
        />
        {minimizing ? (
          <SettingRow
            label="Title transition"
            description="Fade the compact title into place, or scroll both copies as they cross."
            control={
              <SegmentedControl
                label="Title transition"
                value={prefs.threads.headingTransition}
                options={[
                  { value: "fade", label: "Fade" },
                  { value: "scroll", label: "Scroll" },
                ]}
                onChange={(headingTransition) =>
                  update({ threads: { headingTransition } })
                }
              />
            }
          />
        ) : null}
        {minimizing ? (
          <SettingRow
            label="Title alignment"
            description="Place the minimized title's slot at the left or middle of the title bar. The workstream name and title stay left aligned."
            control={
              <SegmentedControl
                label="Title alignment"
                value={prefs.threads.headingAlign}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Centered" },
                ]}
                onChange={(headingAlign) =>
                  update({ threads: { headingAlign } })
                }
              />
            }
          />
        ) : null}
        <SettingRow
          label="Show parent thread link"
          description="Add a link to the parent thread in child thread headers."
          control={
            <SettingSwitch
              label="Show parent thread link"
              checked={prefs.threads.showParentLink}
              onChange={(showParentLink) =>
                update({ threads: { showParentLink } })
              }
            />
          }
        />
        <SettingRow
          label="Show archive button"
          description="Add an Archive button to thread headers."
          control={
            <SettingSwitch
              label="Show archive button"
              checked={prefs.threads.showArchiveButton}
              onChange={(showArchiveButton) =>
                update({ threads: { showArchiveButton } })
              }
            />
          }
        />
      </SectionRows>
    </div>
  );
}

export function NewWorkSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  const { status, projects } = experimental_useSidebarThreads();
  if (!prefs) return <Loading />;
  const projectOptions = [
    { value: "", label: "Don't work in a project" },
    ...projects
      .filter((project) => !project.isPersonal)
      .map((project) => ({ value: project.id, label: project.name })),
  ];
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <SettingRow
          label="Home project"
          description="Where new work starts when it has no project target."
          control={
            <SettingsPicker
              label="Home project"
              value={prefs.newWork.homeProjectId}
              options={projectOptions}
              placeholder={
                status === "loading" ? "Loading projects…" : "Choose a project"
              }
              onChange={(homeProjectId) =>
                update({ newWork: { homeProjectId } })
              }
              disabled={status !== "ready"}
              className="w-56"
            />
          }
        />
        <SettingRow
          label="Suggestions while typing"
          description="Preview a new thread's topic in the composer as you write, using the Quick analysis model."
          control={
            <SettingSwitch
              label="Suggestions while typing"
              checked={prefs.newWork.suggestions}
              onChange={(suggestions) => update({ newWork: { suggestions } })}
            />
          }
        />
        <ModelField
          label="Quick analysis model"
          description="Titles a new thread and picks its topic from its first request, and previews both in the composer as you type."
          choice={prefs.analysis.quickModel}
          onChange={(quickModel) => update({ analysis: { quickModel } })}
        />
      </SectionRows>
    </div>
  );
}

export function OrganizeSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  if (!prefs) return <Loading />;
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <ModelField
          label="Placement model"
          description="Picks each thread's topic from its requests: when it starts, and again after a new request."
          choice={prefs.analysis.placementModel}
          onChange={(placementModel) =>
            update({ analysis: { placementModel } })
          }
        />
        <SettingRow
          label="Fast placement"
          description="Ask a decision model placement's question and use its answer when it is confident, so a thread is filed in a fraction of a second. Anything less than confident is asked of the placement model as usual."
          control={
            <SettingSwitch
              label="Fast placement"
              checked={prefs.analysis.placementGate}
              onChange={(placementGate) =>
                update({ analysis: { placementGate } })
              }
            />
          }
        />
        {prefs.analysis.placementGate ? (
          <ModelField
            label="Fast placement model"
            description="The decision model that answers placement's question with a topic and a probability. It runs on AI Gateway directly, not as a BB worker."
            choice={prefs.analysis.placementGateModel}
            onChange={(placementGateModel) =>
              update({ analysis: { placementGateModel } })
            }
          />
        ) : null}
        <SettingRow
          label="Organizing suggestions"
          description="Suggest lasting topic divisions and tidy edits. Topic changes wait for your acceptance; categories update automatically."
          control={
            <SettingSwitch
              label="Organizing suggestions"
              checked={prefs.organize.suggestions}
              onChange={(suggestions) => update({ organize: { suggestions } })}
            />
          }
        />
        <ModelField
          label="Organization model"
          description="Organizes current thread collections into categories and writes topic suggestions for review."
          choice={prefs.organize.tidyModel}
          onChange={(tidyModel) => update({ organize: { tidyModel } })}
        />
      </SectionRows>
    </div>
  );
}

export function AdvancedSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  const rpc = useRpc<RpcContract>();
  const { status: projectStatus, projects } = experimental_useSidebarThreads();
  const [machines, setMachines] = useState<
    { id: string; name: string }[] | null
  >(null);
  useEffect(() => {
    let active = true;
    void rpc
      .call("machines", null)
      .then(({ machines: connected }) => {
        if (active) setMachines(connected);
      })
      .catch(() => {
        if (active) setMachines([]);
      });
    return () => {
      active = false;
    };
  }, [rpc]);
  if (!prefs) return <Loading />;
  const machineOptions = [
    { value: "", label: "Only connected machine" },
    ...(machines?.map((machine) => ({
      value: machine.id,
      label: machine.name,
    })) ?? []),
  ];
  /**
   * What the debug UI shows, one row per surface. Each switch is a `debug*`
   * preference beside `debugUi`; only this list decides which of them exists,
   * so a surface that is retired leaves the settings here.
   */
  const surfaces: {
    key: keyof Omit<
      Prefs["advanced"],
      "hostId" | "debugRecord" | "debugUi" | "debugProjectId"
    >;
    label: string;
  }[] = [
    { key: "debugInspect", label: "Inspect buttons" },
    { key: "debugDiscuss", label: "Debug thread buttons" },
    { key: "debugActivity", label: "Activity model calls" },
    { key: "debugComposer", label: "Composer routing diagnostics" },
    { key: "debugReplies", label: "Reply diagnostics" },
    { key: "debugThreadInfo", label: "Thread Info and context card" },
  ];
  const debugProjectOptions = [
    { value: "", label: "Home project" },
    ...projects
      .filter((project) => !project.isPersonal)
      .map((project) => ({ value: project.id, label: project.name })),
  ];
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      {/* slop-ok: 2 every Workstreams settings section draws this card, and BB
          frames its own settings the same way */}
      <SectionRows>
        {machines && machines.length > 1 ? (
          <SettingRow
            label="Analysis machine"
            description="Machine whose Pi key is used for AI Gateway calls."
            control={
              <SettingsPicker
                label="Analysis machine"
                value={prefs.advanced.hostId}
                options={machineOptions}
                placeholder="Use any connected machine"
                onChange={(hostId) => update({ advanced: { hostId } })}
                className="w-56"
              />
            }
          />
        ) : null}
        <SettingRow
          label="Record model calls"
          description="Saves each model call's prompt, reasoning, and response, redacting common secrets, for 7 days."
          control={
            <SettingSwitch
              label="Record model calls"
              checked={prefs.advanced.debugRecord}
              onChange={(debugRecord) => update({ advanced: { debugRecord } })}
            />
          }
        />
        <SettingRow
          label="Debug UI"
          control={
            <SettingSwitch
              label="Debug UI"
              checked={prefs.advanced.debugUi}
              onChange={(debugUi) => update({ advanced: { debugUi } })}
            />
          }
        />
        {prefs.advanced.debugUi ? (
          <div className="space-y-5 pl-4">
            {surfaces.map((surface) => (
              <SettingRow
                key={surface.key}
                label={surface.label}
                control={
                  <SettingSwitch
                    label={surface.label}
                    checked={prefs.advanced[surface.key]}
                    onChange={(checked) =>
                      update({
                        advanced: { [surface.key]: checked },
                      })
                    }
                  />
                }
              />
            ))}
            <SettingRow
              label="Debug threads project"
              description="Where a debug thread starts, so its agent can read the prompts and code behind the result you asked about."
              control={
                <SettingsPicker
                  label="Debug threads project"
                  value={prefs.advanced.debugProjectId}
                  options={debugProjectOptions}
                  placeholder={
                    projectStatus === "loading"
                      ? "Loading projects…"
                      : "Choose a project"
                  }
                  onChange={(debugProjectId) =>
                    update({ advanced: { debugProjectId } })
                  }
                  disabled={projectStatus !== "ready"}
                  className="w-56"
                />
              }
            />
          </div>
        ) : null}
      </SectionRows>
    </div>
  );
}

function SettingsSaveError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function Loading() {
  return <p className="text-xs text-muted-foreground">Loading settings…</p>;
}
