import { useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { weekDatesFor, WEEKDAY_LABELS } from '../weekDates';

// Shared list-row rendering used by both Plan (upcoming) and History (past)
// — the two screens differ only in which date range they fetch, where a row
// links to, and whether rescheduling is offered (Plan only — moving a past
// session doesn't make sense), not in how a row looks.

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// Planned is the default, unremarkable state — no badge needed. Completed
// and skipped are both worth calling out explicitly so a row's status is
// visible without opening it, especially once more than one row can share
// a day.
function statusBadge(s: SessionSummary) {
	if (s.status === 'planned') return null;
	return <span class="eyebrow--accent"> · {capitalize(s.status)}</span>;
}

function metaLine(s: SessionSummary): string {
	if (s.kind === 'lift') {
		const exercises = `${s.exercise_count} exercise${s.exercise_count === 1 ? '' : 's'}`;
		const sets = `${s.planned_set_count} set${s.planned_set_count === 1 ? '' : 's'}`;
		return `${exercises} · ${sets}`;
	}

	const typeLabel = s.run_type ? capitalize(s.run_type) : 'Run';
	if (s.target_minutes) return `${typeLabel} · ${s.target_minutes} min`;
	if (s.target_km) return `${typeLabel} · ${s.target_km} km`;
	return typeLabel;
}

interface SessionListProps {
	sessions: SessionSummary[];
	linkFor: (session: SessionSummary) => string;
	emptyMessage: string;
	onReschedule?: (session: SessionSummary, date: string) => void;
}

export function SessionList({ sessions, linkFor, emptyMessage, onReschedule }: SessionListProps) {
	const [openId, setOpenId] = useState<number | null>(null);

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

	return (
		<>
			{groups.map((g) => (
				<div key={`week-${g.week}`}>
					<h2 class="section-heading">Week {g.week}</h2>
					{g.items.map((s) => (
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
