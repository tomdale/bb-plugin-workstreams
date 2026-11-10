import {
  createContext,
  useContext,
  useEffect,
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

/** The phase of the fold a row sits in, so its open menus can close with it. */
const FoldPhase = createContext<PresencePhase>("idle");

/**
 * Closes a menu the moment the fold around it starts closing. The contents
 * stay mounted, inert, until the fold finishes, and a menu left open over
 * them would outlive the row it belongs to.
 */
export function useCloseOnFoldLeave(open: boolean, close: () => void) {
  const leaving = useContext(FoldPhase) === "leave";
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
  if (!fold.render) return null;
  return (
    <div className="ws-fold" ref={fold.ref} {...presenceProps(fold.phase)}>
      <ul ref={listRef} className={listClassName}>
        <FoldPhase.Provider value={fold.phase}>{children}</FoldPhase.Provider>
      </ul>
    </div>
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
