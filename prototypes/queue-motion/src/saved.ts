/**
 * Saved presets: the reader's own named sets of settings, kept in this browser's `localStorage` beside the
 * built-in presets. A saved preset belongs to one model (the drum or the cascade; the product has no presets)
 * and holds the built-in preset it starts from and every model, path and page setting the URL hash overrides,
 * as the hash spells them. Applying one is a hash change, so the hash stays the whole state: it restores a
 * saved preset's settings on a machine that has never seen the preset, though not its name.
 */
import {
  CASCADE_SETTINGS,
  PATH_KEYS,
  SETTINGS,
  VIEW_KEYS,
  type Opt,
} from "./controls.ts";

export type SavedPreset = { name: string; opt: Opt };
type Store = Partial<Record<"drum" | "cascade", SavedPreset[]>>;

const KEY = "queue-motion-lab.presets";

/** The hash keys a saved preset of `mode` holds, besides `preset`: its model's settings, the path's and the page's. */
export const savedKeys = (mode: "drum" | "cascade"): readonly string[] => [
  ...(mode === "drum" ? SETTINGS : CASCADE_SETTINGS).map((s) => s.key),
  ...PATH_KEYS,
  ...VIEW_KEYS,
];

function read(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function write(store: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** The saved presets of `mode`, oldest first; anything malformed in storage is skipped. */
export function savedPresets(mode: string): SavedPreset[] {
  if (mode !== "drum" && mode !== "cascade") return [];
  const list = read()[mode];
  return Array.isArray(list)
    ? list.filter(
        (p): p is SavedPreset =>
          !!p &&
          typeof p.name === "string" &&
          !!p.opt &&
          typeof p.opt === "object",
      )
    : [];
}

/** What a saved preset of `mode` records from the state `opt`. */
export function captureOpt(opt: Opt, mode: "drum" | "cascade"): Opt {
  const out: Opt = { preset: opt.preset! };
  for (const k of savedKeys(mode)) if (opt[k] !== undefined) out[k] = opt[k]!;
  return out;
}

/**
 * Saves the state `opt` as `name` for `mode`, replacing a saved preset of the same name. Returns false when
 * storage refuses the write (private browsing, or a full quota).
 */
export function savePreset(
  mode: "drum" | "cascade",
  name: string,
  opt: Opt,
): boolean {
  const store = read();
  const list = savedPresets(mode).filter((p) => p.name !== name);
  list.push({ name, opt: captureOpt(opt, mode) });
  store[mode] = list;
  return write(store);
}

export function deletePreset(mode: "drum" | "cascade", name: string): void {
  const store = read();
  store[mode] = savedPresets(mode).filter((p) => p.name !== name);
  write(store);
}
