import { useEffect, useState } from 'preact/hooks';
import type { Progress as ProgressData, ProgressGoal, ProgressLift, ProgressWeek } from '../../progress';
import { fetchProgress } from '../api';
import { formatDuration } from '../format';
import { HistoryTabs } from '../components/HistoryTabs';
import { shortDate } from '../components/PlanSetup';
import { ListSkeleton, StripSkeleton } from '../components/Skeletons';

/** "9 Nov" — shortDate without its weekday. */
const dayMonth = (dateIso: string) => shortDate(dateIso).replace(/^\S+\s/, '');
const kg = (n: number) => `${n} kg`;
const km = (n: number) => `${n} km`;
const NAMED_DISTANCES: Record<number, string> = { 50: '5K', 100: '10K', 211: 'Half marathon', 422: 'Marathon' };
const distanceName = (distanceKm: number) => NAMED_DISTANCES[Math.round(distanceKm * 10)] ?? km(distanceKm);

/** Where the estimate stands against the target, in words. */
function verdict(goal: ProgressGoal): string | null {
	if (goal.gap_seconds === null) return null;
	if (goal.gap_seconds <= 0) return `${formatDuration(-goal.gap_seconds)} inside your target on current form.`;
	return `${formatDuration(goal.gap_seconds)} to find to hit your target.`;
}

function GoalCard({ goal }: { goal: ProgressGoal }) {
	const { race, estimate, pb } = goal;
	const said = verdict(goal);
	return (
		<section class="card" aria-label="Race goal">
			<p class="eyebrow">{race ? `${race.name} · ${race.days_until === 0 ? 'today' : `in ${race.days_until} days`}` : distanceName(goal.distance_km)}</p>
			<dl class="summary-strip summary-strip--times">
				<div class="stat">
					<dt class="stat-label">Target</dt>
					<dd class="stat-value">{race?.target_seconds != null ? formatDuration(race.target_seconds) : '—'}</dd>
				</div>
				<div class="stat">
					<dt class="stat-label">Estimate</dt>
					<dd class="stat-value">{estimate ? formatDuration(estimate.seconds) : '—'}</dd>
				</div>
				<div class="stat">
					<dt class="stat-label">Best</dt>
					<dd class="stat-value">{pb ? formatDuration(pb.seconds) : '—'}</dd>
				</div>
			</dl>
			{said && <p class="progress-verdict">{said}</p>}
			{estimate ? (
				<p class="hint">
					Estimated from your {km(estimate.distance_km)} in {formatDuration(estimate.effort_seconds)} on {shortDate(estimate.date)}
					{estimate.source === 'race' ? ', a race.' : ', a training run — on race day you are usually quicker.'}
				</p>
			) : (
				<p class="hint">Log a run of 5 km or more and an estimate appears here.</p>
			)}
			{!race && (
				<p class="hint">
					No race ahead. <a href="#/goals">Add one in Goals</a> to see a target here.
				</p>
			)}
		</section>
	);
}

/** One row of tappable bars, one per week. Selecting a week is shared between
 * the charts, so the line above them reads the same week in both. */
function WeekBars({ label, weeks, value, selected, onSelect }: { label: string; weeks: ProgressWeek[]; value: (w: ProgressWeek) => number; selected: number; onSelect: (i: number) => void }) {
	const max = Math.max(...weeks.map(value), 1);
	return (
		<div class="bars-block">
			<p class="bars-label">
				<span>{label}</span>
				<span class="bars-max">max {km(Math.max(...weeks.map(value)))}</span>
			</p>
			<div class="bars" role="group" aria-label={label}>
				{weeks.map((w, i) => (
					<button
						type="button"
						key={w.week_start}
						class="bar-col"
						aria-pressed={i === selected}
						aria-label={`Week of ${dayMonth(w.week_start)}: ${km(value(w))}`}
						onClick={() => onSelect(i)}
					>
						<span class="bar" style={{ height: `${(value(w) / max) * 100}%` }} />
					</button>
				))}
			</div>
		</div>
	);
}

function RunningCard({ data }: { data: ProgressData }) {
	const { weeks, easy_pace: easy } = data;
	// Open on the last full week: the current one is still filling up.
	const [selected, setSelected] = useState(Math.max(0, weeks.length - 2));
	const week = weeks[selected];
	const lastFour = weeks.filter((w) => !w.is_current).slice(-4);
	const avgKm = lastFour.length ? Math.round((lastFour.reduce((sum, w) => sum + w.km, 0) / lastFour.length) * 10) / 10 : 0;
	const longest = Math.max(...weeks.map((w) => w.long_run_km));

	if (!weeks.some((w) => w.km > 0))
		return (
			<section class="card">
				<h2 class="section-heading">Running</h2>
				<p class="hint">No runs logged in the last 12 weeks.</p>
			</section>
		);

	return (
		<section class="card">
			<h2 class="section-heading">Running</h2>
			<dl class="summary-strip">
				<div class="stat">
					<dt class="stat-label">Km a week</dt>
					<dd class="stat-value">{avgKm}</dd>
				</div>
				<div class="stat">
					<dt class="stat-label">Longest run</dt>
					<dd class="stat-value">{longest}</dd>
				</div>
			</dl>
			<p class="hint">Km a week is the average of the last four full weeks.</p>
			<p class="bars-caption" aria-live="polite">
				Week of {dayMonth(week.week_start)}
				{week.is_current ? ' (so far)' : ''} · {km(week.km)} · longest {km(week.long_run_km)}
			</p>
			<WeekBars label="Km per week" weeks={weeks} value={(w) => w.km} selected={selected} onSelect={setSelected} />
			<WeekBars label="Longest run" weeks={weeks} value={(w) => w.long_run_km} selected={selected} onSelect={setSelected} />
			<p class="bars-axis">
				<span>{dayMonth(weeks[0].week_start)}</span>
				<span>this week</span>
			</p>
			{easy.first_seconds_per_km !== null && easy.last_seconds_per_km !== null && (
				<p class="progress-line">
					Easy pace {formatDuration(easy.first_seconds_per_km)} → {formatDuration(easy.last_seconds_per_km)} /km
					{easy.first_avg_hr !== null && easy.last_avg_hr !== null && ` · heart rate ${Math.round(easy.first_avg_hr)} → ${Math.round(easy.last_avg_hr)}`}
					<span class="hint"> (first six weeks → last six)</span>
				</p>
			)}
		</section>
	);
}

const SPARK_W = 72;
const SPARK_H = 24;

/** The lift's weekly bests placed on the 12-week window, so a gap in training reads as a gap in time. */
function Sparkline({ lift, weekStarts }: { lift: ProgressLift; weekStarts: string[] }) {
	const values = lift.points.map((p) => p.e1rm_kg);
	const min = Math.min(...values);
	const span = Math.max(...values) - min || 1;
	const pad = 3;
	const xy = lift.points.map((p) => {
		const x = pad + (weekStarts.indexOf(p.week_start) / (weekStarts.length - 1)) * (SPARK_W - 2 * pad);
		const y = SPARK_H - pad - ((p.e1rm_kg - min) / span) * (SPARK_H - 2 * pad);
		return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
	});
	const [endX, endY] = xy[xy.length - 1];
	return (
		<svg class="spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true" focusable="false">
			<polyline points={xy.map((p) => p.join(',')).join(' ')} />
			<circle cx={endX} cy={endY} r="3" />
		</svg>
	);
}

function StrengthCard({ data }: { data: ProgressData }) {
	const weekStarts = data.weeks.map((w) => w.week_start);
	return (
		<section class="card">
			<h2 class="section-heading">Strength</h2>
			{data.lifts.length === 0 ? (
				<p class="hint">Train a lift in two different weeks and its trend shows here.</p>
			) : (
				<>
					<ul class="lift-list">
						{data.lifts.map((lift) => (
							<li class="lift-row" key={lift.exercise_id}>
								<span class="lift-name">{lift.name}</span>
								<Sparkline lift={lift} weekStarts={weekStarts} />
								<span class="lift-figures">
									<span class="lift-now">{kg(lift.last_e1rm_kg)}</span>
									<span class="lift-change">
										{lift.change_kg > 0 ? '+' : lift.change_kg < 0 ? '−' : ''}
										{kg(Math.abs(lift.change_kg))}
									</span>
								</span>
							</li>
						))}
					</ul>
					<p class="hint">Estimated one-rep max from your best set each week, and the change over the last 12 weeks.</p>
				</>
			)}
		</section>
	);
}

/** Is the training working: the race against its target, the running build, the lifts. */
export function Progress() {
	const [data, setData] = useState<ProgressData | null>(null);
	const [error, setError] = useState(false);
	const [retryToken, setRetryToken] = useState(0);

	useEffect(() => {
		setError(false);
		fetchProgress()
			.then(setData)
			.catch(() => setError(true));
	}, [retryToken]);

	return (
		<main class="screen">
			<h1>Progress</h1>
			<HistoryTabs active="progress" />
			{error ? (
				<div role="alert">
					<p>Could not load your progress.</p>
					<button type="button" class="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
						Retry
					</button>
				</div>
			) : data === null ? (
				<>
					<StripSkeleton />
					<ListSkeleton rows={4} />
				</>
			) : (
				<>
					<GoalCard goal={data.goal} />
					<RunningCard data={data} />
					<StrengthCard data={data} />
					{data.adherence_pct !== null && (
						<p class="progress-line progress-line--foot">You did {Math.round(data.adherence_pct)}% of your planned sessions over the last 12 weeks.</p>
					)}
				</>
			)}
		</main>
	);
}
