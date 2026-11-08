import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ExampleChoice } from "../ExampleChoice";
import { GalleryControls, GalleryNotes, LiveExample } from "../ExampleFrame";
import type { GalleryExample } from "../examples";

type Presentation = "viewport" | "floating" | "drawer";
type Submission = "save" | "reject" | "pending";
const {
  Item: MenuItem,
  Label: MenuLabel,
  Separator: MenuSeparator,
} = plainMenuKit;

function OverlaysExample() {
  const [presentation, setPresentation] = useState<Presentation>("viewport");
  const [submission, setSubmission] = useState<Submission>("save");
  const [compact, setCompact] = useState(false);
  const [name, setName] = useState("Check the release notes");
  const [value, setValue] = useState(name);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const record = (message: string) =>
    setLog((items) => [message, ...items].slice(0, 6));
  const copy = () => record(`Local copy requested: ${name}`);
  const finishSave = () => {
    setName(value.trim());
    setDialogOpen(false);
    record(`Local name saved: ${value.trim()}`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !value.trim()) return;
    if (submission === "reject") {
      setError("Local save rejected. Your edit is still here.");
      record("Local save rejected");
    } else if (submission === "pending") {
      setBusy(true);
      record("Local save pending; Cancel closes the dialog");
    } else {
      finishSave();
    }
  };
  const specimens = (
    <div className="min-w-0 space-y-4">
      <LiveExample
        name="RowActions · gallery row composition"
        sources={[
          "src/app/sidebar/HoverActions.tsx",
          "src/app/snooze/SnoozeMenuItems.tsx",
        ]}
      >
        <section
          aria-label="Sidebar action composition"
          className="min-w-0 rounded-md border border-border bg-sidebar p-2"
        >
          <div className="group/row flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-sidebar-accent">
            <button
              type="button"
              onClick={() => record(`Local row activated: ${name}`)}
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
                label="Archive local thread"
                hint="Archive"
                onClick={() =>
                  record("Local archive requested; row kept for inspection")
                }
              >
                <Icon name="Archive" className="size-3.5" />
              </HoverAction>
              <HoverMenuButton
                compact={compact}
                label="Copy local thread"
                onClick={copy}
                menu={
                  <>
                    <MenuLabel>Local thread actions</MenuLabel>
                    <MenuItem onSelect={copy}>Copy name</MenuItem>
                    <MenuItem
                      onSelect={() =>
                        record("Local copy-link requested; clipboard unchanged")
                      }
                    >
                      Copy link
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      onSelect={() =>
                        record("Local archive requested from menu")
                      }
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
      </LiveExample>
      <GalleryNotes>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Hover or Tab into the row to replace its age with actions. Archive
          uses Hint. Click Copy to run the local action; rest the pointer on
          Copy to open its menu. From Copy, ↓ opens the menu; ↑/↓, Home, and End
          move focus; Escape returns keyboard focus. Action clicks do not
          activate the row. These hover-only actions stay hidden on coarse
          pointers.
        </p>
      </GalleryNotes>
      <LiveExample
        name="Hint · Dialog · Popover"
        sources={[
          "src/app/Hint.tsx",
          "components/ui/dialog.tsx",
          "components/ui/popover.tsx",
          "components/ui/button.tsx",
        ]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Hint label="A shared Hint on a labeled control" side="bottom">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => record("Hint control activated locally")}
            >
              Hint control
            </Button>
          </Hint>
          <Popover
            open={popoverOpen}
            onOpenChange={(next) => {
              setPopoverOpen(next);
              record(`Local popover ${next ? "opened" : "closed"}`);
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                Open options
              </Button>
            </PopoverTrigger>
            <PopoverContent
              mobileTitle="Local options"
              className="w-64 max-w-[calc(100vw-1rem)] space-y-3 p-3"
            >
              <p className="text-sm font-medium">Local options</p>
              <p className="text-xs text-muted-foreground">
                Inspect the release notes before archiving this thread.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  record("Local popover action ran");
                  setPopoverOpen(false);
                }}
              >
                Record local action
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
              record(`Local rename ${next ? "opened" : "closed"}`);
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                Rename local thread…
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <form onSubmit={submit} className="min-w-0 space-y-3">
                <DialogHeader>
                  <DialogTitle>Rename local thread</DialogTitle>
                  <DialogDescription>
                    Choose a name that describes this thread’s work.
                  </DialogDescription>
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
                      record("Local rename cancelled");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !value.trim()}
                  >
                    Save
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </LiveExample>
    </div>
  );
  return (
    <div className="min-w-0 space-y-4">
      <GalleryControls>
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
          }}
        >
          <ExampleChoice
            label="Overlay presentation"
            value={presentation}
            options={[
              { value: "viewport", label: "Follow viewport" },
              { value: "floating", label: "Desktop overlays" },
              { value: "drawer", label: "Compact drawers" },
            ]}
            onChange={setPresentation}
          />
          <ExampleChoice
            label="Local dialog submission"
            value={submission}
            options={[
              { value: "save", label: "Save locally" },
              { value: "reject", label: "Reject locally" },
              { value: "pending", label: "Hold pending" },
            ]}
            onChange={setSubmission}
          />
          <ExampleChoice
            label="Action size"
            value={compact ? "compact" : "normal"}
            options={[
              { value: "normal", label: "Normal · thread row" },
              { value: "compact", label: "Compact · header action" },
            ]}
            onChange={(next) => setCompact(next === "compact")}
          />
        </div>
      </GalleryControls>
      {presentation === "viewport" ? (
        specimens
      ) : (
        <CompactViewportOverrideProvider
          isCompactViewport={presentation === "drawer"}
        >
          {specimens}
        </CompactViewportOverrideProvider>
      )}
      <GalleryNotes>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Dialog and Popover are the real responsive registry controls; the
          hover menu uses a floating Radix portal in every mode. Portals escape
          the specimen container. Compact drawers override the React viewport
          hook, not touch media queries or the soft keyboard. Dialog contents
          stay mounted through closing. Desktop dialogs return focus to their
          trigger; compact drawers restore the previously focused content. Click
          outside a popover or press Escape to dismiss it. Clear the dialog name
          to disable Save; Hold pending shows a local pending state until Cancel
          or dismissal. No request is sent.
        </p>
        <section
          aria-label="Local overlay actions"
          className="border-t border-border pt-3 text-xs"
        >
          <h3 className="mb-1 font-medium">Local action log</h3>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="break-words text-muted-foreground"
          >
            {log[0] ?? "No local actions yet"}
          </div>
          {log.length > 1 ? (
            <ol className="mt-1 space-y-1 break-words text-muted-foreground">
              {log.slice(1).map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ol>
          ) : null}
        </section>
      </GalleryNotes>
    </div>
  );
}

export const overlaysExample: GalleryExample = {
  id: "actions-overlays",
  title: "Actions, hints, and overlays",
  group: "Components",
  description:
    "Real row-action reveal, hints, hover menus, responsive popovers, and dialog validation with local action logging.",
  source: `import { Icon } from "../components/ui/icon";
import { HoverAction, HoverMenuButton, RowActions } from "../src/app/sidebar/HoverActions";
import { plainMenuKit } from "../src/app/snooze/SnoozeMenuItems";

const { Item: MenuItem } = plainMenuKit;

<div className="group/row flex min-w-0 items-center gap-1.5">
  <button type="button" className="min-w-0 flex-1 truncate">Local thread</button>
  <RowActions>
    <HoverAction label="Archive local thread" onClick={recordLocalArchive}>
      <Icon name="Archive" className="size-3.5" />
    </HoverAction>
    <HoverMenuButton label="Copy local thread" onClick={recordLocalCopy}
      menu={<MenuItem onSelect={recordLocalCopy}>Copy name</MenuItem>}>
      <Icon name="Copy" className="size-3.5" />
    </HoverMenuButton>
  </RowActions>
</div>`,
  render: () => <OverlaysExample />,
};
