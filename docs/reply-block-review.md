# Review: reply block design proposal and prototype

Reviewed: `reply-block-prototype.html` (opened cold in headless Chrome at 1440×900, all three widths, both themes, both renderings) and `reply-block-design.md`, against `src/app/reply/PlainBody.tsx`, `ReplyBlock.tsx` and `src/app/composer/RecapCard.tsx` on `main`.

## Verdict

**Approve with named changes.** The core design is sound. The parts that matter are right: every status prints its word, prose is never boxed, the panels reuse existing tokens and the recessed frame, and a component that fails to parse keeps its source. The checks panel and the recommended option are real improvements.

The artifacts do not yet prove the claim they are built around. The only comparison the page offers is today's renderer, which has a sizing bug, against the full redesign. A reader cannot tell how much of the improvement comes from the panels and how much comes from fixing 16px labels. The document is also still written in the vocabulary the owner rejected. Implement it once these changes are made:

1. **Land the calibration fix first, as its own change.** Set a 13px base on the reply container, keep labels quieter than their values, and tighten the gaps between fields. Then judge the panels in the real app against that fixed baseline, not against the bug (finding 1).
2. **Drop the inert recap card for old replies.** Render them plainly at the corrected sizes and restore the dropped `Next` row (finding 7; decision 4).
3. **Make a failing `checks` panel look different from a passing one at panel level** (finding 8; decision 1).
4. **Cut the derived `N steps` / `N options` counts and the dashed and dotted rule styles for certainty.** Settle `unknown` on a single tone (findings 9, 16).
5. **Decide two things before building:** the nested mode inside subagent deliveries, and how consecutive panels stack. Both are product paths the design will hit, so they cannot stay as caveats (finding 17).
6. **Fix the prototype's copy errors (findings 3–6, 11–13) before it is shown to anyone else.** Rewrite the document's opening in plain words with the ask at the top (finding 2). These two do not block implementation, but the document cannot be used to persuade anyone in its current state.

## The first ninety seconds (before reading the document)

**What I saw.** The page has no visible title: the `<h1>` "How reply blocks could look: a rendering prototype" is screen-reader-only. The first thing on screen is a dense toolbar: three segmented controls, a right-aligned blurb ("The plugin's own sample replies. Colours copied from its theme. Works offline."), and a three-line jump index of about 25 lowercase monospace links (`context finding evidence … pending unparsed`). It reads like a developer tool. Below it, "What this page is" starts with "**A drawing, not a change.**", and that line works. By the end of the first paragraph I knew it was a mockup of how structured reply parts could render, and that nothing on it is live.

**What I thought I was supposed to do.** The intro sets one task: "Does a reply read as carefully made as the recap card that ends a turn? … the answer is yours to judge." So I flipped Rendering and looked for the recap card. The page never says what decision my judgement feeds, and the six decisions in the document never appear on it.

**Where I got confused:**
- "That card is the last section's benchmark". I scrolled to the last section, which turned out to be "What this page does not prove". The card is in the third section.
- "One part of the vocabulary at a time". Which vocabulary? I worked it out from the index.
- The tier table and its rule ("a panel needs two or more things side by side, or a label and a value"). I tried the rule against the next section. Context has a label and a value and is not boxed, so the rule failed on its first test.
- The comparison section. The panels are about a queue key bug and the recap card under them is about a gallery. I spent time looking for the connection before deciding there isn't one.
- The page is 23,482px tall at the wide setting, and most of that is expanded JSON. By "Comparison" I was skimming past the code blocks, which are often taller than the rendering they produce.

**My reaction.** The proposed rendering looks good, quiet and native, and much better than the current one. My second thought, after flipping to "Current plain", was that the current rendering looks broken rather than plain ("Before:" is bigger than the sentence it labels). I couldn't tell whether I was being shown a design or a bug fix.

**After reading the document's opening.** The document made it worse before it made it better. The title is "Reply blocks at parity with recap cards". "Direction in two sentences" opens with "The recap card is the turn's *verdict*; reply components are its *exhibits*" and then "its label gutter, 11/13px type, hairline rules, glyph vocabulary, token set, 8px radius". That is the shorthand the owner objected to, in the first 20 lines. §1's table confirmed my suspicion about the baseline: "Literal labels … render at **16px / 24px**". The document's own diagnosis says the bug is the main cause, and the prototype still doesn't show the bug fixed on its own.

## Findings, ranked by cost to the reader

### 1. The comparison is against a bug, so it cannot answer the page's own question
*Where:* the Rendering switch on every screen; doc §1 table rows 1–2; §10 "Height".

"Current plain" faithfully reproduces today's renderer (I checked it against `before-gallery-delivered.jpg` and `PlainBody.tsx`). Today's renderer prints `<p>Before:</p>`, `<p>Status: passed</p>` and the test totals as unsized elements, at 16px, over 13px content, with a 16px gap after every field. The document says this is the cause ("The flat rendering is *miscalibrated*", "the current 16px field gaps cost more than the frames do"). So the A/B on the page compares a sizing bug with a redesign. Any design would win that comparison.

The owner is asked whether the panels are worth it. Nowhere can they see what the 13px, label-column version without panels looks like, and that is the real alternative and the cheap one. §11 even contains the one-line fix ("set the base `text-[13px] leading-relaxed` on the reply container so unsized elements never fall back to 16px again").

*Do instead:* add a third rendering, "Today, sizes fixed", or ship the fix first and compare in the real app. If the panels still clearly win, the case is made. If not, the owner gets most of the value for a tenth of the code.

### 2. The document reintroduces the exact words the owner pushed back on, and buries the ask
*Where:* the document's title, "Direction in two sentences", §3, §4, §5, §10, §11.

Counts in `reply-block-design.md`: "parity" 3, "exhibit(s)" 19, "claims" as a design term (§3 "A reply interleaves *claims* (prose) and *evidence*"), "verdict" and "ruling", "gutter" 13, "glyph" 26, "chrome" 6, "tiers", "specimens" 8, "the brief". The prototype's copy was cleaned up, but the document was not. Specific failures:
- Title: "Reply blocks at parity with recap cards". The reader will take "parity" to mean "look the same as the recap card", which the design explicitly rejects (§5 recommendation: "deliberately lighter … so the recap stays the loudest object"). Say what is proposed: "Drawing reply components instead of flattening them to paragraphs."
- "Direction in two sentences": "Exhibits borrow the recap card's grammar (its label gutter, 11/13px type, hairline rules, glyph vocabulary, token set, 8px radius) but not its volume". Nobody who wasn't in the room can parse this. Instead: "The parts get the recap card's label column, type sizes and status marks, but stay grey; only a status or a recommended choice gets colour."
- §3 "Idea": "The recap card is the turn's ruling; components are the exhibits the ruling rests on." This is a courtroom metaphor standing in for a hierarchy rule. Say the rule.
- "Four corrections to the brief's premises" (§1) and "Is the gallery 'quite unimpressive'?" These are in-conversation references. The four corrections (uppercase state line, check-mark colour, `max-w-4xl`) are trivia that do not bear on the decision. Move them to an appendix.
- §2 References, §4 tokens and type scale, §12 preflight: about half the document is process and implementation detail placed ahead of the decisions. The six decisions are at the very end (§13).

*Do instead:* open with four short paragraphs covering what is wrong today, what changes, what it costs, and the decisions needed. Move §2, §4 and §12 to an appendix. Ban "exhibit", "parity", "verdict", "gutter", "chrome" and "glyph" from everything above the appendix.

### 3. The page's one stated rule contradicts the design it summarises
*Where:* "What this page is", the blockquote under the tier table.

> "The rule that keeps this from becoming boxes all the way down: a panel needs two or more things side by side, or a label and a value."

- "Side by side": nothing in a panel is side by side. Rows stack, and Comparison says "stacked at every width".
- "A label and a value": this describes Context ("Context" | topic) and a finding's "Consequence" row. Both are "Labels, no box".
- "Two or more things": by this rule a `checks` with one item, or a one-step `sequence`, would not be boxed. The design boxes them anyway, and that case is never drawn.

A reader who tries to use the rule to predict the next section gets it wrong. The real rule seems to be: *a part whose data is a list of parallel rows gets a panel; a part with one subject gets a label and no panel.* State that, and say what happens with a single row.

### 4. The Group section mislabels its own example and claims a difference it does not show
*Where:* "Group" section. Header tag "Boxed panel". First caption "**A supporting group** — sample reply 1".

The JSON printed directly under that first example says `"relationship": "peers"`. So the one section that exists to show peers versus supporting labels a peers group as supporting. The peers rendering is two paragraphs and a recommendation with "only a little more space between the parts", which in practice is nothing visible. The section's "Why" says "Today both collapse into the same list, so the difference the agent wrote is lost". Under the proposal, peers is still lost.

The header "Boxed panel" is also wrong for half the section. And the supporting example (change plus finding in one frame) shows the finding as a third row of the change. Nothing marks which child is the explanation and which is the support.

*Do instead:* fix the caption. Tag the section "Boxed panel (supporting) / Plain (peers)". Say honestly that peers is not distinguished, or design something that distinguishes it.

### 5. The page contradicts itself in a dozen places
Each of these makes a careful reader distrust the rest:

| Quote, and where it is | Contradicted by |
|---|---|
| "No sample reply contains: `evidence`." (Every part intro) and "No sample reply contains this part." (Evidence section, which shows no example at all) | The finding example from sample reply 1 shows two evidence chips. Sample reply 1's "Uses" line lists "evidence". The checks example shows a "Replay fixture" chip. The count misses evidence because evidence is nested inside other parts, not a top-level part. Show those chips in the Evidence section. |
| "This is the one place a reply earns red and green." (Change, Why) | Checks shows a red "Failed" and a green "Passed". Delivery shows green "Done" and green connectors. |
| "…followed by the exact text an agent types to produce it." (intro) | The caveat "the order of its keys may differ from what an agent typed", and doc "a schema default can appear that the author left out". It is not exact. |
| Jump index link "what this proves" | It jumps to the heading "What this page does **not** prove". |
| "That card is the last section's benchmark" | The card is in section 3, not the last one. |
| "Whole replies, in order — *how one arrives*" | Nothing arrives. These are static, finished replies. "How one arrives" suggests streaming. |
| Details: "a one-line preview so hidden text is never a surprise" | Doc §10: "content is hidden until opened, which may surprise a reader". |
| Pending: "holding the space stops the rest of the reply from jumping when it lands" | Caveat: "shifting the reply below it is not measured". Doc §12: "the 44px reservation does not match every result". |
| "The plugin's samples are all successes" (Failures section) | Sample reply 2's delivery has "Blocked" and its checks have "Skipped". |
| "…parsed here by the plugin's own `parse()`, which is why every example below can be trusted to be valid input." | Every "invented for this page" example is a hand-written object (`SYNTHETIC` in the HTML) that never goes through `parse()`. |
| "Sample reply 1 of 3", "2 of 3", "3 of 3" | "Old replies" captions its example "sample reply 4", and the doc says "four specimens". |
| Text section: "Markdown, with no component at all" | Sample reply 3's prose, on the same page: "This paragraph is a component like any other". |
| Reply 1 "Uses … Details section"; reply 2 "Uses … details component" | Same part, two names. |

### 6. The benchmark recap card belongs to a different task
*Where:* "A reply block next to the recap card", and "Whole replies", sample reply 2: "The recap card that ends this turn, copied from a real thread".

The panels are about the held-key fix. The card says "Added a reply-block gallery to the Workstreams page and shipped it". The caption "ends this turn" is false. The page asks the reader to judge hierarchy between a reply and its own recap, and a card about another piece of work makes that judgement impossible: nobody can ask "does the card summarise what the panels show?" when it doesn't.

*Do instead:* write a recap for the queue fix in the card's real format and label it as written for the page. The point of the comparison is whether the two objects work together, not whether real data was used.

### 7. The recommended handling of old replies breaks the document's own hierarchy
*Where:* "Old replies that carry the card inline"; doc §5 "legacy `card` fields"; decision 4.

§3 says "the recap is the only tinted, bordered, state-colored object". The proposal then draws a blue-bordered "Ready for Review" card *inside the transcript* for every old reply. Scroll through history and you meet several recap cards that are not the recap card. Two other problems:
- The inert card has no buttons but looks exactly like the interactive one. That is a false affordance, despite the claim that it is "without pretending to be interactive".
- The unchecked result ("Not done / ☐ Check the settle timing on a display") renders *above* the card, outside it, before its state line. That is how the parser orders it today, but drawing a full card makes the orphaned item more obvious, not less.

These are historical messages. Fix them cheaply: plain rendering at corrected sizes, with `Next` restored and "Not done" kept next to its results.

### 8. A failing check panel looks like a passing one at a glance
*Where:* "CI on the task branch", dark and light; doc §10 "Neutral frames, not state-tinted"; decision 1.

At 728px dark, the failed row's tint is barely visible. In light mode the document admits the tints are "only faintly visible against white". The only strong failure signal is the red "1 failed" in the header tally and the word "Failed" at the right edge of the row. Finding a failure is the main reason anyone reads a checks panel (the Checks section's own "Why" says so), and the design spends its colour restraint in exactly that place. A reply with four grey panels in a row, as sample reply 2 has, hides a failure behind panels that look identical.

*Do instead:* tint the frame's header strip or border when any row is `failed` or `blocked`. Keep passing panels neutral. That keeps the recap card the loudest object and still lets failure reach panel level.

### 9. Colour and tone are inconsistent across parts
*Where:* the "Failures and unknowns" reply; doc §4 status table.
- `unknown` is amber (the "needs you" tone) on a finding and grey on a delivery stage. It is the same word with two meanings for the eye.
- `pending` on a delivery is purple, a hue used nowhere else in a reply.
- The single invented reply shows green, red, amber, purple and blue. That is defensible case by case, but it undercuts "color is spent only where a status or a decision needs it" as a selling point. Five hues in one reply is not quiet.
- The amber "⚠ Attention" on a sequence step sits right-aligned in the same column as the status words in checks and delivery, so it reads as a status ("this step failed"?). The schema never says what `attention` means, and neither does the page: "A step that needs attention keeps its number, gains an amber ring, and says Attention."

### 10. Louder statuses make the schema's gaps louder
*Where:* Delivery, "Where the fix stands" (sample reply 2).

`delivery` statuses are `done | pending | blocked | unknown`, with no "not started". So the sample marks "Deployed — The plugin reloads after merge" as **Blocked**, which now renders as an amber circle with a slash. Nothing is blocked; deployment just hasn't happened yet. Similarly, "Pushed — Pending — Waiting on your review" is not the state of the push. The plain renderer made that misuse harmless. The new one presents it as a warning. The design should either add a not-started status or change the agent guidance before rendering statuses this loudly. Neither the document nor the six decisions mentions this.

### 11. The page buries the drawings under JSON
*Where:* every catalogue example ("▼ What the agent typed to produce this", expanded by default).

The code block under nearly every example is taller than the rendering above it (the finding example is about 180px of drawing and about 360px of JSON). The owner wrote the schema and does not need it shown 30 times to judge a visual design. Also unexplained: the uppercase "WORKSTREAMS" label on every code block (it is the fence's language tag), and the "⧉" in the failed-validation example.

*Do instead:* collapse by default, and keep the one annotated "What an agent types" section at the top.

### 12. The descriptions don't change with the Rendering switch
*Where:* any section with Rendering on "Current plain".

The section headers still say "Labels, no box" and "Boxed panel", and "How it looks" still describes the proposal ("A rule down the left whose line style shows the certainty…") over a rendering that has none of that. In plain mode the words and the picture disagree. Either change the header and "How it looks" rows with the switch, or label them "Proposed: …".

### 13. Labels and control names that fail
| Text (where) | What a reader thinks it means | Instead |
|---|---|---|
| "Current plain" (Rendering control) | "Plain" sounds like a style choice, not "what ships today". | "Today" / "Proposed" |
| "Wide 728 / Narrow 600 / Compact 375" (Thread column) | Bare numbers, and "Compact" is called "a phone" in the intro. | "Window 728px / Narrow 600px / Phone 375px" |
| "Works offline." (toolbar blurb) | Irrelevant to the decision. | Cut it. Put the page's real title here, since the `<h1>` is hidden. |
| Jump index `directive pending unparsed text group` | Schema identifiers, while the sections are titled "A part still arriving" and "A part that failed validation". The two never match. | Use the section titles. |
| "Every part" / "Whole replies" / "Caveats" (index groups) | Fine. | Keep. |
| "Written as" (first row of every part) | It means something different in each section: a type name (`context`), "the evidence list inside a finding or a check", "Markdown, with no component at all", "nothing yet: a fence that opened but has not closed", "whatever the agent wrote, kept as text". | "JSON type" with a value, or "—" with a one-line note. |
| "One part of the vocabulary at a time" (intro) | Which vocabulary? | "One kind of part at a time" |
| "One reply carrying the reading half of the vocabulary" (sample reply 1) | Insider shorthand. | "A reply that explains a bug: prose, a finding with evidence, steps, options and a recommendation" |
| "The same four specimens the Gallery page loads" (What an agent types) | "Specimens" is jargon, and the page elsewhere says "sample replies". | "The same four sample replies the Workstreams Gallery shows" |
| "the plugin's own `parse()`" | A function name in reader copy. | "the plugin's own parser" |
| "Today the text says Evidence: observed, which names the wrong field." (Finding, Why) | "Which field?" | "Today it prints 'Evidence: observed', which labels the certainty as if it were evidence." |
| "so alignment does work that words used to do" (Checks, Why) | The words are still there. | "Status words sit in one column, so a failure is found by scanning one edge." |
| "Which option the agent picked is the one real decision in the reply" (Comparison, Why) | The recommendation is also a decision. | "The recommended option is the only row that takes colour." |
| "the only part of a reply that echoes the recap card" (Recommendation, Why) | The recommended pill and the old-reply card also echo it. | Drop "only". |
| "same width, same colours" (comparison subtitle) | Fine. | Keep. |
| "Uses — card state, result checkboxes, Review, Links, Next" (Old replies) | "Result checkboxes"? | "Uses the card's state, done and not-done items, Review, Links and Next" |
| "Receiving information…" (Pending) | Fine, and it matches today. | Keep. |
| "Component not displayed: Invalid input" (Unparsed) | Tells the reader nothing. | The document defers this (§1). The prototype should show what a useful error would look like, since this is the panel the reader sees when it goes wrong. |
| "How much box each part gets." | Colloquial, but it works. | Keep. |
| "A drawing, not a change." | Works. | Keep. |
| "The address keeps all three" | "Address" is vague. | "The URL keeps all three" |
| "Labels, no box" listing "evidence" | Evidence chips are bordered pills. | List evidence under its parent parts. |
| Intro tier "Labels, no box" omits Details | But the Details section is tagged "Labels, no box". | Make them match. |

### 14. The "shorter" claim is partly an artefact of hiding content
*Where:* doc §10 "Height".

I reproduced the prototype-side numbers exactly. At 728px, current 1321 / 1579 / 235 and proposed 1130 / 1248 / 261, so the two main samples go from 2900 to 2378px. At 600px it is 3160 to 2575, and at 375px 3587 to 3342. But the Details sections drop from 98px and 77px to 35px each because they are closed by default. That is about 105px of the 522px saving, or roughly 20%, and it comes from hiding text, not better layout. The rest comes from fixing the 16px gaps, which the calibration fix alone would also recover. The invented reply is *taller* at 375px (2185 to 2239px), which the document does not mention. The live-app heights ("live 1321 / 1582 / 242 / 321") cannot be checked from anything shipped. Height is also not a goal the document set anywhere else. Drop the claim or qualify it.

### 15. Measurements cited without anything a reader can rerun
*Where:* §7, §9, §12.

"Contrast measured by script on every text node … 0 failures; minimum 7.49:1 dark, 4.74:1 light". "Replica fidelity against the live gallery". "Non-text glyphs ≥ 3:1". No script, output or table ships with the artefacts, and the reference screenshots for §2 "were … not archived". "Settings → Colors still restyles everything" and "this design passes [color-lint] by construction" are claims about code that does not exist yet. The one computed claim I could check, recap body text at about 10.2px in a 375px column, does reproduce in the prototype (10.197px). Either ship the measurement script next to the prototype or phrase these as "the author measured".

### 16. Overbuilt in places
- **Certainty encoded three ways** (rule style, glyph, word). At 2px, dashed and dotted are hard to tell apart; the word does the work. Keep the glyph and the word, and use a solid rule for all three.
- **`2 steps`, `2 options`, `3 options`** in panel headers repeat what is visible a few pixels below. Keep the tallies that summarise state (`1 of 3 done`, the checks totals).
- **The 5.5rem label column for Context** spends about 100px of a 600px column on the word "Context". Context is a one-line subject: put the label above it.
- **A frame around `sequence`.** The design's own reference (R5, Linear) shows the rail unframed. The stated reason, "a reply may carry several in a row", is a reason to space them apart, not to box them.

### 17. Cases the product will hit that are not drawn or decided
- **Consecutive panels.** Sample reply 2 is change, checks, delivery and a supporting group: four grey boxes in a row, then a callout. The tier rule stops paragraphs being boxed, but nothing stops a reply becoming a stack of panels. Decide on spacing, a joined stack, or a soft limit.
- **Nested inside subagent deliveries.** That code path exists today (`SubagentDeliveries.tsx`) and will double-frame. §11 calls it "Not prototyped". It is a design decision, not a caveat.
- **Long checks lists.** 30 passing rows and one failure, in agent order. Do passing rows collapse? Does a failure move up?
- **Single-row parts.** A one-item `checks` or a one-step `sequence` (see finding 3).
- **Streaming.** A 44px dashed placeholder becomes a 300px panel. The caveat admits it isn't measured, but the design should at least say how much jump is acceptable.
- **Copy and select.** `toText` is untouched, but selecting text across a panel now picks up right-aligned status words and pill labels in DOM order. The document doesn't say what that produces.

## The six decisions in §13

| # | Right question? | Comment |
|---|---|---|
| 1 Frame tone | **Yes, but it should come with a firmer recommendation.** | Failure has to be visible at panel level (finding 8). Recommend: neutral by default, failure tone on the header strip or border when any row is failed or blocked. |
| 2 Before/After colour | Barely needs asking. | A reversible one-line CSS taste call. The designer should decide it; I would keep the signs and drop the tint, since signs plus words already read as a diff and the tint implies "wrong → right". |
| 3 `details` default | **Yes.** | A real product decision, and it changes the height claim (finding 14). Surface that link. |
| 4 Legacy card | **Yes, but the recommendation is wrong.** | The inert card contradicts the hierarchy (finding 7). Recommend plain rendering with the fixes. |
| 5 Derived summaries | **Does not need asking.** | Decide it in the design: keep state tallies, drop counts that repeat visible rows. |
| 6 Recommendation hue | Yes, minor. | The comparison section puts a blue callout and a blue-bordered card in the same view. The owner can judge it from that screen, so the decision should point there. |

**Missing decisions, in order of importance:**
1. **Order of work: ship the calibration fix separately first?** This is the decision with the most money in it, and it isn't on the list.
2. **Status semantics: add a not-started delivery status, define `attention`, or change the agent guidance** before the renderer makes misuse loud (finding 10).
3. **Nested mode inside subagent deliveries** (finding 17). A real code path, needed before implementation.
4. **Consecutive panels:** spacing, joining, or accepting a stack (finding 17).

## What to keep
- **The catalogue structure.** One section per part, the same four rows each time, a Rendering switch over everything, and a URL that records the view. It is the right shape for this decision.
- **"What this page does not prove".** Honest, specific and in plain words. The document should copy its tone.
- **The invented failure reply.** Without it the samples would never show a failure, and it is the most convincing screen on the page.
- **Every status prints its word,** with a distinct glyph shape per status. Colour is never the only channel.
- **Prose stays prose,** even inside panels, and headlines and `text` are unchanged.
- **The checks panel:** totals strip, right-aligned status column, chips under the row.
- **The comparison panel's recommended row,** and stacking options at every width (the Stripe reasoning holds).
- **Evidence chips one per line,** a fix the author caught in preflight.
- **Fallbacks keep the source,** and dashed means "not the real thing".
- **No new colour tokens,** and the recessed frame borrowed from `SubagentDeliveries.tsx`.
- **The §1 diagnosis.** It is accurate (I checked it against the code and the before screenshot), and it found real bugs: `Evidence: observed` mislabels certainty, `Next` is dropped because `ReplyBlock.tsx` iterates only `review`, `waitingOn` and `links`, and headings skip from `h1` to `h3`. Those are worth fixing whatever happens to the redesign.
