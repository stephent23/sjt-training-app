import { useEffect, useRef, useState } from 'preact/hooks';
import type { SwapCandidate, SwapReason, SwapScope } from '../../types';
import { applySwap, fetchSwapCandidates } from '../api';

interface SwapSheetProps {
	sessionId: number;
	fromExerciseId: number;
	plannedSetId: number;
	/** Exercise ids already used by OTHER planned sets in this session. They're
	 *  filtered out of the candidate list: two planned_sets rows sharing an
	 *  exercise_id would share one `logged` array (logSet and loadSessionDetail
	 *  both key on exercise_id), and logged_sets' unique index on
	 *  (session_id, exercise_id, set_index) would make their sets overwrite
	 *  each other. Most reachable inside a superset, where the members usually
	 *  share a movement pattern and so appear in each other's candidate list. */
	excludeExerciseIds: number[];
	onClose: () => void;
	onSwapped: () => void;
}

const REASONS: { value: SwapReason; label: string }[] = [
	{ value: 'equipment_busy', label: "Equipment's busy" },
	{ value: 'pain', label: 'Pain' },
	{ value: 'preference', label: "Don't like it" },
	{ value: 'unavailable', label: "Doesn't exist here" },
];

export function SwapSheet({ sessionId, fromExerciseId, plannedSetId, excludeExerciseIds, onClose, onSwapped }: SwapSheetProps) {
	const [reason, setReason] = useState<SwapReason | null>(null);
	const [painType, setPainType] = useState<'shoulder' | 'back' | null>(null);
	const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
	const [chosen, setChosen] = useState<number | null>(null);
	const [scope, setScope] = useState<SwapScope>('this_session');
	const [confirming, setConfirming] = useState(false);
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const previouslyFocused = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

	useEffect(() => {
		if (!reason) return;
		if (reason === 'pain' && !painType) return;
		fetchSwapCandidates(fromExerciseId, reason === 'pain' ? painType : null).then((found) =>
			setCandidates(found.filter((c) => !excludeExerciseIds.includes(c.id))),
		);
	}, [reason, painType, fromExerciseId, excludeExerciseIds.join(',')]);

	useEffect(() => {
		sheetRef.current?.focus();
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			previouslyFocused.current?.focus();
		};
	}, []);

	async function confirm() {
		if (!reason || chosen === null) return;
		setConfirming(true);
		try {
			await applySwap({ session_id: sessionId, planned_set_id: plannedSetId, from_exercise_id: fromExerciseId, to_exercise_id: chosen, reason, scope });
			onSwapped();
		} finally {
			setConfirming(false);
		}
	}

	return (
		<div class="sheet-backdrop" onClick={onClose}>
			<div
				class="sheet"
				role="dialog"
				aria-modal="true"
				aria-labelledby="swap-sheet-title"
				tabIndex={-1}
				ref={sheetRef}
				onClick={(e) => e.stopPropagation()}
			>
				<h2 id="swap-sheet-title">Swap exercise</h2>

				{!reason && (
					<div class="tap-row tap-row--stacked" role="group" aria-label="Reason">
						{REASONS.map((r) => (
							<button type="button" key={r.value} class="tap-btn" onClick={() => setReason(r.value)}>
								{r.label}
							</button>
						))}
					</div>
				)}

				{reason === 'pain' && !painType && (
					<div class="tap-row tap-row--stacked" role="group" aria-label="Where">
						<button type="button" class="tap-btn" onClick={() => setPainType('shoulder')}>
							Shoulder
						</button>
						<button type="button" class="tap-btn" onClick={() => setPainType('back')}>
							Back
						</button>
					</div>
				)}

				{reason && (reason !== 'pain' || painType) && (
					<>
						<div class="tap-row tap-row--stacked" role="group" aria-label="Alternatives">
							{candidates.length === 0 && <p>No alternatives found for this pattern.</p>}
							{candidates.map((c) => (
								<button type="button" key={c.id} class={`tap-btn ${chosen === c.id ? 'tap-btn--selected' : ''}`} onClick={() => setChosen(c.id)}>
									{c.name}
									{c.hasHistory ? ' · logged before' : ''}
								</button>
							))}
						</div>

						<div class="tap-row" role="group" aria-label="Scope">
							<button type="button" class={`tap-btn ${scope === 'this_session' ? 'tap-btn--selected' : ''}`} onClick={() => setScope('this_session')}>
								Just today
							</button>
							<button type="button" class={`tap-btn ${scope === 'permanent' ? 'tap-btn--selected' : ''}`} onClick={() => setScope('permanent')}>
								From now on
							</button>
						</div>

						<button type="button" class="btn-primary" disabled={chosen === null || confirming} onClick={confirm}>
							Confirm swap
						</button>
					</>
				)}

				<button type="button" class="btn-secondary" onClick={onClose}>
					Cancel
				</button>
			</div>
		</div>
	);
}
