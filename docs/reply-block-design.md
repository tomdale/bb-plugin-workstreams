# Drawing reply parts instead of flattening them to paragraphs

A proposal, decided. Part of it is already in the product and part of it is not. The prototype is
[`reply-block-prototype.html`](./reply-block-prototype.html), the screenshots are in
[`reply-block-shots/`](./reply-block-shots/) (eight key captures, both regenerable from the prototype),
and an outside review that shaped this version is in
[`reply-block-review.md`](./reply-block-review.md).

The order of work: (1) the sizing fix on its own, which improves replies whether or not the rest
follows — the base size on the reply container, the muted label tone, the tighter gaps; (2) the
panels, behind the same block; (3) old replies drawn plainly, with `next` restored; (4) the one new
status value, before statuses are drawn loudly enough to punish an agent for using the wrong one.

Main already carries more of this than the list implies: the per-part bodies, the card's label and
mark primitives, `details` unboxed and open, and the group relationships. What follows is the part it
has not taken.

## Read this first: the code has moved

This document describes the reply renderer as it stood on 1 November 2026. Main has changed under it
since: most of what that section describes no longer exists, and the product has settled the
decisions differently:

- **`4dc40ca feat(replies): retire finding component` deleted the `finding` component**, and with it
  `certainty`, `consequence` and its evidence list. The schema has no such type, and the renderer
  draws none.
- **The renderer now has a body per part** (`AdviceBody`, `ContextBody`, `DetailsBody`, `GroupBody`,
  `SequenceBody`), and those bodies take the recap card's primitives from `src/app/recap/marks.tsx`:
  the label gutter, the mark column, accent labels. A `change` draws as labelled rows with rules; a
  `checks` row carries a mark and its status word rather than a "Status:" line; a `group` puts peers
  in equal columns and indents supporting children under a rule, which is further than this proposal
  asked for.
- **`details` draws unboxed and always open**, on the ground that "essential caveats can land here
  too". That overturns decision 3, and its reasoning is better than mine was.
- **The panels shipped afterwards.** A part whose data is a list of parallel rows draws in the
  subagent delivery's recessed frame, with the failure tone on its border, header and title; a part
  with one subject draws a label and no frame. `src/app/reply/Panel.tsx` holds the frame and
  `src/app/reply/status.ts` the vocabulary, and delivery accepts `not-started`.

A re-baseline means dropping the finding section and restating what the renderer does now.
Until then the tenses are the 1 November renderer's.

## The four decisions, taken

An earlier draft put these to you as questions. I have decided them instead, and recorded the
reasoning so any of them can be overturned in a line.

1. **Fix the sizes first, as its own change — decided yes.** Today's labels are 16px over 13px prose
   with a 16px gap after every field. Correcting that is a few lines: a base size on the reply
   container, a muted tone for labels, tighter gaps. The prototype's middle rendering shows that fix
   alone, so you can see the split. My reading: the fix recovers most of the
   legibility and none of the grouping, and the panels are what make four changed things or a set of
   checks readable at a glance. Both are worth having, and the fix is worth having on its own.
   *Would change my mind:* if the panels turn out to add little over the fixed sizes when you look
   at the three side by side.
2. **A panel containing a failure looks different — decided yes, a tinted header.** With neutral
   panels, a reply carrying four of them looks the same whether one contains a failure or none does,
   and the tint on a single row is very faint in dark mode and effectively invisible in light. So
   when any row is failed or blocked the panel's border and header strip take the failure tone and
   the title takes the failure text colour. Passing panels stay neutral, so the recap card is still
   the loudest object on screen. *Would change my mind:* if the tint starts competing with the card
   in a reply that also ends with one.
3. **Supporting detail — overturned by the shipped code.** I decided it should start collapsed with a
   preview line, on the ground that the agent marks the part as supporting, so opening it is the
   reader's decision. `DetailsBody` does the opposite and gives a better reason: it draws "unboxed and
   always open: the body keeps its Markdown and stays fully readable, because essential caveats can
   land here too". That is right. An agent that puts a caveat in `details` is still making a claim
   the reader needs, and a collapsed section is a place to hide one. Drop this decision; the product
   has it settled.
4. **Old replies are drawn plainly — decided.** Replies written before the recap tool keep the
   card's fields inside the block. Rebuilding the card in the transcript would put a second
   bordered, state-tinted object on screen, which the design otherwise reserves for the live card,
   and it would look clickable when it is not. So: the state stays as a small muted line, the
   body renders as it does anywhere else, and the card's own rows ("Done", "Not done", "Review",
   "Waiting on", "Links", "Next") draw as labelled rows with no box, no tint and no footer buttons.
   The new renderer restores `Next`, which today's drops. *Would change my mind:* if old replies turn out
   to be read mostly for their state at a glance, which is an argument for a badge, not a card.

Two more things have to be settled before anyone builds this: a reply nested inside a subagent
delivery needs a variant with no outer border, or it will double-frame; and a reply holding four
panels in a row needs a spacing rule — space them, or join them into one stack.
Neither is drawn in the prototype yet.

## What is wrong today

The plugin took the structured parts an agent attaches to a reply and turned every one of them into
ordinary Markdown. Prose stayed readable and copyable that way, and a part that failed to parse kept
its source. What the reply gave up is the shape the agent asked for:

- **The renderer printed a change as four paragraphs.** "Before:", "After:", "Unchanged:" and
  "Limitation:" were separate sentences, so the difference between them was something you held in
  your head.
- **It printed a comparison as a list of bold names.** Each option was a name and a sentence, and
  the recommended one was marked with the word "Recommended" on its own line.
- **It printed checks as prose plus a word.** The totals read "8 tests passed; 0 failed; 1 skipped",
  and every row repeated "Status: passed". Pass, fail and skip differed by one word at equal weight.
- **It printed a `details` part whole.** The title in bold, then the entire body, with nothing to
  open or close.
- **It flattened a group's children.** The difference between "these are peers" and "this is the
  explanation and that is its support" went missing.
- **It drew no border, background or rule anywhere in a reply**, so a six-part explanation read like
  text that stopped mid-thought.

Nested inside that were three bugs, visible in any screenshot of the gallery at the time:

| What happens | Why it matters |
|---|---|
| The prose renders at 13px, but the literal labels the renderer writes — `Status: passed`, `Before:`, `Evidence: observed`, the totals, every bullet — carry no size class and render at the browser default, 16px. | Every label is louder than the content it labels. "Before:" is visibly bigger than the sentence under it. |
| The wrapper is `min-w-0 space-y-4`, and each field is its own child, so every gap is 16px. | A title, its scope and its first row are as far apart as two unrelated paragraphs. |
| No part of a reply uses a colour token, a border or a background. | A reply cannot read as a different kind of thing from the prose around it. |
| Status is a word at body weight. | A failing check and a passing one are the same shape. |
| The recommended option prints "Recommended" on its own line between the name and the summary. | The one option the agent picked looks like the others. |
| `group` flattens its children. | Peers and supporting are identical. |
| Headings go from the reply's `h1` headline straight to `h3` part titles. | A skipped heading level, in the current renderer and any replacement. |

Three further bugs fell out of writing this down, and are worth fixing whatever happens to the rest:

- A finding printed its **certainty** on a line labelled "evidence", so the label pointed at the
  wrong field. The component itself was retired later (`4dc40ca`), which settles it.
- An old reply's `Next` list is dropped, because the renderer's loop visits `review`, `waitingOn` and
  `links` but not `next`.
- The failed-to-parse message is the raw schema error: "Component not displayed: Invalid input".

One more thing today's rendering gets right, and this proposal keeps: the plain-text view is
generated separately from the drawing, so nothing is lost to a screen reader or a copy.

## What changes

This proposal groups the parts by how much structure each one gets. The rule is the important part:

> A part whose data is a **list of parallel rows** gets a panel: checks, delivery, a sequence, a
> comparison, a change, a supporting group. A part with **one subject** gets a label and no panel:
> context, a recommendation, supporting detail. Prose never gets either.

The part names are the schema's own. `checks`, `delivery`, `group` and the rest are the strings an
agent types and the code parses, so they appear here as they appear in code.

The prototype and this document use the same four names:

| Name | Parts | What it looks like |
|---|---|---|
| Plain prose | the text, the headline, Markdown inside any field | As it does now: 13px, no box, at any depth. |
| Labels, no box | context, recommendation, supporting detail, evidence chips | A label column, a rule down the side, or a tinted note. |
| Boxed panel | checks, delivery, sequence, comparison, change, a supporting group | A bordered box with a header and rows, on the frame the repo already uses for subagent deliveries. A group of peers gets no box. |
| Fallback | a part still arriving, a part that failed to parse | Dashed, because it is not the real thing. |

Within that, in one line each:

- **Checks** get a header that counts the results, one row per check, and the status word pushed to
  the right edge so failures can be found by scanning one column. A failed or blocked row takes a
  tint, and now so does the panel's header.
- **Delivery** draws as a rail of stages: a filled line under a finished one, a dashed line under one
  still waiting.
- **A change** draws as four labelled rows with a minus, plus, equals and warning sign.
- **A comparison** stacks its options at every width and gives the recommended one a mark and a rule.
- **A sequence** is a numbered rail; a step needing attention keeps its number and gains a warning.
- **A recommendation** is a tinted callout with a rule down the left, quieter than the recap card.
- **Evidence** draws as the chip the recap card already uses for links: icon, label, line range.

The design spends colour only on a status, a caveat, or a choice. Nothing else in a reply is
coloured, so the recap card that ends the turn stays the loudest object on screen.

## How it behaves in the cases that come up

I settled these too, because they are the ones an implementer hits on the first day.

- **A part with one row still gets its panel.** A one-item checks list and a one-step sequence are
  still tables of one row. The alternative — a threshold that switches shape — produces replies
  whose parts look different for reasons a reader cannot see.
- **Long lists keep the agent's order and do not collapse.** In a thirty-row checks list the failed
  row is where the agent put it; the panel's header shows the count and the failure tint, which is
  what makes it findable without reordering. Collapsing passing rows is a later, separate idea.
- **A sequence keeps its panel.** It is a list of steps the way delivery is a list of stages, and a
  reply can carry several in a row. The reference I took the rail from draws it unframed, which
  works when the rail is the only object on screen; here it needs the same frame as its neighbours
  or the reply looks like it is falling apart.
- **The design spaces several panels in a row rather than joining them.** Two panels in the same
  reply take the same gap as two paragraphs. I considered joining them into one stack and
  rejected it: a reply can carry a change, then checks, then delivery, and a single frame
  would imply one object where there are three.
- **A reply inside a subagent delivery draws without its own border**, so the panel it lives in is
  the only frame. That variant is part of the work.
- **A part arriving reserves 44px.** A short part lands close to its reserved height; a tall one
  still moves what is below it, and that is accepted rather than solved.
- **Counts appear only where they summarise state:** how many stages are done, and the test totals.
  I cut the count of the rows directly below it ("2 options", "3 steps") as noise.
- **The design barely distinguishes a group of peers.** It gets no panel and only a slightly wider gap.
  That concedes the limit without solving it: if telling peers from siblings matters, spacing is not
  enough, and this proposal has no better idea.
- **Selecting text across a panel picks up the status words** in document order, because they are
  the last cell in each row. The plain-text view is generated separately and still reads in order.

## What it costs

Roughly: a new `RichBody` renderer beside `PlainBody`, a status table, and three small layout
components (a panel, its header, its rows). The full map is in Appendix D. It is a contained change:
no new dependencies, no new colour tokens, no change to the reply schema except one status value, and
`toText` — the plain-text view — is untouched.

What this proposal leaves out: per-part icons in headers, a progress bar for test results, a
column layout for comparisons, panels that open and close as a whole (only supporting detail
collapses), copy buttons, and any change to the recap card.

Known limits: the phone layout is written but untested; evidence chips are stubs in the prototype;
markdown beyond the sample replies (tables, code blocks, maths) was not exercised; and a part that
arrives while you are reading still shifts what is below it.

---

## Appendix A — What I compared against

Four products, inspected in their own dark surfaces, for the specific decision each one informed.

| Source | What I looked at | What I took | What I rejected |
|---|---|---|---|
| BB's own message surface: the gallery, a live thread, and `SubagentDeliveries.tsx` | The code block's recessed, bordered frame; a delivery that wraps a whole reply in `rounded-lg border bg-surface-recessed` | The frame for every panel — it already exists in the product | — |
| Vercel's Geist notes | Severity carried by a different icon shape, one line, no box | A different icon per status | Tinting the whole sentence: tiring to read at length, and low contrast |
| A GitHub pull request's conversation and files-changed views | Prose in an open frame; a commit row as a one-line object with a verified pill; diff lines with a sign beside a tint | Signs beside the tint in a change, and structure only for atomic status rows | The whole-line red and green, which belongs to code |
| A PR description with a failing check and an AI-written warning | The warning as an icon, a label and a 3px rule on ordinary text; a failure as a mark at the end of a row | The rule down the left for a finding and a recommendation | Treating outcome and confidence as one vocabulary, which is why certainty and status are separate |
| Linear's agent interaction guidance | An agent's steps as a rail of marks, not a box; four states per step | The rail for a sequence and for delivery | Their rail is unboxed; a reply may carry several in a row, and they need separating |
| Stripe's payment-lifecycle docs (light) | A state table with muted headers and hairline rows | The header-over-rules anatomy, and that it works on white | Columns: they collapse into unreadable slivers at a 584px column |

## Appendix B — Colours, type and spacing

Every colour comes from the tokens the plugin already has. Nothing new is introduced, so Settings →
Colors still restyles everything, and the repository's own colour lint passes by construction.

| Role | Token |
|---|---|
| Panel border and row rules | `--border` |
| Panel fill | `--surface-recessed` (the frame subagent deliveries use) |
| Body and secondary text | `--foreground`, `--muted-foreground`; qualifications at 80% |
| Success | `--ws-complete-text`, `-surface`, `-border` |
| Failure | `--ws-failure-text`, `-surface`, `-border` |
| Needs a person | `--ws-needs-you-text`, `-surface`, `-border` |
| Waiting on someone | `--ws-waiting-text`, `-border` |
| A decision | `--ws-review`, `-text`, `-surface`, `-border` |

Sizes, all already in use by the recap card or the message surface:

| Role | Size / line / weight |
|---|---|
| Headline | 18 / 28 / 600 |
| Body, explanations, row values | 13 / 21 / 400 |
| A part's title, an option's name | 13 / 19 / 600 |
| A row's name | 13 / 20 / 400 (500 when failed or blocked) |
| Secondary: detail, scope, qualifications | 12 / 18 / 400, muted |
| Label column, status words | 11 / 17.6 / 500 |
| Chips, counts | 11.5 / 18 / 500 |
| Paths, line ranges | 11–12 monospace |

Spacing is the 4px grid. The gap between parts stays 16px; inside a panel, the header and rows take
14px/9px padding and the label column is 8rem (the recap card's is 3.25rem, which cannot fit
"Consequence"; the two never appear in the same box). Below a 26rem container the labels stack above
their values.

## Appendix C — The status vocabulary

Shape and word carry the meaning; colour only reinforces it. Every status prints its word, and no
two states share a word with different meanings.

| Value | Where | Mark | Word | Tone |
|---|---|---|---|---|
| `passed` | checks | tick | Passed | success |
| `failed` | checks | cross | Failed | failure |
| `skipped` | checks | dash | Skipped | muted |
| `blocked` | checks | circled slash | Blocked | needs a person |
| `untested` | checks | dashed ring | Untested | muted |
| `done` | delivery | tick in a ring | Done | success |
| `pending` | delivery | ring | Pending | waiting |
| `blocked` | delivery | circled slash | Blocked | needs a person |
| `not-started` **new** | delivery | dashed ring | Not started | muted |
| `unknown` | delivery | dashed ring | Unknown | muted |

The design mutes `unknown` wherever it appears. The same word in two colours in one reply reads as two
different states.

**The one schema change:** delivery needs `not-started`. Today an agent writing "Deployed — the
plugin reloads after merge" has only `blocked` to reach for, so a stage nobody has reached draws as
a warning. Adding it means one value in
`src/domain/replyComponents.ts` and a sentence in the agent instructions. Worth doing before statuses
are drawn as loudly as this proposal draws them.

`skipped` and `untested` mean different things: skipped was meant to run and did not; untested
was never attempted. A zero in the totals takes the muted tone, so a passing run shows no red word.

## Appendix D — Implementation map

- **Per-part bodies exist already:** `AdviceBody` (comparison, recommendation), `ContextBody`,
  `DetailsBody`, `GroupBody`, `SequenceBody`, with `PlainBody` holding the rest. What this proposal
  adds beside them is the panel around a part, not another set of bodies.
- **`src/app/recap/marks.tsx`** already exports the card's `LABEL_CLASS`, `MARK_ROW_CLASS` and
  `CHECK` mark, and the reply bodies import them. No new export is needed from `RecapCard.tsx`.
- **`src/app/reply/status.ts`** (new): the Appendix C table — status to mark, word and tone.
- **`src/app/reply/Panel.tsx`** (new): the panel, its header and its rows.
- **`src/app/reply/ReplyBlock.tsx`**: a container on the wrapper; render `RichBody`; the legacy `card`
  branch uses the plain rendering described in decision 4, with `next` restored and the `h2`/`h3`
  heading levels corrected.
- **`src/app/composer/RecapCard.tsx`**: export `CHIP_CLASS`, the mark component and the label class
  so the reply reuses them instead of copying them. No behaviour change to the card.
- **`src/app/reply/SubagentDeliveries.tsx`**: needs the no-outer-border variant.
- **`src/app/page/gallery.ts`**: add a sample reply with a failing check, a blocked row and a stage
  that has not started. The gallery currently contains no failure at all.
- **Not touched:** the reply schema (except the one status value), `componentText`, streaming, and the
  recap card's behaviour.

## Appendix E — What was checked, and what was not

Checked on the prototype, at 728, 600 and 375px wide, in dark and light: contrast on every text node
(no failures; lowest 7.49:1 dark, 4.74:1 light, measured by the author), no horizontal overflow, the
heading order, that every status prints its word, and that the current rendering is reproduced to
within a few pixels of the live gallery.

Height, at 728px: today 1321 / 1579 / 235px for the three sample replies, proposed 1130 / 1248 /
261px. About a fifth of that saving comes from `details` starting collapsed rather than from layout,
and the invented reply is slightly *taller* at 375px. Height was not a goal; treat it as a side
effect.

The type pass over the prototype turned up one defect worth recording, in the benchmark rather than in
this proposal: the recap card's body text is sized with a `clamp()` whose floor is too low. At a 600px
column it computes to about 10.5px, and at 375px about 10.2px, with the step numerals near 8.7px. The
card is reproduced from `RecapCard.tsx`, not restyled, so it was left alone here; raising that clamp's
minimum to 11px is a separate, small fix to the card.

Not checked: a phone with a finger, a real file link, markdown beyond these samples, a reply nested
in a subagent delivery, how much a part shifts the reply when it finishes arriving, and any browser
other than the one used to render the prototype. No screen reader, and nobody has watched a real
reply arrive.
