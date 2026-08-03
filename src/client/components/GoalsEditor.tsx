import { useEffect, useState } from 'preact/hooks';
import { fetchSettings, updateSettings } from '../api';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Inline, always-visible disclosure on Plan — there's no dedicated settings
// screen and the nav stays 3 tabs. Local input state is tracked separately
// from the last-saved values so typing doesn't fight a controlled value;
// the actual PATCH fires on blur, not per keystroke.
export function GoalsEditor() {
	const [loaded, setLoaded] = useState(false);
	const [goals, setGoals] = useState('');
	const [daysPerWeek, setDaysPerWeek] = useState(5);
	const [saveState, setSaveState] = useState<SaveState>('idle');

	useEffect(() => {
		let cancelled = false;
		fetchSettings()
			.then((s) => {
				if (cancelled) return;
				setGoals(s.goals);
				setDaysPerWeek(s.days_per_week);
				setLoaded(true);
			})
			.catch(() => {
				if (cancelled) return;
				setLoaded(true);
				setSaveState('error');
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function save(patch: { goals?: string; days_per_week?: number }) {
		setSaveState('saving');
		try {
			await updateSettings(patch);
			setSaveState('saved');
		} catch {
			setSaveState('error');
		}
	}

	if (!loaded) return null;

	return (
		<details>
			<summary class="section-heading">Goals &amp; schedule</summary>

			<label class="field">
				Goals
				<textarea
					rows={4}
					value={goals}
					onInput={(e) => setGoals((e.target as HTMLTextAreaElement).value)}
					onBlur={() => save({ goals })}
				/>
			</label>

			<label class="field">
				Days per week
				<input
					type="number"
					min={1}
					max={7}
					value={daysPerWeek}
					onInput={(e) => setDaysPerWeek(Number((e.target as HTMLInputElement).value))}
					onBlur={() => save({ days_per_week: daysPerWeek })}
				/>
			</label>

			<p class="eyebrow">
				{saveState === 'saving' && 'Saving…'}
				{saveState === 'saved' && 'Saved'}
				{saveState === 'error' && 'Could not save — try again.'}
				{saveState === 'idle' && ' '}
			</p>
		</details>
	);
}
