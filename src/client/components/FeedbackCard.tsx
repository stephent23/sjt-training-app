import { useState } from 'preact/hooks';
import type { SessionFeedback } from '../../types';
import { TapGroup } from './TapGroup';

interface FeedbackCardProps {
	feedback: SessionFeedback | null;
	onSave: (feedback: SessionFeedback) => void;
}

const PAIN_OPTIONS = [0, 1, 2, 3];

const PAIN_LABELS: Record<number, string> = { 0: 'None', 1: 'Niggle', 2: 'Sore', 3: 'Bad' };

// Shown on a lift's Review, after the work is done — asking mid-session would
// interrupt the thing being measured. (A run has its own effort scale and
// "How it went" note, so it doesn't get this card.)
//
// The note leads: it is what the owner actually wants to say, and it reaches
// the plan-writer as sessionNotes. Pain scoring sits behind "Anything sore?"
// because most sessions have nothing to report, but it is not optional
// plumbing — a 2+ here is what stops next week's plan from programming an
// exercise the catalogue marks unsafe for that joint, and it is the only source
// of the generator's shoulder/back flags. Each control saves on tap (the write
// is queued and idempotent: the route upserts on session_id), so there is no
// Save button to forget.
//
// The old 1-5 energy rating is no longer asked for — nothing used it — but a
// value already recorded is passed through untouched on every save.
export function FeedbackCard({ feedback, onSave }: FeedbackCardProps) {
	const [note, setNote] = useState(feedback?.note ?? '');

	const current: SessionFeedback = {
		back_pain_0_3: feedback?.back_pain_0_3 ?? null,
		shoulder_pain_0_3: feedback?.shoulder_pain_0_3 ?? null,
		energy_1_5: feedback?.energy_1_5 ?? null,
		note: feedback?.note ?? null,
	};
	const anySore = (current.back_pain_0_3 ?? 0) > 0 || (current.shoulder_pain_0_3 ?? 0) > 0;
	const flagged = (current.back_pain_0_3 ?? 0) >= 2 || (current.shoulder_pain_0_3 ?? 0) >= 2;

	return (
		<section class="feedback-card">
			<h2 class="section-heading">How did that feel?</h2>

			<label class="field">
				<span class="visually-hidden">How it went</span>
				<textarea
					rows={3}
					placeholder="In your own words: energy, what felt heavy, anything worth remembering"
					value={note}
					onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
					onBlur={() => {
						if ((current.note ?? '') !== note) onSave({ ...current, note: note.trim() === '' ? null : note });
					}}
				/>
			</label>

			<details class="disclosure" open={anySore || undefined}>
				<summary class="disclosure-summary">Anything sore?</summary>
				<div class="disclosure-body">
					<div class="set-field">
						<span class="eyebrow">Back</span>
						<TapGroup
							options={PAIN_OPTIONS}
							value={current.back_pain_0_3}
							onChange={(v) => onSave({ ...current, back_pain_0_3: v })}
							label={(v) => PAIN_LABELS[v]}
							ariaLabel="Back pain, none to bad"
						/>
					</div>

					<div class="set-field">
						<span class="eyebrow">Shoulder</span>
						<TapGroup
							options={PAIN_OPTIONS}
							value={current.shoulder_pain_0_3}
							onChange={(v) => onSave({ ...current, shoulder_pain_0_3: v })}
							label={(v) => PAIN_LABELS[v]}
							ariaLabel="Shoulder pain, none to bad"
						/>
					</div>
				</div>
			</details>

			{flagged ? <p class="eyebrow eyebrow--accent">Next week's plan will avoid exercises flagged unsafe for that joint.</p> : null}
		</section>
	);
}
