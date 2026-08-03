import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../../types';
import { fetchSession, logSet } from '../api';
import { RestTimer } from '../components/RestTimer';
import { SetRow } from '../components/SetRow';
import { SwapSheet } from '../components/SwapSheet';
import { readCachedSession, writeCachedSession } from '../sessionCache';
import { pendingCount } from '../sync';

interface LiftSessionProps {
	sessionId: number;
	onBack: () => void;
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function LiftSession({ sessionId, onBack }: LiftSessionProps) {
	const [detail, setDetail] = useState<SessionDetail | null>(() => readCachedSession(sessionId));
	const [exerciseIndex, setExerciseIndex] = useState(0);
	const [rest, setRest] = useState<{ startedAt: number; seconds: number } | null>(null);
	const [swapOpen, setSwapOpen] = useState(false);

	useEffect(() => {
		fetchSession(sessionId).then((fresh) => {
			// A visit still has unsynced local writes — trust those over the server's stale view.
			if (pendingCount() > 0) return;
			setDetail(fresh);
			writeCachedSession(sessionId, fresh);
		});
	}, [sessionId]);

	const exercise = detail?.plannedSets[exerciseIndex];

	if (!detail || !exercise) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={onBack}>
					← Back
				</button>
				<p>Loading…</p>
			</main>
		);
	}

	const setIndexes = Array.from({ length: exercise.target_sets }, (_, i) => i + 1);
	const isBodyweight = exercise.loading === 'bodyweight';

	function handleLog(setIndex: number, weight: number, reps: number, rir: number) {
		const restTaken = rest ? Math.round((Date.now() - rest.startedAt) / 1000) : null;
		const updated = logSet(
			sessionId,
			{
				exercise_id: exercise!.exercise_id,
				set_index: setIndex,
				weight_kg: weight,
				reps,
				rir,
				rest_taken_seconds: restTaken,
				performed_on: todayIso(),
			},
			detail!,
		);
		setDetail(updated);
		setRest({ startedAt: Date.now(), seconds: exercise!.rest_seconds });
	}

	function afterSwap() {
		setSwapOpen(false);
		fetchSession(sessionId).then((fresh) => {
			setDetail(fresh);
			writeCachedSession(sessionId, fresh);
		});
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>

			<div class="exercise-nav">
				<button type="button" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((i) => i - 1)}>
					‹
				</button>
				<span>
					{exerciseIndex + 1} / {detail.plannedSets.length}
				</span>
				<button type="button" disabled={exerciseIndex === detail.plannedSets.length - 1} onClick={() => setExerciseIndex((i) => i + 1)}>
					›
				</button>
			</div>

			<h1>{exercise.exercise_name}</h1>
			<p class="exercise-target">
				{exercise.target_sets} × {exercise.rep_low}-{exercise.rep_high}
				{exercise.notes ? ` — ${exercise.notes}` : ''}
			</p>

			<button type="button" class="btn-secondary" onClick={() => setSwapOpen(true)}>
				Swap exercise
			</button>

			{rest && <RestTimer totalSeconds={rest.seconds} startedAt={rest.startedAt} onSkip={() => setRest(null)} />}

			{setIndexes.map((si) => (
				<SetRow
					key={si}
					setIndex={si}
					repLow={exercise.rep_low}
					repHigh={exercise.rep_high}
					incrementKg={exercise.increment_kg}
					isBodyweight={isBodyweight}
					defaultWeight={
						exercise.logged.find((l) => l.set_index === si)?.weight_kg ??
						exercise.lastWeek.find((l) => l.set_index === si)?.weight_kg ??
						exercise.target_weight_kg ??
						0
					}
					logged={exercise.logged.find((l) => l.set_index === si)}
					lastWeek={exercise.lastWeek.find((l) => l.set_index === si)}
					onLog={(weight, reps, rir) => handleLog(si, weight, reps, rir)}
				/>
			))}

			{swapOpen && <SwapSheet sessionId={sessionId} fromExerciseId={exercise.exercise_id} onClose={() => setSwapOpen(false)} onSwapped={afterSwap} />}
		</main>
	);
}
