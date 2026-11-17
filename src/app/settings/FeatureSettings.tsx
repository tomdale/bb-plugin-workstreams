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
          {row("Up Next", prefs.sidebar.showUpNext, (showUpNext) =>
            update({ sidebar: { showUpNext } }),
          )}
          {row(
            "Recent",
            prefs.sidebar.showRecent,
            (showRecent) => update({ sidebar: { showRecent } }),
            prefs.sidebar.showRecent ? (
              <Stepper
                size="sm"
                label="recent threads shown"
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
            "Threads that need you",
            prefs.sidebar.needsYouCount,
            countOptions,
            (needsYouCount) => update({ sidebar: { needsYouCount } }),
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
    ? "Threads you have already read fill the rows left after the ones that need your answer or review."
    : "Skips threads you have read that don't need your answer or review.";
  const unreadDescription = prefs.upNext.unreadFirst
    ? "Unread threads come before read ones."
    : "Every thread ranks by what it needs from you, so a read question can come before an unread review.";
  const window = windows.find(
    (option) => option.value === prefs.upNext.freshWindow,
  );
  // Inside the window the tiers decide, which is the unread setting's order, so
  // the second sentence follows that setting too.
  const withinWindow = prefs.upNext.unreadFirst
    ? "unread threads come first, then the ones that need your answer or review."
    : "threads rank by what they need from you.";
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

/** How the large title hands off to the minimized one, and what each looks like. */
const TITLE_TRANSITIONS = [
  {
    value: "fade",
    label: "Fade",
    description:
      "The large heading gently moves back as the minimized title rises into place.",
  },
  {
    value: "scroll",
    label: "Scroll",
    description: "Both copies slide past each other as you scroll.",
  },
  {
    value: "morph",
    label: "Morph",
    description: "One title travels to the title bar, shrinking as it goes.",
  },
  {
    value: "stagger",
    label: "Stagger",
    description: "Each line slides away, then the next slides in behind it.",
  },
  {
    value: "flip",
    label: "Flip",
    description: "Each line turns edge-on and the minimized lines turn in.",
  },
  {
    value: "rack",
    label: "Rack focus",
    description:
      "The large title blurs out as the minimized title sharpens in.",
  },
  {
    value: "cascade",
    label: "Cascade",
    description:
      "Letters rise away one after another and the new title follows.",
  },
] as const;

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
            description={
              TITLE_TRANSITIONS.find(
                (option) => option.value === prefs.threads.headingTransition,
              )?.description
            }
            control={
              <SettingsPicker
                label="Title transition"
                value={prefs.threads.headingTransition}
                options={TITLE_TRANSITIONS}
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
  if (!prefs) return <Loading />;
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <SettingRow
          label="Name and organize as you write"
          description="Show a guess at a new thread's title and workstream in the composer as you write. The guessed workstream holds the thread after you send until its start call answers."
          control={
            <SettingSwitch
              label="Name and organize as you write"
              checked={prefs.newWork.organizeAsYouWrite}
              onChange={(organizeAsYouWrite) =>
                update({ newWork: { organizeAsYouWrite } })
              }
            />
          }
        />
      </SectionRows>
    </div>
  );
}

/**
 * Every model Workstreams calls, in the order a thread meets them, and the
 * machine whose AI Gateway key runs the gateway ones. That machine picker
 * appears only when there is more than one to choose from.
 */
export function ModelsSettings() {
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
  return (
    <div className="space-y-3">
      <SettingsSaveError error={error} />
      <SectionRows>
        <ModelField
          label="Name and organize as you write"
          description="Guesses a new thread's title and workstream in the composer while you type, so it needs a model that answers in about a second. The thread's start settles both after you send."
          choice={prefs.analysis.composerModel}
          onChange={(composerModel) => update({ analysis: { composerModel } })}
        />
        <ModelField
          label="Name and organize new threads"
          description="Titles a new thread and chooses its workstream when its first request is sent. Also chooses the workstream for a thread you move into a group, and checks whether threads fit their workstream's categories."
          choice={prefs.analysis.newThreadModel}
          onChange={(newThreadModel) =>
            update({ analysis: { newThreadModel } })
          }
        />
        <ModelField
          label="Update threads after each turn"
          description="When a turn ends, updates the thread's goal, its title while Keep titles current is on, and its status when the agent didn't report one. After a new request, it also decides whether the thread moves to another workstream."
          choice={prefs.analysis.turnEndModel}
          onChange={(turnEndModel) => update({ analysis: { turnEndModel } })}
        />
        <ModelField
          label="Arrange categories"
          description="Arranges a workstream's threads into categories when it reaches six, and rearranges them when a thread fits none."
          choice={prefs.organize.categoryModel}
          onChange={(categoryModel) => update({ organize: { categoryModel } })}
        />
        <ModelField
          label="Suggest changes"
          description="Suggests splits and other changes to your workstreams and groups, for you to accept or decline. Categories update on their own either way."
          choice={prefs.organize.suggestionModel}
          onChange={(suggestionModel) =>
            update({ organize: { suggestionModel } })
          }
          enabled={{
            checked: prefs.organize.suggestions,
            onChange: (suggestions) => update({ organize: { suggestions } }),
          }}
        />
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
      </SectionRows>
    </div>
  );
}

export function AdvancedSettings() {
  const { prefs, update, error } = useFeaturePrefs();
  const { status: projectStatus, projects } = experimental_useSidebarThreads();
  if (!prefs) return <Loading />;
  /**
   * What the debug UI shows, one row per surface. Each switch is a `debug*`
   * preference beside `debugUi`; only this list decides which of them exists,
   * so a surface that is retired leaves the settings here.
   */
  const surfaces: {
    key: keyof Omit<
      Prefs["advanced"],
      | "hostId"
      | "workerProjectId"
      | "debugRecord"
      | "debugUi"
      | "debugProjectId"
    >;
    label: string;
  }[] = [
    { key: "debugInspect", label: "Inspect buttons" },
    { key: "debugDiscuss", label: "Debug thread buttons" },
    { key: "debugActivity", label: "Show model traces" },
    { key: "debugComposer", label: "Composer routing diagnostics" },
    { key: "debugReplies", label: "Reply diagnostics" },
    { key: "debugThreadInfo", label: "Thread Info and context card" },
  ];
  const workerProjectOptions = [
    { value: "", label: "First project" },
    ...projects
      .filter((project) => !project.isPersonal)
      .map((project) => ({ value: project.id, label: project.name })),
  ];
  const debugProjectOptions = [
    { value: "", label: "Worker project" },
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
        <SettingRow
          label="Worker project"
          description="Where Workstreams' own background threads run when a model call runs as a BB thread. First project uses the first project BB lists."
          control={
            <SettingsPicker
              label="Worker project"
              value={prefs.advanced.workerProjectId}
              options={workerProjectOptions}
              placeholder={
                projectStatus === "loading"
                  ? "Loading projects…"
                  : "Choose a project"
              }
              onChange={(workerProjectId) =>
                update({ advanced: { workerProjectId } })
              }
              disabled={projectStatus !== "ready"}
              className="w-56"
            />
          }
        />
        <SettingRow
          label="Record model traces"
          description="Saves each model call's prompt, reasoning, and response, redacting common secrets, for 7 days."
          control={
            <SettingSwitch
              label="Record model traces"
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
