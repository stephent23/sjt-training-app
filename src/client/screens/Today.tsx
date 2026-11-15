import { useEffect, useState } from 'preact/hooks';
import type { Race, SessionSummary } from '../../types';
import { addDaysIso, daysBetweenIso, todayIso } from '../../dates';
import { fetchRaces } from '../api';
import { Icon } from '../components/Icon';
import { longDate, weekdayName, WeekStrip } from '../components/WeekStrip';
import { formatDuration, formatPace } from '../format';
import { readCachedSession } from '../sessionCache';
import { pendingCount } from '../sync';
import { useSessionList } from '../useSessionList';
import { weekLabel } from '../weekLabel';
import { weekDatesFor } from '../weekDates';

// Today is the "do this now" screen, and it deliberately does not share Plan's
// and History's list layout: it leads with one hero card for the session you
// are about to do, under a week strip that says where today sits in the week.
//
// One fetch covers both — the whole Monday-to-Sunday week — and today's
// sessions are filtered out of it, so the strip costs no extra request.

/** Where a tap goes. Today's planned sessions open live logging — that is the
 * point of this screen; anything finished opens Review; a future day only
 * previews, exactly as Plan does, and a manually added run opens its editor,
 * as History does. */
function linkFor(today: string) {
	return (s: SessionSummary): string => {
		if (s.origin === 'manual') return `#/run/${s.id}/edit`;
		if (s.status !== 'planned') return `#/review/${s.id}`;
		if (s.date === today) return `#/${s.kind}/${s.id}`;
		if (s.date > today) return `#/preview/${s.id}`;
		// A past day still marked planned was missed; Review is where it can be
		// filled in after the fact.
		return `#/review/${s.id}`;
	};
}

/** The badge that carries a finished session's state as a word, inside the
 * eyebrow so the state reads in the same line as the date. Planned is the
 * default and gets nothing. */
function stateBadge(s: SessionSummary) {
	if (s.status === 'completed')
		return (
			<span class="badge badge--done">
				<Icon name="check" />
				Completed
			</span>
		);
	if (s.status === 'skipped') return <span class="badge badge--skipped">Skipped</span>;
	return null;
}

function typeBadge(s: SessionSummary) {
	return (
		<span class={`badge badge--${s.kind}`}>
			<Icon name={s.kind === 'lift' ? 'lift' : 'run'} />
			{s.kind === 'lift' ? 'Lift' : s.run_type ? s.run_type : 'Run'}
		</span>
	);
}

/** The headline figures. What actually happened beats what was planned once a
 * run is logged, the same rule SessionRow follows. */
function heroStats(s: SessionSummary): { value: string; label: string }[] {
	if (s.kind === 'lift') {
		const sets =
			s.logged_set_count > 0 ? { value: `${s.logged_set_count}/${s.planned_set_count}`, label: 'Sets logged' } : { value: String(s.planned_set_count), label: 'Sets' };
		return [{ value: String(s.exercise_count), label: s.exercise_count === 1 ? 'Exercise' : 'Exercises' }, sets];
	}
	if (s.logged_distance_km != null && s.logged_duration_seconds != null) {
		const stats = [
			{ value: String(s.logged_distance_km), label: 'Km' },
			{ value: formatDuration(s.logged_duration_seconds), label: 'Time' },
		];
		const pace = formatPace(s.logged_distance_km, s.logged_duration_seconds);
		if (pace) stats.push({ value: pace.replace(' /km', ''), label: 'Pace /km' });
		return stats;
	}
	const stats = [];
	if (s.target_minutes) stats.push({ value: String(s.target_minutes), label: 'Min' });
	if (s.target_km) stats.push({ value: String(s.target_km), label: 'Km' });
	return stats;
}

/** Up to three exercise names from the session cache, if this session has been
 * opened on this device before. Local only — Today never fetches a session's
 * detail just to preview it, so on a cold cache the preview is simply absent. */
function cachedPreview(s: SessionSummary): string[] {
	if (s.kind !== 'lift') return [];
	const detail = readCachedSession(s.id);
	if (!detail) return [];
	const names = detail.plannedSets.map((ps) => ps.exercise_name);
	if (names.length <= 3) return names;
	return [...names.slice(0, 2), `${names[2]} · +${names.length - 3} more`];
}

function HeroCard({ session, href }: { session: SessionSummary; href: string }) {
	const done = session.status !== 'planned';
	const inProgress = !done && session.kind === 'lift' && session.logged_set_count > 0;
	const stats = heroStats(session);
	const preview = cachedPreview(session);

	// The button's verb carries the state: start, continue (with how far in),
	// or review once it is finished.
	const action = done
		? 'Review it'
		: inProgress
			? `Continue · ${session.logged_set_count}/${session.planned_set_count}`
			: session.kind === 'lift'
				? 'Start the session'
				: 'Start the run';

	return (
		<article class="card hero">
			<p class="eyebrow card-eyebrow">
				{typeBadge(session)}
				<span>
					{longDate(session.date)} · {weekLabel(session)}
				</span>
				{stateBadge(session)}
			</p>
			<h2 class="hero-title">{session.label}</h2>

			{stats.length > 0 && (
				<dl class="summary-strip">
					{stats.map((stat) => (
						<div key={stat.label} class="stat">
							<dt class="stat-label">{stat.label}</dt>
							<dd class="stat-value">{stat.value}</dd>
						</div>
					))}
				</dl>
			)}

			{inProgress && (
				<div
					class="progress-bar"
					role="progressbar"
					aria-label="Sets logged"
					aria-valuemin={0}
					aria-valuemax={session.planned_set_count}
					aria-valuenow={session.logged_set_count}
					style={{ '--value': String(session.logged_set_count / Math.max(1, session.planned_set_count)) }}
				/>
			)}

			{preview.length > 0 && (
				<ul class="hero-preview">
					{preview.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
			)}

			<a class={done ? 'btn-secondary' : 'btn-primary'} href={href} role="button">
				{action}
			</a>
		</article>
	);
}

/** A second session on the same day — compact, because the hero is the one
 * you will actually do next, and shrinking both would hide that. */
function CompactCard({ session, href }: { session: SessionSummary; href: string }) {
	return (
		<a class="card card--link plan-row" href={href}>
			<div class="plan-row-main">
				<span class="card-eyebrow">
					{typeBadge(session)}
					{stateBadge(session)}
				</span>
				<span class="plan-row-title">{session.label}</span>
			</div>
			<span class="plan-row-chevron">
				<Icon name="chevron-right" />
			</span>
		</a>
	);
}

/** The empty day: same size and shape as the hero, so the screen looks
 * deliberate rather than broken, with one line saying what comes next. */
function RestCard({ today, next, week }: { today: string; next: SessionSummary | undefined; week: SessionSummary | undefined }) {
	let line = 'Nothing planned for the rest of this week.';
	if (next) {
		const when = next.date === addDaysIso(today, 1) ? 'tomorrow' : weekdayName(next.date);
		line = `Nothing planned. Next: ${next.label}, ${when}.`;
	}
	return (
		<article class="card hero hero--rest">
			<p class="eyebrow">
				{longDate(today)}
				{week && ` · ${weekLabel(week)}`}
			</p>
			<h2 class="hero-title">Rest day</h2>
			<p class="hero-note">{line}</p>
			<a class="btn-secondary" href="#/plan" role="button">
				See the week
			</a>
		</article>
	);
}

/** The soonest race still ahead of you with no result yet. */
export function nextRace(races: Race[], today: string): Race | undefined {
	return races.filter((r) => r.date >= today && r.result_seconds == null).sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function raceCountdown(race: Race, today: string): string {
	const days = daysBetweenIso(today, race.date);
	const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 14 ? `${days} days` : `${Math.floor(days / 7)} weeks`;
	return `${race.name} · ${when}`;
}

/** Same footprint as the hero, so nothing jumps when the list lands. */
function HeroSkeleton() {
	return (
		<div class="card hero" aria-hidden="true">
			<span class="skeleton skeleton--line" style={{ width: '45%' }} />
			<span class="skeleton skeleton--title" style={{ width: '60%' }} />
			<span class="skeleton skeleton--block" />
			<span class="skeleton skeleton--button" />
		</div>
	);
}

export function Today() {
	const today = todayIso();
	const week = weekDatesFor(today);
	const { sessions, error, reload } = useSessionList({ from: week[0], to: week[6] }, "Couldn't load today.");
	const pending = pendingCount();
	const href = linkFor(today);

	// A nicety, never a dependency: offline or failing, there is simply no line.
	const [race, setRace] = useState<Race | undefined>();
	useEffect(() => {
		let live = true;
		fetchRaces()
			.then((races) => live && Array.isArray(races) && setRace(nextRace(races, today)))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [today]);

	const todays = sessions?.filter((s) => s.date === today) ?? [];
	// The hero is the next thing you will actually do: the first session still
	// planned, or — once everything today is finished — simply the first.
	const hero = todays.find((s) => s.status === 'planned') ?? todays[0];
	const others = todays.filter((s) => s !== hero);
	const next = sessions?.find((s) => s.date > today && s.status === 'planned');

	return (
		<main class="screen">
			<header class="screen-head">
				<h1>Today</h1>
				{/* The only sign that the offline queue in sync.ts is non-empty, so
				    it stays on screen — but as a badge, never as the headline. */}
				{pending > 0 && (
					<span class="badge" role="status">
						{pending} change{pending === 1 ? '' : 's'} queued
					</span>
				)}
			</header>

			<WeekStrip dates={week} today={today} sessions={sessions} linkFor={href} />

			{error ? (
				<article class="card hero" role="alert">
					<p class="eyebrow card-eyebrow">
						<Icon name="alert" />
						{longDate(today)}
					</p>
					<h2 class="hero-title">{error}</h2>
					<button type="button" class="btn-secondary" onClick={reload}>
						Retry
					</button>
				</article>
			) : sessions === undefined ? (
				<HeroSkeleton />
			) : hero ? (
				<>
					<HeroCard session={hero} href={href(hero)} />
					{others.map((s) => (
						<CompactCard key={s.id} session={s} href={href(s)} />
					))}
				</>
			) : (
				<RestCard today={today} next={next} week={sessions[0]} />
			)}

			{race && (
				<a class="race-line" href="#/goals">
					<Icon name="calendar" />
					{raceCountdown(race, today)}
				</a>
			)}

			<a class="btn-quiet" href="#/run/new" role="button">
				<Icon name="plus" />
				Add a run
			</a>
		</main>
	);
}
