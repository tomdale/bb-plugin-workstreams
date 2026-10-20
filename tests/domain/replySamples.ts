/**
 * Reply fence bodies for the common kinds of turn end, each rewritten from a
 * real thread's final reply. `body` is what bb hands the renderer: the text
 * between the ```` ```reply ```` line and the closing fence. `card` says
 * whether the turn also ends with a recap card, which carries Done and
 * commit links in that case.
 */
export type ReplySample = {
  kind: string;
  card: boolean;
  body: string;
};

export const REPLY_SAMPLES: ReplySample[] = [
  {
    kind: "finished work",
    card: true,
    body: `Skills find their helper scripts from every install path because each snapshot now keeps \`skills/\` and \`scripts/\` side by side.

### Checked
22 tests, type check, build and the Pi smoke test pass locally. Both commits are pushed.

### Details
- Changing a script makes a new snapshot; older snapshots keep their own copy
- I removed both temporary worktrees`,
  },
  {
    kind: "finished work, no card",
    card: false,
    body: `Skills find their helper scripts from every install path. Both commits are pushed: [toolbelt ff20695](https://github.com/tomdale/toolbelt/commit/ff20695a8a0e8225e7b2c63ab2a2575f5f5bc6e2) and [dotfiles 20898c5](https://github.com/tomdale/dotfiles/commit/20898c50af6f973e57f18be9ffed1f0de3e4ccf6).

### Done
- [x] Each skill snapshot keeps \`skills/\` and \`scripts/\` side by side
- [x] Both helper scripts run from Pi's skill folders
- [x] All 18 skills still load in BB and Pi

### Checked
22 tests, type check, build and the Pi smoke test pass locally.`,
  },
  {
    kind: "status check",
    card: true,
    body: `[PR #412](https://github.com/example/api/pull/412) needed no rebase: it already sat on the latest \`feature/register-artifacts\`.

### Checked
- GitHub shows the PR open, mergeable and clean
- Required preview deployments pass
- Code review, code owner and preview comment checks pass
- The force push changed nothing; GitHub already had \`1e55e423e40\`

### Not done
- [ ] Merge: the PR is still open

### Details
One older Build Container run failed. A newer run replaced it and passed, so it needs no fix.`,
  },
  {
    kind: "report",
    card: true,
    body: `Subagents did not cut the model short: the parent thread asked for \`openai/gpt-6-luna\`, and that override replaced the right model. I sent the findings and the [full report](/tmp/pi-routing-report.md) to @thread:thr_yfujvpd8vc.

### Not done
- [ ] No code changes, commits or PRs

### Root cause
bb reads every model name with a slash as \`provider/model\`. Pi also allows plain model names that contain slashes, so bb checks the wrong route.

### Suggested fix
Look the name up in the model list first, pin the provider and model Pi chose, and keep the strict check at startup.

### Workaround
Leave out the subagent model override, or write \`vercel-ai-gateway/openai/gpt-6-luna\`.`,
  },
  {
    kind: "handed off",
    card: false,
    body: `@thread:thr_4teudyehkq now owns the browser-automation Zod error. It has the error text and the steps to reproduce it.

### Next
That thread reports back here when it has a fix.`,
  },
  {
    kind: "waiting on you",
    card: false,
    body: `The GitHub issue form is open in your browser with the title and body filled in. I have not submitted it.

### Needs you
- Read the draft, edit it if needed, then press **Submit new issue**`,
  },
  {
    kind: "blocked",
    card: false,
    body: `The live test stops with \`403 Forbidden\`: the default development token may not call the service-only API. Listing and enabling the sample plugin work, and cleanup succeeds.

### Done
- [x] Wrote down which token the live test needs

### Not done
- [ ] The live test run itself

### Needs you
- A token with service-only API access, or a decision to skip the live test in CI

### Next
I push the checked changes and watch the new CI run.`,
  },
  {
    kind: "short reply",
    card: false,
    body: `The waiting card works: WorkstreamsRecap took state \`waiting\`, goal "Testing Circle X waiting card" and a 120-second timeout, and returned the Waiting state.`,
  },
  {
    kind: "one-line answer",
    card: false,
    body: `PASS`,
  },
  {
    kind: "with code",
    card: false,
    body: `The release check now runs from one command, and it passes on a clean checkout. Nothing is pushed.

### Done
- [x] Added \`npm run check\`, which runs the type check, tests and build in order
- [x] The check stops at the first failure and names the step
- [ ] CI does not call it yet

### How to run
\`\`\`sh
npm run check -- --all
# a heading-like line inside code stays code:
### not a section
\`\`\`

### Details
It reuses the last build when no source file changed since then.`,
  },
  {
    kind: "task list",
    card: true,
    body: `Three of the four flaky tests are fixed; the fourth needs a decision about the retry limit.

### Checked
- [x] \`sync.test.ts\` passes 200 runs in a row
  after the clock is faked
- [x] \`upload.test.ts\` and \`queue.test.ts\` pass 200 runs each
- [ ] \`retry.test.ts\` still fails about 1 run in 40

### Needs you
- Keep the retry limit at 3, or raise it to 5 so the test can pass`,
  },
];
