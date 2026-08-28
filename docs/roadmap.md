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

## Merge checklist

Migrations added by this campaign have been applied to the **local** database only. Deliberately —
the README records an outage caused by code shipping ahead of the remote schema, and nothing here
has been deployed. Before deploying any of these branches:

```
npm run db:migrate:remote
```

Migrations added so far: `0006_structured_goals.sql`, `0007_run_metrics.sql`, `0008_manual_runs.sql`.

## Notes for whoever picks this up

- `test/client/GenerateFlow.test.tsx` pins the label `Download your training data`, finds the weeks
  field via `input[type="number"]` with a synthetic bubbling `input` event, and expects download
  errors in `.eyebrow--accent`. Keep all four, or change them deliberately.
- Do not swap the weeks field for `Stepper` — it commits on blur, so that synthetic event would
  never reach the handler.
- `test/generator*.test.ts` and `test/progression.test.ts` match on exact validation messages and
  `reason` strings. Add new strings rather than reword existing ones.
