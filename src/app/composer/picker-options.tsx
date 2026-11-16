/**
 * The searchable option lists behind New work's two pickers, drawn in the
 * composer's popovers (`WorkstreamPicker`). The rules — which entries appear,
 * how a query matches, what picking one does to the `NewWork` model — live
 * here once.
 *
 * Product/Feature identity and Workstream placement stay independent:
 * - Identity says what the task concerns in the Catalog.
 * - Placement says where the thread is filed in the sidebar.
 * Choosing one never erases or forces the other. Searching matches full
 * ancestry paths and aliases.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import { workstreamIndex } from "../../domain/workstream-path.ts";
import { compareGroupNames } from "../../domain/group-name-order.ts";
import type { Workstream } from "../../domain/workstreams.ts";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { TAG_ICON } from "../workstream-icon.ts";
import { type NewWork, type NewWorkViewState } from "./new-work.ts";

const NONE = "__none__";
const CREATE = "__create__";
const AUTOMATIC = "__automatic__";

/**
 * BB's option-trigger classes, so a chip lines up with the pickers beside it
 * in BB's row. It is not `shrink-0` as BB's project chip is: when the row is
 * short the label ellipsizes, so nothing in the chip paints over a sibling.
 */
export const CHIP_CLASS =
  "h-8 w-fit max-w-full min-w-0 shrink items-center justify-start gap-1 px-1 text-xs leading-tight border-none bg-transparent shadow-none text-muted-foreground hover:text-muted-foreground";

/** Sizing for the composer's popover lists. */
const LIST_CLASSES = {
  item: "items-start py-[0.3125rem] text-xs max-md:py-2",
  name: "text-xs font-medium",
  input: "h-8 text-xs",
  list: "max-h-72",
  note: "",
} as const;

/**
 * A chip's label. It ellipsizes as the row gets short, but an ellipsis needs
 * room: with only a few pixels left the browser draws a sliver of a letter.
 * Once less than 1.75em of a truncated label remains it is hidden (the box
 * keeps its size, so hiding it can't change the layout that decided to).
 */
export function ChipLabel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tiny, setTiny] = useState(false);
  useLayoutEffect(() => {
    const label = ref.current;
    if (!label || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const em = parseFloat(getComputedStyle(label).fontSize) || 12;
      setTiny(
        label.scrollWidth > label.clientWidth && label.clientWidth < 1.75 * em,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span
      ref={ref}
      data-ws-label-tiny={tiny || undefined}
      className="min-w-0 truncate"
    >
      {children}
    </span>
  );
}

/** A one-or-two-line summary under an item's name, like BB's environment picker. */
function Description({ text }: { text: string | null | undefined }) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return (
    <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
      {trimmed}
    </span>
  );
}

/**
 * The Catalog's entities, fetched each time `enabled` turns on (a picker
 * opening) so the list reflects workstreams added since.
 */
export function useTreeWorkstreams(enabled: boolean): Workstream[] {
  const rpc = useRpc<RpcContract>();
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    rpc
      .call("tree", null)
      .then((result) => {
        if (live) setWorkstreams(result.workstreams);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, rpc]);
  return workstreams;
}

/** The Workstream field's value as the pickers state it. */
export function identityValue(state: NewWorkViewState): string {
  return state.identity ? state.identity.label : "Automatic";
}

interface OptionsProps {
  newWork: NewWork;
  /** The Catalog, empty until `useCatalogEntities` has loaded it. */
  workstreams: readonly Workstream[];
  query: string;
  onQueryChange: (query: string) => void;
  /** Runs after a choice has been applied, so the surface can close. */
  onDone: () => void;
}

/** The Workstream list: Automatic, the workstreams and groups, a new workstream, and No workstream. */
export function IdentityOptions({
  newWork,
  workstreams,
  query,
  onQueryChange,
  onDone,
}: OptionsProps) {
  const state = useSyncExternalStore(
    newWork.subscribeView,
    newWork.viewSnapshot,
  );
  const styles = LIST_CLASSES;
  const needle = query.trim().toLowerCase();
  const index = useMemo(() => workstreamIndex(workstreams), [workstreams]);
  const visibleWorkstreams = useMemo(
    () =>
      index.leafWorkstreams.filter(
        (workstream) =>
          !needle ||
          workstream.searchText.some((text) => text.includes(needle)),
      ),
    [index, needle],
  );
  const exact = index.hasExactName(needle);
  const isManual = state.identity?.provenance === "manual";
  const isUnresolved =
    isManual &&
    state.identity?.workstreamId === null &&
    state.identity?.proposal === null;

  return (
    <Command
      label="Search workstreams"
      shouldFilter={false}
      defaultValue={
        state.identity?.workstreamId
          ? `identity:${state.identity.workstreamId}`
          : isManual
            ? NONE
            : AUTOMATIC
      }
      className="min-h-0"
    >
      <CommandInput
        aria-label="Search workstreams"
        placeholder="Find a workstream"
        value={query}
        onValueChange={onQueryChange}
        className={styles.input}
      />
      <CommandList className={styles.list}>
        <CommandGroup>
          <CommandItem
            value={AUTOMATIC}
            aria-current={!isManual ? "true" : undefined}
            onSelect={() => {
              newWork.selectAutomaticIdentity();
              onDone();
            }}
            className={styles.item}
          >
            <span className="ws-spark" aria-hidden>
              ✦
            </span>
            <span className="min-w-0 flex-1 truncate">
              Automatic
              <span
                className={cn(
                  "block font-normal text-muted-foreground",
                  styles.note,
                )}
              >
                Workstreams chooses from your request
              </span>
            </span>
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                !isManual ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </CommandItem>
        </CommandGroup>
        {visibleWorkstreams.length ? (
          <CommandGroup heading="Workstreams">
            {visibleWorkstreams.map(({ workstream, path: fullLabel }) => {
              const isSelected =
                isManual && state.identity?.workstreamId === workstream.id;
              return (
                <CommandItem
                  key={`identity:${workstream.id}`}
                  value={`identity:${workstream.id}`}
                  aria-current={isSelected ? "true" : undefined}
                  onSelect={() => {
                    newWork.selectIdentity({
                      workstreamId: workstream.id,
                      label: fullLabel,
                    });
                    onDone();
                  }}
                  className={styles.item}
                >
                  <Icon
                    name={TAG_ICON}
                    className="size-4 text-muted-foreground shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn("truncate", styles.name)}>
                      {fullLabel}
                    </span>
                    <Description text={workstream.description} />
                    {workstream.aliases.length > 0 && (
                      <span className="line-clamp-1 text-2xs text-muted-foreground/80">
                        Aliases: {workstream.aliases.join(", ")}
                      </span>
                    )}
                  </span>
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto size-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {visibleWorkstreams.length ? <CommandSeparator /> : null}
        <CommandGroup>
          {needle && !exact ? (
            <CommandItem
              value={CREATE}
              onSelect={() => {
                newWork.selectIdentity({
                  proposal: { name: query.trim(), description: "" },
                  label: query.trim(),
                });
                onDone();
              }}
              className={styles.item}
            >
              <Icon
                name="Plus"
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                New workstream “{query.trim()}”
              </span>
            </CommandItem>
          ) : null}
          <CommandItem
            value={NONE}
            aria-current={isUnresolved ? "true" : undefined}
            onSelect={() => {
              newWork.selectIdentity(null);
              onDone();
            }}
            className={styles.item}
          >
            <Icon
              name="X"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            No workstream
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                isUnresolved ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
