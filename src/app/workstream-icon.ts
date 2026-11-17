/**
 * The Workstreams mark: Hugeicons' Wave, declared in the manifest's
 * `bb.branding.experimental_icons` as `workstream` and addressed here by its
 * namespaced name. A declared icon needs no frontend bundle, so the same name
 * works for the nav panel, the plugin's own branding and every `<Icon>` that
 * shows a workstream.
 */
export const WORKSTREAM_ICON = "workstreams/workstream";

/**
 * A price tag, for a workstream. BB's icon set has no tag, and
 * an unknown icon name draws BB's lightning-bolt fallback, so it is declared in
 * the manifest like the marks above.
 */
export const TAG_ICON = "workstreams/tag";

/**
 * The "magic" sparkles, for organizing suggestions. BB's icon set has no
 * sparkles; declared in the manifest like the marks above.
 */
export const SPARKLES_ICON = "workstreams/sparkles";

/**
 * GitHub's pull request shapes, drawn in the sidebar's rows and the pull
 * request view: the branch glyph says open, draft, merged, or closed. BB's icon
 * set has none, so they are declared in the manifest like the marks above.
 */
export const PULL_REQUEST_ICON = {
  open: "workstreams/pr-open",
  draft: "workstreams/pr-draft",
  merged: "workstreams/pr-merged",
  closed: "workstreams/pr-closed",
} as const;

/** A check's result in the pull request view: a filled circle with a tick or a cross. */
export const CHECK_PASSED_ICON = "workstreams/check-passed";
export const CHECK_FAILED_ICON = "workstreams/check-failed";
