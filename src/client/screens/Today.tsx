import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { SessionList } from '../components/SessionRow';
import { pendingCount } from '../sync';
import { useSessionList } from '../useSessionList';

// Today shows every session dated today — there can be more than one (e.g.
// a lift and a run on the same day, or two things rescheduled onto the same
// date). Unlike Plan, a planned session here links straight into live
// logging: Today is the "do this now" screen, Plan is just a preview.
function linkFor(s: SessionSummary): string {
	if (s.status === 'planned') return `#/${s.kind}/${s.id}`;
	return `#/review/${s.id}`;
}

/** The single-session day. Leads with what the session IS — its name, at
 * heading size — and puts one obvious action under it, rather than making you
 * parse a one-row list to find out what you are doing. Everything shown comes
 * from the summary the list already fetched, so this costs no extra request. */
function TodaySession({ session, href }: { session: SessionSummary; href: string }) {
	const done = session.status !== 'planned';
	const detail =
		session.kind === 'lift'
			? `${session.exercise_count} exercise${session.exercise_count === 1 ? '' : 's'} · ${session.planned_set_count} sets`
			: runDetail(session);

	return (
		<section>
			<span class="eyebrow">
				{session.date} · Week {session.week_number}
			</span>
			<h2>{session.label}</h2>
			<p class="exercise-target">{detail}</p>
			<a class={done ? 'btn-secondary' : 'btn-primary'} href={href} role="button">
				{done ? 'Review it' : session.kind === 'lift' ? 'Start the session' : 'Start the run'}
			</a>
		</section>
	);
}

function runDetail(session: SessionSummary): string {
	const type = session.run_type ? session.run_type[0].toUpperCase() + session.run_type.slice(1) : 'Run';
	if (session.target_minutes) return `${type} · ${session.target_minutes} min`;
	if (session.target_km) return `${type} · ${session.target_km} km`;
	return type;
}

export function Today() {
	const today = todayIso();
	const { sessions, error, reload } = useSessionList({ from: today, to: today }, 'Could not load today.');
	const pending = pendingCount();

	return (
		<main class="screen">
			<h1>Training log</h1>
			{pending > 0 && (
				<p class="eyebrow">
					Syncing {pending} change{pending === 1 ? '' : 's'}…
				</p>
			)}
			{error ? (
				<>
					<p>{error}</p>
					<button type="button" class="btn-secondary" onClick={reload}>
						Retry
					</button>
				</>
			) : sessions === undefined ? (
				<p>Loading…</p>
			) : sessions.length === 1 ? (
				// One session is the normal day, and on it Today should read as
				// "here is what you are about to do" rather than as a list of one.
				// Two or more (a lift and a run, or something rescheduled onto the
				// same date) fall back to the list, where the choice is the point.
				<TodaySession session={sessions[0]} href={linkFor(sessions[0])} />
			) : (
				<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing planned today. Enjoy the rest." />
			)}
			<a class="btn-secondary" href="#/run/new" role="button">
				Add a run
			</a>
		</main>
	);
}
