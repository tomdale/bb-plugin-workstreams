/**
 * Checks that the controls and the help text agree. `build.mjs` bundles this file for Node, runs `verify`, and
 * fails the build on any problem it returns; `npm run smoke` makes the same comparison against the live page.
 */
import { CONTROLS } from "./controls.ts";
import { ABOUT, HELP } from "./help.ts";

/** The lines a slider's, toggle's or preset's tooltip must carry under "what you see and feel". */
const EFFECTS: Record<string, string[]> = {
  slider: ["Raise", "Lower"],
  toggle: ["On", "Off"],
  preset: ["Feels", "Measured", "Good for"],
};

export function verify(): string[] {
  const problems: string[] = [];
  const ids = CONTROLS.map((c) => c.id);
  for (const id of ids)
    if (ids.indexOf(id) !== ids.lastIndexOf(id))
      problems.push(`controls.ts lists ${id} twice`);
  for (const id of ids)
    if (!HELP[id]) problems.push(`control ${id} has no entry in help.ts`);
  for (const id of Object.keys(HELP))
    if (!ids.includes(id))
      problems.push(`help.ts has an entry for ${id}, which is not a control`);

  const bad = /undefined|NaN|\[object|\$\{|\{\{/;
  for (const control of CONTROLS) {
    const h = HELP[control.id];
    if (!h) continue;
    const text = (what: string, value: string) => {
      if (!value.trim()) problems.push(`${control.id}: ${what} is empty`);
      else if (bad.test(value))
        problems.push(`${control.id}: ${what} holds a broken figure: ${value}`);
    };
    text("what", h.what);
    text("needs", h.needs);
    text("tune", h.tune);
    if (!h.effect.length)
      problems.push(`${control.id}: no "what you see" lines`);
    for (const [label, body] of h.effect) text(`effect ${label}`, body);
    const labels = h.effect.map(([label]) => label);
    for (const want of EFFECTS[control.kind] ?? [])
      if (!labels.includes(want))
        problems.push(
          `${control.id}: a ${control.kind} needs a "${want}" line`,
        );
  }
  for (const p of ABOUT.paragraphs)
    if (bad.test(p)) problems.push(`about: ${p}`);
  return problems;
}
