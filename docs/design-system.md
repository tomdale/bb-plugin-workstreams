# Workstreams design system

Workstreams draws inside BB. BB supplies the visual foundation; Workstreams adds
the visual language for work identity, attention, reported state, and structured
information. A Workstreams surface should look native to BB before its own
semantic cues appear.

This guide records the design contract for new and revised UI.
`src/app/theme/tokens.css`, the vendored BB components, and current component
code remain the source for exact values and behavior. The reply-component
section describes how the reply renderer draws each part.

## Three layers

1. **BB foundation:** inherit BB's theme, typeface, theme variables, Markdown
   renderer, interaction conventions, and registry controls.
2. **Workstreams semantics:** use Workstreams tokens for work state and topic
   identity, with compact layouts that fit BB's sidebar, timeline, composer, and
   plugin page.
3. **Component composition:** choose a layout that makes each field's
   relationship clear without wrapping every piece of text in a card.

A surface may add Workstreams meaning; it must not replace BB's theme or make a
second, competing application shell.

## BB foundation

### Theme and primitives

Use BB's semantic variables: `--background`, `--foreground`,
`--muted-foreground`, `--border`, `--accent`, `--sidebar-accent`, `--ring`,
`--radius`, and the surface and state variables provided by the host. Use
semantic utility classes such as `bg-background`, `text-foreground`,
`border-border`, `bg-state-hover`, and `ring-ring`; don't choose a Tailwind
palette shade or literal color for a component.

Use the vendored `components/ui` registry components for controls, overlays, and
menus. Use the SDK's `Icon` component and BB icon names. Keep BB's focus,
selected, disabled, hover, and open states. A custom control needs a concrete
interaction reason; visual preference alone is not a reason to replace a
registry control.

Do not set a global font stack or reset BB's typography. Body copy and Markdown
inherit the host's font and theme. Set local type only to establish hierarchy or
fit a documented compact surface.

### Density and shape

Workstreams sits in dense areas of BB, so its controls and secondary labels stay
compact on desktop. Use BB's border and radius variables and the existing
`rounded-md`/`rounded-lg` patterns. Reserve bordered, tinted panels for a
distinct action, state, or grouped object; keep ordinary prose and metadata in
the message flow.

Use the host's responsive conventions. On coarse-pointer layouts, raise text and
control targets where BB does; `max-md:pointer-coarse:*` is the established
Tailwind variant. Wrap long paths, URLs, titles, and evidence labels instead of
allowing horizontal overflow. Use container queries when a component's available
width matters more than the window width.

## Workstreams color

### Keep identity and state separate

A topic color identifies _which workstream_ a thread belongs to. A semantic
status color says _what is happening_ or _what needs attention_. A workstream
hue must not stand in for a completion, review, waiting, failure, or
user-attention state.

Topic colors come from the catalog's allocated hues
(`src/domain/workstreamColor.ts`). The sidebar, Home, queue, and thread header
use the same topic identity. Keep category labels subordinate to the workstream
identity; categories do not get their own hue or become another workstream.

State colors use the six configurable tokens in `src/domain/colors.ts` and
`src/app/theme/tokens.css`:

| Token        | Meaning                                       | Typical use                           |
| ------------ | --------------------------------------------- | ------------------------------------- |
| `complete`   | Work reported complete                        | Completion marks and recap state      |
| `review`     | Work ready for review                         | Review marks and recap state          |
| `waiting`    | Work is still in progress or waiting          | Working indicators and waiting recaps |
| `needsYou`   | The person has a decision or response to make | Up Next and question cards            |
| `failure`    | A failed or invalid operation                 | Errors and failure marks              |
| `suggestion` | A model-suggested value                       | Suggested topic identity and previews |

Each token has mode-aware steps for solid marks, readable text, strong fills,
text on fills, quiet marks, bands, borders, surfaces, footers, and rules. Use
the step that matches the role instead of using the solid color for every
element. Keep body text and unrelated controls in BB's neutral colors. Users can
follow a BB theme color or choose a custom color, so components must use the
token variables rather than assume the default hue.

Pair each colored state with a word, icon, or shape. Do not color a
recommendation as a review state unless the work itself is awaiting review.

## Type and hierarchy

The host font remains the default. Workstreams uses small, legible type for
dense navigation and reserves larger type for the question, goal, or answer that
should lead the reader.

Existing role examples—not a global scale—include 13px sidebar rows, 12px
category labels, 11px uppercase sidebar section headings, a 15px semibold
plugin-page heading, and a 20px question prompt that grows to 22px on
coarse-pointer phone layouts. Recap and question cards use local type roles and
container-aware sizing. Preserve those component-specific scales instead of
making every surface share one font size.

Use weight, size, spacing, and position before color to establish hierarchy. A
headline states the answer; supporting explanation follows at normal message
weight; labels and metadata are smaller and quieter. Keep labels sentence case
and concise. Use monospace for code, paths when they need code treatment, and
compact identifiers such as commit hashes—not for ordinary metadata.

## Surfaces and signature idioms

### Up Next

Up Next is Workstreams' strongest sidebar surface because it collects threads
that need the person's attention. It uses a flat, lightly tinted panel, a fine
state-colored border, a clear heading, and compact rows. Its arrival cue and
slow shimmer are restrained and stop under `prefers-reduced-motion`. Do not
spread this treatment to ordinary workstream groups.

### Recap and question cards

A recap uses the token for its state on the border, faint surface, state label,
and internal rules; its explanation stays neutral. The card is centered and
constrained to the available thread width. Its compact layout steps its type and
spacing down together.

A question card uses the `needsYou` token to identify a choice that requires the
person's input. The question is the largest text in the card; option labels,
details, and descriptions step down in that order. Options expose radio or
checkbox roles, keyboard navigation, a clear selected state, and visible
keyboard focus. Phone controls and text meet the coarse-pointer and iOS
input-size constraints in `question/question-presentation.tsx`.

### Navigation and work identity

Sidebar rows keep BB's thread title and native status primary. Workstreams adds
topic identity, category context, work-state marks, and actions without
displacing native working, unread, waiting, or error indicators. Hover actions
take no resting layout space and appear on row hover, keyboard focus, or while a
menu is open. The thread's topic hue appears as an identity cue, not a row fill.

### Plugin pages and settings

The queue is the primary Workstreams page. Activity, Topics, and Gallery are
secondary views with a clear Back affordance, a constrained reading width, and
compact typography. Settings use BB registry controls and group related rows in
neutral bordered surfaces. A preview shows the result of a choice in context.
Keep its controls in the same vocabulary as the rest of BB.

## Reply component vocabulary

Reply components express different kinds of information. Their presentation
should make those differences visible while keeping the reply part of BB's
message timeline. The reply body is not a stack of generic cards: one frame, the
recessed panel subagent deliveries use, is reserved for the parts that report
results, so the edge of a frame in a reply always means a result is reported
inside it. Every other part uses the recap card's inner idioms in the message
flow: the label gutter, the mark column, hairline rules, and accent labels.

The reply's type scale is in `src/app/reply/type.ts`: body 13/21, a part's title
13/19/600, secondary text 12/18 muted, labels 11/17.6/500. BB's Markdown sets
its own size and foreground colour on its root and every paragraph, so a wrapper
that makes Markdown smaller or muted must hand its values down
(`INHERIT_MARKDOWN`, or `SECONDARY_TEXT` for secondary Markdown); without that,
the wrapper's classes never reach the text.

- **Context:** An orientation line: the topic in medium weight in the reply
  accent, the way the sticky goal header shows its workstream above the goal,
  with the reported location smaller and muted beneath it. Any background
  follows as ordinary prose.
- **Text:** Ordinary Markdown prose, unboxed. Preserve the author's paragraphs,
  lists, and inline formatting.
- **Sequence:** The title, then recap card steps in order: each step number sits
  in the mark column as a small muted tabular figure, sized and placed like a
  stroked mark, with a thin rail joining the numbers so the steps read as one
  path. The step title comes first, with any detail smaller and muted beneath
  it. An attention step takes a medium-weight title and shows the word Attention
  beside it in the reply accent, the thread's workstream identity color (muted
  when unfiled), never a state color. No frame.
- **Comparison:** The title, then each option in one order: its name, the
  summary, any qualification, then any detail, muted and smaller. Options sit in
  columns only when all of them fit in one row at about 13rem each (two, three,
  or four options); otherwise, and always for five or more, they stack. In
  columns every field shares a row across the options, so summaries,
  qualifications, and details start at the same height. A hairline rule sits
  above each option; the recommended option's rule is heavier and in the reply
  accent, and a small accent "Recommended" label sits beside its name, so the
  recommendation never rests on color alone. No frame.
- **Change:** The title, then labelled rows: Before, After, Unchanged, and
  Limitation each take a small label in the card's label gutter beside the
  value, stacked above it below 24rem, with a hairline above every row so the
  part has an edge where it starts. The gutter is at least the card's 3.25rem
  and widens to fit the longest label so every value starts at the same edge.
  Labels take the reply accent, the thread's workstream identity color, so a
  reply reads as part of its workstream rather than as a work state; an unfiled
  thread's labels stay muted. No frame.
- **Checks:** The recessed panel. Its header holds the title, the scope muted
  beneath it, and the reported test totals at the right as one short sentence
  ("8 tests passed, 0 failed, 1 skipped"), where a count above zero takes its
  status's tone. Each check is a row: a stroked status mark, the name, any
  detail and evidence muted beneath it, and the status word at the right edge.
  Each status has its own mark shape; every status but passed prints its word,
  so the right-edge column lists only the rows worth reading, and a pass's word
  is read only by assistive technology. A failed or blocked row's name takes
  medium weight. Rows are not tinted.
- **Delivery:** The same panel and header, then the stages in order on a thin
  rail joining their marks. Done is a check, pending a ring, blocked a struck
  ring, not-started and unknown a broken ring; every status but done prints its
  word at the right edge. Do not imply that a reported stage was independently
  verified.
- **Panel tone:** A checks or delivery panel takes the tone of its worst row at
  its border and in its header strip, the way a recap card takes its state's:
  `failure` when a row failed, `needsYou` when a row is blocked and none failed.
  The title stays neutral, like the card's goal. A panel with nothing failed or
  blocked stays neutral, which keeps the recap card the loudest object.
- **Evidence:** A quiet list beneath the row it supports, at the secondary size:
  the recap card's file or web glyph, then the label as a link, then any detail.
  No bullets.
- **Recommendation:** Labelled rows like Change: "Recommended" beside the choice
  in semibold, then "Reason" and any "Qualification". The labels take the reply
  accent and reuse the recommended option's word, so a recommendation reads the
  same wherever it appears. Do not borrow `review` or `complete` color to make
  advice appear like a work state.
- **Details:** The title as a component heading, then the body as ordinary
  Markdown at full contrast, unboxed and never collapsed, because the answer or
  essential caveats may land there. A `### Details` heading in prose renders the
  same way.
- **Group:** Peers share one row in equal columns when the message column fits
  every peer at its minimum width, and otherwise each takes the full width; they
  never wrap into a ragged second row. Supporting children sit beneath the first
  child, the point they qualify, indented under one thin rule in the reply
  accent. A child that is a list of components stays together in one cell. The
  group adds no frame, so each child draws as it would on its own: a checks
  child keeps its panel and its tone.
- **Rejected component:** The reason sits above the component's source with a
  failure mark, in the failure text step at the secondary size, which marks it
  as a diagnostic about the reply, not part of its answer.

A reply headline is the answer's first reading stop. Keep component headings
below it. Make evidence, status, qualifications, and recommendation easy to
scan, but do not let decoration imply truth, test results, or delivery that the
report does not claim.

## Interaction and motion

Use semantic HTML and the BB registry's keyboard behavior. Provide an accessible
name for icon-only controls, preserve visible keyboard focus, and keep touch
targets large enough for coarse pointers. Tooltips use the shared `Hint`
wrapper; BB does not display native `title` tooltips.

Motion should clarify a state change, preserve continuity, or orient the reader.
Prefer small changes to opacity, transform, or a measured layout track; avoid
motion that makes surrounding content jump. Follow `prefers-reduced-motion` for
every nonessential animation and transition. A static state must still
communicate the same information.

## Shared primitives

`src/app/primitives/` holds the low-level pieces that several surfaces draw the
same way, and each has a page in the gallery's Primitives group:

- `StatusDot`: a small circle that carries color only. Pair it with a word. It
  takes a state tone, the workstream hue, or a hollow ring.
- `CountPill`: the Needs you count on group headers, compact in the sidebar and
  roomy on Home.
- `KeyChip`: an outlined key for a shortcut, hidden under a coarse pointer
  except in its inline form.
- `SectionHeading`: the small uppercase heading over a page section.
- `menu.ts`: the surface, item, label, and separator classes of Workstreams' own
  Radix menus, matching BB's menu surface.

Use a primitive instead of repeating its classes. Add one only when a pattern
appears in three or more places with the same look; a pattern that varies by
surface (the reply accent chips, empty-state messages) stays local.

## Implementation and review

- Use BB theme variables for neutral surfaces and Workstreams variables for
  semantic state. Do not add raw Tailwind palette classes or literal colors in
  `src/app`.
- Keep Workstreams tokens scoped to Workstreams roots and portals. Add or change
  a semantic token only when a stable role needs it; do not add one per
  component.
- Use shared BB components, icons, Markdown, and interaction wrappers. Do not
  recreate a BB primitive for cosmetic reasons.
- Keep current product terms from `README.md` and the UI. A visual distinction
  must not invent a new user-facing state or organization concept.
- Check light and dark themes, a narrow desktop pane, a coarse-pointer phone
  layout, keyboard focus, and reduced motion. Check custom state colors when a
  surface uses them.
- Tests establish structure, semantics, and interaction. Inspect the rendered UI
  in BB or a throwaway BB server before shipping; a passing DOM test does not
  establish visual quality.

Useful source references: `src/app/theme/tokens.css`, `src/domain/colors.ts`,
`src/app/styles.css`, `src/app/sidebar/tokens.ts`, `components/ui/`,
`src/app/composer/RecapCard.tsx`, `src/app/question/question-presentation.tsx`,
`src/app/sidebar/Row.tsx`, and `src/app/page/Page.tsx`.
