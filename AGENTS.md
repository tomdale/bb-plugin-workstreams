Workstreams is Tom's BB plugin that keeps each open root thread's goal, topic,
status, and activity current and derives BB sidebar sections (workstreams) from
root topics. It replaces BB's sidebar thread list and phone Home, adds Up Next,
snooze, recaps, and question cards for agents, and a Workstreams page (Overview,
Topics, Organization, Activity). The package is the repository root:
`src/{app,domain,server}` (React UI, pure rules shared by both sides, plugin
server and RPCs), `tests/` (mirrors `src/`), `eval/` (paid classification
evals), `components/ui/` (vendored BB registry components).

Read first: `CONTEXT.md` is the glossary and its terms are the UI vocabulary
(Topic, No topic, Root, Delegate, workstream; topic paths render with "›"), so
use them in copy, questions, and reports and never coin new ones. `SPEC.md`
holds the invariants, `docs/organization.md` the organizer, `README.md` the
user-facing behavior and settings (update it with any behavior change),
`ISSUES.md` known limits. Before changing UI, agent tools or instructions, or
the SDK dependency, read `.agents/skills/bb-plugin-guidelines/SKILL.md`
(installed from tomdale/bb-plugins by `npx skills add`; refresh it with
`npx skills update`).

Workstreams are derived, never placed: a root's topic assignment decides its
section, sidebar moves are reverted, and moving work means changing its Topic.
Do not add manual placement, section pickers, overrides, or preview/apply flows.
When a feature is retired, delete its RPCs, settings, and tests instead of
keeping compatibility shims. Topics are stored as local names with parent
pointers (`src/domain/{topics,tree,topic-path}.ts`); compound display names are
presentation only. A topic the user chose (`manual` assignment provenance,
`src/server/topics.ts`) is never overwritten by automatic analysis.

Classification (`src/domain/classify.ts`, `src/server/{analyzer,quick}.ts`)
works from the user's requests, not the generated title, so a retitle must never
make a classification stale or trigger another classify call. Proposed topics
are checked against existing paths before they are created. Automatic and async
writes (titles, topics, recaps) check the live thread revision before applying,
go through the service's serial queue, and log to Activity; cache keys include
every setting the result depends on. Measure before optimizing: read live traces
and costs on the Activity page in Debug mode, and test a classifier or prompt
change with `node eval/classification.ts` (see `eval/README.md`) before shipping
it.

Up Next membership and ranking live in `src/domain/upNext.ts`, whose header
comment is the contract; it ranks by `latestAttentionAt`, never `updatedAt`.
Sidebar row and header actions
(`src/app/sidebar/{HoverActions,Row,RowMenu,ThreadList}.tsx`) appear in one
order everywhere (Focus, New work, Archive, then Snooze or Wake), right-aligned,
with the row's age right after its title, and every hover action is also
reachable from the row's right-click and long-press menu. Recap cards keep BB's
thread-pill and full-row-hover conventions and stay minimal.

Commands (repository root): `npm ci`, `npm run typecheck`, `npm test`
(`npx vitest run --maxWorkers=4` on a loaded machine), `npm run build`,
`npx prettier --check <changed files>`, then
`scripts/bb-plugin-smoke <checkout>`, which activates the build in a throwaway
BB server. The canonical checkout `~/Code/Repos/bb-plugin-workstreams/main` is
live (the daily BB app loads the plugin from it), so work in a Workforest task
and follow the `personal-repo-lifecycle` skill. Record BB Plugin SDK limits in
tomdale/bb-plugins `docs/bb-sdk-wishlist.md`.
