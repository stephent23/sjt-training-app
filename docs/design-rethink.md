# Design rethink — a Runna-shaped training app

Status: proposal. Nothing in this document has been applied to `public/styles.css`.
Visual references live in [`docs/mocks/`](mocks/index.html) — open them in a browser.

---

## 1. The tension, stated up front

`public/styles.css` opens with a design position, and it is a good one:

> Editorial, restrained, high-contrast. Quiet by default; claret (`--accent`) is spent only on
> focus, "today"/active state, and destructive confirm — never as a fill for a whole control.

and, over the token block:

> Exact values, contrast-checked against WCAG AA. **Do not change.**

Runna's language is the opposite position on almost every axis: bright white surfaces, large
rounded cards on a tinted ground, one saturated accent used as a *fill* — big primary buttons,
selected chips, progress rings — heavy geometric numerals, completion shown in colour, and very
few hairlines. (Everything I say about Runna here is inference from what is well established
about the app; I cannot browse, and I have not seen the current build.)

These cannot both hold. The austere system's whole idea is a **spending budget** for emphasis:
one accent, used three times, so those three times mean something. Runna's idea is
**confidence**: colour is a workhorse, and hierarchy comes from filled shapes and size, not from
the absence of them. A design that half-adopts Runna — bright cards but a claret that still
mustn't fill anything — gets the density loss of one and the legibility gain of neither.

### The recommendation: move to the Runna-shaped system

Reasons, in order of weight:

1. **The app changed under the design.** The stylesheet was written when this was a log — a thing
   you read. It is now a thing you *do*: a multi-week plan you navigate, sessions you run live in
   a gym, a generator you drive through three steps. Those need "which is the one thing to tap
   here" answered in half a second, and hairline-plus-weight gives you one visual tier for
   everything on screen.
2. **Hierarchy, not decoration.** A filled primary button, a big display numeral, and a green
   completion tick are three unmistakable tiers. The current system has to spell out
   `4 of 18 sets logged` in muted mono where a bar and a heavy `4/18` would land pre-reading.
3. **The context is a phone at arm's length, one-handed, sweaty, in bad gym lighting.** Generous
   padding and big filled targets are an accessibility argument as much as an aesthetic one.
4. **It is what the owner asked for**, and he is the only user. There is no brand committee to
   satisfy and no legacy to protect.

### What is given up — explicitly

- **The claret budget dies.** The header comment's central rule ("never as a fill for a whole
  control") is void. Colour becomes ordinary. That rule was the most distinctive idea in the file.
- **The printed-log character goes**: hairline rules as the only separator, mono figures
  everywhere, 0.12em small-caps eyebrows, 1.7 body leading. The app will look like other fitness
  apps. It is currently more *distinctive* than what replaces it — it is just less *usable* for
  what the app now does.
- **`Do not change` is invalidated.** That line is load-bearing documentation, not decoration: it
  records that someone checked these pairs. It must be replaced by a new checked table (§3), in
  the same commit, not simply deleted.
- **Density drops.** Cards, padding and gaps mean roughly 30–40% fewer rows per screen. Plan and
  History get longer. Mitigations: collapsible weeks already exist on Plan; History gets a
  deliberately compact row (§4.7).
- **More CSS and more states**, maintained by one developer with no component library. Filled
  buttons need pressed/disabled/focus treatments that a transparent button did not.

### The alternative I considered and rejected

*Editorial-plus*: keep the austerity, fix only the hierarchy — one filled `--ink` primary, display
numerals, a completion tick. Cheaper (an evening), keeps the identity, and is genuinely better
than today. Rejected because it does not answer the ask: it would still read as a printed log,
and the owner's actual complaint is that the app does not feel like an app.

### Where I do *not* follow Runna

- **Claret survives, demoted.** It stops being the accent and becomes the destructive/alert
  colour only — a role it already half-held (`.btn-danger`, `.error-list`). Red as a *primary*
  fill would read as "careful" on every screen, which is wrong for "Log set".
- **Mono survives, restricted.** Review's editable tables and the collapsed set summary keep
  `--mono` + `tabular-nums`, because columns of `24kg × 10 @ RIR 2` are genuinely easier to scan
  aligned. Everywhere else, heavy sans with `font-variant-numeric: tabular-nums`.
- **Three colours, not a palette.** Brand indigo, completion green, claret. Anything that wants a
  fourth hue is a hierarchy problem wearing a costume.

---

## 2. Typeface

The single highest-leverage change, and the one that most makes or breaks the resemblance.

IBM Plex Sans is a humanist grotesque with an engineering-drawing flavour — precisely wrong for
friendly-geometric. Recommend self-hosting **Plus Jakarta Sans** (OFL, variable, 200–800) as
`--sans`. It has the geometric roundness with enough personality not to read as Poppins, and the
heavy weights hold up at display sizes, which is the whole point (`800` for numerals). Figtree or
Outfit are acceptable substitutes; Poppins is not — its perfectly circular bowls fall apart in
running text.

Mechanically this is the same operation the repo already does: one `.woff2` in `public/fonts/`,
one `@font-face`, one `<link rel="preload">` in `public/index.html`. Keep
`ibm-plex-mono-latin.woff2` for the table figures; drop `ibm-plex-sans-var-latin.woff2` entirely
so the byte count does not grow.

**Check before committing**: confirm the chosen variable font ships `tnum`. If it does not,
numerals in the week strip and progress counters will shimmer as they change, and `--mono` has to
keep those too.

---

## 3. Tokens

Drop-in replacement for the `:root` block. Names change (`--paper` → `--surface`, `--accent` →
`--brand`) because the meanings changed; keep the old names as aliases for one or two stages of
the migration (§6) so the file stays green while screens move over.

```css
:root {
	/* Surfaces — a tinted ground so white cards lift off it. This is the
	   mechanism the whole look rests on; a white-on-white page has no cards. */
	--bg: #f4f5f8;
	--surface: #ffffff;
	--surface-2: #eef0f5;   /* inset: chips, tracks, code, quiet buttons */
	--surface-3: #e6e9f1;   /* pressed state of the above */
	--line: #e4e7ef;        /* hairline — now rare, used inside cards only */

	/* Ink */
	--ink: #12141a;
	--ink-2: #565d6e;       /* secondary text, meta lines */
	--ink-3: #676e7e;       /* eyebrows, disabled labels */

	/* Brand — used confidently: primary fills, selected chips, rings, today */
	--brand: #3d34d4;       /* fill */
	--brand-ink: #3d34d4;   /* brand-coloured text on --surface/--bg */
	--on-brand: #ffffff;    /* text/icons on a --brand fill */
	--brand-soft: #eceafc;  /* tinted card / selected-adjacent background */

	/* Completion */
	--done-fill: #17795e;   /* tick backgrounds, ring fill */
	--done-ink: #146a53;    /* "Done" text */
	--done-soft: #e3f4ee;

	/* Destructive / alert — the old claret, kept, demoted to this role only */
	--warn: #96262b;
	--warn-soft: #fbeced;

	/* Radius — the other half of the look. Cards are properly round. */
	--r-sm: 10px;   /* chips, inputs */
	--r-md: 16px;   /* inner blocks, sheets */
	--r-lg: 22px;   /* cards */
	--r-pill: 999px;

	/* Elevation. Dark mode replaces these with lightness + a hairline (below):
	   a shadow on a near-black ground is invisible, so cards would vanish. */
	--shadow-1: 0 1px 2px rgba(16, 18, 26, 0.06), 0 10px 24px -16px rgba(16, 18, 26, 0.28);
	--shadow-2: 0 2px 6px rgba(16, 18, 26, 0.07), 0 18px 40px -20px rgba(16, 18, 26, 0.35);
	--card-border: 0 0 0 0 transparent;

	/* Spacing — unchanged scale, plus one step up. Runna's generosity is
	   mostly this: 20px inside a card where the old system used 16. */
	--s1: 0.25rem;
	--s2: 0.5rem;
	--s3: 0.75rem;
	--s4: 1rem;
	--s5: 1.5rem;
	--s6: 2rem;
	--s7: 2.75rem;

	/* Type */
	--sans: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	--mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
	--t-display: 800 clamp(38px, 11vw, 52px) / 1.02 var(--sans);
	--t-h1: 800 28px / 1.15 var(--sans);
	--t-h2: 700 20px / 1.25 var(--sans);
	--t-body: 400 16px / 1.5 var(--sans);
	--t-label: 600 14px / 1.35 var(--sans);
	--t-eyebrow: 700 12px / 1.2 var(--sans);

	--nav-h: 60px;
	color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #0f1116;
		--surface: #171a21;
		--surface-2: #1f232c;
		--surface-3: #272c37;
		--line: #272c37;

		--ink: #f3f5f9;
		--ink-2: #99a1b3;
		--ink-3: #8b93a5;

		--brand: #5b51e8;
		--brand-ink: #a79eff;
		--on-brand: #ffffff;
		--brand-soft: #1e1f3d;

		--done-fill: #1f9b78;
		--done-ink: #5be0ae;
		--done-soft: #14312a;

		--warn: #d4666b;
		--warn-soft: #33191b;

		/* Elevation by lightness, not shadow. --surface is already lighter than
		   --bg; the hairline is what stops a card dissolving into it at the
		   edges on an OLED phone. */
		--shadow-1: none;
		--shadow-2: none;
		--card-border: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
	}
}
```

Cards therefore carry `box-shadow: var(--shadow-1), var(--card-border);` — one declaration that
does the right thing in both modes.

### Contrast

Computed WCAG 2.1 ratios for every pair the design actually uses. Recheck with a tool before
committing; these are calculated, not measured.

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--ink` on `--surface` | 18.4:1 | 16.1:1 | 4.5 |
| `--ink-2` on `--surface` | 6.6:1 | 6.7:1 | 4.5 |
| `--ink-3` on `--bg` | 4.7:1 | 5.6:1 | 4.5 |
| `--brand-ink` on `--surface` | 8.0:1 | 7.4:1 | 4.5 |
| `--on-brand` on `--brand` (primary button) | 8.0:1 | 5.6:1 | 4.5 |
| `--done-ink` on `--surface` | 6.5:1 | 11.6:1 | 4.5 |
| white tick on `--done-fill` | 5.3:1 | 4.0:1 | 3.0 (graphic) |
| `--on-brand` on `--warn` (destructive) | 7.7:1 | 5.0:1 | 4.5 |

Two constraints fall out and must be written into the stylesheet as comments:

- **`--ink-3` is for `--surface` and `--bg` only** — on `--surface-2` it lands at 4.3:1. Chip
  labels use `--ink`, not `--ink-3`.
- **Dark `--done-fill` is a graphic fill only.** A white tick on it passes the 3:1 graphics
  threshold; white *text* on it does not. "Done" as a word always uses `--done-ink`.

Focus rings become `3px solid var(--brand-ink)` at `2px` offset — except on a `--brand`-filled
control, where brand-on-brand is invisible: those get `outline: 3px solid var(--ink)`, which is
near-black in light and near-white in dark, so it reads either way.

---

## 4. Page by page

Each entry: **what leads** (the one thing the eye should hit first), **what recedes**, and the
**empty** and **loading** states. Skeletons everywhere rather than `Loading…` — the app is
offline-first and usually renders from `sessionCache` instantly, so the loading state's real job
is to stop the layout jumping, not to entertain. A skeleton is a grey block at the exact size of
the thing arriving; it never animates under `prefers-reduced-motion`.

### 4.1 Today — `screens/Today.tsx`

Today is currently `<h1>Training log</h1>` over a `SessionList`, which makes the most important
screen in the app indistinguishable from Plan and History. It should not share their layout at
all.

**Leads**: one hero card for today's session — type badge, label (`Lift A`), the headline metric
as display numerals (`6 exercises · 18 sets`, or `30 min · 5 km`), a 3-line preview of what is in
it, and a full-width brand button. The button's verb carries the state: *Start session* →
*Continue* (with `7/18` in it) → *Review*. Above the card, a **week strip**: seven day cells, done
days ringed green with a tick, today filled brand, planned days carrying a small type dot. This is
the single most Runna-ish element and the cheapest navigation win in the app — it answers "where
am I in the week" without opening Plan.

**Recedes**: the date header shrinks to an eyebrow. The sync indicator becomes a small chip
(`2 changes queued`) in the header rather than a paragraph — it must stay visible, since it is the
only signal that the queue in `sync.ts` is non-empty, but it is never the headline.

**Two sessions on one day** (real: a lift and a run, or a reschedule collision): the first is the
hero, the second is a compact card beneath. Do not shrink both — one of them is the next thing
you will actually do.

**Empty**: not a message in muted grey. A rest-day card of the same size and shape as the hero —
big `Rest day`, one line of context (`Nothing planned. Next: Easy run, tomorrow`) — with the week
strip still above it. The screen should look deliberate, not broken.

**Loading**: week strip renders immediately from local dates (it needs no network); one skeleton
hero card.

**Error**: keep the retry, but as a card — `Couldn't load today` + a soft-filled Retry button —
not a bare `<p>` and an outlined button.

### 4.2 Plan — `screens/Plan.tsx`, `components/SessionRow.tsx`

**Leads**: the current week, open, as a card with a progress ring in its header
(`Week 4 · 2 of 5 done`) and the week's focus if the generator supplied one. Later weeks are
collapsed cards — the existing `collapsible` behaviour, restyled: the summary line
(`5 sessions · 2 lifts, 3 runs`) already exists and is exactly right.

Rows inside a week become a fixed-width day column (`MON` over `24`) + type badge + label + meta,
with a trailing chevron. Completed rows swap the chevron for a green tick and drop to `--ink-2`;
they stay tappable. Today's row gets a brand left-edge or a filled day column — the `--today`
emphasis survives the accent change, just in the new colour.

**Recedes**: rescheduling. Today it is a permanent full-width `Move to a different day` button
under *every* row, which doubles the length of the screen for an action taken maybe once a week.
It moves inside the row as a small soft-filled button revealed on tap (or a `⋯` in the row), with
the seven day chips unchanged underneath — same markup, same 48px targets, far less noise.

**Empty**: a card, not a sentence — `No plan yet` and a brand `Generate a plan` button linking to
`#/generate`. This is the cold-start screen for a new install and currently says "Nothing planned."

**Loading**: three skeleton week cards, the first taller.

### 4.3 Lift session — `screens/LiftSession.tsx`, `ExerciseCard`, `SetRow`

The screen where the redesign is most at risk, because it is the one with a hard usability
contract (§5). The visual change here is almost entirely *chrome*: the interaction stays as built.

**Leads**: the set you are about to log. Sticky header carries back, `Lift A`, and a progress bar
with `4/18` in heavy numerals — small, but always on screen, which the current muted mono line at
the top is not once you scroll. Inside the expanded exercise card, the working set is the only
thing at full volume: the weight stepper as a big pill (`−  22 kg  +`), the rep chips, the RIR
chips, and a full-width brand **Log set**.

**Recedes**: logged sets collapse to a single tick + mono summary line (`24kg × 10 @ RIR 2`) —
this already happens, and it is the best thing about the current screen; it just gains a green
tick and loses the hairline. Swap/Skip become small soft-filled buttons in the card body, not
full-width outlined ones competing with Log set.

**Superset cards** keep the unbroken left rule that `.exercise-card--superset` draws today, in
`--brand` rather than `--ink`, plus a `Superset` pill. Rounds stay as they are.

**Rest timer**: today a sticky bar at the top. Move it to a floating pill above the tab bar —
countdown numerals with a thin ring draining around them, and Skip. Over time, it turns
`--warn`. It is closer to the thumb there and it stops competing with the header.

**Empty**: there is no empty lift session. The real fallback is `SessionScreenFallback` (no cache,
no network): back button, a card explaining it, Retry.

**Loading**: skeleton header + six collapsed exercise rows.

### 4.4 Run session — `screens/RunSession.tsx`, `RunStructure`

**Leads**: the target, huge. `30 MIN` / `5 KM` as display numerals side by side, run type as an
eyebrow above. For intervals, the structure list stops being an `<ol>` of grey text and becomes a
stack of step rows, each with a short effort bar whose length is the duration and whose fill is a
lightness step of `--brand` (warmup/recovery pale, work solid) — no new hues. `5 × 3 min` reads
as a repeat group, indented under one bracket.

**Recedes**: the three stacked buttons. Only *Mark complete* is brand-filled; *Log what you ran*
becomes soft-filled; *Mark skipped* becomes a quiet text button. Three equal-weight full-width
buttons is the clearest place the current system's flatness costs the user a decision.

**Empty / loading**: `SessionScreenFallback`, as above.

### 4.5 Review — `screens/Review.tsx`, `FeedbackCard`

The one screen where the editorial system is genuinely better, because it is a data-entry table.
Change the least here.

**Leads**: a summary strip at the top of what actually happened — for a lift, sets logged and
total tonnage; for a run, distance, time, and the computed pace from `formatPace` as the display
numeral. Pace is derived, it is the thing you want to see, and today it is a table row.

**Recedes**: nothing much. Exercise tables keep `--mono`, keep `tabular-nums`, keep the input
grid; they gain a card around each exercise and a green tick on the ones that are complete.
Skipped exercises keep the strikethrough. The "From your watch" disclosure stays collapsed.

`FeedbackCard` becomes a visually distinct tinted card (`--surface-2`, no shadow) so it reads as a
different question from the logging above it — which is what the existing `border-top` was
reaching for. The pain/energy chips become the same pill chips as everywhere else; the
"next week's plan will avoid…" note becomes a soft `--warn` inline note rather than accent text.

**Empty**: a session with nothing logged is a real and common state (opened from History). Show
`Nothing logged for this one` in the summary strip, but keep every table editable — the entire
point of Review is retro-filling.

**Loading**: skeleton summary strip + two skeleton tables.

### 4.6 Generate — `screens/Generate.tsx`, `GenerateFlow`, `GoalsEditor`, `ProposalReview`

Three `.row` blocks stacked with `Step 1 · Your data` eyebrows. It is a wizard; it should look
like one.

**Leads**: whichever step you are on. Numbered circles in a card header (`1` filled brand while
active, green tick once done), one card per step, and the primary action of each step as the only
brand button on screen. `GoalsEditor` sits above as its own card — pill chips that fill brand when
selected, exactly as they behave now, plus the sessions-per-week row.

**Recedes**: the prompt preview (already behind a disclosure — keep it), the paste-instead
fallback (already behind a disclosure — keep it), and the `aria-live` status line, which becomes a
small chip under the active step rather than a floating eyebrow above everything.

**Rejected import** is the state worth designing for, because it is common: a `--warn-soft` card
with the count as its heading (`3 problems — plan rejected`), the `.error-list` inside it in mono,
and *Copy these problems* as a soft button. Keep `--warn` as the left rule; keep the messages in
`--ink`, since they need to be read and pasted.

**Pending proposal** (`ProposalReview`): week cards matching Plan's, sessions as rows, the
speculative flag as an outline pill on weeks 2+ rather than accent text. Accept is brand-filled;
Reject is a quiet text button, deliberately unequal — rejecting is cheap and recoverable, and
symmetric buttons imply a symmetric decision.

**Empty**: the three-step flow *is* the empty state, which is why it works. Say so with the
heading rather than treating it as a fallback.

**Loading**: skeleton goals card + three collapsed step cards.

### 4.7 History — `screens/History.tsx`

**Leads**: a summary strip that does not exist today — last four weeks: sessions completed, km
run, sets logged. Three numbers, display weight, in one card. History is the screen where you want
a sense of accumulation, and the data for this is already on the rows.

Below that, rows grouped by week (the existing grouping), deliberately **denser** than Plan: one
line each, day column, type badge, label, and the actual result as a small mono badge
(`9.4 km · 6:11 /km`, `18 sets`). `SessionRow` already prefers logged actuals over targets — that
logic stays and is the reason this reads well.

**Recedes**: everything else. No rescheduling, no progress rings per week; a small `4/5` next to
each week heading is enough.

**Empty**: `Nothing logged yet` centred in a card with a line pointing at Today.

**Loading**: skeleton summary strip + eight skeleton rows.

---

## 5. What stays — the non-negotiables

A redesign that breaks these is a worse app however good it looks. Each of these is a line the
current stylesheet already holds; the new one has to hold it too.

**Two taps to log a set.** Weight is prefilled from `resolveSetDefaults`; reps and RIR are chips.
The floor is: tap a rep chip, tap *Log set*. Nothing in the redesign may add a step, a confirm, an
animation you have to wait out, or a scroll between the chips and the button. Concretely, in a
390×844 viewport the working set's chips and its Log set button must fit on screen together —
this is the constraint that caps how much padding a card can have.

**The four chip states must stay distinguishable, and not by colour alone.** `SetRow` composes
`--target` and selected, giving plain / target / selected / target+selected. Today that is
`inset 0 -3px 0 var(--ink)` plus weight 700, times a claret fill. In the new system: target = a
3px `--brand-ink` underline *and* weight 800; selected = `--brand` fill with `--on-brand` text.
Both together = filled with a lighter underline. The weight difference is what carries it for a
colour-blind reader, and the stylesheet comment saying "don't collapse this with `!important`"
should be carried over verbatim.

**≥44px, and 48px for anything logged mid-set.** Cards with big radii tempt you into small inset
controls. Chips stay `min-height: 48px; min-width: 48px`; the stepper buttons stay 52px; primary
buttons go to 52px (up from 48). Rounder is fine; smaller is not.

**Offline-first, and nothing that needs the network to render.** No CDN fonts, no icon font, no
remote images. Icons are inline SVG in the JSX. Shadows, gradients and `conic-gradient` rings all
cost zero bytes over the wire. The service worker caches `styles.css` — the swap must not
introduce a second stylesheet or a runtime theme fetch.

**Component structure unchanged.** `Shell`, `SessionList`/`SessionRow`, `ExerciseCard`, `SetRow`,
`TapGroup`, `Stepper`, `RestTimer`, `SwapSheet`, `GenerateFlow`, `GoalsEditor`, `FeedbackCard`,
`ProposalReview`, `SessionScreenFallback` all survive. This is a CSS-first redesign; JSX changes
are additive class names plus three genuinely new pieces — the week strip, the progress ring, and
the icon set. If a stage needs a component rewrite, the stage is wrong.

**Compatibility aliases survive the migration.** `.today-card`, `.set-row`, `.tap-btn` exist
because the markup still uses those names. Do not remove them in the same commit that restyles
them — that turns a visual regression into a broken screen.

**Tests pin some of this.** `test/client/GenerateFlow.test.tsx` matches the label
`Download your training data` and expects download errors in `.eyebrow--accent`;
`SessionList.test` exists. Keep those class names and strings, or change them deliberately with
the tests in the same commit.

**`prefers-reduced-motion`** already kills all transitions. The redesign adds more motion
(skeleton shimmer, ring fills, chip presses); every one of them goes through the existing
`@media (prefers-reduced-motion: reduce)` block.

---

## 6. Staging

Every stage is one commit, independently shippable, independently revertible. The fact that this
is a single hand-written CSS file with no build step is the biggest advantage available here: a
bad stage is `git revert` of one commit, and the app is back, because there is no compiled
artifact and no component library encoding the old look.

Do them in this order — it is roughly steepest-perceived-change-first, so the thing can be
abandoned after stage 3 and still be worth having.

| # | Stage | Touches | Effort |
|---|---|---|---|
| 0 | **Tokens.** Replace the `:root` and dark blocks with §3. Keep `--paper`/`--accent` as aliases pointing at the new values. Rewrite the file header comment and the contrast table in the same commit. | `styles.css` only | 1–2 h |
| 1 | **Typeface.** Add the woff2, `@font-face`, swap `--sans`, preload in `index.html`, drop the Plex Sans file. Re-check line heights — a geometric sans at 16/1.5 sets differently from Plex at 17/1.7. | `styles.css`, `index.html`, `public/fonts/` | 1 h |
| 2 | **Cards.** `.row`/`.plan-row`/`.exercise-card`/`.sheet` gain `--surface`, `--r-lg`, padding and `--shadow-1`; hairline separators become gaps. Screens get `.screen { background: var(--bg) }`. | `styles.css` only | 2–3 h |
| 3 | **Buttons and chips.** `.btn-primary` → brand fill; `.btn-secondary` → soft fill; new `.btn-quiet`; `.tap`/`.tap-btn` restyle with the four states from §5. Focus rings. | `styles.css`, minor JSX for `.btn-quiet` | 2–3 h |
| 4 | **Icons.** 8 inline SVGs, one family, as a tiny `components/Icon.tsx`. Lift, run, tick, chevron, back, plus, minus, warning. | new component + call sites | 2 h |
| 5 | **Today.** Week strip component + hero card + rest-day empty state. The first substantial JSX. | `Today.tsx`, new `WeekStrip.tsx` | 3–4 h |
| 6 | **Progress.** Ring (`conic-gradient`) and bar primitives; Plan week headers, lift session header, History summary strip. | `styles.css`, `SessionList`, `LiftSession`, `History` | 3 h |
| 7 | **Generate + Review chrome.** Numbered step cards; rejected-import card; Review summary strip; `FeedbackCard` as a tinted card. | those components | 3 h |
| 8 | **Skeletons.** One `.skeleton` primitive, applied at each of the seven loading states, replacing `Loading…`. | `styles.css` + 7 call sites | 2 h |
| 9 | **Prune.** Delete the aliases, delete dead selectors, and fix the comments the migration invalidated — including the note on `.shell` that says the tab bar is "not yet wired into app.tsx", which has been false since `Shell` shipped. | `styles.css` | 1 h |

Two rules for the run:

- **Do not build a theme switch.** One file, one look; the old design lives in git. A
  `[data-theme]` fork doubles the surface for one user who will never switch back.
- **Stage 0 and stage 9 are the same commit's bookends.** Between them the stylesheet contains
  two vocabularies and comments that contradict each other. Stage 9 is not optional polish; skip
  it and the file becomes actively misleading, which is the one thing it currently is not.

---

## 7. How close can this actually get?

Honestly: **80–85% of the *feel*, most of the way through stage 6, in about two weekends.** The
gap is not where you would guess.

**What is genuinely easy** — and gets you to ~70% by itself: surfaces, radii, elevation, colour,
typeface, filled buttons, pill chips, cards, the week strip, progress bars and rings. All of it is
plain CSS in one file, all of it is already token-driven, and the component structure already maps
onto it. The mocks in `docs/mocks/` are hand-written CSS with no framework and no build step, and
they are the proof: nothing in them needed anything the real app cannot do.

**What is hard, in order:**

1. **Icons.** Runna's coherence owes a lot to one custom icon family. Hand-drawn SVGs of varying
   stroke weight are the single fastest way to look amateur. Mitigation: take 8 icons from one
   ISC/MIT set (Lucide), paste the paths, never mix in a ninth from elsewhere, and use them at
   exactly two sizes.
2. **Motion.** A lot of the "app-like" quality is spring transitions, a sheet that settles, a tick
   that draws itself. CSS transitions and a couple of keyframes get maybe 60% of that; the rest
   needs a spring library, and it is not worth a dependency here.
3. **The last 10% is states you do not notice until you build them**: pressed, disabled-but-
   explained, focus on a filled button, a 34-character exercise name in a 2-column row, twelve
   collapsed weeks, a 45-item error list. The current stylesheet is careful about exactly these,
   and every one of them has to be re-earned in the new vocabulary. Budget more time for this
   than for the visible work.
4. **Empty and error states.** Runna has illustration; you have typography. Skip illustration
   entirely rather than commissioning bad art — a large-type rest-day card looks intentional; a
   mediocre SVG runner does not.

**What will not match, ever, and should not be chased**: native page transitions, haptics, and
charts. This is a PWA with hash routing in Safari; navigation will always be a repaint, the tab
bar will always sit above Safari's own chrome, and there is no progress-graph work in scope. Runna
also has a design team and a native codebase; a solo developer matching it pixel-for-pixel is not
the goal and failing to is not a failure.

**The real risk is not aesthetic.** `styles.css` is ~1100 lines of unusually good commentary
explaining *why* — the no-fill rationale on `.set-row--collapsed`, the claret budget in the
header, the contrast note on `.tap[aria-pressed]`, the four-state warning on `.tap--target`. The
redesign invalidates several of those arguments outright. If the comments are not rewritten as the
code changes, the most valuable thing in this repo's frontend quietly becomes wrong, and the next
person (or the next model) will follow rules that no longer describe the file. Treat comment
maintenance as part of each stage's definition of done, not as cleanup at the end.
