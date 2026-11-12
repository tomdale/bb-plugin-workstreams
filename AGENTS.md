Workstreams is Tom's BB plugin that keeps each open root thread's goal, topic,
status, and activity current and derives BB sidebar workstreams from root
topics. The package is the repository root: `src/{app,domain,server}` (React UI,
pure rules shared by both sides, plugin server), `tests/` mirroring `src/`,
`eval/` (paid model evals), `components/ui/` (vendored BB registry components),
`stream-deck/` (optional Stream Deck plugin, its own npm package). The Stream
Deck plugin bundles `src/domain/streamDeck.ts`, the Up Next wire format that
`src/server/streamDeck.ts` serves, so that file imports nothing.

The code and its doc comments are the authority on current behavior; read them
rather than relying on summaries. These product rules are Tom's decisions:
change one only when he asks, never route around it. A root's topic determines
its workstream: a sidebar move is recorded and reverted, and a thread changes
group only through the user's action, an accepted suggestion, or placement after
a new request. Topic identity has at most two levels total. A topic holds
assignments or child topics, never both; stored assignments, including archived
work, require a reviewed complete filing plan before children can be added.
Categories organize a leaf topic's current roots at either depth, separately
from topic assignments and native sections: create at six roots, discard at
three or fewer, and reconsider the whole collection on membership or substantive
work changes without a throttle. Automatic changes and observed outside changes
are recorded in Activity, with undo where supported. Invalid model output never
files a thread or clears a valid assignment. Up Next is the short ranked list of
roots most worth the user's attention, shared by the sidebar, phone Home, and
the next-Up-Next command (`src/domain/upNext.ts`). `docs/organization.md`
details the organizer. `README.md` is the user-facing reference; update it with
any user-visible change. In UI copy, questions, and reports, use the terms
`README.md` and the app already use; do not coin new ones. `ISSUES.md` records
known limits. When a feature is retired, delete its code, settings, and tests
rather than leaving compatibility shims. Measure before optimizing analysis:
check live traces and costs, and evaluate prompt or model changes with `eval/`
(see `eval/README.md`).

Before changing UI, agent tools or instructions, or the SDK dependency, read
`.agents/skills/bb-plugin-guidelines/SKILL.md`, installed from
tomdale/bb-plugins by the skills CLI (`skills-lock.json`; refresh with
`npx skills update`). Every `<Icon name>` must be a name BB's icon registry has:
BB draws any other string as a lightning bolt with no warning. Pick from
`VERIFIED_BB_ICONS` in `tests/app/icons.test.ts`; when none fits, declare an SVG
in `package.json` `bb.branding.experimental_icons`, export its
`workstreams/<key>` name from `src/app/workstream-icon.ts`, and use that. Add a
name to the verified list only after seeing it render in the running app. Record
BB Plugin SDK limits in tomdale/bb-plugins `docs/bb-sdk-wishlist.md`.

Checks (repository root): `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`, `npx prettier --check <changed files>`, then
`scripts/bb-plugin-smoke <checkout>`, which activates the build in a throwaway
BB server. A change under `stream-deck/` or to `src/domain/streamDeck.ts` also
runs, in `stream-deck/`: `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run validate`. The canonical checkout
`~/Code/Repos/bb-plugin-workstreams/main` is live (the daily BB app loads the
plugin from it), so work in a Workforest task and follow the
`personal-repo-lifecycle` skill.
