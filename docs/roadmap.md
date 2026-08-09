# Generator rework — progress ledger

Started 2026-08-09. This file is the single source of truth for what's done and what's next, and it
is updated **in the same commit** as the stage it describes — so this file and `git log` never
disagree. Read this first when picking the work back up.

Design rationale lives in [generator-design.md](generator-design.md).

## Working rules

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
- [ ] **2 · Constraint review.** Reject a duplicate `exercise_id` within a session; require dates
      unique and ascending within a week and strictly increasing between weeks; reject collision
      with sessions already in the database; validate `structure_json` step shape and harden
      `RunStructure` against malformed steps; relax the session count to allow a deload
      (week 1 exact, later weeks `daysPerWeek` or one fewer); optional `week.focus` string.
      *Acceptance: each new rule has its own failing-first test; existing message wording unchanged.*
- [ ] **3 · Structured goals** (migration 0006). `settings.goal_tags` JSON array; validated slug
      vocabulary in `src/types.ts`; `GoalsEditor` becomes always-visible with objective, emphasis
      and constraint tick boxes plus free text; export carries `goalTags`.
- [ ] **4 · Run data** (migration 0007). `logged_runs` gains `max_hr`, `avg_cadence_spm`,
      `elevation_gain_m`, `aerobic_training_effect`, all nullable. Validate them — and `avg_hr`,
      which is currently bound unchecked. Optionals behind a "From your watch" disclosure; add the
      missing `note` control; computed pace via a new `formatPace`; show actuals on list and
      history rows instead of only the plan; a "Log the run" route from `RunSession` to Review.
- [ ] **5 · Run progression uses the new data.** `progressRun` weighs RPE/HR and whether the last
      long run was cut short. New reason strings only; existing ones untouched.
- [ ] **6 · Overwrite a pending plan.** `importProposal(…, replace)`; the "already pending" 422
      offers a Replace button that supersedes in one `db.batch`.
- [ ] **7 · Import by file upload.** File picker primary, textarea fallback, both through a new
      pure `src/client/parseProposal.ts`; `POST /import` 422 gains `errors: string[]` and the client
      throws an `ImportRejected` carrying it.
- [ ] **8 · The new prompt.** Moved to `src/client/prompt.ts`, rewritten against `validateProposal`
      as it stands after stages 2–5. Covers the three data states, both caps and their baselines,
      `increment_kg` / `per_hand`, deloads, and resolves the prose-vs-JSON contradiction.
- [ ] **9 · Generate page redesign.** Kill the duplicate heading; two export routes (file, or
      prompt + data as one paste); data-state note; prompt behind a styled disclosure; errors as a
      copyable list; one `aria-live` region. New CSS: `.disclosure*`, `.error-list`, `.btn-small`,
      capped `.prompt-preview`.
- [ ] **10 · Collapsible weeks on Plan.** Opt-in `collapsible` prop on `SessionList`; current week
      open, rest closed, independent toggles, count in the collapsed header. First test for
      `SessionList`.
- [ ] **11 · Swaps and adding an exercise.** Make `scope: 'permanent'` actually repoint future
      planned sessions; loading and error states in the sheet; a back affordance; new
      `POST /api/exercises` with a minimal form, reachable from the sheet's empty state. Optional
      per-lap `splits_json` last, and droppable.

## Notes for whoever picks this up

- `test/client/GenerateFlow.test.tsx` pins the label `Download your training data`, finds the weeks
  field via `input[type="number"]` with a synthetic bubbling `input` event, and expects download
  errors in `.eyebrow--accent`. Keep all four, or change them deliberately.
- Do not swap the weeks field for `Stepper` — it commits on blur, so that synthetic event would
  never reach the handler.
- `test/generator*.test.ts` and `test/progression.test.ts` match on exact validation messages and
  `reason` strings. Add new strings rather than reword existing ones.
