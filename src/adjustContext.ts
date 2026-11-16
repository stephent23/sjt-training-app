// "Adjust current block": everything the server needs to let the assistant
// revise a block in progress — which block is in progress, what was planned vs
// done so far, and the weeks still scheduled (which become the deterministic
// proposal). See migrations/0013_adjust_block.sql. Pure reads; accept lives in
// generator.ts next to the code that inserts sessions.

import { addDaysIso, daysBetweenIso, isMondayIso, weekStartOnOrAfter, weekStartOnOrBefore } from './dates';
import { parseGoalTags } from './types';
import type { ActiveBlock, AdjustContext, AdjustSession, AdjustWeek, ProposedSessionInput, ProposedSetInput, RunType, SessionKind, SessionStatus, WeekProposalInput } from './types';

export interface BlockRow {
	id: number;
	name: string;
	start_date: string;
	week_count: number;
	goals: string;
	goal_tags: string;
	generated_plan_id: number | null;
}

/** Last date (inclusive) of a block. */
function blockEnd(block: BlockRow): string {
	return addDaysIso(block.start_date, block.week_count * 7 - 1);
}

/** The block week (1-based) a date falls in. */
function blockWeekOf(block: BlockRow, date: string): number {
	return Math.floor(daysBetweenIso(block.start_date, date) / 7) + 1;
}

export async function loadBlock(db: D1Database, id: number): Promise<BlockRow | null> {
	return db.prepare(`SELECT id, name, start_date, week_count, goals, goal_tags, generated_plan_id FROM plan_blocks WHERE id = ?`).bind(id).first<BlockRow>();
}

/** The coaching note of the most recent accepted plan for a block: a plan that
 * revised it (generated_plans.block_id), else the one that created it. */
async function blockSummary(db: D1Database, block: BlockRow): Promise<string | null> {
	let row = await db
		.prepare(`SELECT plan_json FROM generated_plans WHERE status = 'accepted' AND block_id = ? ORDER BY id DESC LIMIT 1`)
		.bind(block.id)
		.first<{ plan_json: string }>();
	if (!row && block.generated_plan_id !== null) {
		row = await db.prepare(`SELECT plan_json FROM generated_plans WHERE id = ?`).bind(block.generated_plan_id).first<{ plan_json: string }>();
	}
	if (!row) return null;
	try {
		const summary = (JSON.parse(row.plan_json) as { summary?: unknown }).summary;
		return typeof summary === 'string' && summary.trim() !== '' ? summary : null;
	} catch {
		return null;
	}
}

/** The block `today` falls inside (latest start_date if several), or null. */
export async function findActiveBlock(db: D1Database, today: string): Promise<ActiveBlock | null> {
	const { results } = await db
		.prepare(
			`SELECT id, name, start_date, week_count, goals, goal_tags, generated_plan_id FROM plan_blocks
			 WHERE start_date <= ? ORDER BY start_date DESC, id DESC`,
		)
		.bind(today)
		.all<BlockRow>();
	const block = results.find((b) => blockEnd(b) >= today);
	if (!block) return null;

	const nextMonday = weekStartOnOrAfter(today);
	const weeksRemaining = Math.max(0, Math.floor(daysBetweenIso(nextMonday, addDaysIso(blockEnd(block), 1)) / 7));
	return {
		id: block.id,
		name: block.name,
		start_date: block.start_date,
		week_count: block.week_count,
		current_week: blockWeekOf(block, today),
		weeks_remaining: weeksRemaining,
		next_monday: nextMonday,
		summary: await blockSummary(db, block),
	};
}

/** Why `startDate` cannot start an adjustment of `block`, or null if it can: a
 * Monday, not in the past, inside the block or immediately after it. */
export function adjustStartError(block: BlockRow, startDate: string, today: string): string | null {
	if (!isMondayIso(startDate)) return 'startDate must be a Monday, as YYYY-MM-DD';
	if (startDate < today) return 'startDate must be today or later';
	if (startDate < block.start_date || startDate > addDaysIso(blockEnd(block), 1)) {
		return `startDate must fall inside ${block.name} (${block.start_date} to ${blockEnd(block)}) or the Monday right after it`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Rendering planned / done as short strings for the assistant.

interface PlannedSetRow {
	session_id: number;
	exercise_id: number;
	exercise_name: string;
	order_index: number;
	target_sets: number;
	rep_low: number;
	rep_high: number;
	target_weight_kg: number | null;
	rest_seconds: number;
	notes: string | null;
	superset_group: number | null;
}
interface LoggedSetRow {
	session_id: number;
	exercise_id: number;
	exercise_name: string;
	weight_kg: number;
	reps: number;
	rir: number;
}
interface PlannedRunRow {
	session_id: number;
	run_type: RunType;
	target_minutes: number | null;
	target_km: number | null;
	structure_json: string | null;
}
interface LoggedRunRow {
	session_id: number;
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	rpe_1_10: number | null;
}
interface SessionRow {
	id: number;
	date: string;
	kind: SessionKind;
	label: string;
	status: SessionStatus;
	origin: 'planned' | 'manual';
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

function clock(totalSeconds: number): string {
	const s = Math.round(totalSeconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function describePlannedLift(rows: PlannedSetRow[]): string {
	if (rows.length === 0) return 'no exercises';
	return rows
		.map((r) => {
			const reps = r.rep_low === r.rep_high ? `${r.rep_low}` : `${r.rep_low}-${r.rep_high}`;
			return `${r.exercise_name} ${r.target_sets}x${reps}${r.target_weight_kg === null ? '' : ` @${num(r.target_weight_kg)}kg`}`;
		})
		.join('; ');
}

function describeDoneLift(planned: PlannedSetRow[], logged: LoggedSetRow[]): string | null {
	if (logged.length === 0) return null;
	const byExercise = new Map<number, LoggedSetRow[]>();
	for (const l of logged) byExercise.set(l.exercise_id, [...(byExercise.get(l.exercise_id) ?? []), l]);

	const parts: string[] = [];
	const render = (name: string, sets: LoggedSetRow[]) => {
		const weights = new Set(sets.map((s) => s.weight_kg));
		const rirs = sets.map((s) => s.rir);
		const lo = Math.min(...rirs);
		const hi = Math.max(...rirs);
		const rir = lo === hi ? `RIR ${lo}` : `RIR ${lo}-${hi}`;
		parts.push(
			weights.size === 1
				? `${name} ${num(sets[0].weight_kg)}kg x${sets.map((s) => s.reps).join('/')} (${rir})`
				: `${name} ${sets.map((s) => `${num(s.weight_kg)}x${s.reps}`).join('/')}kg (${rir})`,
		);
	};
	for (const p of planned) {
		const sets = byExercise.get(p.exercise_id);
		if (sets) {
			render(p.exercise_name, sets);
			byExercise.delete(p.exercise_id);
		} else {
			parts.push(`${p.exercise_name} not done`);
		}
	}
	for (const sets of byExercise.values()) render(sets[0].exercise_name, sets); // swapped-in exercises
	return parts.join('; ');
}

function describePlannedRun(run: PlannedRunRow | undefined): string {
	if (!run) return 'run';
	const target = [run.target_km === null ? null : `${num(run.target_km)} km`, run.target_minutes === null ? null : `${num(run.target_minutes)} min`].filter(Boolean);
	return target.length > 0 ? `${run.run_type} ${target.join(' / ')}` : run.run_type;
}

function describeDoneRun(run: LoggedRunRow | undefined): string | null {
	if (!run) return null;
	return [`${num(run.distance_km)} km in ${clock(run.duration_seconds)}`, run.rpe_1_10 === null ? null : `RPE ${run.rpe_1_10}`, run.avg_hr === null ? null : `avg HR ${run.avg_hr}`]
		.filter(Boolean)
		.join(', ');
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
	const map = new Map<number, T[]>();
	for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
	return map;
}

function toProposedSession(session: SessionRow, sets: PlannedSetRow[], run: PlannedRunRow | undefined): ProposedSessionInput {
	const plannedSets: ProposedSetInput[] = sets.map((r) => ({
		exercise_id: r.exercise_id,
		order_index: r.order_index,
		target_sets: r.target_sets,
		rep_low: r.rep_low,
		rep_high: r.rep_high,
		target_weight_kg: r.target_weight_kg,
		rest_seconds: r.rest_seconds,
		notes: r.notes,
		superset_group: r.superset_group,
	}));
	return {
		date: session.date,
		kind: session.kind,
		label: session.label,
		plannedSets,
		plannedRun: session.kind === 'run' && run ? { run_type: run.run_type, target_minutes: run.target_minutes, target_km: run.target_km, structure_json: run.structure_json } : null,
	};
}

/**
 * The adjust context for a block, and the deterministic weeks: the sessions
 * actually scheduled from `startDate` on, one proposal week per requested week
 * (an empty week copies the previous one forward, which is how a block is
 * extended). Five queries however long the block, scoped by sub-select so no
 * id list is bound.
 */
export async function buildAdjustContext(
	db: D1Database,
	block: BlockRow,
	weekCount: number,
	startDate: string,
): Promise<{ adjust: AdjustContext; weeks: WeekProposalInput[] }> {
	// The block's own sessions, plus manual runs dated inside it (they belong to
	// no block but are part of what he did in these weeks).
	const scope = (col: string) => `${col} IN (SELECT id FROM sessions WHERE block_id = ?1 OR (origin = 'manual' AND date >= ?2 AND date <= ?3))`;
	const bind = [block.id, block.start_date, blockEnd(block)] as const;

	const [sessions, plannedSets, loggedSets, plannedRuns, loggedRuns, summary] = await Promise.all([
		db
			.prepare(`SELECT id, date, kind, label, status, origin FROM sessions WHERE ${scope('id')} ORDER BY date, id`)
			.bind(...bind)
			.all<SessionRow>(),
		db
			.prepare(
				`SELECT ps.session_id, ps.exercise_id, e.name AS exercise_name, ps.order_index, ps.target_sets, ps.rep_low, ps.rep_high,
				        ps.target_weight_kg, ps.rest_seconds, ps.notes, ps.superset_group
				 FROM planned_sets ps JOIN exercises e ON e.id = ps.exercise_id
				 WHERE ${scope('ps.session_id')} ORDER BY ps.session_id, ps.order_index`,
			)
			.bind(...bind)
			.all<PlannedSetRow>(),
		db
			.prepare(
				`SELECT ls.session_id, ls.exercise_id, e.name AS exercise_name, ls.weight_kg, ls.reps, ls.rir
				 FROM logged_sets ls JOIN exercises e ON e.id = ls.exercise_id
				 WHERE ${scope('ls.session_id')} ORDER BY ls.session_id, ls.set_index`,
			)
			.bind(...bind)
			.all<LoggedSetRow>(),
		db
			.prepare(`SELECT session_id, run_type, target_minutes, target_km, structure_json FROM planned_runs WHERE ${scope('session_id')}`)
			.bind(...bind)
			.all<PlannedRunRow>(),
		db
			.prepare(`SELECT session_id, distance_km, duration_seconds, avg_hr, rpe_1_10 FROM logged_runs WHERE ${scope('session_id')}`)
			.bind(...bind)
			.all<LoggedRunRow>(),
		blockSummary(db, block),
	]);

	const setsBySession = groupBy(plannedSets.results, (r) => r.session_id);
	const loggedBySession = groupBy(loggedSets.results, (r) => r.session_id);
	const plannedRunBySession = new Map(plannedRuns.results.map((r) => [r.session_id, r]));
	const loggedRunBySession = new Map(loggedRuns.results.map((r) => [r.session_id, r]));

	const describe = (s: SessionRow): AdjustSession => {
		const sets = setsBySession.get(s.id) ?? [];
		const isLift = s.kind === 'lift';
		return {
			date: s.date,
			kind: s.kind,
			label: s.label,
			status: s.status,
			planned: s.origin === 'manual' ? 'unplanned run' : isLift ? describePlannedLift(sets) : describePlannedRun(plannedRunBySession.get(s.id)),
			done: isLift ? describeDoneLift(sets, loggedBySession.get(s.id) ?? []) : describeDoneRun(loggedRunBySession.get(s.id)),
		};
	};
	const toWeeks = (list: SessionRow[]): AdjustWeek[] => {
		const weeks = new Map<number, AdjustSession[]>();
		for (const s of list) {
			const n = blockWeekOf(block, s.date);
			weeks.set(n, [...(weeks.get(n) ?? []), describe(s)]);
		}
		return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([week_number, sessionList]) => ({ week_number, sessions: sessionList }));
	};

	const elapsed = sessions.results.filter((s) => s.date < startDate);
	const scheduled = sessions.results.filter((s) => s.date >= startDate && s.origin !== 'manual');
	const firstWeekNumber = blockWeekOf(block, startDate);

	// Deterministic weeks: what is scheduled in each requested week; an empty
	// week (extending the block) repeats the previous week, 7 days on.
	const weeks: WeekProposalInput[] = [];
	for (let i = 0; i < weekCount; i++) {
		const from = addDaysIso(startDate, i * 7);
		const to = addDaysIso(from, 6);
		let proposed = scheduled.filter((s) => s.date >= from && s.date <= to).map((s) => toProposedSession(s, setsBySession.get(s.id) ?? [], plannedRunBySession.get(s.id)));
		if (proposed.length === 0 && i > 0) {
			proposed = weeks[i - 1].sessions.map((s) => ({
				date: addDaysIso(s.date, 7),
				kind: s.kind,
				label: s.label,
				plannedSets: s.plannedSets.map((set) => ({ ...set })),
				plannedRun: s.plannedRun ? { ...s.plannedRun } : null,
			}));
		}
		weeks.push({ week_number: firstWeekNumber + i, sessions: proposed });
	}

	return {
		adjust: {
			block: {
				id: block.id,
				name: block.name,
				start_date: block.start_date,
				week_count: block.week_count,
				goals: block.goals,
				goal_tags: parseGoalTags(block.goal_tags),
				summary,
			},
			firstWeekNumber,
			elapsed: toWeeks(elapsed),
			scheduled: toWeeks(scheduled),
		},
		weeks,
	};
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'Mon 14 Dec' */
function shortDate(iso: string): string {
	const d = new Date(`${iso}T00:00:00Z`);
	return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Blocks may not overlap in dates. An adjusting plan's span (first..last
 * session date, widened to whole weeks) must stay clear of every OTHER block's
 * range; otherwise a message naming the first one it runs into, else null. */
export async function adjustOverlapError(db: D1Database, blockId: number, span: { first: string; last: string }): Promise<string | null> {
	const first = weekStartOnOrBefore(span.first);
	const last = addDaysIso(weekStartOnOrBefore(span.last), 6);
	const { results } = await db
		.prepare(`SELECT id, name, start_date, week_count, goals, goal_tags, generated_plan_id FROM plan_blocks WHERE id != ? ORDER BY start_date`)
		.bind(blockId)
		.all<BlockRow>();
	const other = results.find((b) => b.start_date <= last && blockEnd(b) >= first);
	if (!other) return null;
	return other.start_date >= first
		? `${other.name} starts ${shortDate(other.start_date)} — shorten this block or adjust ${other.name} instead`
		: `${other.name} runs until ${shortDate(blockEnd(other))} — start this block after it or adjust ${other.name} instead`;
}
