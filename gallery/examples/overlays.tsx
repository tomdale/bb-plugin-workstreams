import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { CompactViewportOverrideProvider } from "../../components/ui/hooks/use-compact-viewport";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Hint } from "../../src/app/Hint";
import {
  HoverAction,
  HoverMenuButton,
  RowActions,
} from "../../src/app/sidebar/HoverActions";
import { plainMenuKit } from "../../src/app/snooze/SnoozeMenuItems";
import {
  GalleryActivity,
  LiveExample,
  Variant,
  Variants,
} from "../ExampleFrame";
import type { GalleryExample } from "../examples";

type Presentation = "viewport" | "floating" | "drawer";
type Submission = "save" | "reject" | "pending";
const {
  Item: MenuItem,
  Label: MenuLabel,
  Separator: MenuSeparator,
} = plainMenuKit;

function ActionRow({
  compact,
  record,
}: {
  compact: boolean;
  record: (message: string) => void;
}) {
  const name = "Check the release notes";
  const copy = () => record(`Copy requested: ${name}`);
  return (
    <section
      aria-label="Sidebar action composition"
      className="min-w-0 rounded-md border border-border bg-sidebar p-2"
    >
      <div className="group/row flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-sidebar-accent">
        <button
          type="button"
          onClick={() => record(`Opened: ${name}`)}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {name}
        </button>
        <span className="pointer-events-none shrink-0 text-[11px] tabular-nums text-muted-foreground group-hover/row:hidden group-has-[:focus-visible]/row:hidden group-has-[[data-state=open]]/row:hidden">
          2m
        </span>
        <RowActions>
          <HoverAction
            compact={compact}
            label="Archive thread"
            hint="Archive"
            onClick={() => record("Archive requested")}
          >
            <Icon name="Archive" className="size-3.5" />
          </HoverAction>
          <HoverMenuButton
            compact={compact}
            label="Copy thread"
            onClick={copy}
            menu={
              <>
                <MenuLabel>Thread actions</MenuLabel>
                <MenuItem onSelect={copy}>Copy name</MenuItem>
                <MenuItem onSelect={() => record("Copy link requested")}>
                  Copy link
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  onSelect={() => record("Archive requested from menu")}
                >
                  Archive
                </MenuItem>
              </>
            }
          >
            <Icon name="Copy" className="size-3.5" />
          </HoverMenuButton>
        </RowActions>
      </div>
    </section>
  );
}

function OverlayButtons({
  submission,
  record,
}: {
  submission: Submission;
  record: (message: string) => void;
}) {
  const [name, setName] = useState("Check the release notes");
  const [value, setValue] = useState(name);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishSave = () => {
    setName(value.trim());
    setDialogOpen(false);
    record(`Name saved: ${value.trim()}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !value.trim()) return;
    if (submission === "reject") {
      setError("Couldn’t save the name. Try again.");
      record("Save rejected");
    } else if (submission === "pending") {
      setBusy(true);
      record("Saving name…");
    } else {
      finishSave();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Hint label="Read the release notes" side="bottom">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => record("Release notes opened")}
        >
          Release notes
        </Button>
      </Hint>
      <Popover
        open={popoverOpen}
        onOpenChange={(next) => {
          setPopoverOpen(next);
          record(`Options ${next ? "opened" : "closed"}`);
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            Open options
          </Button>
        </PopoverTrigger>
        <PopoverContent
          mobileTitle="Options"
          className="w-64 max-w-[calc(100vw-1rem)] space-y-3 p-3"
        >
          <p className="text-sm font-medium">Options</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              record("Release notes selected");
              setPopoverOpen(false);
            }}
          >
            Review release notes
          </Button>
        </PopoverContent>
      </Popover>
      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (next) {
            setValue(name);
            setError(null);
            setBusy(false);
          }
          setDialogOpen(next);
          record(`Rename ${next ? "opened" : "closed"}`);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            Rename thread…
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <form onSubmit={submit} className="min-w-0 space-y-3">
            <DialogHeader>
              <DialogTitle>Rename thread</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1 text-xs">
              <span>Thread name</span>
              <Input
                autoFocus
                value={value}
                disabled={busy}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {busy ? (
              <div className="space-y-2">
                <p role="status" className="text-xs text-muted-foreground">
                  Saving thread name…
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDialogOpen(false);
                  record("Rename cancelled");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !value.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const presentations: readonly {
  label: string;
  presentation: Presentation;
  submission: Submission;
}[] = [
  { label: "Follow viewport", presentation: "viewport", submission: "save" },
  { label: "Desktop overlays", presentation: "floating", submission: "save" },
  { label: "Compact drawers", presentation: "drawer", submission: "save" },
  {
    label: "Dialog rejects the save",
    presentation: "viewport",
    submission: "reject",
  },
  {
    label: "Dialog holds pending",
    presentation: "viewport",
    submission: "pending",
  },
];

function OverlaysExample() {
  const [log, setLog] = useState<string[]>([]);
  const record = (message: string) =>
    setLog((items) => [message, ...items].slice(0, 6));
  return (
    <div className="min-w-0 space-y-4">
      <LiveExample
        name="RowActions composition"
        sources={[
          "src/app/sidebar/HoverActions.tsx",
          "src/app/snooze/SnoozeMenuItems.tsx",
        ]}
      >
        <Variants>
          <Variant label="Normal actions">
            <ActionRow compact={false} record={record} />
          </Variant>
          <Variant label="Compact actions">
            <ActionRow compact record={record} />
          </Variant>
        </Variants>
      </LiveExample>
      <LiveExample
        name="Hints and overlays"
        sources={[
          "src/app/Hint.tsx",
          "components/ui/dialog.tsx",
          "components/ui/popover.tsx",
          "components/ui/button.tsx",
        ]}
      >
        <Variants>
          {presentations.map(({ label, presentation, submission }) => (
            <Variant key={label} label={label}>
              {presentation === "viewport" ? (
                <OverlayButtons submission={submission} record={record} />
              ) : (
                <CompactViewportOverrideProvider
                  isCompactViewport={presentation === "drawer"}
                >
                  <OverlayButtons submission={submission} record={record} />
                </CompactViewportOverrideProvider>
              )}
            </Variant>
          ))}
        </Variants>
      </LiveExample>
      <GalleryActivity entries={log} />
    </div>
  );
}

export const overlaysExample: GalleryExample = {
  id: "actions-overlays",
  title: "Actions, hints, and overlays",
  group: "Components",
  description:
    "Row actions, hints, hover menus, responsive popovers, and dialog validation.",
  source: `import { Icon } from "../components/ui/icon";
import { HoverAction, HoverMenuButton, RowActions } from "../src/app/sidebar/HoverActions";
import { plainMenuKit } from "../src/app/snooze/SnoozeMenuItems";

const { Item: MenuItem } = plainMenuKit;

<div className="group/row flex min-w-0 items-center gap-1.5">
  <button type="button" className="min-w-0 flex-1 truncate">Check the release notes</button>
  <RowActions>
    <HoverAction label="Archive thread" onClick={recordArchive}>
      <Icon name="Archive" className="size-3.5" />
    </HoverAction>
    <HoverMenuButton label="Copy thread" onClick={recordCopy}
      menu={<MenuItem onSelect={recordCopy}>Copy name</MenuItem>}>
      <Icon name="Copy" className="size-3.5" />
    </HoverMenuButton>
  </RowActions>
</div>`,
  render: () => <OverlaysExample />,
};
