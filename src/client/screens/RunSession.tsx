import { setSessionStatus } from '../api';
import { useSession } from '../useSession';
import type { RunStep } from '../../types';

interface RunSessionProps {
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

// Simplified for now, per explicit request: just mark the run done or
// skipped — no distance/duration/HR/RPE form. That detailed logging is
// still fully built server-side (logRun/LogRunInput/POST /:id/runs) and can
// come back to the UI later; this screen just doesn't ask for it yet.
export function RunSession({ sessionId, onBack }: RunSessionProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);

	if (!detail || !detail.plannedRun) {
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

	const run = detail.plannedRun;
	const structure = parseStructure(run.structure_json);

	function finish(status: 'completed' | 'skipped') {
		setSessionStatus(sessionId, status);
		setDetail({ ...detail!, session: { ...detail!.session, status } });
		location.hash = '#/';
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>
			{error && <p class="eyebrow">{error}</p>}
			<h1>{run.run_type.charAt(0).toUpperCase() + run.run_type.slice(1)} run</h1>
			<p class="exercise-target">
				{run.target_minutes ? `${run.target_minutes} min` : ''}
				{run.target_km ? ` · ${run.target_km} km` : ''}
			</p>

			{structure && (
				<ol class="run-steps">
					{structure.map((s, i) => (
						<li key={i}>
							{s.repeat ? `${s.repeat} × ` : ''}
							{s.minutes} min {s.kind} ({s.effort.replace('_', ' ')})
						</li>
					))}
				</ol>
			)}

			<button type="button" class="btn-primary" onClick={() => finish('completed')} disabled={detail.session.status === 'completed'}>
				{detail.session.status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
			<button type="button" class="btn-secondary" onClick={() => finish('skipped')} disabled={detail.session.status === 'skipped'}>
				{detail.session.status === 'skipped' ? 'Skipped' : 'Mark skipped'}
			</button>
		</main>
	);
}
