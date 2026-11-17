/**
 * The workstream whose ＋ opened the New thread composer. The sidebar sets it
 * just before navigating, and the composer's banner takes it when it mounts,
 * so the new thread starts in that workstream. Both run in this
 * plugin's one client bundle, so a module value carries it; it expires
 * quickly so a later, unrelated New thread doesn't pick it up.
 */
const PRESET_TTL_MS = 10_000;

/**
 * A workstream, named by its sidebar section, or directly when no section
 * backs its header (see `nestGroups`).
 */
export type WorkstreamTarget =
  | { sectionId: string; workstreamId?: undefined }
  | { workstreamId: string; sectionId?: undefined };

type Preset = { target: WorkstreamTarget; label: string };

let preset: (Preset & { at: number }) | null = null;

export function setComposerPreset(
  target: WorkstreamTarget,
  label: string,
): void {
  preset = { target, label, at: Date.now() };
}

export function takeComposerPreset(): Preset | null {
  const current = preset;
  preset = null;
  if (!current || Date.now() - current.at > PRESET_TTL_MS) return null;
  return { target: current.target, label: current.label };
}
