import { Icon } from '../components/Icon';
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
				<Icon name="chevron-left" />
				Back
			</button>
			{error && <p class="eyebrow">{error}</p>}
			<p class="eyebrow card-eyebrow">
				<span class="badge badge--run">
					<Icon name="run" />
					{run.run_type}
				</span>
			</p>
			<h1>{capitalize(run.run_type)} run</h1>

			{/* The target, huge: this is what you are about to go and do. */}
			{Boolean(run.target_minutes || run.target_km) && (
				<dl class="summary-strip summary-strip--hero">
					{run.target_minutes ? (
						<div class="stat">
							<dt class="stat-label">Min</dt>
							<dd class="stat-value">{run.target_minutes}</dd>
						</div>
					) : null}
					{run.target_km ? (
						<div class="stat">
							<dt class="stat-label">Km</dt>
							<dd class="stat-value">{run.target_km}</dd>
						</div>
					) : null}
				</dl>
			)}

			<RunStructure structureJson={run.structure_json} />

			<button type="button" class="btn-primary" onClick={() => finish('completed')} disabled={session.status === 'completed'}>
				{session.status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
			{/* Finishing a run used to lead nowhere near the screen that records
			    what it was, so the numbers on the watch face went unlogged. */}
			<button type="button" class="btn-secondary" onClick={() => (location.hash = `#/review/${sessionId}`)}>
				Log what you ran
			</button>
			<button type="button" class="btn-quiet" onClick={() => finish('skipped')} disabled={session.status === 'skipped'}>
				{session.status === 'skipped' ? 'Skipped' : 'Mark skipped'}
			</button>
		</main>
	);
}
