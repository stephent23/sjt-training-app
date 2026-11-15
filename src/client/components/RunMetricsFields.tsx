import { INTERVAL_PACE_RUN_TYPES, RUN_METRIC_FIELDS, type RunType } from '../../types';
import { ranAsPlanned, runPreview, type RunFields } from '../runFields';
import { DurationInput } from './DurationInput';
import { RpeScale } from './RpeScale';
import { RunField } from './RunField';

export interface PlannedTarget {
	target_km: number | null;
	target_minutes: number | null;
}

export interface RunMetricsFieldsProps {
	fields: RunFields;
	onChange: (next: RunFields) => void;
	/** Fires on blur/change (and straight away for a tap on the RPE scale) with
	 * the latest fields — keystroke-safe: Review passes this so a partial value
	 * never gets committed mid-type. RunEditor omits it: it saves via an
	 * explicit Save button instead, so committing per-field would do nothing
	 * useful. */
	onCommit?: (next: RunFields) => void;
	/** Interval pace only makes sense for a run with a work segment to average
	 * it over — hidden entirely (not just optional) for easy/long runs. Absent
	 * (e.g. before a run type has been chosen) hides it too. */
	runType?: RunType | null;
	/** The plan this run answers, if any: offers the one-tap "Ran as planned"
	 * while the distance and time are still empty. */
	planned?: PlannedTarget | null;
	/** Field-level messages, keyed like RunFields (see parseRunFields). */
	errors?: Record<string, string>;
}

// Units live inside the field, so labels stay short and the box says what to type.
const SUFFIX: Record<string, string> = { avg_hr: 'bpm', max_hr: 'bpm', avg_cadence_spm: 'spm', elevation_gain_m: 'm' };
const WATCH_FIELDS = RUN_METRIC_FIELDS.filter((f) => f.key !== 'rpe_1_10');

/** The distance/time/pace + effort + "from your watch" + note block shared by
 * Review's inline run editor and the standalone RunEditor screen. */
export function RunMetricsFields({ fields, onChange, onCommit, runType, planned, errors = {} }: RunMetricsFieldsProps) {
	const commit = () => onCommit?.(fields);
	const preview = runPreview(fields);
	const byPace = fields.durationBy === 'pace';
	const showIntervalPace = runType != null && INTERVAL_PACE_RUN_TYPES.includes(runType);

	const set = (key: string) => (value: string) => onChange({ ...fields, [key]: value });

	const offerPlanned =
		planned != null &&
		Boolean(planned.target_km || planned.target_minutes) &&
		fields.distance.trim() === '' &&
		fields.duration.trim() === '' &&
		fields.pace.trim() === '';

	function handleRanAsPlanned() {
		if (!planned) return;
		const next = ranAsPlanned(fields, planned);
		onChange(next);
		// Distance is what the plan gave; the number still to read off the watch is the time.
		const target = next.distance.trim() !== '' && next.duration.trim() === '' ? 'run-duration' : 'run-distance';
		setTimeout(() => document.getElementById(target)?.focus(), 0);
	}

	return (
		<div class="run-form">
			{offerPlanned && planned && (
				<button type="button" class="btn-secondary run-planned" onClick={handleRanAsPlanned}>
					Ran as planned
					<span class="run-planned-detail">
						{planned.target_km ? `${planned.target_km} km` : `${planned.target_minutes} min`}
					</span>
				</button>
			)}

			<p class="run-summary" aria-live="polite">
				{preview.summary || 'Enter distance and time'}
			</p>

			<div class="run-grid">
				<RunField
					id="run-distance"
					label="Distance"
					suffix="km"
					value={fields.distance}
					onInput={set('distance')}
					onCommit={commit}
					error={errors.distance}
				/>
				<DurationInput
					id="run-duration"
					label="Duration"
					placeholder="28:40"
					value={byPace ? preview.duration : fields.duration}
					onInput={(value) => onChange({ ...fields, duration: value, durationBy: 'duration' })}
					onCommit={commit}
					derived={byPace && preview.duration !== ''}
					error={errors.duration}
				/>
				<DurationInput
					id="run-pace"
					label="Avg pace"
					placeholder="5:30"
					suffix="/km"
					value={byPace ? fields.pace : preview.pace}
					onInput={(value) => onChange({ ...fields, pace: value, durationBy: 'pace' })}
					onCommit={commit}
					derived={!byPace && preview.pace !== ''}
					error={errors.pace}
				/>
				{/* Garmin's second pace figure for an interval/tempo run — the
				    average during the work segments only, distinct from the
				    overall pace beside it. Can't be derived like overall pace can,
				    since interval-level distance/duration aren't captured — see
				    the doc comment on LoggedRunEntry. */}
				{showIntervalPace && (
					<DurationInput
						id="run-interval-pace"
						label="Interval pace"
						placeholder="4:32"
						suffix="/km"
						value={fields.intervalPace}
						onInput={set('intervalPace')}
						onCommit={commit}
						error={errors.intervalPace}
					/>
				)}
			</div>

			<RpeScale
				value={fields.rpe_1_10}
				error={errors.rpe_1_10}
				onChange={(value) => {
					const next = { ...fields, rpe_1_10: value };
					onChange(next);
					onCommit?.(next);
				}}
			/>

			{/* Behind a disclosure so the everyday case stays a handful of fields.
			    Everything in here is typed off the watch face, and skipping any of
			    it is fine. */}
			<details class="disclosure" open={WATCH_FIELDS.some((f) => errors[f.key]) || undefined}>
				<summary class="disclosure-summary">From your watch</summary>
				<div class="disclosure-body run-grid">
					{WATCH_FIELDS.map((field) => (
						<RunField
							key={field.key}
							id={`run-${field.key}`}
							label={field.label.replace(/\s*\(.*\)$/, '')}
							suffix={SUFFIX[field.key]}
							inputMode={field.integer ? 'numeric' : 'decimal'}
							value={fields[field.key]}
							onInput={set(field.key)}
							onCommit={commit}
							error={errors[field.key]}
						/>
					))}
				</div>
			</details>

			<label class="field">
				How it went
				<textarea rows={2} value={fields.note} onInput={(e) => set('note')((e.target as HTMLTextAreaElement).value)} onBlur={commit} />
			</label>
		</div>
	);
}
