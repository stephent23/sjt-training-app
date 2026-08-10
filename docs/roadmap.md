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
- [ ] **11 · Swaps and adding an exercise.** Make `scope: 'permanent'` actually repoint future
      planned sessions; loading and error states in the sheet; a back affordance; new
      `POST /api/exercises` with a minimal form, reachable from the sheet's empty state. Optional
      per-lap `splits_json` last, and droppable.
- [ ] **12 · Simplification pass.** A dedicated refactor over everything this campaign touched:
      delete dead code and unused CSS (`.plan-row--today` is defined and never applied), collapse
      duplication the stages introduced, shorten anything that grew a wrapper it didn't need, and
      re-read every new comment for whether it still earns its place. No behaviour change — the
      suite must stay green throughout. Run the `simplify` skill over the full diff against `main`.

## Merge checklist

Migrations added by this campaign have been applied to the **local** database only. Deliberately —
the README records an outage caused by code shipping ahead of the remote schema, and nothing here
has been deployed. Before deploying any of these branches:

```
npm run db:migrate:remote
```

Migrations added so far: `0006_structured_goals.sql`, `0007_run_metrics.sql`.

## Notes for whoever picks this up

- `test/client/GenerateFlow.test.tsx` pins the label `Download your training data`, finds the weeks
  field via `input[type="number"]` with a synthetic bubbling `input` event, and expects download
  errors in `.eyebrow--accent`. Keep all four, or change them deliberately.
- Do not swap the weeks field for `Stepper` — it commits on blur, so that synthetic event would
  never reach the handler.
- `test/generator*.test.ts` and `test/progression.test.ts` match on exact validation messages and
  `reason` strings. Add new strings rather than reword existing ones.
