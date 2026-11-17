/**
 * The fixture page that `scripts/perf.mjs` builds and measures.
 * `perf.html?page=<name>&size=<count>` mounts one entry of `pages` inside a
 * React Profiler, on React's profiling build so the Profiler reports commits,
 * and publishes `window.__perf` for the runner to read. A `css` parameter is
 * added to the page as a stylesheet: the runner's way to switch one thing off.
 *
 * To add a page, write a module beside this one that exports
 * `(size) => Component`, list it in `pages`, and describe it under the same
 * name in `pages` in `scripts/perf.mjs`.
 */
import { Profiler, useState, type ComponentType } from "react";
import { createRoot, flushSync } from "react-dom/profiling";
import { installGalleryHost } from "../host.tsx";
import { questionPage } from "./question.tsx";
import { sidebarPage } from "./sidebar.tsx";
import "../base.css";
import "./style.css";

/** Builds a fixture of `size` items, installs the host stubs it reads, and returns its component. */
export type PerfPage = (size: number) => ComponentType;

const pages: Record<string, PerfPage> = {
  sidebar: sidebarPage,
  question: questionPage,
};

type Commit = { phase: string; actualDuration: number; baseDuration: number };
const perf = {
  /** Every React commit since load, or since the runner last took them. */
  commits: [] as Commit[],
  /** Re-renders the page from its root, as a host update with equal props does. */
  rerender: () => {},
  /**
   * Brings a loaded page to rest before a measurement: CSS entrance
   * animations jump to their end (endless ones keep running), scripted motion
   * and timers get 600 ms to finish, and the commits so far are forgotten.
   */
  rest: async () => {
    for (const animation of document.getAnimations())
      if (animation.effect?.getComputedTiming().endTime !== Infinity)
        animation.finish();
    await new Promise((done) => setTimeout(done, 600));
    perf.commits.length = 0;
  },
  /** Resolves two animation frames on, once the last change has been drawn. */
  settled: () =>
    new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    ),
};
(window as unknown as { __perf: typeof perf }).__perf = perf;

const query = new URLSearchParams(location.search);
const name = query.get("page") ?? "";
const createPage = pages[name];
if (!createPage)
  throw new Error(
    `No fixture page named "${name}". gallery/perf/main.tsx lists: ${Object.keys(pages).join(", ")}.`,
  );
const css = query.get("css");
if (css)
  document.head.append(
    Object.assign(document.createElement("style"), { textContent: css }),
  );
installGalleryHost();
const Page = createPage(Number(query.get("size")));

function Fixture() {
  const [, setRevision] = useState(0);
  perf.rerender = () => flushSync(() => setRevision((value) => value + 1));
  return (
    <Profiler
      id="perf"
      onRender={(_id, phase, actualDuration, baseDuration) =>
        perf.commits.push({ phase, actualDuration, baseDuration })
      }
    >
      <Page />
    </Profiler>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
