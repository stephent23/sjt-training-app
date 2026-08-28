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
export const PROMPT = `Plan my next block of gym training.

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
- historyWindow.loggedSets / .loggedRuns — my raw logged rows from the last two weeks. Ignore
  session_id, it's an internal id that joins to nothing you can see; use performed_on and
  exercise_id. Runs may carry distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm,
  elevation_gain_m, aerobic_training_effect, rpe_1_10 and interval_pace_seconds_per_km (the average
  pace during the work segments of an interval/tempo run) — any of them may be null.
- skippedSessions — sessions I didn't do.
- painFlags — { shoulder, back }. True means I reported real pain (2 or 3 out of 3).
- goals, goalTags — what I'm training for, as free text and as tick-box tags. These outrank
  everything except the hard rules below.
- daysPerWeek — how many sessions I train per week.
- exerciseCatalogue — every exercise I can be prescribed: id, name, pattern, increment_kg,
  loading, shoulder_safe, back_safe.
- today, weekStartDate — today's date, and the Monday to build from if I have no schedule yet.

HARD RULES — BREAK ONE AND THE IMPORT FAILS

1. Return every week in deterministicProposal.weeks, in the same order, with the same
   week_number values. Don't add weeks, don't drop weeks.
2. Week 1 must contain EXACTLY daysPerWeek sessions. Later weeks may have daysPerWeek or one
   fewer — that one session is the room you have for a deload. Never more, never zero. Count
   them before you answer; this is the most common failure.
3. Keep week 1's session dates exactly as given. Changing them breaks how the app checks week 1
   (see rule 5) and desyncs it from reasons. Later weeks are +7 days per week. Dates must be real
   calendar dates as YYYY-MM-DD, one session per day, ascending within a week, and every week
   must start after the previous week's last day.
4. A session with "kind": "run" must have "plannedSets": [] — the key present, the array empty —
   and a plannedRun object. A session with "kind": "lift" must have "plannedRun": null and a
   non-empty plannedSets. Never both, never neither. The same exercise_id may not appear twice in
   one session.
5. Weight increases are capped at +10% per week, checked per exercise:
   - Week 1 is compared against the same date AND same exercise_id in
     deterministicProposal.weeks[0].
   - Every later week is compared against the previous week of YOUR OWN answer, matched on
     exercise_id alone.
   - Exactly +10% passes, more fails. Decreases are never rejected — deload freely. If there is
     no matching baseline (a substituted exercise, or a baseline of null or 0) that exercise is
     unconstrained. Don't lean on that: inventing a number in week 1 where the baseline was null
     and then adding 20% in week 2 WILL be rejected on week 2.
6. Long runs ("run_type": "long") are capped the same way: +10% on target_km per week, against
   the same baselines as rule 5. easy/tempo/intervals runs and target_minutes are uncapped — stay
   sensible anyway.
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
   Use null for steady runs.
10. A week may carry an optional "focus" string. Put "deload" on a deload week so I can see it in
    the review screen.
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

If the block is four weeks or longer, include one deload week — usually the last, or week 4 of a
6+ week block. A deload drops load and volume rather than repeating: cut working weights about
10-15%, drop a set from the main lifts, keep the movements, and make the runs easy (no tempo, no
intervals, shorter long run). You may drop one session that week — that's allowed in any week after
the first, whether or not you label it. Mark it "focus": "deload" so I can see what it is.
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
  This is a calibration week I haven't trained yet. Keep week 1 exactly as given, weights still
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
- If running load is climbing, don't add lifting volume in the same week.
- Periodise weeks 2 onward properly: progressive overload, exercise rotation for variety (same
  movement pattern, respecting the safety flags), and the deload rules above.
- My goals and goalTags, and anything I've told you in this chat — an injury, travel, how I'm
  feeling. Weight those heavily.

OUTPUT

Explain what you changed and why in a few sentences, then give the complete plan in ONE fenced
json block, with nothing after it. Shape (these are all the fields — none extra, none omitted):

\`\`\`json
{"weeks":[{"week_number":2,"focus":null,"sessions":[
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
