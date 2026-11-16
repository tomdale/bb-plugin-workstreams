import {
  parsePresentationPrefs,
  type PresentationPrefs,
} from "../../domain/postTurn/prefs.ts";
import { getMeta, setMeta, type Database } from "../db.ts";

const KEY = "presentationPrefs";

export function loadPresentationPrefs(db: Database): PresentationPrefs {
  const raw = getMeta(db, KEY);
  try {
    return parsePresentationPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parsePresentationPrefs(null);
  }
}

export function savePresentationPrefs(
  db: Database,
  patch: Partial<PresentationPrefs>,
): PresentationPrefs {
  const saved = parsePresentationPrefs({
    ...loadPresentationPrefs(db),
    ...patch,
  });
  setMeta(db, KEY, JSON.stringify(saved));
  return saved;
}
