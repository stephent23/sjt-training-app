import { useState } from 'preact/hooks';
import type { PlannedSetDetail } from '../../types';
import { logSet, setExerciseStatus } from '../api';
import { ExerciseCard } from '../components/ExerciseCard';
import { RestTimer } from '../components/RestTimer';
import { SwapSheet } from '../components/SwapSheet';
import { todayIso } from '../../dates';
import { useSession } from '../useSession';

interface LiftSessionProps {
	sessionId: number;
	onBack: () => void;
}

export function LiftSession({ sessionId, onBack }: LiftSessionProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [rest, setRest] = useState<{ startedAt: number; seconds: number; plannedSetId: number } | null>(null);
	const [swapFor, setSwapFor] = useState<{ plannedSetId: number; exerciseId: number } | null>(null);

	if (!detail) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={onBack}>
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

	function handleLog(exercise: PlannedSetDetail, setIndex: number, weight: number, reps: number, rir: number) {
		const restTaken = rest ? Math.round((Date.now() - rest.startedAt) / 1000) : null;
		const updated = logSet(
			sessionId,
			{
				exercise_id: exercise.exercise_id,
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

		const partner =
			exercise.superset_group == null ? null : updated.plannedSets.find((p) => p.id !== exercise.id && p.superset_group === exercise.superset_group);
		if (partner) {
			const partnerLoggedThisRound = partner.logged.some((l) => l.set_index === setIndex);
			if (!partnerLoggedThisRound) {
				setRest(null);
				setExpandedId(partner.id);
				return;
			}
			setRest({ startedAt: Date.now(), seconds: Math.max(exercise.rest_seconds, partner.rest_seconds), plannedSetId: exercise.id });
			return;
		}

		setRest({ startedAt: Date.now(), seconds: exercise.rest_seconds, plannedSetId: exercise.id });
	}

	function handleSkipToggle(exercise: PlannedSetDetail) {
		setDetail(setExerciseStatus(sessionId, exercise.id, exercise.status === 'skipped' ? 'planned' : 'skipped', detail!));
	}

	function afterSwap() {
		setSwapFor(null);
		reload();
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>

			{error && <p class="eyebrow">{error}</p>}

			{detail.plannedSets.map((exercise) => (
				<ExerciseCard
					key={exercise.id}
					exercise={exercise}
					expanded={expandedId === exercise.id}
					onToggle={() => setExpandedId((id) => (id === exercise.id ? null : exercise.id))}
					onLog={(si, w, r, rir) => handleLog(exercise, si, w, r, rir)}
					onSwap={() => setSwapFor({ plannedSetId: exercise.id, exerciseId: exercise.exercise_id })}
					onSkipToggle={() => handleSkipToggle(exercise)}
					restNode={
						rest && rest.plannedSetId === exercise.id ? <RestTimer totalSeconds={rest.seconds} startedAt={rest.startedAt} onSkip={() => setRest(null)} /> : null
					}
				/>
			))}

			{swapFor && (
				<SwapSheet
					sessionId={sessionId}
					fromExerciseId={swapFor.exerciseId}
					plannedSetId={swapFor.plannedSetId}
					onClose={() => setSwapFor(null)}
					onSwapped={afterSwap}
				/>
			)}
		</main>
	);
}
