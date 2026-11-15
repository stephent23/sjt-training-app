# Generator rework — progress ledger

Started 2026-08-09. This file is the single source of truth for what's done and what's next, and it
is updated **in the same commit** as the stage it describes — so this file and `git log` never
disagree. Read this first when picking the work back up.

Design rationale lives in [generator-design.md](generator-design.md).

## Branches

One branch per key feature, each pushed to `origin` for review. They are stacked in the order
below — each is branched off the one before it, so **merge them into `main` in this order** and
every merge is a fast-forward with no conflicts. Merging only the first few is also safe; the later
branches simply carry the earlier commits with them.

1. `feat/generator-foundations` — stages 0–2 (docs, date anchor, constraint review)
2. `feat/structured-goals` — stage 3
3. `feat/run-data` — stages 4–5
4. `feat/generate-page` — stages 6–9
5. `feat/plan-collapsible-weeks` — stage 10
6. `feat/swaps-and-exercises` — stage 11
7. `refactor/simplify` — stage 12

## Working rules

- **Keep it simple.** Prefer deleting to adding, and the smallest change that actually solves the
  problem. No abstraction until the third repetition. Stage 12 is a dedicated pass to remove
  anything this campaign let creep in.

- **TDD.** Failing test first, then the code. Server logic runs under the `worker` vitest project,
  client under `client`.
- **One commit per stage**, each self-contained and green: `npm test`, `npm run typecheck`,
  `npm run build:client`.
- **All dev commands run through WSL**:
  `wsl -- bash -lc "cd /mnt/c/Users/Steve/Documents/projects/training-app && <cmd>"`.
  **Git runs through PowerShell.** Never install anything globally — project-local devDependencies
  only.
- **Migrations apply to both local and remote** (`db:migrate:local`, `db:migrate:remote`). The
  README records a production outage caused by forgetting the remote apply.
- Commits are authored by Stephen Tate only. No AI co-author trailer.

## Stages

- [x] **0 · Ledger and design doc.** This file plus `generator-design.md`, capturing the decisions
      the code comments cite. *Done: the `plan doc §N` comments now resolve to something in-repo.*
- [x] **1 · Date anchor.** `weekStartOnOrAfter` in `src/dates.ts`; `/export` returns `today` and
      `weekStartDate` via a new `ExportPayload`. `buildExportContext` stays clock-free.
      *Done: a cold-start export now carries a Monday to build from, and the generator tests still
      assert exact dates because the clock lives in the route.*
- [x] **2 · Constraint review.** Reject a duplicate `exercise_id` within a session; require dates
      unique and ascending within a week and strictly increasing between weeks; reject collision
      with sessions already in the database; validate `structure_json` step shape; relax the session
      count to allow a deload (week 1 exact, later weeks `daysPerWeek` or one fewer); optional
      `week.focus` string. *Done: 15 new tests. Two existing fixtures built every week from week 1's
      template without shifting the date — unrealistic, and the new overlap rule caught them.
      `RunStructure` hardening moved to stage 4, where the run work lives.*
- [x] **3 · Structured goals** (migration 0006). `settings.goal_tags` JSON array; validated slug
      vocabulary in `src/types.ts`; `GoalsEditor` becomes always-visible with objective, emphasis
      and constraint tick boxes plus free text; export carries `goalTags`. *Done. Migration applied
      locally only — **run `npm run db:migrate:remote` before deploying** (see merge checklist).*
- [x] **4 · Run data** (migration 0007). `logged_runs` gains `max_hr`, `avg_cadence_spm`,
      `elevation_gain_m`, `aerobic_training_effect`, all nullable. Validate them — and `avg_hr`,
      which was bound unchecked. Optionals behind a "From your watch" disclosure; the missing
      `note` control; computed pace via `formatPace`; actuals on list and history rows instead of
      only the plan; a "Log what you ran" route from `RunSession` to Review. *Done. `.disclosure`
      CSS landed here since Review needed it first; stage 9 reuses it. `RunStructure` now also
      filters malformed individual steps, which is what stage 2 deferred.*
- [x] **5 · Run progression uses the new data.** `progressRun` weighs RPE, the heart-rate share of
      the run's own max, and whether the long run was cut short. *Done: growth previously followed
      from a logged run merely existing, so a run cut half short earned the same 10% as a
      comfortable one. New reason strings only; the existing four are untouched.*
- [x] **6 · Overwrite a pending plan.** `importProposal(…, replace)`; the "already pending" 422
      offers a Replace button that supersedes in one `db.batch`. *Done: correcting a rejected plan
      always arrives while the first is still pending, so refusing outright was too strict — but
      it stays explicit, so a double-import can't discard the plan you were reading.*
- [x] **7 · Import by file upload.** File picker primary, textarea fallback, both through the new
      pure `src/client/parseProposal.ts`; `POST /import` 422 gains `errors: string[]` and the client
      throws an `ImportRejected` carrying it. *Done: 11 parser tests covering fenced blocks, prose
      either side, a brace inside a string value, and a decoy snippet before the real plan.*
- [x] **8 · The new prompt.** Moved to `src/client/prompt.ts`, rewritten against `validateProposal`
      as it stands after stages 2–6. *Done: correct field names, all eleven hard rules stated,
      three data-state branches, deload instructions, and prose-then-one-fenced-block output that
      the stage 7 parser reads.*
- [x] **9 · Generate page redesign.** *Done: duplicate heading gone; download or copy-as-one-paste;
      data-state note; prompt behind a styled disclosure; upload-or-paste answer; problems as a
      copyable list; one `aria-live` region. `.error-list` and `.btn-small` added, `.prompt-preview`
      capped at 45vh. The import path now has tests — it had none.*
- [x] **10 · Collapsible weeks on Plan.** Opt-in `collapsible` prop on `SessionList`; current week
      open, rest closed, independent toggles, count in the collapsed header. *Done: Plan fetches
      from today onwards, so the first group is the current week by construction — no calendar
      arithmetic needed. Toggles are independent, not an accordion, since comparing this week with
      next is reasonable. First test for `SessionList`, which had none.*
- [x] **11 · Swaps and adding an exercise.** *Done: `scope: 'permanent'` now repoints every future
      **planned** session (the past keeps what was actually done, and sessions already holding the
      substitute are skipped so the bulk update can't create the duplicate the clash guard
      prevents). The sheet distinguishes "still loading" from "nothing found", surfaces the 409 it
      used to swallow, and can go back to the reason picker. New `POST /api/exercises` +
      `GET /api/exercises/patterns` — the first write path to that table — reachable from the
      sheet. Pattern must be an existing one: a novel pattern would orphan the exercise from swaps
      in both directions.* Per-lap `splits_json` dropped: most typing, least signal.
- [x] **12 · Simplification pass.** Four review agents over the full diff (reuse, simplification,
      efficiency, altitude). *Applied: one `parseGoalTags`, `MODALITIES`/`LOADINGS` and
      `RUN_METRIC_FIELDS` shared from `src/types.ts` instead of hand-typed twice each;
      `fetchExportText` uses the same `errorFrom` as its new siblings; `withExport` lets the action
      supply its own closing line (the generic one was overwriting the KB message); `SessionList`
      stores the open weeks directly instead of an XOR against a default; `parseProposal` defers
      the brace scan so a bare-JSON paste never pays for it; the swap route's writes go in one
      `db.batch`. Files touched were run through the repo's own Prettier config, which is some of
      the diff.*
      **Skipped deliberately:** parallelising the import/collision queries and the two exercise
      lookups (a weekly and an occasional action — sequential reads clearer than the saved
      round trip); splitting `LogRunInput` back out from `LoggedRunEntry` (duplicating the field
      list today to preserve a seam nothing needs yet); extracting a `CollapsibleWeekList` (a
      boolean prop is the smaller thing); moving the add-exercise form out of the swap sheet
      (there is no exercise-management screen for it to move to).
      **Worth knowing:** the altitude review noted `weekStartDate` is only a hint to the assistant
      — `validateProposal` still accepts any real calendar date, so a backdated plan can still be
      imported. Left as-is because importing a plan that starts later is legitimate, but it means
      the cold-start guard is advisory, not enforced.
- [x] **13 · Manual runs, a truthful export anchor, and re-planning over scheduled weeks**
      (migration 0008). Three fixes landing together because the second two only became visible
      while building the first. *Done:*
      - **Manual runs.** `POST/PUT/DELETE /api/runs` records a run that was never planned, or
        corrects/removes one that was — a real `sessions` row (`origin: 'manual'`), never routed
        through the generator. `RunEditor` (add via `#/run/new`, correct via `#/run/:id/edit`,
        reachable from Today, History, and a new "Edit run details" link on Review) shares its
        field logic (`src/client/runFields.ts`) and markup (`RunMetricsFields`) with `ReviewRun`,
        which is now a thin wrapper over both rather than a second copy of a ten-field form.
      - **The export anchor was wrong.** `buildExportContext` picked its two-week history window
        by `MAX(week_number)` — the newest *scheduled* week. Once multi-week accept could insert
        several unlogged future weeks in one go, that stopped being the newest *logged* week, so
        the export silently read two empty weeks: `historyWindow` came back blank, `painFlags`
        was always false (disabling the shoulder/back-safety checks on both export and import),
        and `reasons` filled up with "no sets logged" holds after a week that was fully logged.
        No test caught it — every fixture in the suite seeded exactly one past-dated week, where
        the two numbers coincide. Fixed by splitting "newest scheduled" (still used to number the
        new proposal, so it can't collide with weeks already on the calendar) from "newest
        logged" (used for the window and progression), and by replacing the flat `+7` date shift
        with the smallest multiple of 7 days that actually clears today — mid-week generation
        used to propose dates in the week already half gone.
      - **A re-plan can now land over already-scheduled weeks.** Import used to refuse outright if
        any proposed date already had a session. Now it replaces every *untouched* session in the
        proposal's date span and refuses only where something was actually trained — completed,
        skipped, or logged against even while still `'planned'` — naming the offending dates.
        Accept re-checks the same span rather than trusting import, since a session can be logged
        in the human-sized gap between reviewing a plan and accepting it.

      A manual run is deliberately invisible to the copy-forward pass that builds next week's
      template (an unplanned session would break `validateSessionCount`'s exact-count rule and
      then propagate into every future week), but its logged data still reaches `historyWindow` —
      the assistant reviewing the plan sees it, even though it isn't a template for anything.

      Built as three parallel implementation passes behind one shared migration and `types.ts`
      contract, each landing tests first: server routes, the client screen, and
      `src/generator.ts`/`src/routes/generator.ts` (kept to a single owner throughout, since all
      three fixes touch that file). 434 tests, `npm run typecheck` and `npm run build:client` all
      clean.
- [x] **14 · Plan blocks, a 12-week summary, the New plan flow and run entry** (migration 0010).
      *Done (2026-11-15, uncommitted at time of writing):*
      - **Plan blocks.** `plan_blocks` + `sessions.block_id`; existing sessions backfilled into
        "Block 1". Each accepted plan is a block, weeks numbered 1..N, shown as "Block 2 · Week 1 of
        8". `/export?startDate=` (a Monday, today or later; 400 otherwise) is where week 1 lands.
        The export anchor is now **date-based** (newest logged non-manual week) — `week_number`
        restarts per block, so `MAX(week_number)` no longer means anything across blocks.
      - **`src/trainingSummary.ts`.** Twelve weeks plus the current one, per-week adherence, best
        e1RM (Epley) and top weight per exercise, hard sets (RIR ≤ 3) per pattern, run km / long
        run / avg RPE and HR, worst pain; plus trends. Rides on `ExportPayload.trainingSummary`,
        built in the route; the prompt says it informs judgement only — hard rules are still
        checked against `deterministicProposal`.
      - **Generate tab** is a five-step flow (Goals → Start & length → Ask Claude → Paste → Review),
        resumable via localStorage so a trip to the Claude app doesn't lose your place; Web Share
        of file + prompt where supported, copy-as-one-paste otherwise; paste-from-clipboard;
        "Copy errors for Claude"; week cards with "Changed" highlights and a sticky Accept/Reject
        bar stating what gets replaced. `/pending` gained `deterministic`, `replaces`, `start_date`.
      - **Run entry**: run-type and Today/Yesterday/Pick chips, one `mm:ss`/`h:mm:ss` field with
        auto-colons (iOS numeric keypad has no colon), duration-or-pace with the other derived,
        1–10 RPE scale, "Ran as planned", per-field errors, sticky Save bar.
      - **Live generation was built and then deliberately removed** at the owner's request: plan
        generation must run on the Claude Pro subscription, never API credits, and the GitHub
        Actions + `claude setup-token` route that achieves that is shelved for now. If it returns,
        remember the repo is public, so Actions logs are too.

      Fixed during integration: the Ask step awaited a prefetch that a fast tap could beat,
      saving a file containing `null` — the export is now started on demand and a failed request
      is dropped so the next tap retries.
      529 tests, `npm run typecheck`, `npm run build:client` clean.

      **Running tests:** jsdom loads ~2,000 modules, and from WSL over `/mnt/c` that has been slow
      enough to blow vitest's 60s worker-start timeout ("Timeout waiting for worker to respond"),
      even with nothing else running. Not a code problem — run the suite from a copy on WSL's
      native filesystem (`rsync` the tree, excluding `node_modules`/`.git`/`.wrangler`, to `/tmp`,
      then `npm ci` there), or exclude the project folder from Windows Defender.
- [x] **15 · Races, a one-screen New plan, and an export a model can coach from** (migration 0011).
      *Done (2026-11-15). The owner is training for spring half marathons (PB attempt) with
      strength kept as a real element; this stage gives the assistant the data to judge targets.*
      - **Races** (`races` table, `/api/races`, `#/goals`). One table for goals and results: a
        future row has a target, a past one a result; the PB per distance is derived. "Main race"
        / "Tune-up" in the UI, `A`/`B` stored. A past race with no result opens with an EMPTY
        time — it used to pre-fill the target, one tap from saving a fake result into PBs.
      - **Export** gained `races` (with `block_week`: which week of this block, or null),
        `raceResults`, `personalBests`, `athlete` (max/resting HR), and
        `trainingSummary.run_fitness` (pace/HR by run type, easy-pace trend, best whole-run
        efforts ≥5/10/15/21 km, Riegel 10K/half estimates from them and from race results in the
        last year). The app does the arithmetic; the model does the judgement.
      - **Validator.** Weight and long-run caps now compare against the HIGHEST value in any
        earlier week, not the previous week — the old rule rejected the return from a deload.
        Race-day long runs are exempt and never a baseline. Weeks after the first may drop two
        sessions (taper, race week). Optional top-level `summary` (≤1500 chars) is stored and
        shown on Review as the coach's note.
      - **Prompt** rewritten around all of that: periodise to the next main race, taper, races
        after the block, honest target assessment, where pace/HR targets go, hold leg loads as
        km rises.
      - **New plan** is one screen: goals card → start → length (with "Ends … · race is N weeks
        later") → ① Copy/Share for Claude → ② Paste Claude's answer; everything else under "More
        options". The wizard is gone. Review compares week 1 only against the mechanical pass.
      - **Everyday screens**: sticky Mark complete bar, confirmed skip, race countdown on Today,
        drafts survive collapsing an exercise card, tab renamed "New plan". RIR now carries over
        from the set just logged (sets 2+ are one tap) — a deliberate trade recorded in
        `src/setDefaults.ts`; remove `defaultRir` if progression looks too generous.

      Built by five parallel agents behind a coordinator-written migration/types/client-API
      contract, then an Opus review whose findings (the deload rejection and the fake-result bug
      among them) were all applied. 596 tests, typecheck and build clean.

## Merge checklist

Migrations added by this campaign have been applied to the **local** database only. Deliberately —
the README records an outage caused by code shipping ahead of the remote schema, and nothing here
has been deployed. Before deploying any of these branches:

```
npm run db:migrate:remote
```

Migrations added so far: `0006_structured_goals.sql`, `0007_run_metrics.sql`, `0008_manual_runs.sql`,
`0010_plan_blocks.sql`, `0011_races_and_profile.sql`.

## Notes for whoever picks this up

- `test/client/GenerateFlow.test.tsx` pins the label `Download your training data` and expects
  download errors in `.eyebrow--accent`. It mounts `PlanRequest`, which prefetches the export,
  so assert on the import call by URL, never by call index.
- Run tests with a copy on WSL's native filesystem (see stage 14) — never from `/mnt/c`.
- The weeks control (`PlanSetup`) is −/+ buttons named by `aria-label`, not `Stepper` — Stepper
  commits on blur.
- `test/generator*.test.ts` and `test/progression.test.ts` match on exact validation messages and
  `reason` strings. Add new strings rather than reword existing ones.
