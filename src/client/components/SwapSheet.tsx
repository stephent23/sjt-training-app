import { useEffect, useRef, useState } from 'preact/hooks';
import type { Modality, SwapCandidate, SwapReason, SwapScope } from '../../types';
import { applySwap, createExercise, fetchSwapCandidates } from '../api';

interface SwapSheetProps {
	sessionId: number;
	fromExerciseId: number;
	/** Movement pattern of the exercise being replaced. Needed to add a new one,
	 * and it can't be read off the candidate list — the case where adding
	 * matters most is the one where that list came back empty. */
	fromPattern: string;
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

const MODALITIES: { value: Modality; label: string }[] = [
	{ value: 'dumbbell', label: 'Dumbbell' },
	{ value: 'machine', label: 'Machine' },
	{ value: 'cable', label: 'Cable' },
	{ value: 'bodyweight', label: 'Bodyweight' },
];

export function SwapSheet({ sessionId, fromExerciseId, fromPattern, plannedSetId, excludeExerciseIds, onClose, onSwapped }: SwapSheetProps) {
	const [reason, setReason] = useState<SwapReason | null>(null);
	const [painType, setPainType] = useState<'shoulder' | 'back' | null>(null);
	const [candidates, setCandidates] = useState<SwapCandidate[] | null>(null);
	const [chosen, setChosen] = useState<number | null>(null);
	const [scope, setScope] = useState<SwapScope>('this_session');
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [newExercise, setNewExercise] = useState({ name: '', modality: 'dumbbell' as Modality, increment_kg: '2' });
	const sheetRef = useRef<HTMLDivElement | null>(null);
	const previouslyFocused = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

	// null means "not asked yet" and [] means "asked, nothing came back" — with
	// one array for both, the empty state flashed "No alternatives found"
	// during every round trip.
	useEffect(() => {
		if (!reason) return;
		if (reason === 'pain' && !painType) return;
		let cancelled = false;
		setCandidates(null);
		setError(null);
		fetchSwapCandidates(fromExerciseId, reason === 'pain' ? painType : null)
			.then((found) => {
				if (cancelled) return;
				setCandidates(found.filter((c) => !excludeExerciseIds.includes(c.id)));
			})
			.catch(() => {
				if (cancelled) return;
				setCandidates([]);
				setError('Could not load alternatives — try again.');
			});
		return () => {
			cancelled = true;
		};
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

	/** Back to the reason picker. Changing your mind used to mean closing the
	 * sheet and starting over. */
	function startOver() {
		setReason(null);
		setPainType(null);
		setCandidates(null);
		setChosen(null);
		setError(null);
		setAdding(false);
	}

	async function confirm() {
		if (!reason || chosen === null) return;
		setConfirming(true);
		setError(null);
		try {
			await applySwap({ session_id: sessionId, planned_set_id: plannedSetId, from_exercise_id: fromExerciseId, to_exercise_id: chosen, reason, scope });
			onSwapped();
		} catch (e) {
			// A 409 (the substitute is already in this session) used to show the
			// person nothing at all — the sheet just sat there.
			setError(e instanceof Error ? e.message : 'Could not swap — try again.');
		} finally {
			setConfirming(false);
		}
	}

	async function addExercise() {
		setError(null);
		try {
			// Same movement pattern as the exercise being replaced — the only
			// pattern that could be a swap for it anyway.
			const created = await createExercise({
				name: newExercise.name,
				pattern: fromPattern,
				increment_kg: Number(newExercise.increment_kg),
				modality: newExercise.modality,
			});
			setCandidates((current) => [...(current ?? []), { ...created, hasHistory: false }]);
			setChosen(created.id);
			setAdding(false);
			setNewExercise({ name: '', modality: 'dumbbell', increment_kg: '2' });
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not add that exercise.');
		}
	}

	const picking = reason !== null && (reason !== 'pain' || painType !== null);

	return (
		<div class="sheet-backdrop" onClick={onClose}>
			<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="swap-sheet-title" tabIndex={-1} ref={sheetRef} onClick={(e) => e.stopPropagation()}>
				<h2 id="swap-sheet-title">Swap exercise</h2>

				{error && <p class="eyebrow eyebrow--accent">{error}</p>}

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

				{picking && (
					<>
						{candidates === null ? (
							<p>Finding alternatives…</p>
						) : (
							<div class="tap-row tap-row--stacked" role="group" aria-label="Alternatives">
								{candidates.length === 0 && <p>Nothing else here works this movement.</p>}
								{candidates.map((c) => (
									<button type="button" key={c.id} class={`tap-btn ${chosen === c.id ? 'tap-btn--selected' : ''}`} onClick={() => setChosen(c.id)}>
										{c.name}
										{c.hasHistory ? ' · logged before' : ''}
									</button>
								))}
							</div>
						)}

						{/* The escape hatch for an exercise the catalogue has never heard
						    of — previously you had to abandon the swap entirely. */}
						{candidates !== null &&
							(adding ? (
								<div class="field">
									<label class="field">
										New exercise
										<input
											type="text"
											placeholder="Hack squat"
											value={newExercise.name}
											onInput={(e) => setNewExercise({ ...newExercise, name: (e.target as HTMLInputElement).value })}
										/>
									</label>
									<div class="tap-row" role="group" aria-label="Equipment">
										{MODALITIES.map((m) => (
											<button
												type="button"
												key={m.value}
												class={`tap-btn ${newExercise.modality === m.value ? 'tap-btn--selected' : ''}`}
												aria-pressed={newExercise.modality === m.value}
												onClick={() => setNewExercise({ ...newExercise, modality: m.value })}
											>
												{m.label}
											</button>
										))}
									</div>
									<label class="field">
										Smallest weight step (kg)
										<input
											type="number"
											inputmode="decimal"
											value={newExercise.increment_kg}
											onInput={(e) => setNewExercise({ ...newExercise, increment_kg: (e.target as HTMLInputElement).value })}
										/>
									</label>
									<button type="button" class="btn-secondary" onClick={addExercise} disabled={newExercise.name.trim() === ''}>
										Add it
									</button>
								</div>
							) : (
								<button type="button" class="btn-secondary btn-small" onClick={() => setAdding(true)}>
									Add an exercise that isn't listed
								</button>
							))}

						<div class="tap-row" role="group" aria-label="Scope">
							<button type="button" class={`tap-btn ${scope === 'this_session' ? 'tap-btn--selected' : ''}`} onClick={() => setScope('this_session')}>
								Just today
							</button>
							<button type="button" class={`tap-btn ${scope === 'permanent' ? 'tap-btn--selected' : ''}`} onClick={() => setScope('permanent')}>
								From now on
							</button>
						</div>

						<button type="button" class="btn-primary" disabled={chosen === null || confirming} onClick={confirm}>
							{confirming ? 'Swapping…' : 'Confirm swap'}
						</button>
						<button type="button" class="btn-secondary" onClick={startOver}>
							← Different reason
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
