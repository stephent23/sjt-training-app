import { useState } from 'preact/hooks';
import { GOAL_TAG_GROUPS, type Settings } from '../../types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export type GoalsPatch = { goals?: string; days_per_week?: number; goal_tags?: string[] };

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];

/** Slugs read fine as sentences once the underscores go, so there's no label
 * map to keep in step with the vocabulary in src/types.ts. */
function label(tag: string): string {
	const words = tag.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SaveStatus({ state }: { state: SaveState }) {
	return (
		<p class="eyebrow goals-status" role="status" aria-live="polite">
			{state === 'saving' && 'Saving…'}
			{state === 'saved' && 'Saved'}
			{state === 'error' && 'Could not save — try again.'}
			{state === 'idle' && ' '}
		</p>
	);
}

/** Focus tags, free text and sessions per week. The first tag group shows;
 * the other two sit behind "More". Local state is kept apart from the saved
 * values so typing doesn't fight a controlled value: free text saves on blur,
 * the tap controls on change. */
export function FocusFields({ settings, save }: { settings: Settings; save: (patch: GoalsPatch) => void }) {
	const [goals, setGoals] = useState(settings.goals);
	const [daysPerWeek, setDaysPerWeek] = useState(settings.days_per_week);
	const [tags, setTags] = useState<string[]>(settings.goal_tags);
	const groups = Object.entries(GOAL_TAG_GROUPS);
	// Open by default when a tag already lives in a hidden group, so nothing selected is out of sight.
	const hiddenHasTag = groups.slice(1).some(([, g]) => g.some((t) => settings.goal_tags.includes(t)));

	function toggleTag(tag: string) {
		const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
		setTags(next);
		save({ goal_tags: next });
	}

	function group([heading, groupTags]: [string, readonly string[]]) {
		return (
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
		);
	}

	return (
		<>
			{group(groups[0])}
			<details class="goals-more" open={hiddenHasTag}>
				<summary>More</summary>
				{groups.slice(1).map(group)}
			</details>

			<label class="field">
				Anything else
				<textarea
					rows={2}
					placeholder="Keep upper-body strength"
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
			</div>
		</>
	);
}

