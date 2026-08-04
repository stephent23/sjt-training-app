import { RunStructure } from '../components/RunStructure';
import { SessionScreenFallback } from '../components/SessionScreenFallback';
import { runSummary } from '../format';
import { useSession } from '../useSession';

interface PreviewProps {
	sessionId: number;
	onBack: () => void;
}

// Read-only look at a session that hasn't happened yet, reached from Plan.
// No logging controls, no swap, no skip — those all belong to the day you
// actually do it (Today), or to fixing something after the fact (Review).
// Looking ahead shouldn't let you touch it.
export function Preview({ sessionId, onBack }: PreviewProps) {
	const { detail, error, reload } = useSession(sessionId);

	if (!detail) return <SessionScreenFallback error={error} onBack={onBack} onRetry={reload} />;

	const { session, plannedSets, plannedRun } = detail;

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>
			{error && <p class="eyebrow">{error}</p>}

			<span class="eyebrow">
				{session.date} · Week {session.week_number}
			</span>
			<h1>{session.label}</h1>
			<p class="exercise-target">Preview — this hasn't happened yet.</p>

			{session.kind === 'lift'
				? plannedSets.map((ps) => (
						<div key={ps.id} class="row">
							<h2 class="section-heading">{ps.exercise_name}</h2>
							<p class="exercise-target">
								{ps.target_sets} × {ps.rep_low}-{ps.rep_high}
								{ps.target_weight_kg ? ` @ ${ps.target_weight_kg}kg` : ''}
							</p>
							{ps.notes && <p class="exercise-target">{ps.notes}</p>}
						</div>
					))
				: plannedRun && (
						<div class="row">
							<p class="exercise-target">{runSummary(plannedRun.run_type, plannedRun.target_minutes, plannedRun.target_km)}</p>
							<RunStructure structureJson={plannedRun.structure_json} />
						</div>
					)}
		</main>
	);
}
