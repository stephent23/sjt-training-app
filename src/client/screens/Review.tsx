import { useEffect, useState } from 'preact/hooks';
import type { LoggedRunEntry, LoggedSetEntry, PlannedSetDetail, SessionFeedback } from '../../types';
import { logRun, logSet, saveFeedback, setExerciseStatus, setSessionStatus } from '../api';
import { FeedbackCard } from '../components/FeedbackCard';
import { SessionScreenFallback } from '../components/SessionScreenFallback';
import { runSummary } from '../format';
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
				<input type="number" inputmode="numeric" value={reps} onInput={(e) => setReps((e.target as HTMLInputElement).value)} onChange={commit} />
			</td>
			<td>
				<input type="number" inputmode="numeric" value={rir} onInput={(e) => setRir((e.target as HTMLInputElement).value)} onChange={commit} />
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

	return (
		<section class={skipped ? 'review-exercise--skipped' : undefined}>
			<h2 class="section-heading">{exercise.exercise_name}</h2>
			<p class="exercise-target">
				{skipped ? 'Skipped' : `${exercise.target_sets} × ${exercise.rep_low}-${exercise.rep_high}`}
			</p>

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
	onCommit: (input: { distance_km: number; duration_seconds: number; avg_hr: number | null; rpe_1_10: number | null }) => void;
}

function ReviewRun({ loggedRun, onCommit }: ReviewRunProps) {
	const [distance, setDistance] = useState(loggedRun ? String(loggedRun.distance_km) : '');
	const [minutes, setMinutes] = useState(loggedRun ? String(Math.floor(loggedRun.duration_seconds / 60)) : '');
	const [seconds, setSeconds] = useState(loggedRun ? String(loggedRun.duration_seconds % 60) : '');
	const [avgHr, setAvgHr] = useState(loggedRun?.avg_hr != null ? String(loggedRun.avg_hr) : '');
	const [rpe, setRpe] = useState(loggedRun?.rpe_1_10 != null ? String(loggedRun.rpe_1_10) : '');

	useEffect(() => {
		setDistance(loggedRun ? String(loggedRun.distance_km) : '');
		setMinutes(loggedRun ? String(Math.floor(loggedRun.duration_seconds / 60)) : '');
		setSeconds(loggedRun ? String(loggedRun.duration_seconds % 60) : '');
		setAvgHr(loggedRun?.avg_hr != null ? String(loggedRun.avg_hr) : '');
		setRpe(loggedRun?.rpe_1_10 != null ? String(loggedRun.rpe_1_10) : '');
	}, [loggedRun?.distance_km, loggedRun?.duration_seconds, loggedRun?.avg_hr, loggedRun?.rpe_1_10]);

	// A run is only worth writing once BOTH distance and duration are real —
	// otherwise filling in the first field alone would log a run with
	// duration 0 (or distance 0), which is not just cosmetic: progressRun
	// only checks whether a long run was logged at all, so a junk row counts
	// as a real one and earns the 10% weekly growth. Partial input simply
	// isn't committed, matching ReviewSetRow's refuse-to-commit-garbage rule.
	function commit() {
		const distanceKm = Number(distance);
		const durationSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
		if (!Number.isFinite(distanceKm) || distanceKm <= 0) return;
		if (durationSeconds <= 0) return;

		const avgHrValue = avgHr === '' ? null : Number(avgHr);
		if (avgHrValue !== null && (!Number.isInteger(avgHrValue) || avgHrValue <= 0)) return;

		const rpeValue = rpe === '' ? null : Number(rpe);
		if (rpeValue !== null && (!Number.isInteger(rpeValue) || rpeValue < 1 || rpeValue > 10)) return;

		onCommit({ distance_km: distanceKm, duration_seconds: durationSeconds, avg_hr: avgHrValue, rpe_1_10: rpeValue });
	}

	return (
		<div class="table-scroll">
			<table class="review-table">
				<tbody>
					<tr>
						<td>Distance (km)</td>
						<td>
							<input type="number" inputmode="decimal" value={distance} onInput={(e) => setDistance((e.target as HTMLInputElement).value)} onChange={commit} />
						</td>
					</tr>
					<tr>
						<td>Duration</td>
						<td>
							<div class="duration-inputs">
								<input
									type="number"
									inputmode="numeric"
									placeholder="min"
									value={minutes}
									onInput={(e) => setMinutes((e.target as HTMLInputElement).value)}
									onChange={commit}
								/>
								<input
									type="number"
									inputmode="numeric"
									placeholder="sec"
									value={seconds}
									onInput={(e) => setSeconds((e.target as HTMLInputElement).value)}
									onChange={commit}
								/>
							</div>
						</td>
					</tr>
					<tr>
						<td>Avg HR</td>
						<td>
							<input type="number" inputmode="numeric" value={avgHr} onInput={(e) => setAvgHr((e.target as HTMLInputElement).value)} onChange={commit} />
						</td>
					</tr>
					<tr>
						<td>RPE</td>
						<td>
							<input type="number" inputmode="numeric" value={rpe} onInput={(e) => setRpe((e.target as HTMLInputElement).value)} onChange={commit} />
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
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

	function handleCommitRun(input: { distance_km: number; duration_seconds: number; avg_hr: number | null; rpe_1_10: number | null }) {
		if (!detail) return;
		const existing = detail.loggedRun;
		const updated = logRun(
			sessionId,
			{
				distance_km: input.distance_km,
				duration_seconds: input.duration_seconds,
				avg_hr: input.avg_hr,
				rpe_1_10: input.rpe_1_10,
				performed_on: existing ? existing.performed_on : session.date,
				note: existing ? existing.note : null,
			},
			detail,
		);
		setDetail(updated);
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
	const progressLine = session.kind === 'lift' ? `${totals.logged} of ${totals.target} sets logged` : loggedRun ? 'Run logged' : 'Not yet logged';

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={() => history.back()}>
				← Back
			</button>

			{error && <p class="eyebrow">{error}</p>}

			<span class="eyebrow">
				{session.date} · Week {session.week_number}
			</span>
			<h1>{session.label}</h1>
			<p class="exercise-target">{progressLine}</p>

			{session.kind === 'lift' ? (
				plannedSets.map((ps) => <ReviewExercise key={ps.id} exercise={ps} onCommitSet={handleCommitSet} onUnskip={handleUnskip} />)
			) : (
				<>
					{detail.plannedRun && (
						<p class="exercise-target">
							{runSummary(detail.plannedRun.run_type, detail.plannedRun.target_minutes, detail.plannedRun.target_km)}
						</p>
					)}
					<ReviewRun loggedRun={loggedRun} onCommit={handleCommitRun} />
				</>
			)}

			<FeedbackCard feedback={detail.feedback} onSave={handleSaveFeedback} />

			<button type="button" class="btn-primary" onClick={() => finish('completed')} disabled={session.status === 'completed'}>
				Mark session complete
			</button>
			<button type="button" class="btn-secondary" onClick={() => finish('skipped')} disabled={session.status === 'skipped'}>
				Mark skipped
			</button>
		</main>
	);
}
