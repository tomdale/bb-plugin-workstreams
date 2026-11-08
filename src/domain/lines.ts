import { z } from "zod";

export const lineSchema = z
  .object({
    show: z.boolean(),
    width: z.number().int().min(1).max(6),
    color: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
    indent: z.number().int().min(0).max(32),
    spacing: z.number().int().min(0).max(32),
  })
  .strict();

export type LinePrefs = z.infer<typeof lineSchema>;
export const DEFAULT_LINE: LinePrefs = {
  show: false,
  width: 1,
  color: "",
  indent: 8,
  spacing: 11,
};

/** Keep valid fields when one stored value is malformed. */
export function parseLine(raw: unknown): LinePrefs {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = Object.fromEntries(
    Object.entries(lineSchema.shape).map(([key, schema]) => {
      const result = schema.safeParse(value[key]);
      return [
        key,
        result.success ? result.data : DEFAULT_LINE[key as keyof LinePrefs],
      ];
    }),
  );
  return lineSchema.parse(parsed);
}
