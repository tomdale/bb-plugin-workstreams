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
import { ExampleChoice } from "../ExampleChoice";
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

function SettingsExample() {
  const [layout, setLayout] = useState<Layout>("compact");
  const [state, setState] = useState<ControlState>("enabled");
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
  const disabled = state === "disabled";
  const compact = layout === "compact";
  const size = compact ? "sm" : "md";
  const updateLimit = (value: number) => {
    setLimit(value);
    record(`Recent: ${value} threads`);
  };
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
    <div className="min-w-0 space-y-4">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
        }}
      >
        <ExampleChoice
          label="Row layout"
          value={layout}
          options={[
            { value: "compact", label: "Compact" },
            { value: "normal", label: "Normal" },
            { value: "stacked", label: "Stacked" },
          ]}
          onChange={setLayout}
        />
        <ExampleChoice
          label="Controls"
          value={state}
          options={[
            { value: "enabled", label: "Enabled" },
            { value: "disabled", label: "Disabled · inert section" },
          ]}
          onChange={setState}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Local settings, using the production row and control exports. Nothing
        reads or saves BB preferences.
      </p>
      <div
        inert={disabled}
        className={disabled ? "space-y-4 opacity-50" : "space-y-4"}
      >
        <SettingsGroup title="Sections">
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
                  description="Threads most worth your attention."
                  stacked={layout === "stacked"}
                  control={upNextSwitch}
                />
                <SettingRow
                  label="Recent"
                  description="Show recently active threads."
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
              description="Open the picker and search for “zz” to see No matches. Tab to an option, then use the arrow keys to move between results."
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
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !recent}
          onClick={() => updateLimit(1)}
        >
          Minimum · 1
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !recent}
          onClick={() => updateLimit(10)}
        >
          Maximum · 10
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Focus the enabled stepper group and use ↑/↓; its buttons stop at 1 and
        10. The disabled section is inert: Stepper’s current keyboard handler
        does not check its disabled prop. Compact rows preserve the production
        accessory column; stacked rows give longer controls their own line.
      </p>
      <section
        aria-label="Local settings actions"
        className="border-t border-border pt-3 text-xs"
      >
        <h3 className="mb-1 font-medium">Local action log</h3>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-muted-foreground"
        >
          {log[0] ?? "No local changes yet"}
        </div>
        {log.length > 1 ? (
          <ol className="mt-1 space-y-1 text-muted-foreground">
            {log.slice(1).map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

export const settingsExample: GalleryExample = {
  id: "settings",
  title: "Settings composition",
  group: "Components",
  description:
    "Production settings rows, switches, bounded steppers, segmented choices, and a searchable picker with local state.",
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
