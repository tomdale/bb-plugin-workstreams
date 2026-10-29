import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MAX_PRESET_LABEL,
  defaultWakeOnEvents,
  presetWakesOnEvents,
  ruleLabel,
  type SnoozePreset,
  type SnoozeRule,
  wakeSentence,
} from "../../domain/snooze.ts";
import {
  SnoozeRuleFields,
  draftOf,
  resolveDraft,
  type SnoozeDraft,
} from "./RuleFields.tsx";

/** What a preset can do: every rule kind, but no one-off date. */
const PRESET_KINDS = ["duration", "time", "activity"] as const;

/**
 * Adds a snooze preset (`preset` absent) or edits one. `onSave` receives the
 * label, empty to label the preset by its rule, the rule, and whether it
 * wakes early on events.
 */
export function PresetDialog({
  open,
  preset,
  onClose,
  onSave,
}: {
  open: boolean;
  preset?: SnoozePreset;
  onClose: () => void;
  onSave: (change: {
    label: string;
    rule: SnoozeRule;
    wakeOnEvents: boolean;
  }) => void;
}) {
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<SnoozeDraft>(() =>
    draftOf(preset?.rule, Date.now()),
  );
  useEffect(() => {
    if (!open) return;
    setLabel(preset?.label ?? "");
    setDraft(
      draftOf(
        preset?.rule ?? { kind: "duration", amount: 2, unit: "hours" },
        Date.now(),
        undefined,
        // A choice that matches its kind's default follows the kind, so
        // changing the kind brings that kind's default.
        preset &&
          presetWakesOnEvents(preset) !== defaultWakeOnEvents(preset.rule.kind)
          ? presetWakesOnEvents(preset)
          : null,
      ),
    );
  }, [open, preset]);
  const now = Date.now();
  const result = resolveDraft(draft, now);
  // Focus starts on the rule's first field, or on the label when the rule
  // has none; never on a kind it doesn't have.
  const opensOnField = (preset?.rule.kind ?? "duration") !== "activity";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!result.ok || !result.rule) return;
    onSave({
      label: label.trim(),
      rule: result.rule,
      wakeOnEvents: result.events,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{preset ? "Edit preset" : "Add preset"}</DialogTitle>
          </DialogHeader>
          <SnoozeRuleFields
            draft={draft}
            onChange={setDraft}
            kinds={PRESET_KINDS}
            autoFocus={opensOnField}
          />
          <div>
            <label className="text-xs font-medium text-foreground">
              Label
              <Input
                autoFocus={!opensOnField}
                value={label}
                maxLength={MAX_PRESET_LABEL}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={
                  result.ok && result.rule ? ruleLabel(result.rule) : ""
                }
                className="mt-1 h-8 text-sm font-normal"
              />
            </label>
          </div>
          {!result.ok || result.until !== null ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {result.ok
                ? wakeSentence(result.until, now, result.events)
                : result.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!result.ok}>
              {preset ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
