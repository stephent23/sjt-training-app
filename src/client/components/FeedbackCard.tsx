import { useState } from 'preact/hooks';
import type { SessionFeedback } from '../../types';
import { TapGroup } from './TapGroup';

interface FeedbackCardProps {
	feedback: SessionFeedback | null;
	onSave: (feedback: SessionFeedback) => void;
}

const PAIN_OPTIONS = [0, 1, 2, 3];
const ENERGY_OPTIONS = [1, 2, 3, 4, 5];

const PAIN_LABELS: Record<number, string> = { 0: 'None', 1: 'Niggle', 2: 'Sore', 3: 'Bad' };

// Captured on Review, after the work is done — asking mid-session would
// interrupt the thing being measured. Each control saves on tap rather than
// behind a "Save" button: the write is queued and idempotent (the route
// upserts on session_id), so there's nothing to lose by writing early and
// often, and a form you have to remember to submit is a form that silently
// collects nothing.
//
// This is the only source of the generator's shoulder/back pain flags — a
// 2+ here is what stops next week's plan from programming an exercise the
// catalogue marks unsafe for that joint.
export function FeedbackCard({ feedback, onSave }: FeedbackCardProps) {
	const [note, setNote] = useState(feedback?.note ?? '');

	const current: SessionFeedback = {
		back_pain_0_3: feedback?.back_pain_0_3 ?? null,
		shoulder_pain_0_3: feedback?.shoulder_pain_0_3 ?? null,
		energy_1_5: feedback?.energy_1_5 ?? null,
		note: feedback?.note ?? null,
	};

	return (
		<section class="feedback-card">
			<h2 class="section-heading">How did that feel?</h2>

			<div class="set-field">
				<span class="eyebrow">Back pain</span>
				<TapGroup
					options={PAIN_OPTIONS}
					value={current.back_pain_0_3}
					onChange={(v) => onSave({ ...current, back_pain_0_3: v })}
					label={(v) => PAIN_LABELS[v]}
					ariaLabel="Back pain, none to bad"
				/>
			</div>

			<div class="set-field">
				<span class="eyebrow">Shoulder pain</span>
				<TapGroup
					options={PAIN_OPTIONS}
					value={current.shoulder_pain_0_3}
					onChange={(v) => onSave({ ...current, shoulder_pain_0_3: v })}
					label={(v) => PAIN_LABELS[v]}
					ariaLabel="Shoulder pain, none to bad"
				/>
			</div>

			<div class="set-field">
				<span class="eyebrow">Energy · 1 flat, 5 great</span>
				<TapGroup
					options={ENERGY_OPTIONS}
					value={current.energy_1_5}
					onChange={(v) => onSave({ ...current, energy_1_5: v })}
					label={(v) => String(v)}
					ariaLabel="Energy, 1 flat to 5 great"
				/>
			</div>

			<label class="field">
				Note
				<textarea
					rows={2}
					value={note}
					onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
					onBlur={() => {
						if ((current.note ?? '') !== note) onSave({ ...current, note: note.trim() === '' ? null : note });
					}}
				/>
			</label>

			{(current.back_pain_0_3 ?? 0) >= 2 || (current.shoulder_pain_0_3 ?? 0) >= 2 ? (
				<p class="eyebrow eyebrow--accent">Next week's plan will avoid exercises flagged unsafe for that joint.</p>
			) : null}
		</section>
	);
}
