/**
 * Reply bodies for the common kinds of turn end, each rewritten in block form
 * from a real thread's final reply. `card` says whether the turn also ends
 * with a recap card, which carries Done and commit links in that case.
 */
export type ReplySample = {
  kind: string;
  /** The thread whose final reply this rewrites. */
  from: string;
  card: boolean;
  message: string;
};

export const REPLY_SAMPLES: ReplySample[] = [
  {
    kind: "finished work",
    from: "thr_ghfi59evbk",
    card: true,
    message: `:::reply
Skills find their helper scripts from every install path because each snapshot now keeps \`skills/\` and \`scripts/\` side by side.

### Checked
22 tests, type check, build and the Pi smoke test pass locally. Both commits are pushed.

### Details
- Changing a script makes a new snapshot; older snapshots keep their own copy
- I removed both temporary worktrees
:::
`,
  },
  {
    kind: "finished work, no card",
    from: "thr_ghfi59evbk",
    card: false,
    message: `:::reply{v="1"}
Skills find their helper scripts from every install path. Both commits are pushed: [toolbelt ff20695](https://github.com/tomdale/toolbelt/commit/ff20695a8a0e8225e7b2c63ab2a2575f5f5bc6e2) and [dotfiles 20898c5](https://github.com/tomdale/dotfiles/commit/20898c50af6f973e57f18be9ffed1f0de3e4ccf6).

### Done
- [x] Each skill snapshot keeps \`skills/\` and \`scripts/\` side by side
- [x] Both helper scripts run from Pi's skill folders
- [x] All 18 skills still load in BB and Pi

### Checked
22 tests, type check, build and the Pi smoke test pass locally.
:::
`,
  },
  {
    kind: "status check",
    from: "thr_bmdzxnqkvt",
    card: true,
    message: `:::reply
[PR #412](https://github.com/example/api/pull/412) needed no rebase: it already sat on the latest \`feature/register-artifacts\`.

### Checked
- GitHub shows the PR open, mergeable and clean
- Required preview deployments pass
- Code review, code owner and preview comment checks pass
- The force push changed nothing; GitHub already had \`1e55e423e40\`

### Not done
- [ ] Merge: the PR is still open

### Details
One older Build Container run failed. A newer run replaced it and passed, so it needs no fix.
:::
`,
  },
  {
    kind: "report",
    from: "thr_6mnpbbtj5b",
    card: true,
    message: `:::reply
Subagents did not cut the model short: the parent thread asked for \`openai/gpt-6-luna\`, and that override replaced the right model. I sent the findings and the [full report](/tmp/pi-routing-report.md) to @thread:thr_yfujvpd8vc.

### Not done
- [ ] No code changes, commits or PRs

### Root cause
bb reads every model name with a slash as \`provider/model\`. Pi also allows plain model names that contain slashes, so bb checks the wrong route.

### Suggested fix
Look the name up in the model list first, pin the provider and model Pi chose, and keep the strict check at startup.

### Workaround
Leave out the subagent model override, or write \`vercel-ai-gateway/openai/gpt-6-luna\`.
:::
`,
  },
  {
    kind: "handed off",
    from: "thr_bv9tr2z664",
    card: false,
    message: `:::reply
@thread:thr_4teudyehkq now owns the browser-automation Zod error. It has the error text and the steps to reproduce it.

### Next
That thread reports back here when it has a fix.
:::
`,
  },
  {
    kind: "waiting on you",
    from: "thr_yfujvpd8vc",
    card: false,
    message: `:::reply
The GitHub issue form is open in your browser with the title and body filled in. I have not submitted it.

### Needs you
- Read the draft, edit it if needed, then press **Submit new issue**
:::
`,
  },
  {
    kind: "blocked",
    from: "thr_myw2nnifxa",
    card: false,
    message: `:::reply
The live test stops with \`403 Forbidden\`: the default development token may not call the service-only API. Listing and enabling the sample plugin work, and cleanup succeeds.

### Done
- [x] Wrote down which token the live test needs

### Not done
- [ ] The live test run itself

### Needs you
- A token with service-only API access, or a decision to skip the live test in CI

### Next
I push the checked changes and watch the new CI run.
:::
`,
  },
  {
    kind: "short reply",
    from: "thr_j7nykucjym",
    card: false,
    message: `:::reply
The waiting card works: WorkstreamsRecap took state \`waiting\`, goal "Testing Circle X waiting card" and a 120-second timeout, and returned the Waiting state.
:::
`,
  },
  {
    kind: "one-line answer",
    from: "thr_w45jad2u9i",
    card: false,
    message: `:::reply
PASS
:::
`,
  },
];
