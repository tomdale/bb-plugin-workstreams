import { useEffect, useState, type ReactNode } from "react";
import { experimental_useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import {
  RECENT_LIMIT,
  type Prefs,
  type PrefsPatch,
} from "../../domain/prefs.ts";
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
          label="Title transition"
          description="How the large heading changes to the compact title as you scroll."
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
   * What Debug mode turns on, one row per diagnostic. Each switch is a
   * `debug*` preference beside `debug`; only this list decides which of them
   * exists, so a diagnostic that is retired leaves the settings here.
   */
  const diagnostics: {
    key: keyof Omit<Prefs["advanced"], "hostId" | "debug">;
    label: string;
    description: string;
  }[] = [
    {
      key: "debugRecord",
      label: "Record model calls",
      description:
        "Records prompts, reasoning, and responses with redacted thread excerpts. Kept for 7 days. Every other diagnostic reads what it records.",
    },
    {
      key: "debugInspect",
      label: "Inspect buttons",
      description:
        "The bug button on rows and banners that opens the recorded calls behind a decision.",
    },
    {
      key: "debugActivity",
      label: "Activity model calls",
      description:
        "Lists recorded calls in Activity, with kinds, failures, cost, and Clear traces.",
    },
    {
      key: "debugComposer",
      label: "Composer routing diagnostics",
      description:
        "A Debug disclosure under the new-thread composer: confidence, inputs, and the server's notes on each routing step.",
    },
    {
      key: "debugReplies",
      label: "Reply diagnostics",
      description:
        "Raw agent output and reply syntax diagnosis on assistant replies.",
    },
    {
      key: "debugThreadInfo",
      label: "Thread Info and context card",
      description:
        "A Workstreams Debug section listing the metadata Workstreams accumulated for a thread.",
    },
  ];
  return (
    <div className="space-y-4">
      <SettingsSaveError error={error} />
      {machines && machines.length > 1 ? (
        <SettingsGroup title="Analysis">
          <SectionRows>
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
          </SectionRows>
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="Debug mode">
        <SectionRows>
          <SettingRow
            label="Debug mode"
            description="Turns the diagnostics below on. Each one can be turned off on its own."
            control={
              <SettingSwitch
                label="Debug mode"
                checked={prefs.advanced.debug}
                onChange={(debug) => update({ advanced: { debug } })}
              />
            }
          />
        </SectionRows>
        {prefs.advanced.debug ? (
          <div className="mt-1.5">
            <SectionRows>
              {diagnostics.map((diagnostic) => (
                <SettingRow
                  key={diagnostic.key}
                  label={diagnostic.label}
                  description={diagnostic.description}
                  control={
                    <SettingSwitch
                      label={diagnostic.label}
                      checked={prefs.advanced[diagnostic.key]}
                      onChange={(checked) =>
                        update({
                          advanced: { [diagnostic.key]: checked },
                        })
                      }
                    />
                  }
                />
              ))}
            </SectionRows>
          </div>
        ) : null}
      </SettingsGroup>
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
