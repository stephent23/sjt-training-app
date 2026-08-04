import { setSessionStatus } from '../api';
import { RunStructure } from '../components/RunStructure';
import { SessionScreenFallback } from '../components/SessionScreenFallback';
import { capitalize } from '../format';
import { useSession } from '../useSession';

interface RunSessionProps {
	sessionId: number;
	onBack: () => void;
}

// Simplified for now, per explicit request: just mark the run done or
// skipped — no distance/duration/HR/RPE form. That detailed logging is
// still fully built server-side (logRun/LogRunInput/POST /:id/runs) and
// available on the Review screen after the fact; this screen just doesn't
// ask for it mid-run.
export function RunSession({ sessionId, onBack }: RunSessionProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);

	if (!detail || !detail.plannedRun) return <SessionScreenFallback error={error} onBack={onBack} onRetry={reload} />;

	const run = detail.plannedRun;
	const session = detail.session;

	function finish(status: 'completed' | 'skipped') {
		setSessionStatus(sessionId, status);
		setDetail({ ...detail!, session: { ...session, status } });
		location.hash = '#/';
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>
			{error && <p class="eyebrow">{error}</p>}
			<h1>{capitalize(run.run_type)} run</h1>
			<p class="exercise-target">
				{run.target_minutes ? `${run.target_minutes} min` : ''}
				{run.target_km ? ` · ${run.target_km} km` : ''}
			</p>

			<RunStructure structureJson={run.structure_json} />

			<button type="button" class="btn-primary" onClick={() => finish('completed')} disabled={session.status === 'completed'}>
				{session.status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
			<button type="button" class="btn-secondary" onClick={() => finish('skipped')} disabled={session.status === 'skipped'}>
				{session.status === 'skipped' ? 'Skipped' : 'Mark skipped'}
			</button>
		</main>
	);
}
