import { useEffect, useState } from 'preact/hooks';
import type { Athlete, AthleteField, Race, Settings } from '../../types';
import { todayIso } from '../../dates';
import { fetchRaces, fetchSettings, updateSettings } from '../api';
import { formatDuration } from '../format';
import { autoColon, parsePace } from '../runFields';
import { FocusFields, SaveStatus, type GoalsPatch, type SaveState } from '../components/GoalsEditor';
import { Icon } from '../components/Icon';
import { RaceForm } from '../components/RaceForm';
import { RaceList } from '../components/RaceList';

type Editing = 'new' | Race | null;

const digits = (v: string) => v.replace(/\D/g, '');

/** How each watch number is typed and stored. Text in, a number (or null for
 * an empty box) out — junk like "185 bpm" is cleaned as it is typed, so it can
 * never reach the server as NaN. */
const WATCH_NUMBERS: { key: AthleteField; label: string; inputMode: 'numeric' | 'decimal'; clean: (v: string) => string; toText: (n: number) => string; toNumber: (v: string) => number | null }[] = [
	{ key: 'max_hr', label: 'Max HR (bpm)', inputMode: 'numeric', clean: digits, toText: String, toNumber: Number },
	{ key: 'resting_hr', label: 'Resting HR (bpm)', inputMode: 'numeric', clean: digits, toText: String, toNumber: Number },
	{ key: 'vo2max', label: 'VO2 max', inputMode: 'decimal', clean: (v) => v.replace(/[^\d.]/g, ''), toText: String, toNumber: Number },
	{ key: 'threshold_hr', label: 'Threshold HR (bpm)', inputMode: 'numeric', clean: digits, toText: String, toNumber: Number },
	{ key: 'threshold_pace_seconds_per_km', label: 'Threshold pace (/km)', inputMode: 'numeric', clean: autoColon, toText: formatDuration, toNumber: parsePace },
];

function WatchNumbers({ settings, onSave }: { settings: Settings; onSave: (patch: Partial<Athlete>) => void }) {
	const [text, setText] = useState<Record<string, string>>(() =>
		Object.fromEntries(WATCH_NUMBERS.map((f) => [f.key, settings[f.key] == null ? '' : f.toText(settings[f.key]!)])),
	);

	return (
		<section class="card">
			<h2 class="section-heading">From your watch</h2>
			<div class="goals-hr">
				{WATCH_NUMBERS.map((f) => (
					<label class="field" key={f.key}>
						{f.label}
						<input
							type="text"
							inputMode={f.inputMode}
							value={text[f.key]}
							onInput={(e) => setText({ ...text, [f.key]: f.clean((e.target as HTMLInputElement).value) })}
							onBlur={() => {
								const value = text[f.key] === '' ? null : f.toNumber(text[f.key]);
								// Unreadable (a lone "." or half a pace): leave what was saved alone.
								if (value === null ? text[f.key] === '' : Number.isFinite(value)) onSave({ [f.key]: value });
							}}
						/>
					</label>
				))}
			</div>
			<p class="hint">All optional. Garmin shows VO2 max and lactate threshold under Performance Stats — update them when they change.</p>
		</section>
	);
}

/** The one place he says what he is training for: races, focus, heart rate.
 * Everything saves as it goes, apart from the race form's own button. */
export function Goals() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [races, setRaces] = useState<Race[] | null>(null);
	const [editing, setEditing] = useState<Editing>(null);
	const [saveState, setSaveState] = useState<SaveState>('idle');
	const [loadError, setLoadError] = useState(false);
	const [retryToken, setRetryToken] = useState(0);

	const loadRaces = () =>
		fetchRaces()
			.then(setRaces)
			.catch(() => setLoadError(true));

	useEffect(() => {
		setLoadError(false);
		fetchSettings()
			.then(setSettings)
			.catch(() => setLoadError(true));
		loadRaces();
	}, [retryToken]);

	async function save(patch: GoalsPatch | Partial<Athlete>) {
		setSaveState('saving');
		try {
			await updateSettings(patch);
			setSaveState('saved');
		} catch {
			setSaveState('error');
		}
	}

	function formDone() {
		setEditing(null);
		loadRaces();
	}

	// While adding or editing, the form is the whole screen: below a long list it would be off screen.
	if (editing)
		return (
			<main class="screen goals-screen">
				<h1>{editing === 'new' ? 'Add a race' : 'Edit race'}</h1>
				<RaceForm key={editing === 'new' ? 'new' : editing.id} race={editing === 'new' ? undefined : editing} onDone={formDone} />
			</main>
		);

	return (
		<main class="screen goals-screen">
			<button type="button" class="back-btn" onClick={() => history.back()}>
				<Icon name="chevron-left" />
				Back
			</button>
			<h1>Goals</h1>
			<SaveStatus state={saveState} />

			{loadError && (
				<div role="alert">
					<p class="run-field-error">Could not load your goals.</p>
					<button type="button" class="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
						Retry
					</button>
				</div>
			)}

			<section class="card">
				<h2 class="section-heading">Races</h2>
				{races && <RaceList races={races} today={todayIso()} onSelect={setEditing} />}
				<button type="button" class="btn-secondary race-add" onClick={() => setEditing('new')}>
					Add a race
				</button>
			</section>

			{settings && (
				<>
					<section class="card goals-card">
						<h2 class="section-heading">Focus</h2>
						<FocusFields settings={settings} save={save} />
					</section>
					<WatchNumbers settings={settings} onSave={save} />
				</>
			)}
		</main>
	);
}
