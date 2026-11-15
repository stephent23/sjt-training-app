import { Icon } from '../components/Icon';
import { useEffect, useState } from 'preact/hooks';
import {
	type LoggedRunEntry,
	type LoggedSetEntry,
	type PlannedSetDetail,
	type RunMetricField,
	type RunType,
	type SessionFeedback,
} from '../../types';
import { logRun, logSet, saveFeedback, setExerciseStatus, setSessionStatus } from '../api';
import { FeedbackCard } from '../components/FeedbackCard';
import { RunMetricsFields, type PlannedTarget } from '../components/RunMetricsFields';
import { SessionScreenFallback } from '../components/SessionScreenFallback';
import { longDate } from '../components/WeekStrip';
import { weekLabel } from '../weekLabel';
import { parseRunFields, runFieldsFrom, type RunFields } from '../runFields';
import { formatDuration, formatPace, runSummary } from '../format';
import { sessionSetTotals } from '../../sessionProgress';
import { useSession } from '../useSession';

interface ReviewProps {
	sessionId: number;
}

interface ReviewSetRowProps {
	setIndex: number;
	entry: LoggedSetEntry | undefined;
	onCommit: (setIndex: number, weightKg: number, reps: number, rir: number) => void;
}

// One editable row of an exercise's review table. Local string state lets the
// person type freely; the write only fires on blur/Enter (the `change`
// event), not per keystroke — an `input` handler here would queue a write
// for every partial value ("2", "22", "22.5") and race them against each
// other through the sync queue.
function ReviewSetRow({ setIndex, entry, onCommit }: ReviewSetRowProps) {
	const [weight, setWeight] = useState(entry ? String(entry.weight_kg) : '');
	const [reps, setReps] = useState(entry ? String(entry.reps) : '');
	const [rir, setRir] = useState(entry ? String(entry.rir) : '');

	useEffect(() => {
		setWeight(entry ? String(entry.weight_kg) : '');
		setReps(entry ? String(entry.reps) : '');
		setRir(entry ? String(entry.rir) : '');
	}, [entry?.weight_kg, entry?.reps, entry?.rir]);

	function commit() {
		const w = Number(weight);
		const r = Number(reps);
		const ri = Number(rir);
		if (!Number.isFinite(w) || w < 0 || !Number.isInteger(r) || r < 0 || !Number.isInteger(ri) || ri < 0 || ri > 4) return;
		onCommit(setIndex, w, r, ri);
	}

	return (
		<tr>
			<td class="num">{setIndex}</td>
			<td>
				<input
					type="number"
					inputmode="decimal"
					value={weight}
					onInput={(e) => setWeight((e.target as HTMLInputElement).value)}
					onChange={commit}
				/>
			</td>
			<td>
				<input
					type="number"
					inputmode="numeric"
					value={reps}
					onInput={(e) => setReps((e.target as HTMLInputElement).value)}
					onChange={commit}
				/>
			</td>
			<td>
				<input
					type="number"
					inputmode="numeric"
					value={rir}
					onInput={(e) => setRir((e.target as HTMLInputElement).value)}
					onChange={commit}
				/>
			</td>
		</tr>
	);
}

interface ReviewExerciseProps {
	exercise: PlannedSetDetail;
	onCommitSet: (exercise: PlannedSetDetail, setIndex: number, weightKg: number, reps: number, rir: number) => void;
	onUnskip: (exercise: PlannedSetDetail) => void;
}

function ReviewExercise({ exercise, onCommitSet, onUnskip }: ReviewExerciseProps) {
	const skipped = exercise.status === 'skipped';
	const setIndexes = Array.from({ length: exercise.target_sets }, (_, i) => i + 1);

	// A skipped exercise used to render as a normal, empty table — identical to
	// one you simply hadn't got to yet. Show the table only if something was
	// actually logged before the skip, so a mis-skip stays inspectable and
	// repairable without hiding real data.
	const showTable = !skipped || exercise.logged.length > 0;
	// Ticked once every prescribed set has a logged entry — the word is in the
	// aria-label, so the tick is never the only carrier.
	const complete = !skipped && exercise.logged.length >= exercise.target_sets;

	return (
		<section class={`card review-exercise${skipped ? ' review-exercise--skipped' : ''}`}>
			<h2 class="section-heading">
				{exercise.exercise_name}
				{complete && (
					<span class="review-tick" role="img" aria-label="All sets logged">
						<Icon name="check" />
					</span>
				)}
			</h2>
			<p class="exercise-target">{skipped ? 'Skipped' : `${exercise.target_sets} × ${exercise.rep_low}-${exercise.rep_high}`}</p>

			{skipped && (
				// Without this an accidental skip is unreachable: once the session
				// is completed, Today routes to Review rather than back into the
				// lift screen, which is the only other place with a skip toggle.
				<button type="button" class="btn-secondary" onClick={() => onUnskip(exercise)}>
					Unskip
				</button>
			)}

			{showTable && (
				<div class="table-scroll">
					<table class="review-table">
						<thead>
							<tr>
								<th>Set</th>
								<th>Weight</th>
								<th>Reps</th>
								<th>RIR</th>
							</tr>
						</thead>
						<tbody>
							{setIndexes.map((si) => (
								<ReviewSetRow
									key={si}
									setIndex={si}
									entry={exercise.logged.find((l) => l.set_index === si)}
									onCommit={(setIndex, weightKg, reps, rir) => onCommitSet(exercise, setIndex, weightKg, reps, rir)}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

interface ReviewRunProps {
	loggedRun: LoggedRunEntry | null;
	runType: RunType | null;
	planned: PlannedTarget | null;
	onCommit: (input: LoggedRunMetrics) => void;
}

type LoggedRunMetrics = Pick<LoggedRunEntry, 'distance_km' | 'duration_seconds' | 'note' | 'interval_pace_seconds_per_km'> &
	Record<RunMetricField, number | null>;

function ReviewRun({ loggedRun, runType, planned, onCommit }: ReviewRunProps) {
	const [fields, setFields] = useState<RunFields>(() => runFieldsFrom(loggedRun));
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	// Resynced against a signature of the saved values rather than a dependency
	// per field — there are ten of them now, and a list that long is a list
	// someone forgets to extend.
	const signature = JSON.stringify(loggedRun);
	useEffect(() => setFields(runFieldsFrom(loggedRun)), [signature]);

	// A run is only worth writing once BOTH distance and duration are real —
	// otherwise filling in the first field alone would log a run with
	// duration 0 (or distance 0), which is not just cosmetic: progressRun
	// only checks whether a long run was logged at all, so a junk row counts
	// as a real one and earns the 10% weekly growth. Partial input simply
	// isn't committed, matching ReviewSetRow's refuse-to-commit-garbage rule.
	// Only a value that was typed and is wrong gets a message — a field that is
	// merely still empty is mid-entry, not an error.
	function commit(next: RunFields = fields) {
		const parsed = parseRunFields(next);
		if (!parsed.ok) {
			setFieldErrors(Object.fromEntries(Object.entries(parsed.fieldErrors).filter(([key]) => (next[key] ?? '').trim() !== '')));
			return;
		}
		setFieldErrors({});
		onCommit(parsed.value);
	}

	return <RunMetricsFields fields={fields} onChange={setFields} onCommit={commit} runType={runType} planned={planned} errors={fieldErrors} />;
}

export function Review({ sessionId }: ReviewProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);

	if (!detail) return <SessionScreenFallback error={error} onBack={() => history.back()} onRetry={reload} />;

	const { session, plannedSets, loggedRun } = detail;

	// A set edited/filled in here must reuse ITS OWN performed_on (or the
	// session's planned date for a set that was never logged) — never
	// today's real date. Rewriting performed_on to "now" would corrupt the
	// "last week" prefill logic the next time this exercise is planned,
	// since that prefill keys off performed_on to find the most recent day.
	function handleCommitSet(exercise: PlannedSetDetail, setIndex: number, weightKg: number, reps: number, rir: number) {
		if (!detail) return;
		const existing = exercise.logged.find((l) => l.set_index === setIndex);
		const updated = logSet(
			sessionId,
			{
				exercise_id: exercise.exercise_id,
				set_index: setIndex,
				weight_kg: weightKg,
				reps,
				rir,
				rest_taken_seconds: existing ? existing.rest_taken_seconds : null,
				performed_on: existing ? existing.performed_on : session.date,
			},
			detail,
		);
		setDetail(updated);
	}

	function handleCommitRun(input: LoggedRunMetrics) {
		if (!detail) return;
		const existing = detail.loggedRun;
		setDetail(logRun(sessionId, { ...input, performed_on: existing ? existing.performed_on : session.date }, detail));
	}

	function handleSaveFeedback(feedback: SessionFeedback) {
		if (!detail) return;
		setDetail(saveFeedback(sessionId, feedback, detail));
	}

	function handleUnskip(exercise: PlannedSetDetail) {
		if (!detail) return;
		setDetail(setExerciseStatus(sessionId, exercise.id, 'planned', detail));
	}

	function finish(status: 'completed' | 'skipped') {
		if (!detail) return;
		setSessionStatus(sessionId, status);
		setDetail({ ...detail, session: { ...detail.session, status } });
		location.hash = '#/';
	}

	// Shared with LiftSession so the two screens can't disagree about what
	// "done" means — and it excludes skipped exercises, which is what stopped
	// a session with skipped work ever reading as finished.
	const totals = sessionSetTotals(plannedSets);
	const progressLine =
		session.kind === 'lift' ? `${totals.logged} of ${totals.target} sets logged` : loggedRun ? 'Run logged' : 'Not yet logged';

	const stats: { value: string; label: string }[] = [];
	if (session.kind === 'lift') {
		if (totals.logged > 0) {
			const tonnage = plannedSets.reduce((sum, ps) => sum + ps.logged.reduce((s, l) => s + l.weight_kg * l.reps, 0), 0);
			stats.push({ value: `${totals.logged}/${totals.target}`, label: 'Sets' });
			stats.push({ value: String(Math.round(tonnage)), label: 'Kg lifted' });
		}
	} else if (loggedRun) {
		stats.push({ value: String(loggedRun.distance_km), label: 'Km' });
		stats.push({ value: formatDuration(loggedRun.duration_seconds), label: 'Time' });
		const pace = formatPace(loggedRun.distance_km, loggedRun.duration_seconds);
		if (pace) stats.push({ value: pace.replace(' /km', ''), label: 'Pace /km' });
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={() => history.back()}>
				<Icon name="chevron-left" />
				Back
			</button>

			{error && (
				<p class="eyebrow" role="alert">
					{error}
				</p>
			)}

			<span class="eyebrow">
				{longDate(session.date)} · {weekLabel(session)}
			</span>
			<h1>{session.label}</h1>
			<p class="exercise-target">{progressLine}</p>

			{/* What actually happened, before the tables that let you fix it. */}
			{stats.length > 0 ? (
				<dl class="summary-strip">
					{stats.map((stat) => (
						<div key={stat.label} class="stat">
							<dt class="stat-label">{stat.label}</dt>
							<dd class="stat-value">{stat.value}</dd>
						</div>
					))}
				</dl>
			) : (
				<p class="hint">Nothing logged for this one — fill it in below.</p>
			)}

			{session.kind === 'lift' ? (
				plannedSets.map((ps) => <ReviewExercise key={ps.id} exercise={ps} onCommitSet={handleCommitSet} onUnskip={handleUnskip} />)
			) : (
				<>
					{detail.plannedRun && (
						<p class="exercise-target">
							{runSummary(detail.plannedRun.run_type, detail.plannedRun.target_minutes, detail.plannedRun.target_km)}
						</p>
					)}
					<ReviewRun loggedRun={loggedRun} runType={detail.plannedRun?.run_type ?? null} planned={detail.plannedRun ?? null} onCommit={handleCommitRun} />
					<button type="button" class="btn-secondary" onClick={() => (location.hash = `#/run/${sessionId}/edit`)}>
						Edit run details
					</button>
				</>
			)}

			<FeedbackCard feedback={detail.feedback} onSave={handleSaveFeedback} />

			{/* Only the verdicts that would change something: a session already
			    completed has nothing left to decide (reached right after finishing
			    a lift, or from History); a skipped one can still be marked done once
			    it is filled in; a planned one (a missed day, a run logged after the
			    fact) needs both. */}
			{session.status !== 'completed' && (
				<button type="button" class="btn-primary" onClick={() => finish('completed')}>
					Mark session complete
				</button>
			)}
			{session.status === 'planned' && (
				<button type="button" class="btn-secondary" onClick={() => finish('skipped')}>
					Mark skipped
				</button>
			)}
		</main>
	);
}
