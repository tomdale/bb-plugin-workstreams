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

export function GalleryControls({ children }: { children: ReactNode }) {
  return (
    <section
      className="gallery-example-controls"
      aria-label="Example controls"
      data-gallery-controls=""
    >
      <h2 className="gallery-example-controls-heading">Gallery controls</h2>
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
    <section
      className="gallery-live-example"
      aria-label={`${name} live example`}
      data-gallery-live-example=""
    >
      <header className="gallery-live-example-header">
        <div className="gallery-live-example-heading">
          <span className="gallery-live-example-label">Live example</span>
          <h2>
            <code>{name}</code>
          </h2>
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
