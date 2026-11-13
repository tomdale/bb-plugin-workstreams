import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { presenceProps, type FoldState, type PresencePhase } from "./motion.ts";

/**
 * A fold's chevron: one arrow that turns a quarter turn as the fold opens,
 * over the 150ms BB's own sidebar uses, so the state reads without the icon
 * swapping out from under the pointer.
 */
export function FoldChevron({ open }: { open: boolean }) {
  return (
    <Icon
      name="ChevronRight"
      className={cn(
        "size-3 transition-transform duration-150 motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );
}

/**
 * The phase of the folds around a row. A fold publishes its own phase joined
 * with this one (see `rowsPhase`), so a row nested in a fold that is at rest
 * inside a folding ancestor still sees the ancestor leaving.
 */
const FoldPhase = createContext<PresencePhase>("idle");

/**
 * The phase a fold's rows see: `own`, unless any fold around it is leaving.
 * Once one is, they are all leaving, because that ancestor's closing takes
 * every row inside it, however far the fold nearest them has opened.
 */
export function rowsPhase(
  own: PresencePhase,
  enclosing: PresencePhase,
): PresencePhase {
  return own === "leave" || enclosing === "leave" ? "leave" : own;
}

/** The phase of the folds around this row. */
export function useFoldPhase(): PresencePhase {
  return useContext(FoldPhase);
}

/**
 * Closes a menu the moment the folds around it start closing. The contents
 * stay mounted, inert, until the fold finishes, and a menu left open over
 * them would outlive the row it belongs to.
 */
export function useCloseOnFoldLeave(open: boolean, close: () => void) {
  const leaving = useFoldPhase() === "leave";
  useEffect(() => {
    if (leaving && open) close();
    // `close` only has to be current when the fold starts leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, open]);
}

/**
 * The contents of a fold (see `useFold`), which stay mounted through the
 * closing animation and unmount once it ends. `listRef` and `listClassName`
 * reach the list inside, for a caller that scans or spaces it.
 */
export function FoldBody({
  fold,
  listRef,
  listClassName = "mt-0.5",
  children,
}: {
  fold: FoldState & { readonly ref: (element: HTMLElement | null) => void };
  listRef?: Ref<HTMLUListElement>;
  listClassName?: string;
  children: ReactNode;
}) {
  const enclosing = useFoldPhase();
  if (!fold.render) return null;
  return (
    <div className="ws-fold" ref={fold.ref} {...presenceProps(fold.phase)}>
      <ul ref={listRef} className={listClassName}>
        <FoldPhase.Provider value={rowsPhase(fold.phase, enclosing)}>
          {children}
        </FoldPhase.Provider>
      </ul>
    </div>
  );
}

/**
 * Returns focus to a fold's header button when the fold closes while focus
 * sits inside its rows or a menu it opened, instead of letting the browser
 * drop focus to `<body>` as those rows unmount. A fold that mounts already
 * closed leaves focus where it is: the recovery happens only on a real
 * open-to-closed transition, and only when focus actually belonged to the
 * fold.
 *
 * `root` names the fold's header element (which also holds any menu its
 * header opens), and `contents` the element its rows live in. Both are
 * getters so a caller can hand over a ref without coupling to a specific
 * element type. Focus is read during render, before the commit that closes
 * the fold removes the rows, so a fold that closes without motion (reduced
 * motion, or as in tests) can still recover focus to the header.
 */
export function useFoldFocusRestore({
  open,
  root,
  contents,
}: {
  /** Whether the fold is open (its rows shown). */
  open: boolean;
  /** The fold's header element, which holds the button that folds it. */
  root: () => HTMLElement | null;
  /** The fold's contents, which lose focus when they unmount. */
  contents: () => HTMLElement | null;
}): void {
  const wasOpen = useRef(open);
  const focusInside = useRef(false);
  focusInside.current = focusInsideFold(root(), contents());
  useEffect(() => {
    const closing = wasOpen.current && !open;
    wasOpen.current = open;
    if (closing && focusInside.current) {
      root()
        ?.querySelector<HTMLButtonElement>("button[aria-expanded]")
        ?.focus();
    }
    // Refs the getters read are not reactive; only `open` gates the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Whether focus sits in a fold's rows or a menu the fold opened. */
function focusInsideFold(
  section: HTMLElement | null,
  contents: HTMLElement | null,
): boolean {
  if (typeof document === "undefined" || !section || !contents) return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (contents.contains(active)) return true;
  // A menu opened from the fold portals outside the section, so it is
  // matched by the portal mark for as long as this section holds the menu's
  // open trigger.
  return (
    active.closest("[data-bb-portaled-overlay]") !== null &&
    section.querySelector('[data-state="open"][aria-haspopup]') !== null
  );
}

/**
 * An element that opens and closes its height with its presence phase (see
 * `usePresence`, `.ws-presence` in styles.css). `gap` is the flex gap after
 * it that closes with it, which sibling blocks in a stack need.
 */
export function Presence({
  phase,
  as: Tag = "div",
  gap = false,
  className,
  children,
  ...rest
}: {
  phase: PresencePhase;
  as?: "div" | "li";
  gap?: boolean;
  className?: string;
  children: ReactNode;
  "data-flip-key"?: string;
}) {
  return (
    <Tag
      {...rest}
      className={cn(
        "ws-presence",
        gap && "[--ws-presence-gap:0.5rem]",
        className,
      )}
      {...presenceProps(phase)}
    >
      {children}
    </Tag>
  );
}
