import type { Race } from '../../types';
import { formatDuration, formatPace } from '../format';
import { untilLabel } from '../goalsSummary';

function kmLabel(km: number): string {
	return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

function dateLabel(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

interface RaceListProps {
	races: Race[];
	today: string;
	onSelect: (race: Race) => void;
}

/** Upcoming goals soonest first (a past race still missing its time stays
 * here, asking for it), then a collapsed list of results with PBs marked. */
export function RaceList({ races, today, onSelect }: RaceListProps) {
	const goals = races.filter((r) => r.result_seconds == null).sort((a, b) => a.date.localeCompare(b.date));
	const results = races.filter((r) => r.result_seconds != null).sort((a, b) => b.date.localeCompare(a.date));

	const best = new Map<number, number>();
	for (const r of results) best.set(r.distance_km, Math.min(best.get(r.distance_km) ?? Infinity, r.result_seconds as number));

	return (
		<>
			{goals.length === 0 && <p class="hint">No races yet.</p>}
			<ul class="race-list">
				{goals.map((r) => {
					const missed = r.date < today;
					return (
						<li key={r.id}>
							<button type="button" class="race-row" onClick={() => onSelect(r)}>
								<span class="race-row-main">
									<strong>{r.name}</strong>
									<span class="eyebrow">{r.priority === 'A' ? 'Main' : 'Tune-up'}</span>
								</span>
								<span class="race-row-sub">
									{[dateLabel(r.date), kmLabel(r.distance_km), r.target_seconds ? `target ${formatDuration(r.target_seconds)}` : null, missed ? null : untilLabel(r.date, today)]
										.filter(Boolean)
										.join(' · ')}
								</span>
								{missed && <span class="race-row-sub race-row-cta">Add your time</span>}
							</button>
						</li>
					);
				})}
			</ul>

			{results.length > 0 && (
				<details class="race-results">
					<summary>Results</summary>
					<ul class="race-list">
						{results.map((r) => {
							const seconds = r.result_seconds as number;
							const pace = formatPace(r.distance_km, seconds);
							return (
								<li key={r.id}>
									<button type="button" class="race-row" onClick={() => onSelect(r)}>
										<span class="race-row-main">
											<strong>{r.name}</strong>
											<span class="eyebrow">{best.get(r.distance_km) === seconds ? 'PB' : r.priority === 'A' ? 'Main' : 'Tune-up'}</span>
										</span>
										<span class="race-row-sub">
											{[dateLabel(r.date), kmLabel(r.distance_km), formatDuration(seconds), pace].filter(Boolean).join(' · ')}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</details>
			)}
		</>
	);
}
