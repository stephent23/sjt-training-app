import { useEffect, useState } from 'preact/hooks';
import type { Race, Settings } from '../../types';
import { todayIso } from '../../dates';
import { fetchRaces, fetchSettings, updateSettings } from '../api';
import { FocusFields, SaveStatus, type GoalsPatch, type SaveState } from '../components/GoalsEditor';
import { Icon } from '../components/Icon';
import { RaceForm } from '../components/RaceForm';
import { RaceList } from '../components/RaceList';

type Editing = 'new' | Race | null;

const digits = (v: string) => v.replace(/\D/g, '');

function HeartRate({ settings, onSave }: { settings: Settings; onSave: (patch: { max_hr?: number | null; resting_hr?: number | null }) => void }) {
	const [maxHr, setMaxHr] = useState(settings.max_hr == null ? '' : String(settings.max_hr));
	const [restingHr, setRestingHr] = useState(settings.resting_hr == null ? '' : String(settings.resting_hr));
	// Digits only, so junk like "185 bpm" can never become NaN; empty clears.
	const num = (v: string) => (v === '' ? null : Number(v));

	return (
		<section class="card">
			<h2 class="section-heading">Heart rate</h2>
			<div class="goals-hr">
				<label class="field">
					Max HR (bpm)
					<input type="text" inputMode="numeric" value={maxHr} onInput={(e) => setMaxHr(digits((e.target as HTMLInputElement).value))} onBlur={() => onSave({ max_hr: num(maxHr) })} />
				</label>
				<label class="field">
					Resting HR (bpm)
					<input type="text" inputMode="numeric" value={restingHr} onInput={(e) => setRestingHr(digits((e.target as HTMLInputElement).value))} onBlur={() => onSave({ resting_hr: num(restingHr) })} />
				</label>
			</div>
			<p class="hint">Lets the plan set effort by heart rate.</p>
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

	async function save(patch: GoalsPatch | { max_hr?: number | null; resting_hr?: number | null }) {
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
				<button type="button" class="btn-quiet" onClick={() => setEditing('new')}>
					Add a race
				</button>
			</section>

			{settings && (
				<>
					<section class="card goals-card">
						<h2 class="section-heading">Focus</h2>
						<FocusFields settings={settings} save={save} />
					</section>
					<HeartRate settings={settings} onSave={save} />
				</>
			)}
		</main>
	);
}
