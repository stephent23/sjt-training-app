import type { ComponentChildren } from 'preact';
import type { PlannedSetDetail } from '../../types';
import { resolveSetDefaults } from '../../setDefaults';
import { SetRow } from './SetRow';

interface ExerciseCardProps {
	exercise: PlannedSetDetail;
	expanded: boolean;
	onToggle: () => void;
	onLog: (setIndex: number, weight: number, reps: number, rir: number) => void;
	onSwap: () => void;
	onSkipToggle: () => void;
	restNode: ComponentChildren;
}

function progressLabel(exercise: PlannedSetDetail): string {
	if (exercise.status === 'skipped') return 'Skipped';
	const logged = exercise.logged.length;
	if (logged === 0) return `${exercise.target_sets} sets`;
	if (logged >= exercise.target_sets) return 'Done';
	return `${logged} of ${exercise.target_sets} logged`;
}

export function ExerciseCard({ exercise, expanded, onToggle, onLog, onSwap, onSkipToggle, restNode }: ExerciseCardProps) {
	const setIndexes = Array.from({ length: exercise.target_sets }, (_, i) => i + 1);
	const isBodyweight = exercise.loading === 'bodyweight';
	const skipped = exercise.status === 'skipped';

	return (
		<div
			class={`row plan-row exercise-card ${skipped ? 'exercise-card--skipped' : ''} ${expanded ? 'exercise-card--expanded' : ''} ${exercise.superset_group != null ? 'exercise-card--superset' : ''}`}
		>
			<button type="button" class="plan-row exercise-card-summary" aria-expanded={expanded} onClick={onToggle}>
				<div class="plan-row-main">
					{exercise.superset_group != null && <span class="eyebrow eyebrow--accent">Superset</span>}
					<span class="eyebrow">
						{exercise.target_sets} × {exercise.rep_low}-{exercise.rep_high}
					</span>
					<span class="plan-row-title">{exercise.exercise_name}</span>
					<span class="plan-row-meta">{progressLabel(exercise)}</span>
				</div>
				<span class="plan-row-chevron">{expanded ? '⌄' : '›'}</span>
			</button>

			{/* Collapsing this card unmounts SetRow, discarding any typed-but-not-
			    logged draft for whichever set is mid-edit. Accepted tradeoff —
			    revisit only if this costs real work in the gym. */}
			{expanded && (
				<div class="exercise-card-body">
					{exercise.notes && <p class="exercise-target">{exercise.notes}</p>}

					<div class="exercise-card-actions">
						<button type="button" class="btn-secondary" onClick={onSwap}>
							Swap exercise
						</button>
						<button type="button" class="btn-secondary" onClick={onSkipToggle}>
							{skipped ? 'Unskip' : 'Skip exercise'}
						</button>
					</div>

					{restNode}

					{!skipped &&
						setIndexes.map((si) => {
							const defaults = resolveSetDefaults(exercise, si);
							return (
								<SetRow
									key={`${exercise.exercise_id}-${si}`}
									setIndex={si}
									repLow={exercise.rep_low}
									repHigh={exercise.rep_high}
									incrementKg={exercise.increment_kg}
									isBodyweight={isBodyweight}
									defaultWeight={defaults.weight_kg}
									defaultReps={defaults.reps}
									logged={exercise.logged.find((l) => l.set_index === si)}
									lastWeek={exercise.lastWeek.find((l) => l.set_index === si)}
									onLog={(weight, reps, rir) => onLog(si, weight, reps, rir)}
								/>
							);
						})}
				</div>
			)}
		</div>
	);
}
