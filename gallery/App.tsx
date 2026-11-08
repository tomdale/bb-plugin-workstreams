import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { RecapCardPreview } from "../src/app/composer/RecapCard";
import { examples } from "./examples";
import "./app.css";

type Theme = "light" | "dark" | "system";
type PreviewWidth = "wide" | "narrow" | "phone";

const groups = ["Foundations", "Components"] as const;
const introductionSource = `import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { RecapCardPreview } from "../src/app/composer/RecapCard";

<WorkstreamIcon />
<WorkstreamName name="Workstreams: Design system" />
<RecapCardPreview
  layout="minimal"
  recap={{
    id: "gallery-introduction",
    turnId: "gallery-local",
    at: 0,
    state: "review",
    goal: "Prepared the design-system playground",
    latest: [{ text: "Real components with local example data" }],
    review: [{ text: "Check the specimens in light and dark themes" }],
    links: [],
    next: [],
  }}
/>`;

function pageFromHash() {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || "introduction";
  } catch {
    return "introduction";
  }
}

function pageHref(id: string) {
  return `#${encodeURIComponent(id)}`;
}

function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className="gallery-choices"
      orientation="horizontal"
    >
      {options.map((option) => (
        <label className="gallery-choice" key={option.value}>
          <RadioGroupItem value={option.value} className="gallery-radio" />
          <span>{option.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

function Source({ source }: { source: string }) {
  return (
    <details className="gallery-source">
      <summary>View source</summary>
      <pre tabIndex={0} aria-label="Example source code">
        <code>{source}</code>
      </pre>
    </details>
  );
}

function IntroductionPreview() {
  return (
    <div className="gallery-intro-preview">
      <div className="gallery-topic">
        <WorkstreamIcon />
        <WorkstreamName name="Workstreams: Design system" />
      </div>
      <RecapCardPreview
        layout="minimal"
        recap={{
          id: "gallery-introduction",
          turnId: "gallery-local",
          at: 0,
          state: "review",
          goal: "Prepared the design-system playground",
          latest: [{ text: "Real components with local example data" }],
          review: [{ text: "Check the specimens in light and dark themes" }],
          links: [],
          next: [],
        }}
      />
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("system");
  const [width, setWidth] = useState<PreviewWidth>("wide");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const example = examples.find((entry) => entry.id === page);
  const isIntroduction = page === "introduction";
  const search = query.trim().toLocaleLowerCase();
  const visibleExamples = examples.filter((entry) =>
    `${entry.title} ${entry.group} ${entry.description}`
      .toLocaleLowerCase()
      .includes(search),
  );
  const showIntroduction = "introduction".includes(search);

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash());
      setNavigationOpen(false);
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        heading.current?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        theme === "dark" || (theme === "system" && preference.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.title = `${isIntroduction ? "Introduction" : (example?.title ?? "Page not found")} · Workstreams design system`;
  }, [example, isIntroduction]);

  const title = isIntroduction
    ? "Introduction"
    : (example?.title ?? "Page not found");
  const description = isIntroduction
    ? "BB is the foundation. Workstreams adds a language for work identity, attention, and reported state."
    : (example?.description ??
      "This address does not match a page in the design-system playground.");

  return (
    <div className="gallery-shell" data-bb-plugin="workstreams">
      <a
        className="gallery-skip"
        href="#gallery-main"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="gallery-header">
        <a className="gallery-identity" href={pageHref("introduction")}>
          <WorkstreamIcon className="gallery-identity-mark" />
          <span>Workstreams</span>
          <span className="gallery-identity-divider" aria-hidden="true">
            /
          </span>
          <span className="gallery-identity-section">Design system</span>
        </a>
        <div className="gallery-header-controls">
          <Choices<Theme>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            className="gallery-menu-button"
            aria-expanded={navigationOpen}
            aria-controls="gallery-navigation"
            onClick={() => setNavigationOpen((open) => !open)}
          >
            Pages
          </Button>
        </div>
      </header>

      <aside
        id="gallery-navigation"
        className="gallery-sidebar"
        data-open={navigationOpen}
      >
        <label htmlFor="gallery-search" className="gallery-search-label">
          Find a page
        </label>
        <Input
          id="gallery-search"
          type="search"
          placeholder="Search documentation…"
          className="gallery-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav aria-label="Design system">
          {showIntroduction && (
            <a
              className="gallery-nav-link gallery-nav-introduction"
              href={pageHref("introduction")}
              aria-current={isIntroduction ? "page" : undefined}
              onClick={() => setNavigationOpen(false)}
            >
              Introduction
            </a>
          )}
          {groups.map((group) => {
            const entries = visibleExamples.filter(
              (entry) => entry.group === group,
            );
            if (!entries.length) return null;
            return (
              <section className="gallery-nav-group" key={group}>
                <h2>{group}</h2>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <a
                        className="gallery-nav-link"
                        href={pageHref(entry.id)}
                        aria-current={page === entry.id ? "page" : undefined}
                        onClick={() => setNavigationOpen(false)}
                      >
                        {entry.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {!showIntroduction && visibleExamples.length === 0 && (
            <p className="gallery-no-results" role="status">
              No pages match “{query}”.
            </p>
          )}
        </nav>
        <p className="gallery-sidebar-note">
          Local playground · simulated BB host
        </p>
      </aside>

      <main className="gallery-main" id="gallery-main" ref={main} tabIndex={-1}>
        <article className="gallery-document">
          <div className="gallery-page-heading">
            <p className="gallery-eyebrow">
              {isIntroduction
                ? "Workstreams in BB"
                : (example?.group ?? "Documentation")}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <p className="gallery-description">{description}</p>
          </div>

          {(isIntroduction || example) && (
            <>
              {isIntroduction && (
                <p className="gallery-prose gallery-intro-lead">
                  Topic identity tells you which work belongs together. A recap
                  tells you what happened and what needs your attention. The
                  components below come from Workstreams itself.
                </p>
              )}
              <section
                className="gallery-specimen-section"
                aria-label={`${title} live example`}
              >
                <div className="gallery-specimen-toolbar">
                  <span className="gallery-specimen-label">Preview</span>
                  <Choices<PreviewWidth>
                    label="Preview width"
                    value={width}
                    onChange={setWidth}
                    options={[
                      { value: "wide", label: "Wide" },
                      { value: "narrow", label: "Narrow" },
                      { value: "phone", label: "Phone" },
                    ]}
                  />
                </div>
                <div
                  className="gallery-specimen-stage"
                  data-gallery-preview-width={width}
                >
                  <div
                    className="gallery-specimen-container"
                    data-width={width}
                  >
                    <div className="gallery-specimen-content" key={page}>
                      {isIntroduction ? (
                        <IntroductionPreview />
                      ) : (
                        example?.render()
                      )}
                    </div>
                  </div>
                </div>
                <p className="gallery-width-note">
                  Wide fills the preview. Narrow is 640px; Phone is 360px,
                  capped to fit. These test container layouts, not device
                  behavior.
                </p>
                <Source
                  key={page}
                  source={
                    isIntroduction
                      ? introductionSource
                      : (example?.source ?? "")
                  }
                />
              </section>
            </>
          )}

          {isIntroduction && (
            <>
              <section className="gallery-reading-section">
                <h2>Built from the real UI</h2>
                <p className="gallery-prose">
                  Specimens import the same components, registry controls, and
                  semantic tokens as the plugin. BB’s host is simulated here;
                  example data and interactions stay local. This playground does
                  not write to your threads, topics, or settings.
                </p>
                <p className="gallery-prose">
                  The documentation shell gives examples room to breathe outside
                  the plugin. Inside each preview, Workstreams keeps its compact
                  component typography and density. Theme and width controls
                  help inspect that boundary without restyling the components.
                </p>
              </section>
              <section
                className="gallery-reading-section"
                aria-labelledby="gallery-index-heading"
              >
                <h2 id="gallery-index-heading">Explore the system</h2>
                <div className="gallery-index">
                  {groups.map((group) => (
                    <section className="gallery-index-group" key={group}>
                      <h3>{group}</h3>
                      <ul>
                        {examples
                          .filter((entry) => entry.group === group)
                          .map((entry) => (
                            <li key={entry.id}>
                              <a href={pageHref(entry.id)}>
                                {entry.title}
                                <span aria-hidden="true"> →</span>
                              </a>
                              <p>{entry.description}</p>
                            </li>
                          ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </section>
            </>
          )}
          {!isIntroduction && !example && (
            <Button asChild variant="outline" className="gallery-return">
              <a href={pageHref("introduction")}>Back to introduction</a>
            </Button>
          )}
          <footer className="gallery-footer">
            Workstreams design system <span aria-hidden="true">/</span>{" "}
            Development playground
          </footer>
        </article>
      </main>
    </div>
  );
}
