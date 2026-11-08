/**
 * The recap card's visual primitives, shared with reply components so a
 * structured reply reads in the same voice as the card: small labels in a
 * fixed gutter beside their content, and stroked marks in a narrow column
 * before each item.
 */

// On a phone (a viewport under 768px with a coarse pointer) BB moves its text
// a size up; secondary text follows to `text-xs`.
export const PHONE_SECONDARY = "max-md:pointer-coarse:text-xs";

/** A row label: the card's small medium-weight text. */
export const LABEL_CLASS = `pt-px text-[11px] font-medium leading-[1.6] ${PHONE_SECONDARY}`;

/** A label gutter beside its content; callers add the narrow-width stack. */
export const LABEL_GUTTER_CLASS =
  "grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-0.5";

/** A mark column before each item's text. */
export const MARK_ROW_CLASS =
  "grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 max-md:pointer-coarse:grid-cols-[1.125rem_minmax(0,1fr)]";

/** Sizes a mark to the first line of the text beside it. */
export const MARK_CLASS =
  "mt-[0.2em] h-3.5 w-3.5 max-md:pointer-coarse:h-4 max-md:pointer-coarse:w-4";

export const CHECK = "M3.5 8.5 6.5 11.5 12.5 4.5";

export function Glyph({
  path,
  className,
  filled = false,
  dashed = false,
}: {
  path: string;
  className: string;
  filled?: boolean;
  /** A broken stroke, for a state nobody has established yet. */
  dashed?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? "2 2.4" : undefined}
    >
      <path d={path} />
    </svg>
  );
}
