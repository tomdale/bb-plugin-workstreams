import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import { gatewayModel, type ModelChoice } from "../../domain/prefs.ts";
import { SettingRow, SettingSwitch } from "./ui.tsx";

const pickerValue = (
  choice: ModelChoice,
): ExperimentalProviderModelPickerValue =>
  choice.kind === "gateway"
    ? {
        providerId: "pi",
        model: `vercel-ai-gateway/${choice.model}`,
        reasoningLevel: (choice.reasoningLevel ??
          "none") as ExperimentalProviderModelPickerValue["reasoningLevel"],
      }
    : {
        providerId: choice.providerId,
        model: choice.model,
        reasoningLevel:
          choice.reasoningLevel as ExperimentalProviderModelPickerValue["reasoningLevel"],
        ...(choice.serviceTier
          ? {
              serviceTier:
                choice.serviceTier as ExperimentalProviderModelPickerValue["serviceTier"],
            }
          : {}),
      };

export function ModelField({
  label,
  description,
  choice,
  onChange,
  disabled = false,
  enabled,
}: {
  label: string;
  description: string;
  choice: ModelChoice;
  onChange(choice: ModelChoice): void;
  disabled?: boolean;
  /** A task that can be turned off: its switch sits beside the picker. */
  enabled?: { checked: boolean; onChange(checked: boolean): void };
}) {
  const directModel = gatewayModel(choice);
  const selected = pickerValue(choice);
  return (
    <SettingRow
      label={label}
      description={
        directModel === null
          ? `${description} This model runs in a hidden worker thread and takes several seconds longer per call.`
          : description
      }
      control={
        <div className="flex min-w-0 max-w-full items-center gap-3">
          {enabled ? (
            <SettingSwitch
              label={label}
              checked={enabled.checked}
              onChange={enabled.onChange}
            />
          ) : null}
          <div className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 shadow-sm">
            <ProviderModelPicker
              value={selected}
              onChange={(next) => onChange({ kind: "provider", ...next })}
              align="end"
              disabled={disabled || enabled?.checked === false}
              className="max-w-[22rem]"
              allowProviderChange
            />
          </div>
        </div>
      }
    />
  );
}
