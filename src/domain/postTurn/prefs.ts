/**
 * The Enhanced responses experiment's settings: off by default. While on,
 * agents in visible top-level threads write their final response as plain
 * Markdown instead of a reply block, and Workstreams composes an enhanced
 * document below it after each turn with the chosen model.
 */
import { z } from "zod";
import { modelChoiceSchema, type ModelChoice } from "../prefs.ts";

/**
 * The picker's starting value. No presentation model has been evaluated; the
 * composition runs only after the experiment is turned on. Compositions send
 * the model id alone, so the model reasons at its provider's default.
 */
export const DEFAULT_PRESENTATION_MODEL: ModelChoice = {
  kind: "gateway",
  model: "anthropic/claude-sonnet-5.5",
};

export const presentationPrefsSchema = z.object({
  enabled: z.boolean().catch(false),
  model: modelChoiceSchema.catch(DEFAULT_PRESENTATION_MODEL),
});
export type PresentationPrefs = z.infer<typeof presentationPrefsSchema>;

export function parsePresentationPrefs(raw: unknown): PresentationPrefs {
  const value = raw && typeof raw === "object" ? raw : {};
  return presentationPrefsSchema.parse({
    enabled: false,
    model: DEFAULT_PRESENTATION_MODEL,
    ...value,
  });
}
