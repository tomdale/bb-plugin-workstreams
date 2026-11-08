import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  CompactSettingRow,
  SectionRows,
  SegmentedControl,
  SettingRow,
  SettingSwitch,
  SettingsGroup,
  SettingsPicker,
  Stepper,
} from "../../src/app/settings/ui";
import {
  GalleryActivity,
  GalleryControls,
  LiveExample,
  Variant,
  Variants,
} from "../ExampleFrame";
import type { GalleryExample } from "../examples";

type Layout = "normal" | "compact" | "stacked";
type ControlState = "enabled" | "disabled";

const projectOptions = [
  {
    value: "workstreams",
    label: "Workstreams",
    description: "Plugin UI and organization",
  },
  {
    value: "release-tools",
    label: "Release tools",
    description: "Release notes and packaging",
  },
  {
    value: "documentation",
    label: "Documentation",
    description: "Guides and API reference",
  },
];
const timestampOptions = [
  { value: "show", label: "Always" },
  { value: "hover", label: "On hover" },
  { value: "hide", label: "Never" },
] as const;

const layouts = [
  { layout: "compact", label: "Compact" },
  { layout: "normal", label: "Normal" },
  { layout: "stacked", label: "Stacked" },
] as const satisfies readonly { layout: Layout; label: string }[];
const controlStates = [
  { state: "enabled", label: "enabled" },
  { state: "disabled", label: "disabled" },
] as const satisfies readonly { state: ControlState; label: string }[];

function SettingsExample() {
  const [recent, setRecent] = useState(true);
  const [upNext, setUpNext] = useState(true);
  const [limit, setLimit] = useState(5);
  const [timestamp, setTimestamp] = useState<"show" | "hover" | "hide">(
    "hover",
  );
  const [project, setProject] = useState("workstreams");
  const [log, setLog] = useState<string[]>([]);
  const record = (message: string) =>
    setLog((items) => [message, ...items].slice(0, 5));
  const updateLimit = (value: number) => {
    setLimit(value);
    record(`Recent: ${value} threads`);
  };
  // The variants share one set of values, so a change in one shows in all.
  const specimen = (layout: Layout, disabled: boolean) => {
    const compact = layout === "compact";
    const size = compact ? "sm" : "md";
    const recentSwitch = (
      <SettingSwitch
        label="Recent"
        size={size}
        checked={recent}
        disabled={disabled}
        onChange={(value) => {
          setRecent(value);
          record(`Recent ${value ? "shown" : "hidden"}`);
        }}
      />
    );
    const count = (
      <div inert={disabled || !recent}>
        <Stepper
          label="threads shown"
          value={limit}
          min={1}
          max={10}
          size={size}
          disabled={disabled || !recent}
          onChange={updateLimit}
        />
      </div>
    );
    const upNextSwitch = (
      <SettingSwitch
        label="Up Next"
        size={size}
        checked={upNext}
        disabled={disabled}
        onChange={(value) => {
          setUpNext(value);
          record(`Up Next ${value ? "shown" : "hidden"}`);
        }}
      />
    );
    return (
      <div
        inert={disabled}
        className={disabled ? "space-y-4 opacity-50" : "space-y-4"}
      >
        <SettingsGroup title="Sections">
          {" "}
          {/* slop-ok: 1 Preserve the demonstrated settings component’s own grouping */}
          <SectionRows compact={compact}>
            {compact ? (
              <>
                <CompactSettingRow label="Up Next" control={upNextSwitch} />
                <CompactSettingRow
                  label="Recent"
                  accessory={count}
                  control={recentSwitch}
                />
              </>
            ) : (
              <>
                <SettingRow
                  label="Up Next"
                  description="Threads most worth your attention." // slop-ok: 1 Preserve the demonstrated settings row’s own description
                  stacked={layout === "stacked"}
                  control={upNextSwitch}
                />
                <SettingRow
                  label="Recent"
                  description="Show recently active threads." // slop-ok: 1 Preserve the demonstrated settings row’s own description
                  stacked={layout === "stacked"}
                  control={
                    <div className="flex flex-wrap items-center gap-3">
                      {count}
                      {recentSwitch}
                    </div>
                  }
                />
              </>
            )}
          </SectionRows>
        </SettingsGroup>
        <SettingsGroup title="Details">
          {" "}
          {/* slop-ok: 1 Preserve the demonstrated settings component’s own grouping */}
          <SectionRows compact={compact}>
            <SettingRow
              label="Timestamp"
              stacked
              control={
                <SegmentedControl
                  label="Timestamp"
                  value={timestamp}
                  options={timestampOptions}
                  onChange={(value) => {
                    setTimestamp(value);
                    record(
                      `Timestamp: ${timestampOptions.find((option) => option.value === value)?.label}`,
                    );
                  }}
                />
              }
            />
            <SettingRow
              label="Home project"
              stacked
              control={
                <SettingsPicker
                  label="Home project"
                  value={project}
                  options={projectOptions}
                  disabled={disabled}
                  className="w-full"
                  onChange={(value) => {
                    setProject(value);
                    record(
                      `Home project: ${projectOptions.find((option) => option.value === value)?.label}`,
                    );
                  }}
                />
              }
            />
          </SectionRows>
        </SettingsGroup>
      </div>
    );
  };
  return (
    <div className="min-w-0 space-y-4">
      <GalleryControls label="Stepper bounds">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!recent}
            onClick={() => updateLimit(1)}
          >
            Set minimum to 1
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!recent}
            onClick={() => updateLimit(10)}
          >
            Set maximum to 10
          </Button>
        </div>
      </GalleryControls>
      <LiveExample
        name="Settings composition"
        sources={["src/app/settings/ui.tsx"]}
      >
        <Variants minWidth="26rem">
          {controlStates.flatMap(({ state, label: stateLabel }) =>
            layouts.map(({ layout, label }) => (
              <Variant
                key={`${layout}-${state}`}
                label={`${label}, ${stateLabel}`}
              >
                {specimen(layout, state === "disabled")}
              </Variant>
            )),
          )}
        </Variants>
      </LiveExample>
      <GalleryActivity entries={log} />
    </div>
  );
}

export const settingsExample: GalleryExample = {
  id: "settings",
  title: "Settings composition",
  group: "Components",
  description:
    "Settings rows, switches, bounded steppers, segmented choices, and a searchable picker.",
  source: `import { useState } from "react";
import { CompactSettingRow, SectionRows, SettingsGroup, SettingSwitch, Stepper } from "../src/app/settings/ui";

const [recent, setRecent] = useState(true);
const [limit, setLimit] = useState(5);

<SettingsGroup title="Sections">
  <SectionRows compact>
    <CompactSettingRow label="Recent"
      accessory={<div inert={!recent}>
        <Stepper size="sm" label="threads shown" value={limit}
          min={1} max={10} disabled={!recent} onChange={setLimit} />
      </div>}
      control={<SettingSwitch size="sm" label="Recent"
        checked={recent} onChange={setRecent} />} />
  </SectionRows>
</SettingsGroup>`,
  render: () => <SettingsExample />,
};
