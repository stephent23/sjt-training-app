import type { WeekProposal } from '../../types';

interface ProposalReviewProps {
	proposal: WeekProposal;
	busy: boolean;
	onAccept: () => void;
	onReject: () => void;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// Shows a pending WeekProposal for accept/reject. No inline editing in v1 —
// a deliberate decision (see plan doc §7): the correction path is reject,
// then paste validation errors / a follow-up ask back to the AI assistant
// that produced it, then re-import.
export function ProposalReview({ proposal, busy, onAccept, onReject }: ProposalReviewProps) {
	return (
		<div>
			<h2 class="section-heading">Proposed week {proposal.week_number}</h2>

			{proposal.sessions.map((s, i) => (
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

			<button type="button" class="btn-primary" onClick={onAccept} disabled={busy}>
				Accept
			</button>
			<button type="button" class="btn-secondary" onClick={onReject} disabled={busy}>
				Reject
			</button>
		</div>
	);
}
