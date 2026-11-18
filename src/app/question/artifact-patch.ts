/**
 * Splits a diff artifact into one patch per file, since BB's diff viewer
 * draws exactly one file. Agents send `git diff` output (with `diff --git`
 * headers), bare `---`/`+++` patches, or a lone `@@` hunk; each file keeps
 * its own header text, and a patch with no file header at all is one file
 * named by `fallbackPath`.
 */

export interface FilePatch {
  path: string;
  patch: string;
}

const GIT_HEADER = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/;
const OLD_FILE = /^--- (?:a\/)?(.+?)(?:\t.*)?$/;
const NEW_FILE = /^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/;
const DEV_NULL = "/dev/null";

/** The file a patch names: its new side, or the old side of a deletion. */
function patchPath(lines: readonly string[], fallbackPath: string): string {
  let oldPath: string | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) break;
    const added = NEW_FILE.exec(line)?.[1];
    if (added !== undefined && added !== DEV_NULL) return added;
    const removed = OLD_FILE.exec(line)?.[1];
    if (removed !== undefined && removed !== DEV_NULL) oldPath = removed;
  }
  if (oldPath !== null) return oldPath;
  const header = GIT_HEADER.exec(lines[0] ?? "");
  return header?.[2] ?? fallbackPath;
}

/** Indexes of the lines that start a new file's patch. */
function fileStarts(lines: readonly string[]): number[] {
  const git = lines.flatMap((line, index) =>
    line.startsWith("diff --git ") ? [index] : [],
  );
  if (git.length > 0) return git;
  // Without git headers, a file starts at a `---` line directly followed by
  // `+++`, which a removed line beginning "-- " inside a hunk is not.
  return lines.flatMap((line, index) =>
    line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")
      ? [index]
      : [],
  );
}

export interface SplitPatch {
  /**
   * Text before the first file header, such as a commit message or a stat
   * summary. It is part of what the user approves, so it is kept and shown
   * as text rather than handed to the diff viewer.
   */
  preamble: string | null;
  files: FilePatch[];
}

export function splitFilePatches(
  content: string,
  fallbackPath: string,
): SplitPatch {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const starts = fileStarts(lines);
  if (starts.length === 0)
    return {
      preamble: null,
      files: [{ path: patchPath(lines, fallbackPath), patch: finish(lines) }],
    };
  const preamble = lines.slice(0, starts[0]).join("\n").trim();
  return {
    preamble: preamble || null,
    files: starts.map((start, index) => {
      const fileLines = lines.slice(start, starts[index + 1] ?? lines.length);
      return {
        path: patchPath(fileLines, fallbackPath),
        patch: finish(fileLines),
      };
    }),
  };
}

const finish = (lines: readonly string[]) => lines.join("\n").trimEnd() + "\n";
