import type { Prefs, PrefsPatch } from "../domain/prefs.ts";
import { mergePrefs, parsePrefs } from "../domain/prefs.ts";
import { getMeta, setMeta, type Database } from "./db.ts";

const KEY = "prefs";

/** Reads the stored shape, repairing malformed or older partial values. */
export function loadPrefs(db: Database): Prefs {
  const raw = getMeta(db, KEY);
  try {
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parsePrefs(null);
  }
}

/** Writes the default snapshot once; later reads keep whatever is stored. */
export function seedPrefs(db: Database): Prefs {
  if (getMeta(db, KEY) !== null) return loadPrefs(db);
  const defaults = parsePrefs(null);
  setMeta(db, KEY, JSON.stringify(defaults));
  return defaults;
}

/** Merges a validated patch and persists the clamped complete preference set. */
export function savePrefs(db: Database, patch: PrefsPatch): Prefs {
  const saved = mergePrefs(loadPrefs(db), patch);
  setMeta(db, KEY, JSON.stringify(saved));
  return saved;
}
