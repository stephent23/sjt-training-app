import { useSession } from '../useSession';
import type { RunStep } from '../../types';

interface PreviewProps {
	sessionId: number;
	onBack: () => void;
}

function parseStructure(json: string | null): RunStep[] | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed?.steps) ? parsed.steps : null;
	} catch {
		return null;
	}
}

// Read-only look at a session that hasn't happened yet, reached from Plan.
// No logging controls, no swap, no skip — those all belong to the day you
// actually do it (Today), or to fixing something after the fact (Review).
// Looking ahead shouldn't let you touch it.
export function Preview({ sessionId, onBack }: PreviewProps) {
	const { detail, error, reload } = useSession(sessionId);

	if (!detail) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={onBack}>
					← Back
				</button>
				{error ? (
					<>
						<p>{error}</p>
						<button type="button" class="btn-secondary" onClick={reload}>
							Retry
						</button>
					</>
				) : (
					<p>Loading…</p>
				)}
			</main>
		);
	}

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
							<p class="exercise-target">
								{plannedRun.run_type.charAt(0).toUpperCase() + plannedRun.run_type.slice(1)}
								{plannedRun.target_minutes ? ` · ${plannedRun.target_minutes} min` : ''}
								{plannedRun.target_km ? ` · ${plannedRun.target_km} km` : ''}
							</p>
							{parseStructure(plannedRun.structure_json) && (
								<ol class="run-steps">
									{parseStructure(plannedRun.structure_json)!.map((s, i) => (
										<li key={i}>
											{s.repeat ? `${s.repeat} × ` : ''}
											{s.minutes} min {s.kind} ({s.effort.replace('_', ' ')})
										</li>
									))}
								</ol>
							)}
						</div>
					)}
		</main>
	);
}
