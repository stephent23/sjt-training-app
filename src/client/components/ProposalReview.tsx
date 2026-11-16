import { useState } from 'preact/hooks';
import type { MultiWeekProposal, MultiWeekProposalInput, ProposedSession, WeekProposalInput } from '../../types';
import { Icon } from './Icon';
import { shortDate } from './PlanSetup';

interface ProposalReviewProps {
	proposal: MultiWeekProposal;
	/** What the mechanical pass proposed. With it, what the assistant changed is marked. */
	deterministic?: MultiWeekProposalInput;
	/** Untouched planned sessions accepting would replace, and the Monday it starts. */
	replaces?: number;
	startDate?: string | null;
	/** Set when the plan revises a block in progress; weeks then carry the block's own numbers. */
	block?: { name: string; week_count: number } | null;
	firstWeekNumber?: number;
	busy: boolean;
	onAccept: () => void;
	onReject: () => void;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** What changed in one session against the mechanical proposal for the same
 * date. `sets` maps planned-set index to a short "was ..." note. Cheap by
 * design: matches by date and exercise_id, compares the numbers a person would
 * look at, and says nothing when there is no baseline to compare with. */
function diffSession(session: ProposedSession, baseline: WeekProposalInput | undefined): { changed: boolean; notes: Map<number, string>; runNote: string | null } {
	const notes = new Map<number, string>();
	let runNote: string | null = null;
	if (!baseline) return { changed: false, notes, runNote };

	const base = baseline.sessions.find((s) => s.date === session.date);
	if (!base) return { changed: true, notes, runNote: 'new day' };

	session.plannedSets.forEach((set, i) => {
		const was = base.plannedSets.find((b) => b.exercise_id === set.exercise_id);
		if (!was) {
			notes.set(i, 'new exercise');
			return;
		}
		const parts: string[] = [];
		if (was.target_weight_kg !== set.target_weight_kg) parts.push(was.target_weight_kg == null ? 'no weight' : `${was.target_weight_kg}kg`);
		if (was.target_sets !== set.target_sets || was.rep_low !== set.rep_low || was.rep_high !== set.rep_high) {
			parts.push(`${was.target_sets} × ${was.rep_low}-${was.rep_high}`);
		}
		if (parts.length > 0) notes.set(i, `was ${parts.join(', ')}`);
	});
	if (session.kind === 'lift' && base.plannedSets.some((b) => !session.plannedSets.some((s) => s.exercise_id === b.exercise_id))) {
		runNote = 'exercise dropped';
	}

	const run = session.plannedRun;
	const baseRun = base.plannedRun;
	if (run && baseRun) {
		const parts: string[] = [];
		if (run.run_type !== baseRun.run_type) parts.push(baseRun.run_type);
		if (run.target_km !== baseRun.target_km && baseRun.target_km != null) parts.push(`${baseRun.target_km} km`);
		if (run.target_minutes !== baseRun.target_minutes && baseRun.target_minutes != null) parts.push(`${baseRun.target_minutes} min`);
		if (parts.length > 0) runNote = `was ${parts.join(', ')}`;
	}

	const changed = notes.size > 0 || runNote !== null || base.label !== session.label;
	return { changed, notes, runNote };
}

function sessionNumbers(s: ProposedSession): string {
	if (s.kind === 'lift') {
		const sets = s.plannedSets.reduce((n, ps) => n + ps.target_sets, 0);
		return `${s.plannedSets.length} exercises · ${sets} sets`;
	}
	const run = s.plannedRun;
	if (!run) return 'Run';
	return [capitalize(run.run_type), run.target_minutes ? `${run.target_minutes} min` : null, run.target_km ? `${run.target_km} km` : null]
		.filter(Boolean)
		.join(' · ');
}

function SessionRow({ session, baseline }: { session: ProposedSession; baseline: WeekProposalInput | undefined }) {
	const { changed, notes, runNote } = diffSession(session, baseline);
	return (
		<details class="rv-session">
			<summary class="rv-session-head">
				<span class="rv-day">{shortDate(session.date)}</span>
				<span class="rv-session-main">
					<span class="rv-session-title">
						<span class={`badge badge--${session.kind}`}>
							<Icon name={session.kind === 'lift' ? 'lift' : 'run'} />
							{session.kind === 'lift' ? 'Lift' : 'Run'}
						</span>
						{session.label}
					</span>
					<span class="rv-session-meta">{sessionNumbers(session)}</span>
				</span>
				{changed && <span class="badge badge--accent">Changed</span>}
			</summary>
			<div class="rv-session-body">
				{session.kind === 'lift'
					? session.plannedSets.map((ps, j) => (
							<p key={j} class="exercise-target">
								{ps.exercise_name} — {ps.target_sets} × {ps.rep_low}-{ps.rep_high}
								{ps.target_weight_kg != null ? ` @ ${ps.target_weight_kg}kg` : ''}
								{ps.notes ? ` (${ps.notes})` : ''}
								{notes.has(j) && <span class="rv-was"> · {notes.get(j)}</span>}
							</p>
						))
					: session.plannedRun && (
							<p class="exercise-target">
								{sessionNumbers(session)}
								{runNote && <span class="rv-was"> · {runNote}</span>}
							</p>
						)}
				{session.kind === 'lift' && runNote && <p class="rv-was">{capitalize(runNote)}</p>}
			</div>
		</details>
	);
}

// Shows a pending MultiWeekProposal for accept/reject. No inline editing in
// v1 — a deliberate decision (see plan doc §7): the correction path is
// reject, then paste validation errors / a follow-up ask back to the AI
// assistant that produced it, then re-import.
//
// The first week is open and the rest folded, because the first is the one
// that is real arithmetic and the rest are the assistant's judgement over it.
// Accept/reject is whole-proposal, not per-week, and lives in a bar that stays
// on screen however far down the weeks you have scrolled.
export function ProposalReview({ proposal, deterministic, replaces, startDate, block, firstWeekNumber = 1, busy, onAccept, onReject }: ProposalReviewProps) {
	const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
	const toggle = (i: number) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(i)) next.delete(i);
			else next.add(i);
			return next;
		});

	// Highlights only mean something when the mechanical pass had a week to compare with.
	const hasBaseline = deterministic?.weeks.some((w) => w.sessions.length > 0) ?? false;
	const sessionCount = proposal.weeks.reduce((n, w) => n + w.sessions.length, 0);
	const from = startDate ? ` from ${shortDate(startDate)}` : '';
	const outcome =
		replaces && replaces > 0
			? `Replaces ${replaces} planned ${replaces === 1 ? 'session' : 'sessions'}${from}`
			: `Adds ${sessionCount} sessions${from} — nothing planned to replace`;

	return (
		<div class="review">
			{block && (
				<p class="rv-block-line">
					Updates {block.name} — {proposal.weeks.length === 1 ? `week ${firstWeekNumber}` : `weeks ${firstWeekNumber}–${firstWeekNumber + proposal.weeks.length - 1}`}
				</p>
			)}
			{typeof proposal.summary === 'string' && proposal.summary.trim() !== '' && <p class="card review-note">{proposal.summary.trim()}</p>}

			{proposal.weeks.map((week, weekIndex) => {
				// Only week 1 is the mechanical pass's real arithmetic; later weeks are
				// flat copies, so comparing against them would flag everything.
				const baseline = hasBaseline && weekIndex === 0 ? deterministic?.weeks[0] : undefined;
				const changes = baseline ? week.sessions.filter((s) => diffSession(s, baseline).changed).length : 0;
				const isOpen = open.has(weekIndex);
				const first = week.sessions[0]?.date;
				return (
					<section key={weekIndex} class="card rv-week">
						<button type="button" class="rv-week-head" aria-expanded={isOpen} onClick={() => toggle(weekIndex)}>
							<span class="rv-week-main">
								<span class="section-heading proposal-week-title">
									{block ? `Week ${firstWeekNumber + weekIndex} of ${block.week_count}` : `Week ${weekIndex + 1} of ${proposal.weeks.length}`}
									{week.focus && <span class="badge badge--accent">{week.focus}</span>}
								</span>
								<span class="rv-session-meta">
									{first ? `${shortDate(first)} · ` : ''}
									{week.sessions.length} sessions
									{changes > 0 ? ` · ${changes} changed` : ''}
								</span>
							</span>
							<Icon name="chevron-right" class={isOpen ? 'icon--down' : undefined} />
						</button>
						{isOpen && (
							<div class="rv-week-body">
								{week.sessions.map((s, i) => (
									<SessionRow key={i} session={s} baseline={baseline} />
								))}
							</div>
						)}
					</section>
				);
			})}

			{/* Deliberately unequal: accepting is the decision, rejecting is cheap
			    and recoverable (reject, ask the assistant again, re-import). */}
			<div class="rv-bar">
				<p class="rv-outcome">{outcome}</p>
				<div class="rv-bar-actions">
					<button type="button" class="btn-quiet" onClick={onReject} disabled={busy}>
						Reject
					</button>
					<button type="button" class="btn-primary" onClick={onAccept} disabled={busy}>
						Accept
					</button>
				</div>
			</div>
		</div>
	);
}
