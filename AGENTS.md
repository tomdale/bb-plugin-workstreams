Workstreams is Tom's BB plugin that keeps each open root thread's goal, topic,
status, and activity current and derives BB sidebar workstreams from root
topics. The package is the repository root: `src/{app,domain,server}` (React UI,
pure rules shared by both sides, plugin server), `tests/` mirroring `src/`,
`eval/` (paid model evals), `components/ui/` (vendored BB registry components).

The code and its doc comments are the authority on current behavior; read them
rather than relying on summaries. `CONTEXT.md` defines the vocabulary; use its
terms in UI copy, questions, and reports, and do not coin new ones. `SPEC.md`
(with `docs/organization.md` for the organizer) lists the product invariants,
which are Tom's decisions: change one only when he asks, never route around it.
`README.md` is the user-facing reference; update it with any user-visible
change. `ISSUES.md` records known limits. When a feature is retired, delete its
code, settings, and tests rather than leaving compatibility shims. Measure
before optimizing analysis: check live traces and costs, and evaluate prompt or
model changes with `eval/` (see `eval/README.md`).

Before changing UI, agent tools or instructions, or the SDK dependency, read
`.agents/skills/bb-plugin-guidelines/SKILL.md`, installed from
tomdale/bb-plugins by the skills CLI (`skills-lock.json`; refresh with
`npx skills update`). Record BB Plugin SDK limits in tomdale/bb-plugins
`docs/bb-sdk-wishlist.md`.

Checks (repository root): `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`, `npx prettier --check <changed files>`, then
`scripts/bb-plugin-smoke <checkout>`, which activates the build in a throwaway
BB server. The canonical checkout `~/Code/Repos/bb-plugin-workstreams/main` is
live (the daily BB app loads the plugin from it), so work in a Workforest task
and follow the `personal-repo-lifecycle` skill.
