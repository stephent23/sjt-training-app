// The instructions handed to whatever AI assistant the person uses — ChatGPT,
// Claude, Gemini, anything. Deliberately tool-agnostic and deliberately
// visible in the UI, so what goes on the clipboard is never a surprise.
//
// It is maintained against validateProposal in src/generator.ts: every "hard
// rule" below is a rule the import actually enforces, and the two must not
// drift. An assistant can only satisfy a constraint it has been told about,
// and the previous version told it about almost none of them — it named a
// field that doesn't exist, never mentioned the exact-session-count rule that
// causes most rejections, and asked for prose and JSON in an order the
// importer couldn't read.
export const PROMPT = `Plan my next block of training: lifting and running.

I'm giving you a JSON file (attached, or pasted below). Read it, then give me back an adjusted
plan as JSON. My app imports that JSON and validates it strictly: one broken rule and it rejects
the whole thing. Getting it importable matters more than getting it clever.

WHAT'S IN THE FILE

- deterministicProposal — { "weeks": [...] }, the plan my app already computed mechanically.
  Week 1 is real arithmetic from last week's logged sets — trust it unless you have a reason not
  to. Weeks 2 onward are flat copies of week 1 with dates pushed +7 days each. They are
  placeholders, not judgement (speculativeFromWeek marks where the copies start; it is always 2).
  Replace them with real periodisation.
- reasons — why week 1's numbers came out the way they did. Keys are "YYYY-MM-DD:<exercise_id>"
  for lifts and "YYYY-MM-DD:run" for runs. Week 1 only; there is nothing here for later weeks.
- historyWindow.loggedSets — my raw logged lift sets from the last two weeks. loggedRuns reaches
  back six weeks instead of two — runs happen less often per week and vary more (pace, terrain,
  recovery), so two weeks isn't enough to see a real trend. Ignore session_id on either, it's an
  internal id that joins to nothing you can see; use performed_on and exercise_id. Runs may carry
  distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m,
  aerobic_training_effect, rpe_1_10 and interval_pace_seconds_per_km (the average pace during the
  work segments of an interval/tempo run) — any of them may be null — and note, my own words about
  the run: read it.
- trainingSummary — the long view: the last 12 weeks plus this week so far, one entry per week
  (keyed by Monday, oldest first) with adherence (planned/completed/skipped), per-exercise best
  estimated 1RM and top weight, hard sets (RIR 3 or less) per movement pattern, running km / run count / long
  run / average RPE and HR, and worst shoulder and back pain (0-3). trends sums it up: e1RM change per
  exercise, weekly km change, overall adherence %. Use it to judge direction — what is improving,
  stalling or being skipped — and set the block's periodisation from it. It informs judgement
  only: the hard rules below are checked against deterministicProposal, never against this. It also
  carries trainingSummary.run_fitness, my running fitness: by_type (easy/tempo/intervals/long: runs, km,
  avg_pace_seconds_per_km, avg_hr); easy_pace_trend (first vs last half of the 12 weeks: pace and avg_hr);
  best_efforts (my fastest WHOLE RUN of at least 5/10/15/21 km, not a segment); race_estimates (Riegel
  equivalents: ten_k_seconds, half_marathon_seconds; source "race" or "training_run"); longest_run_km;
  weeks_with_long_run_over_16km. Use these numbers, don't compute your own. "training_run" estimates
  understate race fitness.
- races — my upcoming races: name, date, distance_km, priority ("A" = peak and taper for it, "B" = run it
  as training), target_seconds, target_pace_seconds_per_km (null without a target), days_until, weeks_until,
  block_week (1..N: the week of this block it falls in; null if before or after the block).
- raceResults — past races with a result; personalBests — my fastest result per distance.
- athlete — { max_hr, resting_hr, vo2max, threshold_pace_seconds_per_km, threshold_hr }, each null if
  unknown; never guess one. Use max_hr to judge effort (logged avg_hr as a share of it) and to set
  easy-day guidance; with resting_hr too, use heart-rate-reserve zones. vo2max is my Garmin estimate —
  weigh it with race_estimates when judging a target. threshold_pace_seconds_per_km and threshold_hr
  are my Garmin lactate threshold: set tempo work at or just slower than that pace, and treat the
  threshold HR as the top of tempo effort.
- skippedSessions — sessions I skipped in the last trained week only.
- painFlags — { shoulder, back }. True means I reported real pain (2 or 3 on a 0-3 scale).
- goals, goalTags — what I'm training for, as free text and as tick-box tags. These outrank
  everything except the hard rules below.
- daysPerWeek — how many sessions I train per week, lifts and runs together: one session per day,
  no doubles.
- exerciseCatalogue — every exercise I can be prescribed: id, name, pattern, increment_kg,
  loading, shoulder_safe, back_safe. (modality, needs_spotter and is_default are app details; ignore.)
- today, weekStartDate — today's date, and the Monday the new plan starts on (week 1 lands on it; I chose it).

HARD RULES — BREAK ONE AND THE IMPORT FAILS

1. Return every week in deterministicProposal.weeks, in the same order, with the same
   week_number values (1..N — each plan is a fresh block, so numbering restarts at 1). Don't add weeks, don't drop weeks.
2. Week 1 must contain EXACTLY daysPerWeek sessions. Later weeks may have daysPerWeek, one fewer
   or two fewer (at least 1) — room for a deload, taper or race week. Never more, never zero. Count
   them before you answer; this is the most common failure.
3. Keep week 1's session dates as given: they are how the app checks week 1 (see rule 5) and they
   match reasons. If week 1 has a different number of sessions than daysPerWeek, or a race falls in
   week 1, add, drop or move week-1 sessions to fix it. That is the only reason to change week 1's
   dates. Later weeks are +7 days per week. Dates must be real calendar dates as YYYY-MM-DD, one
   session per day, ascending within a week, and every week must start after the previous week's
   last day.
4. A session with "kind": "run" must have "plannedSets": [] — the key present, the array empty —
   and a plannedRun object. A session with "kind": "lift" must have "plannedRun": null and a
   non-empty plannedSets. Never both, never neither. The same exercise_id may not appear twice in
   one session.
5. Weight increases are capped at +10% per week, checked per exercise:
   - Week 1 is compared against the same date AND same exercise_id in
     deterministicProposal.weeks[0].
   - Every later week is compared against the highest you've prescribed for that exercise_id in
     any earlier week (including the deterministic week 1), so returning to a pre-deload weight is fine.
   - Exactly +10% passes, more fails. Decreases are never rejected — deload freely. If there is
     no matching baseline (a substituted exercise, an added session, or a baseline of null or 0) that
     exercise is unconstrained. Don't lean on that: inventing a number in week 1 where the baseline
     was null and then adding 20% in week 2 WILL be rejected on week 2.
6. Long runs ("run_type": "long") are capped the same way: +10% on target_km, against the highest
   you've prescribed for it in any earlier week. Exception: a long run on the date of a race in
   "races" is exempt and never counts as that baseline. easy/tempo/intervals runs and target_minutes
   are uncapped — stay sensible anyway.
7. Every exercise_id must exist in exerciseCatalogue. If painFlags.shoulder is true, use nothing
   with shoulder_safe: 0. If painFlags.back is true, nothing with back_safe: 0.
8. Field types: target_sets >= 1; rep_high >= rep_low; order_index and rest_seconds are
   non-negative integers; target_weight_kg is null or a non-negative number; superset_group is
   null or an integer; label is a non-empty string. Keep the order_index numbering the export
   used, in the order I do the exercises.
9. structure_json is a STRING CONTAINING JSON, not a JSON object. Escape it. It must parse to
   {"steps":[...]} where every step has "kind" (text), "minutes" (a number) and "effort" (text),
   plus an optional whole-number "repeat". Example:
   "{\\"steps\\":[{\\"kind\\":\\"warmup\\",\\"minutes\\":10,\\"effort\\":\\"easy\\"},{\\"kind\\":\\"work\\",\\"minutes\\":3,\\"effort\\":\\"comfortably_hard\\",\\"repeat\\":5},{\\"kind\\":\\"cooldown\\",\\"minutes\\":10,\\"effort\\":\\"easy\\"}]}"
   Use null for steady runs. Write pace or HR targets into the step effort (e.g. "4:50-5:00/km",
   "HR < 150"); for steady runs put them in the session label (e.g. "Easy 40 min · HR < 150").
10. A week may carry an optional "focus" string: "deload", "taper" or "race" where they apply, so I
    can see it in the review screen.
11. Don't schedule anything on a date I already have a session on — the app refuses the whole
    import and tells you which date clashed.

WEIGHTS

- target_weight_kg has to be a weight I can actually load: a multiple of that exercise's
  increment_kg (2 kg for most dumbbells, 5 kg for machines and cables, 1 kg for small dumbbell
  isolation work). Never 23.5 kg on a 2 kg-increment dumbbell.
- loading: "per_hand" means the number is ONE dumbbell, not the pair. "total" is the stack or
  machine number. "bodyweight" always takes target_weight_kg: null.
- Carry notes and superset_group across from the matching set in deterministicProposal unless you
  are deliberately changing them. Sets sharing a superset_group integer are done as a superset —
  keep the pair together and adjacent in order_index.

DELOADS

If the block is four weeks or longer, include a deload. Deload roughly every 4th week; a taper counts
as one; never deload the week before a taper. A deload drops load and volume rather than repeating: cut working weights about
10-15%, drop a set from the main lifts, keep the movements, and make the runs easy (no tempo, no
intervals, shorter long run). You may drop a session or two that week (allowed in any week after
the first). Mark it "focus": "deload" so I can see what it is.
Deload rather than holding again if I've had two rough sessions in a row, or reps have kept
missing target.

HOW MUCH DATA I ACTUALLY HAVE — USE THE CASE THAT MATCHES

Case A: deterministicProposal.weeks[0].sessions is empty.
  I have no history at all, so you're writing the whole programme. Build week 1 as daysPerWeek
  sessions starting on weekStartDate (a Monday), spread across the week with recovery between
  hard days. Set EVERY target_weight_kg to null and put "Calibration — pick a weight you can hit
  for the top of the rep range at about 2 reps in reserve, then log it." in notes. Don't invent
  kilos for lifts you have never seen me do. Runs can have real target_km / target_minutes —
  start conservatively.

Case B: sessions exist, but every target_weight_kg is null and historyWindow.loggedSets is empty.
  This is a calibration week I haven't trained yet. Keep week 1's lifts as given, weights still
  null. Keep them null in the later weeks too, and vary only volume, exercise selection and
  running. Any number you invent for week 1 becomes the baseline that makes week 2 fail rule 5,
  and I'll have real numbers for you next time anyway.

Case C: some sets are logged, but sparsely.
  Progress only the exercises that actually have logged sets in historyWindow — reasons already
  tells you what the app decided and why. For an exercise with nothing logged, hold: keep the
  weight it has, or null if it has none. Don't extrapolate a progression from a single set, and
  don't assume there are two full weeks of history — there may be one.

WHAT THE APP ALREADY DID, MECHANICALLY

Per exercise: hold if nothing was logged; +1x increment_kg if every set hit rep_high at median
RIR 1 or less; +2x increment_kg if every set hit rep_high at median RIR 2 or more; hold the
weight and chase one more rep if reps landed inside the range; hold if any set fell below
rep_low (with a separate note if my rest ran short). Runs: easy, tempo and intervals always hold.
The long run grows 10%, but only if I actually ran it, finished within 10% of the target
distance, didn't log it at RPE 8+, and didn't average a heart rate within 5% of that run's max.

WHAT I WANT FROM YOU THAT IT CAN'T DO

- Skipped sessions: don't compound a missed week — hold or reshuffle rather than advancing.
- Running: build a real week, not three identical easy runs. One quality session (tempo or
  intervals, with a proper structure_json), one long run, the rest genuinely easy. Use my logged
  pace, heart rate, cadence and training effect to judge whether I'm recovering — if the easy
  runs are drifting hard, make them easier rather than longer.
- Races: periodise toward the next "A" race: build, then sharpen, then taper for 1-2 weeks when the
  race falls inside this block (see block_week). "B" races are run as training, not tapered for. Race
  day is a "long" run labelled "Race: <name>" with target_km = the race distance; it counts as one
  of that week's sessions. Make the week after a race easier. If the next "A" race is after the
  block, build base and volume, don't taper, and finish on a normal week. Two "A" races 4 weeks or
  less apart: one recovery week, then a short re-sharpen; don't rebuild.
- Be honest about my target: compare target_pace_seconds_per_km with what my recent running supports
  (run_fitness, raceResults, personalBests). If it isn't realistic yet, say what is, and what would
  have to change. Push when the data shows I'm absorbing the work (RPE, HR as a share of max, sessions
  completed); hold back when it doesn't.
- Strength stays a real part of the plan: keep the lifting sessions and their progression. In the
  last 2-3 weeks before an "A" race and in race week, cut leg volume and intensity rather than
  dropping lifting. No heavy lower-body work the day before the quality run or the long run.
  As weekly km rises, hold lower-body loads (keep the sets, don't chase leg PRs); upper body can
  keep progressing. Keep the long run on the weekday week 1 has it (Sunday if none).
- Periodise weeks 2 onward properly: progressive overload, exercise rotation for variety (same
  movement pattern, respecting the safety flags), and the deload rules above.
- My goals and goalTags, and anything I've told you in this chat — an injury, travel, how I'm
  feeling. Weight those heavily.

OUTPUT

Explain what you changed and why in a few sentences, then give the complete plan in ONE fenced
json block, with nothing after it. Besides "weeks", include a top-level "summary": plain text, 300
characters or fewer (hard limit 1500): the shape of the block, the realistic race-time range as
h:mm:ss (if there's no race, skip the time), and the one thing to watch. Shape (these are all the fields — none extra, none omitted):

\`\`\`json
{"summary":"Four build weeks, a taper, then the half. A 1:40:00-1:45:00 finish looks realistic. Watch your calves.","weeks":[{"week_number":1,"focus":null,"sessions":[
  {"date":"2026-08-10","kind":"lift","label":"Lift A","plannedRun":null,"plannedSets":[
    {"exercise_id":17,"order_index":1,"target_sets":3,"rep_low":8,"rep_high":10,
     "target_weight_kg":22,"rest_seconds":150,"notes":null,"superset_group":null}]},
  {"date":"2026-08-11","kind":"run","label":"Easy run","plannedSets":[],
   "plannedRun":{"run_type":"easy","target_minutes":30,"target_km":5,"structure_json":null}}
]}]}
\`\`\`

Where deterministicProposal is not empty it is the authoritative example of the shape — match it
field for field. Before you answer, re-check rule 2 (session counts) and rule 5 (the 10% chain
runs across your own weeks, not just against mine).`;
