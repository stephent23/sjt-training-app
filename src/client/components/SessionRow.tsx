import { useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { capitalize, loggedRunSummary } from '../format';
import { weekDatesFor, WEEKDAY_LABELS } from '../weekDates';

// Shared list-row rendering used by both Plan (upcoming) and History (past)
// — the two screens differ only in which date range they fetch, where a row
// links to, and whether rescheduling is offered (Plan only — moving a past
// session doesn't make sense), not in how a row looks.

// Planned is the default, unremarkable state — no badge needed. Completed
// and skipped are both worth calling out explicitly so a row's status is
// visible without opening it, especially once more than one row can share
// a day. Exported so Today's single-session fast path (which doesn't go
// through SessionList) can show the same badge rather than a second copy.
export function statusBadge(s: SessionSummary) {
	if (s.status === 'planned') return null;
	return <span class="eyebrow--accent"> · {capitalize(s.status)}</span>;
}

function metaLine(s: SessionSummary): string {
	// A skipped session has no result to show, and showing the planned target
	// anyway made it look like an ordinary upcoming row — the only tell was the
	// small status badge above. Say plainly that it didn't happen instead, so
	// skipped reads from the meta line itself and not just from a colour.
	if (s.status === 'skipped') return 'Not done';

	if (s.kind === 'lift') {
		const exercises = `${s.exercise_count} exercise${s.exercise_count === 1 ? '' : 's'}`;
		const sets = `${s.planned_set_count} set${s.planned_set_count === 1 ? '' : 's'}`;
		return `${exercises} · ${sets}`;
	}

	const typeLabel = s.run_type ? capitalize(s.run_type) : 'Run';

	// Once it's been run, what it actually was beats what was asked for — a
	// completed run used to read identically to one nobody had started.
	if (s.logged_distance_km != null && s.logged_duration_seconds != null) {
		return `${typeLabel} · ${loggedRunSummary(s.logged_distance_km, s.logged_duration_seconds)}`;
	}
	if (s.target_minutes) return `${typeLabel} · ${s.target_minutes} min`;
	if (s.target_km) return `${typeLabel} · ${s.target_km} km`;
	return typeLabel;
}

/** "Week 4 · 5 of 5 done" — the non-collapsible heading (Today, History)
 * doesn't fold anything away, so it has no need for `weekSummary`'s
 * lift/run breakdown, but it can still say how much of the week actually
 * happened rather than just naming it. */
function weekHeading(week: number, items: SessionSummary[]): string {
	const done = items.filter((s) => s.status === 'completed').length;
	return `Week ${week} · ${done} of ${items.length} done`;
}

/** "5 sessions · 2 lifts, 3 runs" — what a collapsed week still says about
 * itself, so folding one away doesn't make it a mystery. */
function weekSummary(items: SessionSummary[]): string {
	const lifts = items.filter((s) => s.kind === 'lift').length;
	const runs = items.length - lifts;
	const parts = [];
	if (lifts > 0) parts.push(`${lifts} lift${lifts === 1 ? '' : 's'}`);
	if (runs > 0) parts.push(`${runs} run${runs === 1 ? '' : 's'}`);
	return `${items.length} session${items.length === 1 ? '' : 's'} · ${parts.join(', ')}`;
}

interface SessionListProps {
	sessions: SessionSummary[];
	linkFor: (session: SessionSummary) => string;
	emptyMessage: string;
	onReschedule?: (session: SessionSummary, date: string) => void;
	/** Fold every week but the first shut. Opt-in, because it only makes sense
	 * where the list runs forwards from today: Plan can generate twelve weeks
	 * at once, which is an enormous scroll, whereas Today only ever holds one
	 * week and History is entirely past — nothing there is "current". */
	collapsible?: boolean;
}

export function SessionList({ sessions, linkFor, emptyMessage, onReschedule, collapsible }: SessionListProps) {
	const [openId, setOpenId] = useState<number | null>(null);
	// Which week groups are open, by index. Starts as just the first — Plan
	// fetches from today onwards, so group 0 is the current week by
	// construction. Independent toggles rather than an accordion: comparing this
	// week with next is a reasonable thing to want.
	const [openWeeks, setOpenWeeks] = useState<Set<number>>(() => new Set([0]));

	if (sessions.length === 0) {
		return <p class="empty-state">{emptyMessage}</p>;
	}

	// Sessions arrive already ordered by date, so same-week rows are
	// contiguous — group them into one heading per run without re-sorting.
	const groups: { week: number; items: SessionSummary[] }[] = [];
	for (const s of sessions) {
		const current = groups[groups.length - 1];
		if (current && current.week === s.week_number) {
			current.items.push(s);
		} else {
			groups.push({ week: s.week_number, items: [s] });
		}
	}

	const isOpen = (index: number) => !collapsible || openWeeks.has(index);
	const toggle = (index: number) =>
		setOpenWeeks((current) => {
			const next = new Set(current);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});

	return (
		<>
			{groups.map((g, groupIndex) => (
				<div key={`week-${g.week}`}>
					{collapsible ? (
						<button
							type="button"
							class="plan-row exercise-card-summary"
							aria-expanded={isOpen(groupIndex)}
							onClick={() => toggle(groupIndex)}
						>
							<div class="plan-row-main">
								<span class="plan-row-title">Week {g.week}</span>
								<span class="plan-row-meta">{weekSummary(g.items)}</span>
							</div>
							<span class="plan-row-chevron">{isOpen(groupIndex) ? '⌄' : '›'}</span>
						</button>
					) : (
						<h2 class="section-heading">{weekHeading(g.week, g.items)}</h2>
					)}
					{isOpen(groupIndex) &&
						g.items.map((s) => (
							<div key={s.id}>
								<a class="row plan-row" href={linkFor(s)}>
									<div class="plan-row-main">
										<span class="eyebrow">
											{s.date}
											{statusBadge(s)}
										</span>
										<span class="plan-row-title">{s.label}</span>
										<span class="plan-row-meta">{metaLine(s)}</span>
									</div>
									<span class="plan-row-chevron">›</span>
								</a>

								{onReschedule && (
									<div class="reschedule">
										<button type="button" class="btn-secondary reschedule-toggle" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
											{openId === s.id ? 'Cancel' : 'Move to a different day'}
										</button>
										{openId === s.id && (
											<div class="tap-row" role="group" aria-label="Move to a different day this week">
												{weekDatesFor(s.date).map((d, i) => (
													<button
														key={d}
														type="button"
														class={`tap-btn ${d === s.date ? 'tap-btn--selected' : ''}`}
														aria-pressed={d === s.date}
														onClick={() => {
															setOpenId(null);
															if (d !== s.date) onReschedule(s, d);
														}}
													>
														{WEEKDAY_LABELS[i]}
													</button>
												))}
											</div>
										)}
									</div>
								)}
							</div>
						))}
				</div>
			))}
		</>
	);
}
