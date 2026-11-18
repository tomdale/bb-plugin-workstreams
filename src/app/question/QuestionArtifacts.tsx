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
import { cn } from "@/lib/utils";
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
// Long content scrolls inside its own frame so the options stay in reach.
const BODY_CLASS = "max-h-80 overflow-auto overscroll-contain";

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

export function QuestionArtifacts({
  artifacts,
  className,
}: {
  artifacts: readonly InteractionArtifact[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {artifacts.map((artifact, index) => {
        const path =
          artifact.path && artifact.path !== artifact.title
            ? artifact.path
            : null;
        return (
          <section
            key={`${artifact.title}:${index}`}
            aria-label={artifact.title}
            data-ws-question-artifact={artifact.format}
            className="min-w-0 overflow-hidden rounded-md border border-border bg-background/60"
          >
            <div className="flex min-w-0 items-baseline gap-2 border-b border-border/70 px-3 py-1.5 text-xs">
              <span className="shrink-0 font-medium text-foreground">
                {artifact.title}
              </span>
              {path ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  {path}
                </span>
              ) : null}
            </div>
            <div className={BODY_CLASS}>
              <ArtifactBody artifact={artifact} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
