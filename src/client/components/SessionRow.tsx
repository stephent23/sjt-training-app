import type { SessionSummary } from '../../types';

// Shared list-row rendering used by both Plan (upcoming) and History (past)
// — the two screens differ only in which date range they fetch and where a
// row links to, not in how a row looks.

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
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
}

export function SessionList({ sessions, linkFor, emptyMessage }: SessionListProps) {
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
						<a key={s.id} class="row plan-row" href={linkFor(s)}>
							<div class="plan-row-main">
								<span class="eyebrow">{s.date}</span>
								<span class="plan-row-title">{s.label}</span>
								<span class="plan-row-meta">{metaLine(s)}</span>
							</div>
							<span class="plan-row-chevron">›</span>
						</a>
					))}
				</div>
			))}
		</>
	);
}
