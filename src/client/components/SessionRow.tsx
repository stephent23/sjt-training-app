import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { capitalize, loggedRunSummary } from '../format';
import { weekDatesFor, WEEKDAY_LABELS } from '../weekDates';
import { weekLabel } from '../weekLabel';
import { Icon } from './Icon';

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
	if (s.status === 'completed')
		return (
			<span class="badge badge--done">
				<Icon name="check" />
				Completed
			</span>
		);
	return <span class="badge badge--skipped">{capitalize(s.status)}</span>;
}

/** What kind of session, as a word plus an icon — the same badge Today's hero
 * wears, so a row and the card it came from read alike. */
export function typeBadge(s: SessionSummary) {
	return (
		<span class={`badge badge--${s.kind}`}>
			<Icon name={s.kind === 'lift' ? 'lift' : 'run'} />
			{s.kind === 'lift' ? 'Lift' : s.run_type ? s.run_type : 'Run'}
		</span>
	);
}

/** The fixed-width day column ("Mon" over "24"). Parsed by hand from the ISO
 * date so it never shifts with the viewer's timezone. Plain text, so a
 * screen reader hears "Mon 24" before the badges and the title. */
function DayColumn({ date }: { date: string }) {
	const [y, m, d] = date.split('-').map(Number);
	const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
	return (
		<span class="plan-day">
			<span class="plan-day-name">{WEEKDAY_LABELS[weekday]}</span>
			<span class="plan-day-num">{String(d).padStart(2, '0')}</span>
		</span>
	);
}

/** History's one-line result: what was actually done, as a short mono string. */
function resultText(s: SessionSummary): string | null {
	if (s.status === 'skipped') return 'Not done';
	if (s.kind === 'lift') return s.logged_set_count > 0 ? `${s.logged_set_count} sets` : null;
	if (s.logged_distance_km != null && s.logged_duration_seconds != null) return loggedRunSummary(s.logged_distance_km, s.logged_duration_seconds);
	return null;
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
function weekHeading(label: string, items: SessionSummary[]): string {
	const done = items.filter((s) => s.status === 'completed').length;
	return `${label} · ${done} of ${items.length} done`;
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

/** "2/5" in a ring: how much of the week has actually happened. */
function WeekRing({ items }: { items: SessionSummary[] }) {
	const done = items.filter((s) => s.status === 'completed').length;
	return (
		<span class="ring" style={{ '--value': String(items.length ? done / items.length : 0) }} role="img" aria-label={`${done} of ${items.length} sessions done`}>
			<span class="ring-label">
				{done}/{items.length}
			</span>
		</span>
	);
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
	/** Plan: finished sessions drop off the list but still count towards the
	 * week's "2 of 5 done" ring, so the ring is computed from the full set. */
	hideCompleted?: boolean;
	/** History: one line per row, the logged result as a mono badge. */
	dense?: boolean;
	/** Shown beside the empty message (Plan's "Generate a plan"). */
	emptyAction?: ComponentChildren;
}

export function SessionList({ sessions, linkFor, emptyMessage, onReschedule, collapsible, hideCompleted, dense, emptyAction }: SessionListProps) {
	const today = todayIso();
	const [openId, setOpenId] = useState<number | null>(null);
	// Which week groups are open, by index. Starts as just the first — Plan
	// fetches from today onwards, so group 0 is the current week by
	// construction. Independent toggles rather than an accordion: comparing this
	// week with next is a reasonable thing to want.
	const [openWeeks, setOpenWeeks] = useState<Set<number>>(() => new Set([0]));

	// Sessions arrive already ordered by date, so same-week rows are
	// contiguous — group them into one heading per run without re-sorting.
	// `all` keeps finished sessions that `items` hides, for the ring's count.
	const groups: { week: number; block: number | null; label: string; items: SessionSummary[]; all: SessionSummary[] }[] = [];
	for (const s of sessions) {
		const visible = !hideCompleted || s.status !== 'completed';
		const current = groups[groups.length - 1];
		if (current && current.week === s.week_number && current.block === (s.block_id ?? null)) {
			current.all.push(s);
			if (visible) current.items.push(s);
		} else {
			groups.push({ week: s.week_number, block: s.block_id ?? null, label: weekLabel(s), items: visible ? [s] : [], all: [s] });
		}
	}
	// A week whose sessions are all finished has nothing left to show.
	for (let i = groups.length - 1; i >= 0; i--) if (groups[i].items.length === 0) groups.splice(i, 1);

	if (groups.length === 0) {
		if (!emptyAction) return <p class="empty-state">{emptyMessage}</p>;
		// The message stays its own .empty-state element; the action sits beside
		// it inside a card so an empty screen has a way forward.
		return (
			<div class="card empty-card">
				<p class="empty-state">{emptyMessage}</p>
				{emptyAction}
			</div>
		);
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
				<div key={`week-${g.block}-${g.week}`}>
					{collapsible ? (
						<button
							type="button"
							class="plan-row exercise-card-summary"
							aria-expanded={isOpen(groupIndex)}
							onClick={() => toggle(groupIndex)}
						>
							{groupIndex === 0 && hideCompleted && <WeekRing items={g.all} />}
							<div class="plan-row-main">
								<span class="plan-row-title">{g.label}</span>
								<span class="plan-row-meta">{weekSummary(g.items)}</span>
							</div>
							<span class="plan-row-chevron">
								<Icon name="chevron-right" class={isOpen(groupIndex) ? 'icon--down' : undefined} />
							</span>
						</button>
					) : (
						<h2 class="section-heading">{weekHeading(g.label, g.all)}</h2>
					)}
					{isOpen(groupIndex) &&
						g.items.map((s) => (
							<div key={s.id} class={`plan-item${s.date === today ? ' plan-item--today' : ''}${dense ? ' plan-item--dense' : ''}`}>
								<a class="row plan-row" href={linkFor(s)}>
									<DayColumn date={s.date} />
									<div class="plan-row-main">
										<span class="eyebrow card-eyebrow">
											{typeBadge(s)}
											{statusBadge(s)}
										</span>
										<span class="plan-row-title">{s.label}</span>
										{!dense && <span class="plan-row-meta">{metaLine(s)}</span>}
									</div>
									{dense && resultText(s) && <span class="badge badge--result">{resultText(s)}</span>}
									{/* A finished row swaps its chevron for a tick. It stays a
									    link — Review is behind it — but "done" should read
									    before the meta line is. The word still lives in the
									    status badge, so the tick is never the only carrier. */}
									<span class={`plan-row-chevron ${s.status === 'completed' ? 'plan-row-chevron--done' : ''}`}>
										<Icon name={s.status === 'completed' ? 'check' : 'chevron-right'} />
									</span>
								</a>

								{/* Rescheduling is occasional, so it recedes to a small quiet
								    toggle beside the row; the day chips open underneath. */}
								{onReschedule && (
									<>
										<button
											type="button"
											class="btn-quiet btn-small plan-item-move"
											aria-label={openId === s.id ? 'Cancel moving this session' : 'Move to a different day'}
											aria-expanded={openId === s.id}
											onClick={() => setOpenId(openId === s.id ? null : s.id)}
										>
											<Icon name="calendar" />
											{openId === s.id ? 'Cancel' : 'Move'}
										</button>
										{openId === s.id && (
											<div class="reschedule tap-row" role="group" aria-label="Move to a different day this week">
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
									</>
								)}
							</div>
						))}
				</div>
			))}
		</>
	);
}
