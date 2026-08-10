import { useMemo, useState } from 'preact/hooks';
import type { PlannedSetDetail, SessionDetail } from '../../types';
import { logSet, setExerciseStatus, setSessionStatus } from '../api';
import { ExerciseCard } from '../components/ExerciseCard';
import { RestTimer } from '../components/RestTimer';
import { SessionScreenFallback } from '../components/SessionScreenFallback';
import { SwapSheet } from '../components/SwapSheet';
import { todayIso } from '../../dates';
import { isSessionComplete, sessionSetTotals } from '../../sessionProgress';
import { groupPlannedSets, restAfterRound, type ExerciseGroup } from '../../supersets';
import { useSession } from '../useSession';

interface LiftSessionProps {
	sessionId: number;
	onBack: () => void;
}

export function LiftSession({ sessionId, onBack }: LiftSessionProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);

	if (!detail) return <SessionScreenFallback error={error} onBack={onBack} onRetry={reload} />;

	return <LoadedLiftSession sessionId={sessionId} detail={detail} error={error} setDetail={setDetail} reload={reload} onBack={onBack} />;
}

interface LoadedLiftSessionProps {
	sessionId: number;
	detail: SessionDetail;
	error: string | null;
	setDetail: (detail: SessionDetail) => void;
	reload: () => void;
	onBack: () => void;
}

// Split out from LiftSession purely so `detail` is non-null by type rather
// than by a `detail!` assertion in every handler — the parent's early return
// proves it's loaded, but that narrowing doesn't survive into the callbacks
// closed over below.
function LoadedLiftSession({ sessionId, detail, error, setDetail, reload, onBack }: LoadedLiftSessionProps) {
	// Keyed on group.key ('sg-<n>' / 'ps-<id>'), which survives logSet's
	// optimistic rebuild, a skip toggle, and a swap — POST /api/swaps changes
	// exercise_id only, never planned_sets.id or superset_group — so the card
	// you're working in stays open throughout.
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const [rest, setRest] = useState<{ startedAt: number; seconds: number; groupKey: string; roundIndex: number } | null>(null);
	const [swapFor, setSwapFor] = useState<{ plannedSetId: number; exerciseId: number; pattern: string } | null>(null);

	const groups = useMemo(() => groupPlannedSets(detail.plannedSets), [detail.plannedSets]);
	const totals = sessionSetTotals(detail.plannedSets);
	const ready = isSessionComplete(detail.plannedSets);

	function handleLog(group: ExerciseGroup, exercise: PlannedSetDetail, setIndex: number, weight: number, reps: number, rir: number) {
		// Only attribute rest when a timer was actually running. Between
		// superset members there isn't one, so those sets record null — which
		// matters beyond cosmetics: progressExercise compares
		// rest_taken_seconds against the FULL prescribed rest, so writing a
		// short intra-round value would trip restWasShort and hold weight back
		// on every superset, forever.
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
			detail,
		);
		setDetail(updated);

		// Recompute from `updated` — the `group` closed over here still holds
		// pre-log `logged` arrays, so asking it whether the round is finished
		// would always say no.
		const next = groupPlannedSets(updated.plannedSets).find((g) => g.key === group.key);
		const seconds = next ? restAfterRound(next, setIndex) : null;
		setRest(seconds === null ? null : { startedAt: Date.now(), seconds, groupKey: group.key, roundIndex: setIndex });
	}

	function handleSkipToggle(exercise: PlannedSetDetail) {
		setDetail(setExerciseStatus(sessionId, exercise.id, exercise.status === 'skipped' ? 'planned' : 'skipped', detail));
	}

	function afterSwap() {
		setSwapFor(null);
		reload();
	}

	function finish(status: 'completed' | 'skipped') {
		setSessionStatus(sessionId, status);
		// setSessionStatus deliberately doesn't touch the cache, so this is what
		// persists the optimistic status — and what stops Today routing this
		// session straight back into #/lift/:id.
		setDetail({ ...detail, session: { ...detail.session, status } });
		location.hash = '#/';
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>

			{error && <p class="eyebrow">{error}</p>}

			{/* Near the top on purpose: without it the finish button's promotion
			    to primary happens far below the fold and is never seen. */}
			<p class="exercise-target">
				{totals.logged} of {totals.target} sets logged
			</p>

			{groups.map((group) => (
				<ExerciseCard
					key={group.key}
					group={group}
					expanded={expandedKey === group.key}
					onToggle={() => setExpandedKey((key) => (key === group.key ? null : group.key))}
					onLog={(exercise, si, w, r, rir) => handleLog(group, exercise, si, w, r, rir)}
					onSwap={(exercise) => setSwapFor({ plannedSetId: exercise.id, exerciseId: exercise.exercise_id, pattern: exercise.pattern })}
					onSkipToggle={handleSkipToggle}
					restAfterRoundIndex={rest && rest.groupKey === group.key ? rest.roundIndex : null}
					restNode={
						rest && rest.groupKey === group.key ? <RestTimer totalSeconds={rest.seconds} startedAt={rest.startedAt} onSkip={() => setRest(null)} /> : null
					}
				/>
			))}

			{/* `ready` drives prominence only, never disabled — finishing early
			    stays possible, and completion is never automatic. */}
			<button
				type="button"
				class={ready ? 'btn-primary' : 'btn-secondary'}
				disabled={detail.session.status === 'completed'}
				onClick={() => finish('completed')}
			>
				{detail.session.status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
			<button type="button" class="btn-secondary" disabled={detail.session.status === 'skipped'} onClick={() => finish('skipped')}>
				{detail.session.status === 'skipped' ? 'Skipped' : 'Mark skipped'}
			</button>

			{swapFor && (
				<SwapSheet
					sessionId={sessionId}
					fromExerciseId={swapFor.exerciseId}
					fromPattern={swapFor.pattern}
					plannedSetId={swapFor.plannedSetId}
					excludeExerciseIds={detail.plannedSets.filter((ps) => ps.id !== swapFor.plannedSetId).map((ps) => ps.exercise_id)}
					onClose={() => setSwapFor(null)}
					onSwapped={afterSwap}
				/>
			)}
		</main>
	);
}
