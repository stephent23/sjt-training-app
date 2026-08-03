import { useEffect, useState } from 'preact/hooks';
import type { LoggedRunEntry, LoggedSetEntry, PlannedSetDetail } from '../../types';
import { logRun, logSet, setSessionStatus } from '../api';
import { useSession } from '../useSession';

interface ReviewProps {
	sessionId: number;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
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
}

function ReviewExercise({ exercise, onCommitSet }: ReviewExerciseProps) {
	const setIndexes = Array.from({ length: exercise.target_sets }, (_, i) => i + 1);

	return (
		<section>
			<h2 class="section-heading">{exercise.exercise_name}</h2>
			<p class="exercise-target">
				{exercise.target_sets} × {exercise.rep_low}-{exercise.rep_high}
			</p>
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

	function commit() {
		onCommit({
			distance_km: Number(distance) || 0,
			duration_seconds: (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
			avg_hr: avgHr ? Number(avgHr) : null,
			rpe_1_10: rpe ? Number(rpe) : null,
		});
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

	if (!detail) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={() => history.back()}>
					← Back
				</button>
				{error ? (
					<>
						<p>{error}</p>
						<button type="button" class="btn-secondary" onClick={reload}>
							Retry
						</button>
					</>
				) : (
					<p>Loading…</p>
				)}
			</main>
		);
	}

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

	function finish(status: 'completed' | 'skipped') {
		if (!detail) return;
		setSessionStatus(sessionId, status);
		setDetail({ ...detail, session: { ...detail.session, status } });
		location.hash = '#/';
	}

	const totalTarget = plannedSets.reduce((sum, ps) => sum + ps.target_sets, 0);
	const totalLogged = plannedSets.reduce((sum, ps) => sum + ps.logged.length, 0);
	const progressLine = session.kind === 'lift' ? `${totalLogged} of ${totalTarget} sets logged` : loggedRun ? 'Run logged' : 'Not yet logged';

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

			{session.kind === 'lift'
				? plannedSets.map((ps) => <ReviewExercise key={ps.id} exercise={ps} onCommitSet={handleCommitSet} />)
				: (() => {
						const run = detail.plannedRun;
						return (
							<>
								{run && (
									<p class="exercise-target">
										{capitalize(run.run_type)}
										{run.target_minutes ? ` · ${run.target_minutes} min` : ''}
										{run.target_km ? ` · ${run.target_km} km` : ''}
									</p>
								)}
								<ReviewRun loggedRun={loggedRun} onCommit={handleCommitRun} />
							</>
						);
					})()}

			<button type="button" class="btn-primary" onClick={() => finish('completed')} disabled={session.status === 'completed'}>
				Mark session complete
			</button>
			<button type="button" class="btn-secondary" onClick={() => finish('skipped')} disabled={session.status === 'skipped'}>
				Mark skipped
			</button>
		</main>
	);
}
