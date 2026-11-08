import { createContext, useContext, type ReactNode } from "react";

export type PreviewWidth = "wide" | "narrow" | "phone";
const WidthContext = createContext<PreviewWidth>("wide");

export function PreviewWidthProvider({
  width,
  children,
}: {
  width: PreviewWidth;
  children: ReactNode;
}) {
  return (
    <WidthContext.Provider value={width}>{children}</WidthContext.Provider>
  );
}

/**
 * An example's own controls. The page toolbar already carries the
 * "Gallery controls" title, so `label` names what these change.
 */
export function GalleryControls({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      className="gallery-example-controls"
      aria-label="Example controls"
      data-gallery-controls=""
    >
      <h2 className="gallery-example-controls-heading">{label}</h2>
      <div className="gallery-example-controls-content">{children}</div>
    </section>
  );
}

export function GalleryNotes({ children }: { children: ReactNode }) {
  return (
    <div className="gallery-example-notes" data-gallery-documentation="">
      {children}
    </div>
  );
}

export function GalleryActivity({ entries }: { entries: readonly string[] }) {
  if (!entries.length) return null;
  return (
    <GalleryNotes>
      <p role="status" aria-atomic="true">
        {entries[0]}
      </p>
      {entries.length > 1 && (
        <details>
          <summary>Earlier actions</summary>
          <ol>
            {entries.slice(1).map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ol>
        </details>
      )}
    </GalleryNotes>
  );
}

export function LiveExample({
  name,
  sources,
  children,
}: {
  name: string;
  sources: readonly string[];
  children: ReactNode;
}) {
  const width = useContext(WidthContext);
  return (
    // slop-ok: 1 User-requested frame distinguishes the embedded live component from gallery chrome
    <section
      className="gallery-live-example"
      aria-label={`${name} live example`} // slop-ok: 1 User-requested live component identity
      data-gallery-live-example=""
    >
      <header className="gallery-live-example-header">
        <div className="gallery-live-example-heading">
          <span className="gallery-live-example-label">
            {"Live example" /* slop-ok: 1 User-requested boundary label */}
          </span>
          <h2>{name}</h2>
        </div>
        <ul className="gallery-example-sources" aria-label="Component source">
          {sources.map((source) => (
            <li key={source}>
              <a
                href={`https://github.com/tomdale/bb-plugin-workstreams/blob/main/${source}`}
                target="_blank"
                rel="noreferrer"
              >
                {source}
              </a>
            </li>
          ))}
        </ul>
      </header>
      <div
        className="gallery-specimen-stage"
        data-gallery-preview-width={width}
      >
        <div
          className="gallery-specimen-container"
          data-width={width}
          data-gallery-specimen=""
        >
          {children}
        </div>
      </div>
    </section>
  );
}

/** Lays preset variants side by side; each `Variant` is one labeled specimen. */
export function Variants({
  minWidth = "22rem",
  children,
}: {
  /** Narrowest column the grid will create. */
  minWidth?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="grid items-start gap-x-4 gap-y-6"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minWidth}), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export function Variant({
  label,
  wide = false,
  note,
  children,
}: {
  label: string;
  /** What to look for, when the difference is easy to miss. */
  note?: string;
  /** Spans the whole row, for specimens that need the room. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-col gap-2"
      style={wide ? { gridColumn: "1 / -1" } : undefined}
    >
      <div className="space-y-0.5">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        {note && <p className="text-xs text-muted-foreground/80">{note}</p>}
      </div>
      {children}
    </div>
  );
}
