/*
 * The component catalog: field names, optionality, enums, and list limits read
 * from the zod schemas in `replyComponents.ts`. The parser's diagnostics, the
 * signature lines in the agent instructions, and the example formatter all use
 * this one description, so none can drift from what the schemas accept.
 */
import type { z } from "zod";
import { evidenceSchema, groupSchema, leafSchemas } from "./replyComponents.ts";

export type Shape =
  | { kind: "text" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] }
  | { kind: "list"; item: Shape; min?: number; max?: number }
  | { kind: "object"; name?: string; fields: FieldShape[] }
  /** A group's children: a component, or a list of components kept together. */
  | { kind: "children"; min: number; max: number };
export type FieldShape = { name: string; shape: Shape; optional: boolean };
export type ObjectShape = Extract<Shape, { kind: "object" }>;

type Def = {
  type: string;
  innerType?: z.ZodType;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  checks?: {
    _zod: { def: { check: string; minimum?: number; maximum?: number } };
  }[];
};
const defOf = (schema: z.ZodType) => schema._zod.def as unknown as Def;
const NAMED = new Map<z.ZodType, string>([[evidenceSchema, "Evidence"]]);

function describe(schema: z.ZodType): { shape: Shape; optional: boolean } {
  let current = schema,
    optional = false;
  while (defOf(current).type === "optional") {
    optional = true;
    current = defOf(current).innerType!;
  }
  const def = defOf(current);
  switch (def.type) {
    case "string":
      return { shape: { kind: "text" }, optional };
    case "number":
      return { shape: { kind: "number" }, optional };
    case "boolean":
      return { shape: { kind: "boolean" }, optional };
    case "enum":
      return {
        shape: {
          kind: "enum",
          options: (current as z.ZodEnum).options.map(String),
        },
        optional,
      };
    case "array": {
      const bound = (check: string, key: "minimum" | "maximum") =>
        def.checks?.find((c) => c._zod.def.check === check)?._zod.def[key];
      const min = bound("min_length", "minimum"),
        max = bound("max_length", "maximum");
      // A union of component and list-of-components is a group's children.
      if (defOf(def.element!).type === "union")
        return {
          shape: { kind: "children", min: min ?? 1, max: max ?? 32 },
          optional,
        };
      return {
        shape: { kind: "list", item: describe(def.element!).shape, min, max },
        optional,
      };
    }
    case "object":
      return { shape: objectShape(current, NAMED.get(current)), optional };
  }
  throw new Error(`Reply catalog cannot describe a ${def.type} schema.`);
}

function objectShape(schema: z.ZodType, name?: string): ObjectShape {
  const shape = defOf(schema).shape!;
  return {
    kind: "object",
    ...(name ? { name } : {}),
    fields: Object.entries(shape)
      .filter(([key]) => key !== "type")
      .map(([key, field]) => ({ name: key, ...describe(field) })),
  };
}

/** Every component, keyed by the name its call uses. */
export const CATALOG: Readonly<Record<string, ObjectShape>> = {
  ...Object.fromEntries(
    Object.entries(leafSchemas).map(([name, schema]) => [
      name,
      objectShape(schema),
    ]),
  ),
  group: objectShape(groupSchema),
};
export const EVIDENCE_SHAPE = objectShape(evidenceSchema, "Evidence");

function limits(min?: number, max?: number): string {
  return min === undefined && max === undefined
    ? ""
    : ` (${min ?? 0}${max === undefined || max === min ? "+" : `–${max}`})`;
}

/** The compact type notation used in signature lines. */
function typeText(shape: Shape, expandNamed = false): string {
  switch (shape.kind) {
    case "text":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "true|false";
    case "enum":
      return shape.options.join("|");
    case "list":
      return `[${typeText(shape.item)}, …]${limits(shape.min, shape.max)}`;
    case "children":
      return `[component or [component, …], …]${limits(shape.min, shape.max)}`;
    case "object":
      return shape.name && !expandNamed ? shape.name : `{${fieldsText(shape)}}`;
  }
}
function fieldsText(shape: ObjectShape): string {
  return shape.fields
    .map(
      (field) =>
        `${field.name}${field.optional ? "?" : ""}: ${typeText(field.shape)}`,
    )
    .join(", ");
}

/** One signature line per component, then each named object type. */
export function signatureLines(): string[] {
  return [
    ...Object.entries(CATALOG).map(
      ([name, shape]) => `${name}(${fieldsText(shape)})`,
    ),
    `Evidence = ${typeText(EVIDENCE_SHAPE, true)}`,
  ];
}

/** The closest known name within a small edit distance, for "did you mean". */
export function nearest(word: string, candidates: string[]): string | null {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j]!;
        row[j] = Math.min(
          row[j]! + 1,
          row[j - 1]! + 1,
          prev + (a[i - 1]!.toLowerCase() === b[j - 1]!.toLowerCase() ? 0 : 1),
        );
        prev = cur;
      }
    }
    return row[b.length]!;
  };
  let best: [string, number] | null = null;
  for (const candidate of candidates) {
    const d = distance(word, candidate);
    if (
      d <= Math.max(2, Math.floor(candidate.length / 3)) &&
      (!best || d < best[1])
    )
      best = [candidate, d];
  }
  return best?.[0] ?? null;
}
