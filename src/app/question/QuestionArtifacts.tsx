/**
 * A question's artifacts: the exact content it asks the user to approve or
 * review, always visible on the card and in its answered record. Markdown uses
 * BB's chat renderer, diffs and code use BB's diff and source viewers, and
 * text stays as written. The viewers are experimental SDK components, so a BB
 * without one gets preformatted text instead of a broken card.
 */
import {
  Markdown,
  experimental_Diff as Diff,
  experimental_SourceCode as SourceCode,
} from "@get-bb/plugin-sdk/app";
import type { InteractionArtifact } from "../../server/questions/contracts.ts";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Hint } from "../Hint.tsx";
import { splitFilePatches } from "./artifact-patch.ts";

type HostViewer = "experimental_Diff" | "experimental_SourceCode";

/** Whether the running BB supplies a host component; the SDK's wrapper throws when it does not. */
function hostProvides(name: HostViewer): boolean {
  const runtime = (
    globalThis as {
      __bbPluginRuntime?: { pluginSdkApp?: Record<string, unknown> };
    }
  ).__bbPluginRuntime;
  return runtime?.pluginSdkApp?.[name] !== undefined;
}

const PLAIN_CLASS =
  "m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground max-md:pointer-coarse:text-xs";

function PlainText({ content }: { content: string }) {
  return <pre className={PLAIN_CLASS}>{content}</pre>;
}

function DiffArtifact({ artifact }: { artifact: InteractionArtifact }) {
  if (!hostProvides("experimental_Diff"))
    return <PlainText content={artifact.content} />;
  const { preamble, files } = splitFilePatches(
    artifact.content,
    artifact.path ?? artifact.title,
  );
  return (
    <div className="divide-y divide-border/70">
      {preamble ? <PlainText content={preamble} /> : null}
      {files.map((file, index) => (
        <div key={`${file.path}:${index}`} className="min-w-0">
          {files.length > 1 ? (
            <p className="px-3 pt-2 text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
              {file.path}
            </p>
          ) : null}
          <Diff patch={file.patch} path={file.path} overflow="wrap" />
        </div>
      ))}
    </div>
  );
}

function ArtifactBody({ artifact }: { artifact: InteractionArtifact }) {
  switch (artifact.format) {
    case "markdown":
      return (
        <div className="px-3 py-2">
          <Markdown content={artifact.content} />
        </div>
      );
    case "diff":
      return <DiffArtifact artifact={artifact} />;
    case "code":
      return hostProvides("experimental_SourceCode") ? (
        <SourceCode
          content={artifact.content}
          path={artifact.path ?? artifact.title}
          overflow="wrap"
        />
      ) : (
        <PlainText content={artifact.content} />
      );
    case "text":
      return <PlainText content={artifact.content} />;
  }
}

const NAV_BUTTON_CLASS =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:size-9";

/**
 * One artifact at a time, with previous and next controls when there are
 * several. The panel never grows past its maximum height and scrolls in place,
 * so the question's options stay below it. In the card it also shrinks into
 * the space the options leave (see `ARTIFACT_PANEL_CLASS`). Its scroller does
 * not contain overscroll: a wheel at either end, or over content that fits,
 * scrolls the card.
 */
export function QuestionArtifacts({
  artifacts,
  className,
}: {
  artifacts: readonly InteractionArtifact[];
  className?: string;
}) {
  const [chosen, setChosen] = useState(0);
  const index = Math.min(chosen, artifacts.length - 1);
  const artifact = artifacts[index];
  if (!artifact) return null;
  const several = artifacts.length > 1;
  const show = (next: number) =>
    setChosen((next + artifacts.length) % artifacts.length);
  const path =
    artifact.path && artifact.path !== artifact.title ? artifact.path : null;
  return (
    <section
      aria-roledescription={several ? "carousel" : undefined}
      aria-label={several ? "Artifacts" : artifact.title}
      data-ws-question-artifacts=""
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background/60",
        ARTIFACT_PANEL_CLASS,
        className,
      )}
      style={ARTIFACT_PANEL_STYLE}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/70 py-1 pl-3 pr-1.5 text-xs">
        <span className="shrink-0 font-medium text-foreground">
          {artifact.title}
        </span>
        {path ? (
          <span className="min-w-0 truncate text-muted-foreground">{path}</span>
        ) : null}
        {several ? (
          <div
            className="ml-auto flex shrink-0 items-center gap-0.5"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") show(index - 1);
              else if (event.key === "ArrowRight") show(index + 1);
              else return;
              event.preventDefault();
            }}
          >
            <Hint label="Previous artifact">
              <button
                type="button"
                aria-label="Previous artifact"
                className={NAV_BUTTON_CLASS}
                onClick={() => show(index - 1)}
              >
                <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
              </button>
            </Hint>
            <span
              aria-live="polite"
              className="min-w-[3.25rem] text-center font-medium tabular-nums text-muted-foreground"
            >
              {index + 1} of {artifacts.length}
            </span>
            <Hint label="Next artifact">
              <button
                type="button"
                aria-label="Next artifact"
                className={NAV_BUTTON_CLASS}
                onClick={() => show(index + 1)}
              >
                <Icon name="ChevronRight" className="size-3.5" aria-hidden />
              </button>
            </Hint>
          </div>
        ) : (
          <span className="min-h-6" aria-hidden />
        )}
      </div>
      {/* Keyed by position, so each artifact opens scrolled to its top. */}
      <div
        key={index}
        role={several ? "group" : undefined}
        aria-roledescription={several ? "slide" : undefined}
        aria-label={
          several
            ? `${index + 1} of ${artifacts.length}: ${artifact.title}`
            : undefined
        }
        data-ws-question-artifact={artifact.format}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <ArtifactBody artifact={artifact} />
      </div>
    </section>
  );
}

/**
 * The panel's height bounds. At most `24rem` (less on a short viewport) so a
 * long artifact scrolls in place. When the card is short of room it shrinks,
 * but not below `7.5rem` or its own content height, whichever is less; past
 * that the card itself scrolls. `calc-size()` expresses "the lesser of the two";
 * a BB whose Chromium lacks it lets the panel shrink to its header.
 */
const ARTIFACT_PANEL_CLASS = "max-h-[min(24rem,45dvh)] !shrink";
const ARTIFACT_PANEL_STYLE = {
  minHeight: "calc-size(max-content, min(size, 7.5rem))",
};
