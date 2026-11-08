# Workstreams design system

Workstreams draws inside BB. BB supplies the visual foundation; Workstreams adds
the visual language for work identity, attention, reported state, and structured
information. A Workstreams surface should look native to BB before its own
semantic cues appear.

This guide records the design contract for new and revised UI.
`src/app/theme/tokens.css`, the vendored BB components, and current component
code remain the source for exact values and behavior.

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

| Token        | Meaning                                       | Typical use                            |
| ------------ | --------------------------------------------- | -------------------------------------- |
| `complete`   | Work reported complete                        | Completion marks and recap state       |
| `review`     | Work ready for review                         | Review marks and recap state           |
| `waiting`    | Work is still in progress or waiting          | Working indicators and waiting recaps  |
| `needsYou`   | The person has a decision or response to make | Up Next, question cards, reply actions |
| `failure`    | A failed or invalid operation                 | Errors and failure marks               |
| `suggestion` | A model-suggested value                       | Suggested topic identity and previews  |

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

## Reply panel

A structured reply puts what the reader must act on at its top, as counts,
marks, and copyable values, and folds the reasoning. A reader with thirty
seconds should be able to act correctly from the top of the reply; a reader who
wants the reasoning is one click from it. It stays a message: the only controls
are copy buttons on literal values and folds that open, because anything that
acted would go stale as the thread moves on, and the recap and question cards
already own the buttons a person presses.

### Order

The headline states the answer. The lead, the text before the first piece, is at
most two sentences. Then the renderer draws, whatever order the agent wrote:

1. Every actions piece, so what the reader owes is the first thing under the
   lead.
2. Checks, delivery, change, facts, tables, and text glue in written order.
3. Every details fold, at the end, so a run of folds reads as one list.

`arrangeBody` in `src/domain/replyPanel.ts` owns this order, and the plain-text
view follows it too, so a reply read without the renderer still leads with the
action.

### Pieces

- **Actions:** the one tinted panel in a reply: `needsYou` border, surface, and
  rules, a **Needs you** heading (or the agent's title) in `needsYou` text, and
  the computed count on the right. Rows are numbered in a muted tabular column;
  the action is medium weight and its detail muted beneath. A decision shows a
  small **Decide** label in `needsYou` text before the action. A caution is a
  stroked warning triangle and its text in `needsYou` text. A command is a copy
  value.
- **Checks:** counted tiles first: one row of cells on a hairline border, each a
  semibold tabular value over a muted label. A tile whose rows all passed takes
  a `complete` check mark; a failure takes a `failure` cross and failure text on
  its value; anything else stays neutral. The list beneath uses the recap card's
  stroked status marks, one shape per status, with every status but passed
  labeled beside the name. When every check passed, the list folds behind the
  title and scope; otherwise it stays open.
- **Delivery:** title and scope on one line with the computed count on the
  right, then the stages as one wrapping row of marks joined by short rules.
  Done is a check, pending a clock, blocked a struck circle, unknown a question
  mark; every status but done is labeled. Notes on unfinished stages sit open
  beneath; notes on done stages fold. Do not imply a reported stage was
  independently verified.
- **Change:** Before, After, Unchanged, and Limitation rows on hairline rules,
  labels in a shared gutter in the reply accent (the thread's workstream color,
  muted when unfiled), stacked above values when narrow.
- **Facts:** a muted label column sized to the longest label, every value
  starting at the same edge as a copy value; a note follows the value, muted.
- **Table:** semibold title with the computed state count on the right, a muted
  header row, rows on hairline rules, the first cell medium weight, the state
  last. A toned state takes a `StatusDot` and colored word (`complete`,
  `needsYou`, or `failure`); an untoned one stays muted. Under 30rem each row
  stacks: its first cell as the row's name, the other cells as label and value
  pairs, the state last.
- **Details:** a native disclosure, closed: a chevron that turns when open, the
  title in medium weight, and a muted summary computed from the body (code
  blocks, table rows, links, list items, or paragraphs, two kinds at most).
  Consecutive folds share their rules.
- **Text:** ordinary Markdown, unboxed.

A copy value is the value in monospace on a `state-hover` chip, breaking at any
character so a long path never overflows, with an icon button beside it that
names what it copies and confirms with a check. An HTTPS value is also a link.

### Rules that keep it honest

- Color means one thing: `needsYou` for something the reader owes or a risk,
  `complete` for verified, `failure` for broken. Nothing else in a reply is
  colored except change labels in the reply accent. Every color sits beside a
  word or a mark.
- Numbers on tiles and counts are computed from the reply's rows; an agent never
  authors a count the renderer shows, and fold summaries are computed, never
  written.
- A fold never hides a failure, an action, or a caution: failed and unfinished
  rows stay open by rule, and the agent instructions keep actions and cautions
  out of details.
- Monospace is for identifiers and code only. Piece titles are body size and
  semibold, below the headline.

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
`src/app/composer/RecapCard.tsx`, `src/app/reply/`, `src/domain/replyPanel.ts`,
`src/app/question/question-presentation.tsx`, `src/app/sidebar/Row.tsx`, and
`src/app/page/Page.tsx`.
