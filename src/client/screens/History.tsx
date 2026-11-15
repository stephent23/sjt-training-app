import type { SessionSummary } from '../../types';
import { addDaysIso, todayIso } from '../../dates';
import { SessionList } from '../components/SessionRow';
import { ListSkeleton, StripSkeleton } from '../components/Skeletons';
import { Icon } from '../components/Icon';
import { useSessionList } from '../useSessionList';

// History is for reviewing what happened, not for logging — every row goes
// to Review, except a hand-recorded run, which goes to the editor it was
// created in, since there's nothing generated to review there.
function linkFor(s: SessionSummary): string {
	if (s.origin === 'manual') return `#/run/${s.id}/edit`;
	return `#/review/${s.id}`;
}

/** Sessions completed, km run and sets logged over the last four weeks — all
 * already on the rows, so the strip costs no extra request. */
function recentTotals(sessions: SessionSummary[], today: string) {
	const since = addDaysIso(today, -27);
	const recent = sessions.filter((s) => s.date >= since && s.date <= today);
	const sessionsDone = recent.filter((s) => s.status === 'completed').length;
	const km = recent.reduce((sum, s) => sum + (s.logged_distance_km ?? 0), 0);
	const sets = recent.reduce((sum, s) => sum + s.logged_set_count, 0);
	return { sessionsDone, km: Math.round(km * 10) / 10, sets };
}

export function History() {
	const today = todayIso();
	// No `from` on purpose: history has no lower bound. The server treats a
	// missing `from` as "since the beginning" — it used to default to today,
	// which silently collapsed this whole screen to only today's sessions.
	const { sessions, error, reload } = useSessionList({ to: today, order: 'desc' }, 'Could not load history.');
	const totals = sessions ? recentTotals(sessions, today) : null;

	return (
		<main class="screen">
			<h1>History</h1>
			<p class="lede">Everything logged, newest first. Tap a session to see what happened, or fix what you recorded.</p>
			{totals && sessions!.length > 0 && (
				<section class="card" aria-label="Last four weeks">
					<p class="eyebrow">Last 4 weeks</p>
					<dl class="summary-strip">
						<div class="stat">
							<dt class="stat-label">Sessions</dt>
							<dd class="stat-value">{totals.sessionsDone}</dd>
						</div>
						<div class="stat">
							<dt class="stat-label">Km run</dt>
							<dd class="stat-value">{totals.km}</dd>
						</div>
						<div class="stat">
							<dt class="stat-label">Sets</dt>
							<dd class="stat-value">{totals.sets}</dd>
						</div>
					</dl>
				</section>
			)}
			<a class="btn-secondary" href="#/run/new" role="button">
				Add a run
			</a>
			{error ? (
				<>
					<p>{error}</p>
					<button type="button" class="btn-secondary" onClick={reload}>
						Retry
					</button>
				</>
			) : sessions === undefined ? (
				<>
					<StripSkeleton />
					<ListSkeleton rows={8} />
				</>
			) : (
				<SessionList
					sessions={sessions}
					linkFor={linkFor}
					emptyMessage="Nothing logged yet."
					dense
					emptyAction={
						<a class="btn-quiet" href="#/" role="button">
							<Icon name="today" />
							Start from Today
						</a>
					}
				/>
			)}
		</main>
	);
}
