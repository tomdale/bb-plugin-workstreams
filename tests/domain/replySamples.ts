/**
 * Reply bodies for the common kinds of turn end, each rewritten in block form
 * from a real thread's final reply. `card` says whether the turn also ends
 * with a recap card. Beside a card the block has no lead and no Done: the
 * card carries the headline, results and links.
 */
import type { ReplyComponent } from "../../src/domain/replyComponents.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";

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
### Checked
Ran the 22 tests, the type check, the build and the Pi smoke test locally.

### Why
Each snapshot carries its own copy of the scripts, so changing a script makes a new snapshot and older snapshots keep theirs.

### Details
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
### Checked
- Read the PR's status and required checks on GitHub
- Read the preview deployments' status on GitHub
- Read the code review and code owner checks on GitHub
- Compared the branch with \`feature/register-artifacts\`; the force push changed nothing

### Not done
- [ ] Merge: the PR is still open

### Why
The PR already sat on the latest \`feature/register-artifacts\`, so it needed no rebase.

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
### Not done
- [ ] No code changes, commits or PRs

### Why
The parent thread asked for \`openai/gpt-6-luna\`, and that override replaced the right model; subagents did not cut it short.

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
];

/** All three replies keep explanations separate from their compact recap fields. */
export const COMPOSED_SAMPLES = {
  investigation: `:::reply{state="complete" kind="investigation"}
# The coupon treats percentages as cents
- [x] The calculation subtracts the supplied number directly

${componentFence(COMPONENT_EXAMPLES.context)}

The caller passes a whole percentage. The calculation subtracts that number from an amount stored in cents, so the two values have different units.

For a ten-percent coupon on 1000 cents, the current calculation removes ten cents. Converting the percentage to a fraction removes 100 cents instead. The evidence establishes the current calculation; other callers still need checking before changing their contracts.

${componentFence(COMPONENT_EXAMPLES.finding)}

${componentFence(COMPONENT_EXAMPLES.comparison)}

### Next
- Fix the calculation: Correct the percentage calculation and test it
:::
`,
  change: `:::reply{state="review" kind="change"}
# The coupon applies a percentage
- [x] The calculation converts whole percentages to fractions

${componentFence({ type: "context", topic: "Coupon calculation", where: "shop · feature/percent", background: "Review the percentage calculation while keeping the caller’s units unchanged." })}

The calculation divides the percentage by 100 before applying it to the original amount. This keeps the caller contract unchanged and avoids making each caller perform the conversion.

The regression test covers the case that exposed the error. Local checks do not establish whether the payment integration works, because that check could not run without its credential.

${componentFence(COMPONENT_EXAMPLES.change)}

${componentFence({ type: "group", relationship: "peers", children: [COMPONENT_EXAMPLES.checks as Extract<ReplyComponent, { type: "checks" }>, COMPONENT_EXAMPLES.delivery as Extract<ReplyComponent, { type: "delivery" }>] })}

### Review
- Inspect the percentage calculation and its regression test

### Next
- Check callers: Check the other coupon callers for the same unit mismatch
:::
`,
  recommendation: `:::reply{state="complete" kind="recommendation"}
# Keep the caller’s percentage contract
- [x] Converting in the calculation avoids a caller migration

${componentFence({ type: "context", topic: "Coupon calculation", background: "Choose how to correct the unit mismatch; this reply recommends an approach without changing code." })}

${componentFence(COMPONENT_EXAMPLES.recommendation)}

Keeping the conversion beside the calculation gives the caller one consistent unit to use. Changing the contract to accept a monetary discount would also work, but it moves the calculation into every caller and requires checking their assumptions.

This recommendation follows the caller and fixture we inspected. It does not establish that every caller uses the same units. Check those callers before applying the change elsewhere.

${componentFence(COMPONENT_EXAMPLES.comparison)}

### Next
- Inspect callers: Inspect the other callers before choosing a migration
:::
`,
} as const;
