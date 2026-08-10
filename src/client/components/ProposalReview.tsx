import type { MultiWeekProposal } from '../../types';

interface ProposalReviewProps {
	proposal: MultiWeekProposal;
	busy: boolean;
	onAccept: () => void;
	onReject: () => void;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// Shows a pending MultiWeekProposal for accept/reject. No inline editing in
// v1 — a deliberate decision (see plan doc §7): the correction path is
// reject, then paste validation errors / a follow-up ask back to the AI
// assistant that produced it, then re-import.
//
// Accept/reject is whole-proposal, not per-week — that hasn't changed.
// "Speculative" is index > 0 rather than a threaded speculativeFromWeek
// prop: the backend's ExportContext.speculativeFromWeek is always 2 (see
// src/generator.ts's doc comment on that field), i.e. "everything after
// week 1 is speculative" is always true whenever there's more than one
// week — so there's nothing week-count-dependent to plumb through here.
export function ProposalReview({ proposal, busy, onAccept, onReject }: ProposalReviewProps) {
	return (
		<div>
			{proposal.weeks.map((week, weekIndex) => (
				<div key={week.week_number}>
					<h2 class="section-heading">
						Week {week.week_number}
						{week.focus ? ` · ${week.focus}` : ''}
					</h2>
					{weekIndex > 0 && <span class="eyebrow eyebrow--accent">Speculative — needs real judgement</span>}

					{week.sessions.map((s, i) => (
						<div key={i} class="row">
							<span class="eyebrow">{s.date}</span>
							<p class="plan-row-title">{s.label}</p>

							{s.kind === 'lift'
								? s.plannedSets.map((ps, j) => (
										<p key={j} class="exercise-target">
											{ps.exercise_name} — {ps.target_sets} × {ps.rep_low}-{ps.rep_high}
											{ps.target_weight_kg != null ? ` @ ${ps.target_weight_kg}kg` : ''}
											{ps.notes ? ` (${ps.notes})` : ''}
										</p>
									))
								: s.plannedRun && (
										<p class="exercise-target">
											{capitalize(s.plannedRun.run_type)}
											{s.plannedRun.target_minutes ? ` · ${s.plannedRun.target_minutes} min` : ''}
											{s.plannedRun.target_km ? ` · ${s.plannedRun.target_km} km` : ''}
										</p>
									)}
						</div>
					))}
				</div>
			))}

			<button type="button" class="btn-primary" onClick={onAccept} disabled={busy}>
				Accept
			</button>
			<button type="button" class="btn-secondary" onClick={onReject} disabled={busy}>
				Reject
			</button>
		</div>
	);
}
