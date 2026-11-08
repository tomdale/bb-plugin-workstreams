import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { WorkstreamIcon } from "../src/app/WorkstreamIcon";
import { WorkstreamName } from "../src/app/WorkstreamName";
import { RecapCardPreview } from "../src/app/composer/RecapCard";
import { examples } from "./examples";
import {
  LiveExample,
  PreviewWidthProvider,
  type PreviewWidth,
} from "./ExampleFrame";
import "./app.css";

type Theme = "light" | "dark" | "system";

const groups = ["Foundations", "Primitives", "Components"] as const;
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
    goal: "Prepared the release summary",
    latest: [{ text: "Grouped results with their review steps" }],
    review: [{ text: "Review the receipt and discount changes together" }],
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
          goal: "Prepared the release summary",
          latest: [{ text: "Grouped results with their review steps" }],
          review: [
            { text: "Review the receipt and discount changes together" },
          ],
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
  // The playground is its own page; its old gallery address forwards to it.
  if (page === "sidebar-playground") window.location.replace("./sidebar.html");
  const isIntroduction = page === "introduction";
  const search = query.trim().toLocaleLowerCase();
  const visibleExamples = examples.filter((entry) =>
    `${entry.title} ${entry.group} ${entry.description}`
      .toLocaleLowerCase()
      .includes(search),
  );
  const showIntroduction = "introduction".includes(search);
  const showSidebarPlayground = "sidebar playground".includes(search);

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
    document.title = `${isIntroduction ? "Introduction" : (example?.title ?? "Page not found")}: Workstreams design system`;
  }, [example, isIntroduction]);

  const title = isIntroduction
    ? "Introduction"
    : (example?.title ?? "Page not found");
  const description = isIntroduction
    ? "BB is the foundation. Workstreams adds identity, attention, and state."
    : (example?.description ??
      "This address does not match a design-system page.");

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
          Search pages
        </label>
        <Input
          id="gallery-search"
          type="search"
          className="gallery-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav aria-label="Design system">
          {showSidebarPlayground && (
            <a className="gallery-nav-link" href="./sidebar.html">
              {
                "Sidebar playground" /* slop-ok: 2 Existing destination name, outside this cleanup */
              }
            </a>
          )}
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
      </aside>

      <main className="gallery-main" id="gallery-main" ref={main} tabIndex={-1}>
        <article className="gallery-document">
          <div className="gallery-page-heading">
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <p className="gallery-description">{description}</p>
          </div>

          {(isIntroduction || example) && (
            <>
              {isIntroduction && (
                <p className="gallery-prose gallery-intro-lead">
                  A topic shows which work belongs together. A recap shows what
                  happened and what needs you.
                </p>
              )}
              <section
                className="gallery-playground"
                aria-label={`${title} examples`}
              >
                <div
                  className="gallery-specimen-toolbar"
                  data-gallery-controls=""
                  aria-label="Gallery preview controls"
                >
                  <span className="gallery-specimen-label">
                    {
                      "Gallery controls" /* slop-ok: 1 User-requested boundary label */
                    }
                  </span>
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
                <PreviewWidthProvider width={width}>
                  <div className="gallery-specimen-content" key={page}>
                    {isIntroduction ? (
                      <LiveExample
                        name="Identity and recap"
                        sources={[
                          "src/app/WorkstreamName.tsx",
                          "src/app/composer/RecapCard.tsx",
                        ]}
                      >
                        <IntroductionPreview />
                      </LiveExample>
                    ) : (
                      example?.render()
                    )}
                  </div>
                </PreviewWidthProvider>
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

          {!isIntroduction && !example && (
            <Button asChild variant="outline" className="gallery-return">
              <a href={pageHref("introduction")}>Back to introduction</a>
            </Button>
          )}
        </article>
      </main>
    </div>
  );
}
