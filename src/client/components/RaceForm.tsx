import { useEffect, useRef, useState } from 'preact/hooks';
import { RACE_DISTANCES, type Race, type RaceInput } from '../../types';
import { todayIso } from '../../dates';
import { createRace, deleteRace, updateRace } from '../api';
import { formatDuration, formatPace } from '../format';
import { parseDuration } from '../runFields';
import { DurationInput } from './DurationInput';

interface RaceFormProps {
	/** Present when editing; absent when adding. */
	race?: Race;
	onDone: () => void;
}

const OTHER = 'other';

function initialDistance(race?: Race): string {
	if (!race) return String(RACE_DISTANCES[2].km);
	return RACE_DISTANCES.some((d) => d.km === race.distance_km) ? String(race.distance_km) : OTHER;
}

/** One form for a race, past or future. The single time field means "Target
 * time" for a date still to come and "Result" for one that has gone, so the
 * label follows the date rather than there being two forms. */
export function RaceForm({ race, onDone }: RaceFormProps) {
	const [name, setName] = useState(race?.name ?? '');
	const [distance, setDistance] = useState(initialDistance(race));
	const [otherKm, setOtherKm] = useState(race && initialDistance(race) === OTHER ? String(race.distance_km) : '');
	const [date, setDate] = useState(race?.date ?? '');
	// A target is never carried into the result: a race that has already happened starts with an empty time.
	const startsPast = !!race && race.date <= todayIso();
	const existingTime = race ? (race.result_seconds ?? (startsPast ? null : race.target_seconds)) : null;
	const [time, setTime] = useState(existingTime ? formatDuration(existingTime) : '');
	const nameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameRef.current?.scrollIntoView?.({ block: 'start' });
		nameRef.current?.focus?.();
	}, []);
	const [priority, setPriority] = useState<'A' | 'B'>(race?.priority ?? 'A');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const isPast = date !== '' && date <= todayIso();
	const km = distance === OTHER ? Number(otherKm) : Number(distance);
	const seconds = parseDuration(time);
	const pace = seconds && km > 0 ? formatPace(km, seconds) : null;

	// Moving the date across today must not turn a target into a result (or the reverse).
	function changeDate(next: string) {
		const nowPast = next !== '' && next <= todayIso();
		if (!isPast && nowPast && !race?.result_seconds) setTime('');
		else if (isPast && next !== '' && !nowPast && time === '' && race?.target_seconds) setTime(formatDuration(race.target_seconds));
		setDate(next);
	}

	async function save() {
		if (!name.trim()) return setError('Give the race a name.');
		if (!date) return setError('Pick the date.');
		if (!(km > 0)) return setError('Enter the distance in km.');
		if (time.trim() !== '' && !seconds) return setError('Time should look like 1:45:00.');

		const input: RaceInput = {
			name: name.trim(),
			date,
			distance_km: km,
			target_seconds: isPast ? (race?.target_seconds ?? null) : seconds,
			result_seconds: isPast ? seconds : null,
			priority,
		};
		setBusy(true);
		setError('');
		try {
			if (race) await updateRace(race.id, input);
			else await createRace(input);
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not save this race.');
			setBusy(false);
		}
	}

	async function remove() {
		if (!race) return;
		setBusy(true);
		try {
			await deleteRace(race.id);
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Could not delete this race.');
			setBusy(false);
		}
	}

	return (
		<div class="race-form">
			<label class="field">
				Name
				<input ref={nameRef} type="text" value={name} placeholder="Brighton Half" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
			</label>

			<div class="field">
				<span>Distance</span>
				<div class="tap-row" role="group" aria-label="Distance">
					{RACE_DISTANCES.map((d) => (
						<button
							type="button"
							key={d.label}
							class={`tap-btn ${distance === String(d.km) ? 'tap-btn--selected' : ''}`}
							aria-pressed={distance === String(d.km)}
							onClick={() => setDistance(String(d.km))}
						>
							{d.label}
						</button>
					))}
					<button
						type="button"
						class={`tap-btn ${distance === OTHER ? 'tap-btn--selected' : ''}`}
						aria-pressed={distance === OTHER}
						onClick={() => setDistance(OTHER)}
					>
						Other
					</button>
				</div>
				{distance === OTHER && (
					<label class="field">
						Distance (km)
						<input type="text" inputMode="decimal" value={otherKm} onInput={(e) => setOtherKm((e.target as HTMLInputElement).value)} />
					</label>
				)}
			</div>

			<label class="field">
				Date
				<input type="date" value={date} onInput={(e) => changeDate((e.target as HTMLInputElement).value)} />
			</label>

			<DurationInput id="race-time" label={isPast ? 'Result' : 'Target time'} value={time} onInput={setTime} placeholder="h:mm:ss" />
			{pace && <p class="hint race-pace">{pace}</p>}

			<div class="field">
				<span>Priority</span>
				<div class="tap-row" role="group" aria-label="Priority">
					<button type="button" class={`tap-btn ${priority === 'A' ? 'tap-btn--selected' : ''}`} aria-pressed={priority === 'A'} onClick={() => setPriority('A')}>
						Main race
					</button>
					<button type="button" class={`tap-btn ${priority === 'B' ? 'tap-btn--selected' : ''}`} aria-pressed={priority === 'B'} onClick={() => setPriority('B')}>
						Tune-up
					</button>
				</div>
				<p class="hint">{priority === 'A' ? 'Peak and taper for it.' : 'Run it as training.'}</p>
			</div>

			{error && (
				<p class="run-field-error" role="alert">
					{error}
				</p>
			)}

			<button type="button" class="btn-primary" onClick={save} disabled={busy}>
				{busy ? 'Saving…' : race ? 'Save race' : 'Add race'}
			</button>
			<button type="button" class="btn-quiet" onClick={onDone} disabled={busy}>
				Cancel
			</button>

			{race &&
				(confirmingDelete ? (
					<div class="run-delete">
						<button type="button" class="btn-danger" onClick={remove} disabled={busy}>
							Yes, delete this race
						</button>
						<button type="button" class="btn-quiet" onClick={() => setConfirmingDelete(false)} disabled={busy}>
							Keep it
						</button>
					</div>
				) : (
					<button type="button" class="btn-quiet run-delete" onClick={() => setConfirmingDelete(true)}>
						Delete this race
					</button>
				))}
		</div>
	);
}
