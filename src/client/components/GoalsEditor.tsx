import { useEffect, useState } from 'preact/hooks';
import { GOAL_TAG_GROUPS } from '../../types';
import { fetchSettings, updateSettings } from '../api';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];

/** Slugs read fine as sentences once the underscores go, so there's no label
 * map to keep in step with the vocabulary in src/types.ts. */
function label(tag: string): string {
	const words = tag.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

// Always visible on Generate, not tucked into a disclosure: this is the input
// with the most leverage over what the assistant plans, and it has to be right
// *before* the export is downloaded. Local input state is tracked separately
// from the last-saved values so typing doesn't fight a controlled value; the
// free-text PATCH fires on blur, the tap controls save on change since they
// have no blur to hang a save off.
export function GoalsEditor() {
	const [loaded, setLoaded] = useState(false);
	const [goals, setGoals] = useState('');
	const [daysPerWeek, setDaysPerWeek] = useState(5);
	const [tags, setTags] = useState<string[]>([]);
	const [saveState, setSaveState] = useState<SaveState>('idle');

	useEffect(() => {
		let cancelled = false;
		fetchSettings()
			.then((s) => {
				if (cancelled) return;
				setGoals(s.goals);
				setDaysPerWeek(s.days_per_week);
				setTags(s.goal_tags);
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

	async function save(patch: { goals?: string; days_per_week?: number; goal_tags?: string[] }) {
		setSaveState('saving');
		try {
			await updateSettings(patch);
			setSaveState('saved');
		} catch {
			setSaveState('error');
		}
	}

	function toggleTag(tag: string) {
		const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
		setTags(next);
		save({ goal_tags: next });
	}

	if (!loaded) return null;

	return (
		<section>
			<h2 class="section-heading">What are you training for?</h2>

			{Object.entries(GOAL_TAG_GROUPS).map(([heading, groupTags]) => (
				<div key={heading} class="field">
					<span class="eyebrow">{heading}</span>
					<div class="tap-row" role="group" aria-label={heading}>
						{groupTags.map((tag) => (
							<button
								type="button"
								key={tag}
								class={`tap-btn ${tags.includes(tag) ? 'tap-btn--selected' : ''}`}
								aria-pressed={tags.includes(tag)}
								onClick={() => toggleTag(tag)}
							>
								{label(tag)}
							</button>
						))}
					</div>
				</div>
			))}

			<label class="field">
				Anything else
				<textarea
					rows={3}
					placeholder="Half marathon in October, keep upper-body strength"
					value={goals}
					onInput={(e) => setGoals((e.target as HTMLTextAreaElement).value)}
					onBlur={() => save({ goals })}
				/>
			</label>

			<div class="field">
				<span>Sessions per week</span>
				<div class="tap-row" role="group" aria-label="Sessions per week">
					{DAYS_PER_WEEK_OPTIONS.map((n) => (
						<button
							type="button"
							key={n}
							class={`tap-btn ${n === daysPerWeek ? 'tap-btn--selected' : ''}`}
							aria-pressed={n === daysPerWeek}
							onClick={() => {
								setDaysPerWeek(n);
								save({ days_per_week: n });
							}}
						>
							{n}
						</button>
					))}
				</div>
				<span class="eyebrow">Every generated week has to match this — a deload week may drop one.</span>
			</div>

			<p class="eyebrow" role="status" aria-live="polite">
				{saveState === 'saving' && 'Saving…'}
				{saveState === 'saved' && 'Saved'}
				{saveState === 'error' && 'Could not save — try again.'}
				{saveState === 'idle' && ' '}
			</p>
		</section>
	);
}
