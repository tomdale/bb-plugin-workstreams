# Workstreams design system

Workstreams draws inside BB. BB supplies the visual foundation; Workstreams adds
the visual language for work identity, attention, reported state, and structured
information. A Workstreams surface should look native to BB before its own
semantic cues appear.

This guide records the design contract for new and revised UI.
`src/app/theme/tokens.css`, the vendored BB components, and current component
code remain the source for exact values and behavior. The reply-component
section defines the intended presentation language for the reply vocabulary; it
does not describe the current plain-Markdown renderer as if it already followed
that language.

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
keyboard focus.
Phone controls and text meet the coarse-pointer and iOS input-size constraints
in `question/question-presentation.tsx`.

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
message timeline. The reply body is not a stack of generic cards. Use shared
Markdown and text behavior, then add structure where the component's data calls
for it.

- **Context:** A compact, muted orientation line for the subject and reported
  location. Keep background explanation as ordinary prose.
- **Finding:** Lead with the conclusion. Show `observed`, `inferred`, or
  `unknown` as an explicit, quiet certainty cue. Keep the explanation and
  consequence readable; place evidence labels and details beneath the claim.
- **Text:** Ordinary Markdown prose, unboxed. Preserve the author's paragraphs,
  lists, and inline formatting.
- **Sequence:** A numbered path with aligned step markers and short supporting
  detail. Reflow to one column when the message column is narrow.
- **Comparison:** Keep options visibly paired and aligned. Use columns only when
  each option has enough width; stack them on narrow screens. Mark a
  recommendation with a label and restrained emphasis, not color alone.
- **Change:** Pair Before and After so the reader can compare them directly.
  Keep Unchanged and Limitation subordinate but adjacent to the change they
  qualify.
- **Checks:** Separate scope, actual totals, and individual checks. Pair each
  status with readable text and a status mark. Keep skipped, failed, blocked,
  and untested states explicit.
- **Delivery:** Show stages in order, with each stage's name, status, and detail
  together. Do not imply that a reported stage was independently verified.
- **Recommendation:** Give the choice a clear typographic lead, then the reason
  and any qualification. Do not borrow `review` or `complete` color to make
  advice appear like a work state.
- **Details:** Give the section a clear heading and preserve its body as
  Markdown. Supporting detail may be visually quieter; do not hide the answer or
  essential caveats inside it.
- **Group:** Give peer children equal visual weight. Place supporting children
  beneath the point they qualify. Keep the relationship legible at narrow widths
  without adding a card around every child.

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
