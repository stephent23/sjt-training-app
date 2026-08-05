import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { PlannedSetDetail } from '../../types';
import { resolveSetDefaults } from '../../setDefaults';
import { isExerciseLogged, loggedSetCount } from '../../sessionProgress';
import { buildRounds, isRoundComplete, type ExerciseGroup } from '../../supersets';
import { SetRow } from './SetRow';

interface ExerciseCardProps {
	group: ExerciseGroup;
	expanded: boolean;
	onToggle: () => void;
	onLog: (exercise: PlannedSetDetail, setIndex: number, weight: number, reps: number, rir: number) => void;
	onSwap: (exercise: PlannedSetDetail) => void;
	onSkipToggle: (exercise: PlannedSetDetail) => void;
	restNode: ComponentChildren;
	/** Render restNode after this round. Null puts it at the top of the body. */
	restAfterRoundIndex: number | null;
}

function soloProgressLabel(exercise: PlannedSetDetail): string {
	if (exercise.status === 'skipped') return 'Skipped';
	const logged = loggedSetCount(exercise);
	if (logged === 0) return `${exercise.target_sets} sets`;
	if (isExerciseLogged(exercise)) return 'Done';
	return `${logged} of ${exercise.target_sets} logged`;
}

function progressLabel(group: ExerciseGroup): string {
	if (!group.isSuperset) return soloProgressLabel(group.members[0]);

	// Only "Skipped" when there's nothing left to do at all — one skipped
	// member out of two still leaves a workout in front of you.
	if (group.members.every((m) => m.status === 'skipped')) return 'Skipped';

	const rounds = buildRounds(group);
	const firstIncomplete = rounds.findIndex((r) => !isRoundComplete(r));
	if (firstIncomplete === -1) return 'Done';
	if (firstIncomplete === 0) return `${group.rounds} rounds`;
	return `Round ${firstIncomplete + 1} of ${group.rounds}`;
}

export function ExerciseCard({ group, expanded, onToggle, onLog, onSwap, onSkipToggle, restNode, restAfterRoundIndex }: ExerciseCardProps) {
	// Which logged set is open for editing, by slotKey. Exactly ONE piece of
	// state for the whole card — never one per slot inside the rounds map,
	// because skipping a member mid-session changes how many slots exist and
	// therefore how many hooks would run. Collapsing the card unmounts this,
	// which is the reset we want.
	const [editingSlot, setEditingSlot] = useState<string | null>(null);

	const allSkipped = group.members.every((m) => m.status === 'skipped');
	const rounds = buildRounds(group);
	const notes = group.members.filter((m) => m.notes);

	function handleLog(exercise: PlannedSetDetail, setIndex: number, weight: number, reps: number, rir: number) {
		// Snap back to the working set after updating an old one.
		setEditingSlot(null);
		onLog(exercise, setIndex, weight, reps, rir);
	}

	return (
		<div
			class={`row exercise-card ${allSkipped ? 'exercise-card--skipped' : ''} ${expanded ? 'exercise-card--expanded' : ''} ${group.isSuperset ? 'exercise-card--superset' : ''}`}
		>
			<button type="button" class="plan-row exercise-card-summary" aria-expanded={expanded} onClick={onToggle}>
				<div class="plan-row-main">
					{group.isSuperset && <span class="eyebrow eyebrow--accent">Superset</span>}
					<span class="eyebrow">
						{group.isSuperset
							? `${group.rounds} rounds`
							: `${group.members[0].target_sets} × ${group.members[0].rep_low}-${group.members[0].rep_high}`}
					</span>
					{group.members.map((member) => (
						<span key={member.id} class="plan-row-title">
							{member.exercise_name}
						</span>
					))}
					<span class="plan-row-meta">{progressLabel(group)}</span>
				</div>
				<span class="plan-row-chevron">{expanded ? '⌄' : '›'}</span>
			</button>

			{/* Collapsing this card unmounts SetRow, discarding any typed-but-not-
			    logged draft for whichever set is mid-edit. Accepted tradeoff —
			    revisit only if this costs real work in the gym. */}
			{expanded && (
				<div class="exercise-card-body">
					{notes.map((member) => (
						<p key={member.id} class="exercise-target">
							{group.isSuperset ? `${member.exercise_name}: ${member.notes}` : member.notes}
						</p>
					))}

					{group.isSuperset ? (
						<div class="exercise-card-members">
							{group.members.map((member) => (
								<div key={member.id} class={`exercise-card-member ${member.status === 'skipped' ? 'exercise-card-member--skipped' : ''}`}>
									<span class="exercise-card-member-name">{member.exercise_name}</span>
									<button type="button" class="btn-secondary" onClick={() => onSwap(member)}>
										Swap
									</button>
									<button type="button" class="btn-secondary" onClick={() => onSkipToggle(member)}>
										{member.status === 'skipped' ? 'Unskip' : 'Skip'}
									</button>
								</div>
							))}
						</div>
					) : (
						<div class="exercise-card-actions">
							<button type="button" class="btn-secondary" onClick={() => onSwap(group.members[0])}>
								Swap exercise
							</button>
							<button type="button" class="btn-secondary" onClick={() => onSkipToggle(group.members[0])}>
								{group.members[0].status === 'skipped' ? 'Unskip' : 'Skip exercise'}
							</button>
						</div>
					)}

					{restAfterRoundIndex === null && restNode}

					{rounds.map((round) => (
						<div key={round.roundIndex} class="superset-round">
							{group.isSuperset && <p class="eyebrow superset-round-label">Round {round.roundIndex}</p>}

							{round.slots.map((slot) => {
								const defaults = resolveSetDefaults(slot.exercise, slot.setIndex);
								const logged = slot.exercise.logged.find((l) => l.set_index === slot.setIndex);
								return (
									<SetRow
										key={slot.slotKey}
										label={group.isSuperset ? slot.exercise.exercise_name : `Set ${slot.setIndex}`}
										repLow={slot.exercise.rep_low}
										repHigh={slot.exercise.rep_high}
										incrementKg={slot.exercise.increment_kg}
										isBodyweight={slot.exercise.loading === 'bodyweight'}
										defaultWeight={defaults.weight_kg}
										defaultReps={defaults.reps}
										logged={logged}
										lastWeek={slot.exercise.lastWeek.find((l) => l.set_index === slot.setIndex)}
										expanded={editingSlot === slot.slotKey}
										onToggleExpand={() => setEditingSlot((current) => (current === slot.slotKey ? null : slot.slotKey))}
										onLog={(weight, reps, rir) => handleLog(slot.exercise, slot.setIndex, weight, reps, rir)}
									/>
								);
							})}

							{restAfterRoundIndex === round.roundIndex && restNode}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
