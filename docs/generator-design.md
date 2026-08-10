# Generator design decisions

Several comments in `src/generator.ts`, `src/routes/generator.ts`,
`src/client/components/GenerateFlow.tsx` and `src/client/components/ProposalReview.tsx` cite "the
plan doc" by section number. Those documents were never checked in and no longer exist on disk, so
the references had become unresolvable. This file captures the decisions that are still load-bearing,
so the comments point at something a reader can actually open. It is a record of *why*, not a spec —
the code and its tests are the spec.

## There is no live AI call, deliberately

The app is deployed with no authentication in front of it: every endpoint, including all writes, is
open to anyone who knows the URL. A `POST /generate` that spent a paid API key from behind no login
would be a genuine cost-drain risk.

So the AI call does not run on the Worker at all. The app exports its context as JSON, the person
pastes it plus a prompt into whatever assistant they already have — under their own account and
their own access — and pastes the answer back. Everything downstream (schema, validation,
accept/reject, the review UI) is identical to what a live call would have produced. Only the
*source* of the proposal changes.

This also keeps the flow tool-agnostic. A `.claude/skills/*.md` file would only help someone using
Claude Code; the instructions live in the app itself so anyone can follow them with any assistant.

**Phase 2**, explicitly later: once Cloudflare Access is verified working (the trigger is
`/api/settings` returning a 302 to an unauthenticated request), the export/import round trip can be
replaced by a live in-app call. The seam is already in place — `generated_plans.source` is
`'external-import'` today and `'live-api'` then, and `validateProposal` / `hydrateProposal` /
accept-reject are all source-agnostic. A small follow-up, not a rewrite.

## Only week 1 of a multi-week generation is real

The deterministic pass can only prove one week. Mechanically chaining `progressExercise` forward
over assumed data would dress a guess up as arithmetic. So week 1 is the only real deterministic
output; weeks 2..N start as flat copies of week 1 with dates shifted, explicitly flagged
speculative, and the prompt asks the assistant to replace them with real periodisation judgement.

`ExportContext.speculativeFromWeek` is always 2 for this reason — "everything after week 1 is
speculative" is true whenever there is more than one week, so there is nothing week-count-dependent
to thread through the client.

No `reasons` entries are recorded for weeks 2..N. Reusing week 1's text under a different date
would read as a justification that does not actually exist for a speculative week.

## Twelve weeks is the cap

Two reasons. D1 subrequest limits: accepting a plan costs roughly 77 subrequests per week in the
worst case, so 12 weeks lands near 924 — under the documented 1000-subrequest paid-tier ceiling with
margin. And 12 weeks is a real mesocycle length, so the limit is not arbitrary.

## The pasted-back proposal is trusted no more than validation allows

`POST /import` runs exactly the validation a live API response would have gone through. A bad answer
from any assistant, or a garbled paste, gets the same 422 a bad live response would have. When it
does, the UI shows the validation errors verbatim so they can be pasted back into the same chat with
a request to fix the specific problem — that is the designed correction path, which is why there is
no inline editing of a pending proposal.

## No inline editing of a proposal

Accept or reject the whole thing. There is no editing affordance anywhere else in the app for a
prescription's weight or reps, and adding one here would be a new concept for a screen used once a
week. The correction path is reject → paste the errors or a follow-up ask back to the assistant →
re-import.

## days_per_week defaults to 5

To match the real current week (2 lifts + 3 runs), not an arbitrary "4-day" default — which would
have failed validation on the very first generation.

## Model selection, if a live call ever lands

The principle from the original build plan is worth keeping: **the model is for judgement, not
calculation.** Progression arithmetic and swap candidate selection are deterministic rules and a
`WHERE pattern = ?` query respectively — a model is *less* consistent than ten lines of code there,
and you cannot unit-test a prompt. The weekly plan review is the one real judgement call, runs once
a week, and is where a model earns its place.
