# Builds and fixtures

Confirm which build you measured, and compare like with like.

The daily app loads Workstreams from the canonical checkout (`bb plugin list`
shows `source: path:`). A task worktree's change reaches it after the canonical
integration, rebuild, and `bb plugin reload` that `personal-repo-lifecycle`
describes. Before that, label numbers from the gallery fixture, a browser test,
or a throwaway BB server built like `scripts/bb-plugin-smoke` as pre-deploy. A
live-app claim needs a measurement of the daily app after the reload.

The server serves plugin assets by content hash: `GET /api/v1/plugins` reports
`bundle.hash` for `workstreams`, and the page loads
`/api/v1/plugin-app-assets/<hash>/app.js` with a
`<link data-bb-plugin-css="workstreams">`. Read that hash, or the matching
resource entries, from the page you measured. Record `git rev-parse HEAD` and
`shasum -a 256 dist/app.js dist/app.css dist/server.js dist/host.js` from the
checkout you edited, and confirm the hash moves when you rebuild and reload it;
an unchanged hash means the page still serves the earlier build.

Give every build and test its own `cd` or an absolute path: each bash call
starts in the thread's directory, not the checkout you edited.

Discard and rerun samples taken during a concurrent build, full test run, or
plugin reload, and check the bundle hash afterwards.

`structuredClone` or a JSON round trip makes every object new, so structural
sharing looks broken. The app receives a fresh JSON tree on every read, and the
tests clone on purpose.
