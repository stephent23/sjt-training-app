// src/generator.ts — weekly generator orchestration (manual export/import, see
// migrations/0004_generator.sql, migrations/0005_generator_multiweek.sql, and
// the approved plan). No AI call lives here: buildExportContext/
// generateNextWeeks produce the deterministic pass as plain JSON for a human
// to paste into whatever AI assistant they have; importProposal validates and
// persists whatever comes back.

import { addDaysIso, daysBetweenIso, weekStartOnOrAfter, weekStartOnOrBefore } from './dates';
import { deleteSessionStatements } from './sessionDelete';
import { sqlIn } from './sql';
import { progressExercise, type ExercisePrescription, type LoggedSetForProgression } from './progression';
import { progressRun, type LoggedRunForProgression } from './runProgression';
import { parseGoalTags, RUN_TYPES } from './types';
import type { RaceContext } from './raceContext';
import type { TrainingSummary } from './trainingSummary';
import type {
	Exercise,
	LoggedRunEntry,
	LoggedSetEntry,
	MultiWeekProposal,
	MultiWeekProposalInput,
	ProposedRun,
	ProposedSessionInput,
	ProposedSetInput,
	RunType,
	SessionRow,
	WeekProposal,
	WeekProposalInput,
} from './types';

/** Raw history payload — full rows, not derived stats (plan §4). Asymmetric on
 * purpose: loggedSets covers the anchor week and the one before it (all the
 * deterministic weight-progression formula ever reads), while loggedRuns
 * reaches back RUN_HISTORY_WEEKS — runs happen less often per week than lift
 * sessions and vary more (pace, terrain, recovery), so two weeks isn't enough
 * data points for a human or an assistant to see a real trend in. */
export interface HistoryWindow {
	loggedSets: (LoggedSetEntry & { session_id: number; exercise_id: number })[];
	loggedRuns: (LoggedRunEntry & { session_id: number })[];
}

export interface PainFlags {
	shoulder: boolean;
	back: boolean;
}

/**
 * Everything the export/import round-trip needs: the deterministic proposal
 * itself, why each call was made, the raw history that informed it, which
 * sessions were skipped, and enough catalogue/settings context for
 * validateProposal to check a pasted-back answer without any further DB
 * access. This is exactly the content a live API call would have sent as its
 * prompt — here it's just returned as JSON for download instead.
 */
export interface ExportContext {
	deterministicProposal: MultiWeekProposalInput;
	/**
	 * Convention: weeks at index >= speculativeFromWeek - 1 in
	 * deterministicProposal.weeks (i.e. week_number >= the first week's
	 * week_number + (speculativeFromWeek - 1)) are speculative flat copies,
	 * not real deterministic output. Always 2 — week 1 is always the one real
	 * (or genuinely-empty) week; when weekCount === 1 there simply are no
	 * weeks past it, so the value is moot but kept at 2 for consistency
	 * rather than becoming conditional. Callers (the client) should check
	 * `weekCount > 1` before showing any "speculative" badge, or compare an
	 * index against `speculativeFromWeek - 1`.
	 */
	speculativeFromWeek: number;
	reasons: Record<string, string>;
	historyWindow: HistoryWindow;
	skippedSessions: SessionRow[];
	goals: string;
	/** Tick-box goals from settings — a fixed vocabulary the prompt can explain,
	 * alongside the free text. See GOAL_TAG_GROUPS in src/types.ts. */
	goalTags: string[];
	daysPerWeek: number;
	exerciseCatalogue: Exercise[];
	painFlags: PainFlags;
}

/**
 * What GET /export actually returns: the pure ExportContext plus the two
 * clock-derived fields. They are typed here but filled in by the route, not by
 * buildExportContext — that function stays clock-free so every generator test
 * can assert exact dates without stubbing time.
 *
 * Without an anchor, a cold-start export contains no date at all (empty weeks,
 * empty history, empty skipped list). An assistant writing a plan from scratch
 * then has to invent dates, and isRealIsoDate accepts any real calendar date —
 * so a plan dated last year imports cleanly and then never matches a
 * Today/Plan query again.
 */
export interface ExportPayload extends ExportContext, RaceContext {
	/** Heart-rate anchors from settings; null until the person enters them. */
	athlete: import('./types').Athlete;
	today: string;
	weekStartDate: string;
	/** Twelve weeks of per-week aggregates (see src/trainingSummary.ts) — the
	 * trend view historyWindow's raw rows are too short to show. Built in the
	 * route alongside the clock, so buildExportContext stays as it was. */
	trainingSummary: TrainingSummary;
	/** The owner's own words after sessions in the last RUN_HISTORY_WEEKS, newest first. */
	sessionNotes: SessionNote[];
}

export interface SessionNote {
	date: string;
	kind: string;
	label: string;
	note: string;
	energy_1_5?: number;
}

const SESSION_NOTE_MAX_CHARS = 400;
const SESSION_NOTE_MAX_ENTRIES = 30;

export async function buildSessionNotes(db: D1Database, today: string): Promise<SessionNote[]> {
	const { results } = await db
		.prepare(
			`SELECT s.date, s.kind, s.label, f.note, f.energy_1_5
			 FROM session_feedback f JOIN sessions s ON s.id = f.session_id
			 WHERE s.date >= ?1 AND s.date <= ?2 AND f.note IS NOT NULL AND TRIM(f.note) <> ''
			 ORDER BY s.date DESC, s.id DESC LIMIT ?3`,
		)
		.bind(addDaysIso(today, -7 * RUN_HISTORY_WEEKS), today, SESSION_NOTE_MAX_ENTRIES)
		.all<{ date: string; kind: string; label: string; note: string; energy_1_5: number | null }>();
	return results.map((r) => ({
		date: r.date,
		kind: r.kind,
		label: r.label,
		note: r.note.trim().slice(0, SESSION_NOTE_MAX_CHARS),
		...(r.energy_1_5 === null ? {} : { energy_1_5: r.energy_1_5 }),
	}));
}

export type ImportResult = { ok: true; id: number } | { ok: false; errors: string[] };

interface PlannedSetJoinRow {
	id: number;
	session_id: number;
	exercise_id: number;
	order_index: number;
	target_sets: number;
	rep_low: number;
	rep_high: number;
	target_weight_kg: number | null;
	rest_seconds: number;
	notes: string | null;
	superset_group: number | null;
	increment_kg: number;
}

interface PlannedRunRow {
	id: number;
	session_id: number;
	run_type: RunType;
	target_minutes: number | null;
	target_km: number | null;
	structure_json: string | null;
}

interface LoggedSetRow {
	id: number;
	session_id: number;
	exercise_id: number;
	set_index: number;
	weight_kg: number;
	reps: number;
	rir: number;
	rest_taken_seconds: number | null;
	performed_on: string;
}

/** Exactly the logged_runs columns the history window forwards, plus the two
 * the export drops. Derived from LoggedRunEntry so a new watch metric reaches
 * the AI reviewer without a second field list to remember. */
type LoggedRunRow = LoggedRunEntry & { id: number; session_id: number };

/** How many weeks of run history to export, counting back from the anchor
 * week inclusive. Wider than the 2-week lift window on purpose — see the doc
 * comment on HistoryWindow. */
export const RUN_HISTORY_WEEKS = 6;

/** The most a plan may raise a lift's weight, or the long run's distance, in one
 * week over the highest earlier value — a guard against an error or a reckless
 * answer, not a target. It is deliberately looser than the mechanical pass's
 * own steps (progression.ts and runProgression.ts stay cautious, +10% a week
 * for the long run): someone returning to fitness can rebuild toward what they
 * have done before much faster than that, and the prompt tells the assistant
 * when the evidence supports it. How hard to push is judgement, in the prompt;
 * this only stops the absurd. */
export const MAX_PLAN_STEP = 0.25;

/**
 * Runs the deterministic progression pass over the most recently scheduled
 * week to produce week 1, then — for weekCount > 1 — appends flat copies of
 * week 1 (same sessions/plannedSets/plannedRun values, dates shifted forward
 * an additional 7 days per extra week) as weeks 2..weekCount. Weeks beyond
 * the first are inherently speculative: nobody has logged anything against
 * them yet, and mechanically chaining progressExercise forward on assumed
 * data would dress up a guess as arithmetic (see plan §1) — so they start as
 * plain copies and the pasted-back prompt asks the AI reviewer to apply real
 * periodization judgement across them instead.
 *
 * Six bulk queries regardless of week count — sessions, planned_sets+
 * exercises joined, logged_sets, planned_runs, logged_runs, session_feedback,
 * all via `WHERE id IN (...)` — never N+1 per exercise (this is a 2-week
 * window, not a single session); the speculative weeks are pure in-memory
 * copies, no further queries.
 */
export async function buildExportContext(
	db: D1Database,
	weekCount: number,
	today: string,
	startDate: string = weekStartOnOrAfter(today),
): Promise<ExportContext> {
	const settingsRow = await db
		.prepare(`SELECT * FROM settings WHERE id = 1`)
		.first<{ id: number; goals: string; days_per_week: number; goal_tags: string }>();
	const goals = settingsRow?.goals ?? '';
	const goalTags = parseGoalTags(settingsRow?.goal_tags);
	const daysPerWeek = settingsRow?.days_per_week ?? 5;

	const { results: exerciseCatalogue } = await db.prepare(`SELECT * FROM exercises`).all<Exercise>();

	// A proposal is always a NEW BLOCK: its weeks are numbered 1..weekCount and
	// week 1 lands on startDate (a Monday). Week numbers restart per block
	// (migrations/0010_plan_blocks.sql), so nothing here may use week_number to
	// decide which week is "newest" — everything is date-based.
	//
	// The anchor week is the calendar week (Mon-Sun) holding the newest session
	// with something logged against it. Multi-week accept schedules unlogged
	// future weeks, so "newest scheduled" and "newest logged" differ; progression
	// has to read from whatever was actually trained. Manual runs are ignored
	// when choosing the anchor — they are not part of any plan's week, and a
	// run logged ahead of the schedule must not make an empty week the anchor.
	const anchorDateRow = await db
		.prepare(
			`SELECT MAX(s.date) AS d FROM sessions s
			 WHERE s.origin <> 'manual'
			   AND (EXISTS (SELECT 1 FROM logged_sets ls WHERE ls.session_id = s.id)
			     OR EXISTS (SELECT 1 FROM logged_runs lr WHERE lr.session_id = s.id))`,
		)
		.first<{ d: string | null }>();
	const anchorDate = anchorDateRow?.d ?? null;

	// Bulk query 5/6: logged_runs across the wider RUN_HISTORY_WEEKS window —
	// six weeks of actual running history, not based on session week_numbers
	// (which may not exist). Columns listed rather than SELECT * so `logged_at`
	// (an internal audit timestamp) doesn't leak into the exported history window.
	// Not filtered by origin — a manual run's data belongs here even though manual
	// sessions are excluded from the copy-forward template above.
	const sixWeeksAgoIso = addDaysIso(today, -7 * RUN_HISTORY_WEEKS);
	const { results: loggedRunRows } = await db
		.prepare(
			`SELECT lr.id, lr.session_id, lr.distance_km, lr.duration_seconds, lr.avg_hr, lr.max_hr, lr.avg_cadence_spm,
			        lr.elevation_gain_m, lr.aerobic_training_effect, lr.rpe_1_10, lr.interval_pace_seconds_per_km,
			        lr.performed_on, lr.note
			 FROM logged_runs lr
			 WHERE lr.performed_on >= ? AND lr.performed_on <= ?`,
		)
		.bind(sixWeeksAgoIso, today)
		.all<LoggedRunRow>();

	if (anchorDate === null) {
		// Nothing has ever been logged — either no plan exists yet or one was
		// scheduled that nobody has started. Either way there is nothing to
		// progress from, so every week is empty and the assistant writes them
		// from scratch. We still honour weekCount with that many empty weeks
		// (1..weekCount) rather than collapsing to one — an empty N-week shape
		// is more useful for the caller to render than a truncated one.
		const painFlags: PainFlags = { shoulder: false, back: false }; // nothing logged => no feedback to read
		return {
			deterministicProposal: {
				weeks: Array.from({ length: weekCount }, (_, i) => ({ week_number: i + 1, sessions: [] })),
			},
			speculativeFromWeek: 2,
			reasons: {},
			historyWindow: { loggedSets: [], loggedRuns: loggedRunRows.map(({ id: _id, ...run }) => run) },
			skippedSessions: [],
			goals,
			goalTags,
			daysPerWeek,
			exerciseCatalogue,
			painFlags,
		};
	}

	const anchorMonday = weekStartOnOrBefore(anchorDate);
	const anchorSunday = addDaysIso(anchorMonday, 6);
	const priorMonday = addDaysIso(anchorMonday, -7);

	// Bulk query 1/5: sessions across the anchor week and the one before it.
	const { results: windowSessions } = await db
		.prepare(`SELECT * FROM sessions WHERE date >= ? AND date <= ? ORDER BY date`)
		.bind(priorMonday, anchorSunday)
		.all<SessionRow>();

	const anchorWeekSessions = windowSessions.filter((s) => s.date >= anchorMonday);
	// A run recorded by hand (migrations/0008_manual_runs.sql) must not become a
	// template for every future week — validateSessionCount requires week 1 to
	// hold at most days_per_week sessions, so an extra copied-forward session
	// would break the export's own re-importability. Its logged data still
	// reaches historyWindow below (that query is over the unfiltered window),
	// it just isn't copied forward or counted as skipped.
	const sessionsToProgress = anchorWeekSessions.filter((s) => s.origin !== 'manual');
	const sessionsToProgressIds = sessionsToProgress.map((s) => s.id);
	const windowSessionIds = windowSessions.map((s) => s.id);

	// Bulk query 2/5: planned_sets joined with exercises, anchor week only (manual sessions excluded) — this is what's actually being progressed.
	const { results: plannedSetRows } = sessionsToProgressIds.length
		? await db
				.prepare(
					`SELECT ps.id, ps.session_id, ps.exercise_id, ps.order_index, ps.target_sets, ps.rep_low, ps.rep_high,
					        ps.target_weight_kg, ps.rest_seconds, ps.notes, ps.superset_group, e.increment_kg
					 FROM planned_sets ps JOIN exercises e ON e.id = ps.exercise_id
					 WHERE ps.session_id IN (${sqlIn(sessionsToProgressIds.length)})
					 ORDER BY ps.session_id, ps.order_index`,
				)
				.bind(...sessionsToProgressIds)
				.all<PlannedSetJoinRow>()
		: { results: [] as PlannedSetJoinRow[] };

	// Bulk query 3/5: logged_sets across the full 2-week window — feeds both the progression pass (last week's subset) and the raw history payload.
	const { results: loggedSetRows } = windowSessionIds.length
		? await db
				.prepare(`SELECT * FROM logged_sets WHERE session_id IN (${sqlIn(windowSessionIds.length)})`)
				.bind(...windowSessionIds)
				.all<LoggedSetRow>()
		: { results: [] as LoggedSetRow[] };

	// Bulk query 4/5: planned_runs, anchor week only (manual sessions excluded).
	const { results: plannedRunRows } = sessionsToProgressIds.length
		? await db
				.prepare(`SELECT * FROM planned_runs WHERE session_id IN (${sqlIn(sessionsToProgressIds.length)})`)
				.bind(...sessionsToProgressIds)
				.all<PlannedRunRow>()
		: { results: [] as PlannedRunRow[] };

	// Bulk query 6/6: session feedback across the window — this is what makes
	// the shoulder_safe/back_safe checks in validateWeekAgainstBaseline able to
	// fire at all. A flag trips at 2+ on the 0-3 scale: 1 is "noticed it",
	// which shouldn't start banning exercises, whereas 2-3 is real pain worth
	// programming around.
	const { results: feedbackRows } = windowSessionIds.length
		? await db
				.prepare(`SELECT back_pain_0_3, shoulder_pain_0_3 FROM session_feedback WHERE session_id IN (${sqlIn(windowSessionIds.length)})`)
				.bind(...windowSessionIds)
				.all<{ back_pain_0_3: number | null; shoulder_pain_0_3: number | null }>()
		: { results: [] as { back_pain_0_3: number | null; shoulder_pain_0_3: number | null }[] };

	const painFlags: PainFlags = {
		shoulder: feedbackRows.some((f) => (f.shoulder_pain_0_3 ?? 0) >= 2),
		back: feedbackRows.some((f) => (f.back_pain_0_3 ?? 0) >= 2),
	};

	const reasons: Record<string, string> = {};
	const skippedSessions: SessionRow[] = sessionsToProgress.filter((s) => s.status === 'skipped');

	const plannedSetsBySession = new Map<number, PlannedSetJoinRow[]>();
	for (const row of plannedSetRows) {
		const list = plannedSetsBySession.get(row.session_id) ?? [];
		list.push(row);
		plannedSetsBySession.set(row.session_id, list);
	}
	const plannedRunBySession = new Map(plannedRunRows.map((r) => [r.session_id, r]));
	const loggedRunBySession = new Map(loggedRunRows.map((r) => [r.session_id, r]));

	const proposedSessions: ProposedSessionInput[] = [];

	// The anchor week can be any number of weeks behind startDate, so the whole
	// week moves as a unit by the whole-week shift that puts its Monday on
	// startDate (day-of-week pattern preserved).
	const shiftDays = daysBetweenIso(anchorMonday, startDate);

	for (const session of sessionsToProgress) {
		const newDate = addDaysIso(session.date, shiftDays);

		if (session.kind === 'lift') {
			const rows = plannedSetsBySession.get(session.id) ?? [];
			const plannedSets: ProposedSetInput[] = rows.map((row) => {
				const loggedForExercise: LoggedSetForProgression[] = loggedSetRows
					.filter((l) => l.session_id === session.id && l.exercise_id === row.exercise_id)
					.map((l) => ({ weight_kg: l.weight_kg, reps: l.reps, rir: l.rir, rest_taken_seconds: l.rest_taken_seconds }));

				const prescription: ExercisePrescription = {
					rep_low: row.rep_low,
					rep_high: row.rep_high,
					target_weight_kg: row.target_weight_kg,
					rest_seconds: row.rest_seconds,
					increment_kg: row.increment_kg,
				};
				const result = progressExercise(prescription, loggedForExercise);
				// Same key format the pasted-back review is validated against (see
				// validateProposal). Two planned_sets rows sharing one exercise_id
				// on the same day (a rare superset duplicate) would collide here —
				// not handled specially, matching the plan's key format verbatim.
				reasons[`${newDate}:${row.exercise_id}`] = result.reason;

				return {
					exercise_id: row.exercise_id,
					order_index: row.order_index,
					target_sets: row.target_sets,
					rep_low: row.rep_low,
					rep_high: row.rep_high,
					target_weight_kg: result.next_weight_kg,
					rest_seconds: row.rest_seconds,
					notes: row.notes,
					superset_group: row.superset_group,
				};
			});

			proposedSessions.push({ date: newDate, kind: 'lift', label: session.label, plannedSets, plannedRun: null });
		} else {
			const plannedRunRow = plannedRunBySession.get(session.id) ?? null;
			let plannedRun: ProposedRun | null = null;

			if (plannedRunRow) {
				const loggedRunRow = loggedRunBySession.get(session.id) ?? null;
				const logged: LoggedRunForProgression | null = loggedRunRow
					? {
							distance_km: loggedRunRow.distance_km,
							duration_seconds: loggedRunRow.duration_seconds,
							rpe_1_10: loggedRunRow.rpe_1_10,
							avg_hr: loggedRunRow.avg_hr,
							max_hr: loggedRunRow.max_hr,
						}
					: null;
				const result = progressRun(plannedRunRow.run_type, plannedRunRow.target_km, logged);
				reasons[`${newDate}:run`] = result.reason;

				plannedRun = {
					run_type: plannedRunRow.run_type,
					target_minutes: plannedRunRow.target_minutes,
					target_km: result.next_target_km,
					structure_json: plannedRunRow.structure_json,
				};
			}

			proposedSessions.push({ date: newDate, kind: 'run', label: session.label, plannedSets: [], plannedRun });
		}
	}

	const week1: WeekProposalInput = { week_number: 1, sessions: proposedSessions };

	// Weeks 2..weekCount: flat copies of week 1 — structurally identical
	// sessions/plannedSets/plannedRun values, dates shifted an additional 7
	// days per extra week, week_number incremented. No new reasons are
	// recorded for these (see the comment above the `reasons` return below) —
	// they're not a new deterministic judgement, just week 1's numbers moved
	// out in time.
	const weeks: WeekProposalInput[] = [week1];
	for (let w = 2; w <= weekCount; w++) {
		const extraDays = (w - 1) * 7;
		const sessions: ProposedSessionInput[] = proposedSessions.map((session) => ({
			date: addDaysIso(session.date, extraDays),
			kind: session.kind,
			label: session.label,
			plannedSets: session.plannedSets.map((set) => ({ ...set })),
			plannedRun: session.plannedRun ? { ...session.plannedRun } : null,
		}));
		weeks.push({ week_number: w, sessions });
	}

	// `reasons` is only ever populated for week 1 (above). Weeks 2..N are flat
	// copies with no new logged data behind them, so there's nothing genuine
	// to explain for them; reusing week 1's text under a different date would
	// read as a justification that doesn't actually exist for a speculative
	// week. Left unpopulated — the exported prompt tells the AI reviewer
	// directly that weeks past 1 are speculative and to apply its own
	// periodization judgement (plan §6), which covers this better than a
	// copy-pasted "reason" string would.

	const historyWindow: HistoryWindow = {
		loggedSets: loggedSetRows.map((l) => ({
			session_id: l.session_id,
			exercise_id: l.exercise_id,
			set_index: l.set_index,
			weight_kg: l.weight_kg,
			reps: l.reps,
			rir: l.rir,
			rest_taken_seconds: l.rest_taken_seconds,
			performed_on: l.performed_on,
		})),
		loggedRuns: loggedRunRows.map(({ id: _id, ...run }) => run),
	};

	return {
		deterministicProposal: { weeks },
		speculativeFromWeek: 2,
		reasons,
		historyWindow,
		skippedSessions,
		goals,
		goalTags,
		daysPerWeek,
		exerciseCatalogue,
		painFlags,
	};
}

/**
 * Thin wrapper — what the `/export` route calls. Kept as a separate named
 * function (rather than inlining buildExportContext in the route) so the
 * seam where Phase 2 would swap this for a live API call stays obvious;
 * nothing is persisted here since nothing has been reviewed yet.
 */
export async function generateNextWeeks(db: D1Database, weekCount: number, today: string, startDate?: string): Promise<ExportContext> {
	return buildExportContext(db, weekCount, today, startDate);
}

const MAX_SUMMARY_CHARS = 1500;

/** True only for a real calendar date in YYYY-MM-DD form. The regex alone
 * would accept 2026-02-31 / 2026-13-01, which insert happily (sessions.date
 * has no CHECK constraint) and then never match a Today/History query again —
 * silent data corruption rather than a loud failure. Round-tripping through
 * Date.UTC catches the overflow. */
export function isRealIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isPositiveInt(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInt(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0;
}

/** Optional numeric field: null/undefined is fine, but a present value must be a finite non-negative number. */
function isNullableNonNegativeNumber(value: unknown): boolean {
	return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

/**
 * `structure_json` is stored as an opaque TEXT blob and parsed by the client at
 * render time, so anything wrong with it fails silently in the UI rather than
 * loudly at import. Checking only that it parses wasn't enough: `{"foo":1}`
 * passed, then rendered as nothing at all, and a step missing `effort` threw
 * inside RunStructure's render. Validate the shape the renderer actually
 * expects — a flat `{ steps: [...] }` list, deliberately not nested.
 */
function validateStructureJson(raw: string, at: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [`${at} has a structure_json that is not valid JSON`];
	}

	const steps = (parsed as { steps?: unknown } | null)?.steps;
	if (!Array.isArray(steps)) {
		return [`${at} has a structure_json with no steps array — expected {"steps":[...]}`];
	}

	const errors: string[] = [];
	steps.forEach((step, index) => {
		const stepAt = `${at}, structure_json step ${index}`;
		const s = step as { kind?: unknown; minutes?: unknown; effort?: unknown; repeat?: unknown } | null;
		if (typeof s?.kind !== 'string' || s.kind.trim() === '') errors.push(`${stepAt} has no kind`);
		if (typeof s?.minutes !== 'number' || !Number.isFinite(s.minutes) || s.minutes <= 0) errors.push(`${stepAt} has an invalid minutes`);
		if (typeof s?.effort !== 'string' || s.effort.trim() === '') errors.push(`${stepAt} has no effort`);
		if (s?.repeat !== undefined && s.repeat !== null && (!Number.isInteger(s.repeat) || (s.repeat as number) < 1)) {
			errors.push(`${stepAt} has an invalid repeat`);
		}
	});
	return errors;
}

/**
 * Structural/type validation for one week, independent of any baseline.
 *
 * This exists because validateWeekAgainstBaseline only ever checked *weights*
 * (jump caps, pain flags, exercise existence). Everything else in a
 * pasted-back proposal — dates, kind, run_type, rep ranges, set counts — went
 * unchecked straight into insertWeek, where a bad `kind`/`run_type` hits a D1
 * CHECK constraint and 500s PARTWAY THROUGH the insert loop, and a bad date
 * inserts silently and disappears from every date-ranged query. Catching all
 * of it here means a malformed proposal is rejected at import time with a
 * useful message, before anything is persisted.
 */
function validateWeekStructure(week: WeekProposalInput, weekIndex: number): string[] {
	const errors: string[] = [];
	const where = (extra = '') => `week at index ${weekIndex}${extra}`;

	if (!isPositiveInt(week.week_number)) {
		errors.push(`${where()} has an invalid week_number (${JSON.stringify(week.week_number)}) — must be a positive integer`);
	}
	if (week.focus !== null && week.focus !== undefined && (typeof week.focus !== 'string' || week.focus.trim() === '')) {
		errors.push(`${where()} has an invalid focus (${JSON.stringify(week.focus)}) — must be null or a non-empty string`);
	}
	if (!Array.isArray(week.sessions)) {
		errors.push(`${where()} has no sessions array`);
		return errors; // nothing further is inspectable
	}

	// Dates within a week must be distinct and ascending. Neither was checked
	// before, so a whole week could land on one day — which inserts fine and
	// then reads as an unexplainable pile-up on Today.
	const seenDates = new Set<string>();
	let previousDate = '';
	for (const session of week.sessions) {
		if (!isRealIsoDate(session.date)) continue; // reported per-session below
		if (seenDates.has(session.date)) {
			errors.push(`${where()} has a duplicate date (${session.date}) — one session per day`);
		}
		seenDates.add(session.date);
		if (previousDate && session.date < previousDate) {
			errors.push(`${where()} is out of date order (${session.date} follows ${previousDate})`);
		}
		previousDate = session.date;
	}

	week.sessions.forEach((session, sessionIndex) => {
		const at = where(`, session ${sessionIndex}`);

		if (!isRealIsoDate(session.date)) {
			errors.push(`${at} has an invalid date (${JSON.stringify(session.date)}) — must be a real calendar date as YYYY-MM-DD`);
		}
		if (session.kind !== 'lift' && session.kind !== 'run') {
			errors.push(`${at} has an invalid kind (${JSON.stringify(session.kind)}) — must be 'lift' or 'run'`);
		}
		if (typeof session.label !== 'string' || session.label.trim() === '') {
			errors.push(`${at} has an empty label`);
		}

		if (!Array.isArray(session.plannedSets)) {
			errors.push(`${at} has no plannedSets array`);
		} else {
			// insertWeek writes plannedSets regardless of kind, so a run session
			// carrying them would silently attach lift rows to a run.
			if (session.kind === 'run' && session.plannedSets.length > 0) {
				errors.push(`${at} is a run but carries ${session.plannedSets.length} plannedSets`);
			}

			// logged_sets is unique on (session_id, exercise_id, set_index), and
			// logSet/loadSessionDetail both key by exercise_id — so a second
			// planned row for the same exercise in one session is simply
			// unloggable. POST /api/swaps already 409s on this; import didn't.
			const seenExercises = new Set<number>();
			for (const set of session.plannedSets) {
				if (!isPositiveInt(set.exercise_id)) continue; // reported below
				if (seenExercises.has(set.exercise_id)) {
					errors.push(`${at} has exercise_id ${set.exercise_id} twice — an exercise appears twice in one session`);
				}
				seenExercises.add(set.exercise_id);
			}

			session.plannedSets.forEach((set, setIndex) => {
				const setAt = `${at}, set ${setIndex}`;
				if (!isPositiveInt(set.exercise_id)) errors.push(`${setAt} has an invalid exercise_id (${JSON.stringify(set.exercise_id)})`);
				if (!isNonNegativeInt(set.order_index)) errors.push(`${setAt} has an invalid order_index (${JSON.stringify(set.order_index)})`);
				if (!isPositiveInt(set.target_sets))
					errors.push(`${setAt} has an invalid target_sets (${JSON.stringify(set.target_sets)}) — must be a positive integer`);
				if (!isNonNegativeInt(set.rep_low)) errors.push(`${setAt} has an invalid rep_low (${JSON.stringify(set.rep_low)})`);
				if (!isNonNegativeInt(set.rep_high)) errors.push(`${setAt} has an invalid rep_high (${JSON.stringify(set.rep_high)})`);
				if (isNonNegativeInt(set.rep_low) && isNonNegativeInt(set.rep_high) && set.rep_high < set.rep_low) {
					errors.push(`${setAt} has rep_high (${set.rep_high}) below rep_low (${set.rep_low})`);
				}
				if (!isNullableNonNegativeNumber(set.target_weight_kg)) {
					errors.push(
						`${setAt} has an invalid target_weight_kg (${JSON.stringify(set.target_weight_kg)}) — must be null or a non-negative number`,
					);
				}
				if (!isNonNegativeInt(set.rest_seconds)) errors.push(`${setAt} has an invalid rest_seconds (${JSON.stringify(set.rest_seconds)})`);
				if (set.superset_group !== null && set.superset_group !== undefined && !Number.isInteger(set.superset_group)) {
					errors.push(`${setAt} has an invalid superset_group (${JSON.stringify(set.superset_group)}) — must be null or an integer`);
				}
			});
		}

		const run = session.plannedRun;
		if (run !== null && run !== undefined) {
			if (session.kind === 'lift') {
				errors.push(`${at} is a lift but carries a plannedRun`);
			}
			if (!RUN_TYPES.includes(run.run_type)) {
				errors.push(`${at} has an invalid run_type (${JSON.stringify(run.run_type)}) — must be one of ${RUN_TYPES.join(', ')}`);
			}
			if (!isNullableNonNegativeNumber(run.target_minutes))
				errors.push(`${at} has an invalid target_minutes (${JSON.stringify(run.target_minutes)})`);
			if (!isNullableNonNegativeNumber(run.target_km)) errors.push(`${at} has an invalid target_km (${JSON.stringify(run.target_km)})`);
			if (run.structure_json !== null && run.structure_json !== undefined) {
				if (typeof run.structure_json !== 'string') {
					errors.push(`${at} has a non-string structure_json`);
				} else {
					errors.push(...validateStructureJson(run.structure_json, at));
				}
			}
		}
	});

	return errors;
}

/**
 * Checks one week of a pasted-back (or hand-crafted) proposal against
 * whichever week's values are its baseline — either the true deterministic
 * week 1, or (for week k>0 in a chain) the preceding week in the SAME pasted
 * back proposal. `baselineDescription` only affects error-message wording.
 *
 * `dateKeyed` controls how baseline values are looked up:
 *  - true (week 0 vs the true deterministic baseline): keyed by
 *    `${date}:${exercise_id}`, exactly like today's single-week logic —
 *    the pasted-back week is expected to keep the same calendar dates the
 *    export handed out, so date+exercise_id pins down "the same slot".
 *  - false (week k>0 vs the previous week in the chain): the two weeks
 *    being compared are, by construction, 7 calendar days apart (that's the
 *    whole point of them being different weeks), so a date-keyed lookup
 *    would never match anything and every chain check would silently pass
 *    as "unconstrained". Baselines are keyed by exercise_id alone instead
 *    (and by mere presence of a 'long' run, for the run-growth check) —
 *    matching wherever that exercise/long-run appears in the previous week,
 *    regardless of date. This assumes an exercise (or long run) appears at
 *    most once per week, which holds for every case this app actually
 *    produces; a week with the same exercise programmed twice would have
 *    the later occurrence's value win the lookup — an edge case not
 *    currently exercised anywhere in this app.
 */
function validateWeekAgainstBaseline(
	week: WeekProposalInput,
	baselineWeeks: WeekProposalInput[],
	context: ExportContext,
	baselineDescription: string,
	dateKeyed: boolean,
	raceDates: ReadonlySet<string>,
): string[] {
	const errors: string[] = [];
	const exerciseById = new Map(context.exerciseCatalogue.map((e) => [e.id, e]));

	// Baselines keyed exactly like `reasons` when dateKeyed — the baseline
	// week's own values for the same slot are the reference point for "how
	// big a jump is this". See the dateKeyed doc comment above for the
	// chain (non-date-keyed) case.
	const weightBaselineByKey = new Map<string, number | null>();
	const weightBaselineByExercise = new Map<number, number | null>();
	const longRunBaselineByDate = new Map<string, number | null>();
	let longRunBaseline: number | null | undefined;
	for (const baselineWeek of baselineWeeks) {
		for (const session of baselineWeek.sessions) {
			for (const set of session.plannedSets) {
				weightBaselineByKey.set(`${session.date}:${set.exercise_id}`, set.target_weight_kg);
				const w = set.target_weight_kg;
				const seen = weightBaselineByExercise.get(set.exercise_id);
				if (seen === undefined || seen === null || (w !== null && w > seen)) weightBaselineByExercise.set(set.exercise_id, w);
			}
			// Race-day runs are never a baseline. In a chain the baseline is the highest
			// earlier long run, so a deload, taper or race week does not lower it.
			if (session.plannedRun?.run_type === 'long' && !raceDates.has(session.date)) {
				const km = session.plannedRun.target_km;
				longRunBaselineByDate.set(session.date, km);
				if (km !== null && (longRunBaseline === undefined || longRunBaseline === null || km > longRunBaseline)) longRunBaseline = km;
			}
		}
	}

	for (const session of week.sessions) {
		for (const set of session.plannedSets) {
			const exercise = exerciseById.get(set.exercise_id);
			if (!exercise) {
				errors.push(`Unknown exercise_id ${set.exercise_id} (week ${week.week_number}, ${session.date})`);
				continue;
			}

			if (context.painFlags.shoulder && exercise.shoulder_safe === 0) {
				errors.push(
					`${exercise.name} is flagged shoulder-unsafe but a shoulder pain flag is active (week ${week.week_number}, ${session.date})`,
				);
			}
			if (context.painFlags.back && exercise.back_safe === 0) {
				errors.push(`${exercise.name} is flagged back-unsafe but a back pain flag is active (week ${week.week_number}, ${session.date})`);
			}

			// Weight jump vs the baseline week, capped at MAX_PLAN_STEP — only on
			// increases; a decrease (e.g. a deload) is never rejected here. A
			// substituted exercise_id with no matching baseline entry in the
			// baseline week is unconstrained on weight — nothing to compare
			// against.
			const baseline = dateKeyed
				? weightBaselineByKey.get(`${session.date}:${set.exercise_id}`)
				: weightBaselineByExercise.get(set.exercise_id);
			if (baseline !== undefined && baseline !== null && baseline > 0 && set.target_weight_kg !== null && set.target_weight_kg > baseline) {
				const jump = (set.target_weight_kg - baseline) / baseline;
				if (jump > MAX_PLAN_STEP) {
					errors.push(
						`Weight jump for exercise_id ${set.exercise_id} on ${session.date} (week ${week.week_number}) exceeds ${MAX_PLAN_STEP * 100}% vs ${baselineDescription} (${baseline}kg -> ${set.target_weight_kg}kg)`,
					);
				}
			}
		}

		// Race day is exempt from the cap: the race sets the distance.
		if (session.plannedRun?.run_type === 'long' && !raceDates.has(session.date)) {
			const baselineKm = (dateKeyed ? longRunBaselineByDate.get(session.date) : longRunBaseline) ?? null;
			if (baselineKm !== null && baselineKm > 0 && session.plannedRun.target_km !== null && session.plannedRun.target_km > baselineKm) {
				const growth = (session.plannedRun.target_km - baselineKm) / baselineKm;
				if (growth > MAX_PLAN_STEP) {
					errors.push(
						`Long run growth on ${session.date} (week ${week.week_number}) exceeds the ${MAX_PLAN_STEP * 100}% cap vs ${baselineDescription} (${baselineKm}km -> ${session.plannedRun.target_km}km)`,
					);
				}
			}
		}
	}

	return errors;
}

/**
 * How many sessions a week is allowed to contain.
 *
 * Week 1 must match `days_per_week` exactly — it mirrors a week that really
 * happened, and dropping a session there is just an omission. Later weeks may
 * drop one or two (a deload, a taper or race week trains fewer days). Never
 * more than `days_per_week`, and never zero — with days_per_week of 1 the
 * floor and the target are the same number.
 */
function validateSessionCount(week: WeekProposalInput, context: ExportContext): string[] {
	const target = context.daysPerWeek;
	// The same room in every week, week 1 included: a returning runner, a race
	// week or a lighter week should not need a workaround to pass.
	const floor = Math.max(1, target - 2);
	if (week.sessions.length >= floor && week.sessions.length <= target) return [];

	const allowed = floor === target ? `${target}` : `${floor}-${target}`;
	return [
		`Session count (${week.sessions.length}) is outside the allowed ${allowed} for days_per_week ${target} (week ${week.week_number})`,
	];
}

/** First and last dates of a week, for the cross-week ordering check. Weeks are
 * already known to be internally ordered by the time this runs. */
function weekDateRange(week: WeekProposalInput): { first: string; last: string } | null {
	const dates = week.sessions.map((s) => s.date).filter((d) => typeof d === 'string');
	if (dates.length === 0) return null;
	return { first: dates[0], last: dates[dates.length - 1] };
}

/**
 * Checks a pasted-back (or hand-crafted) MultiWeekProposalInput against the
 * context that produced it. Walks proposal.weeks in order: week 0 is checked
 * against the TRUE deterministic baseline (context.deterministicProposal.
 * weeks[0]); week k>0 is checked against week k-1 of the SAME proposal — a
 * chain, not a fixed baseline — so a person (or AI) applying real
 * periodization judgement across weeks is validated against what they
 * actually proposed for the previous week, not against week 1 forever.
 * Empty array = valid.
 */
export function validateProposal(proposal: MultiWeekProposalInput, context: ExportContext, raceDates: ReadonlySet<string> = new Set()): string[] {
	if (!Array.isArray(proposal?.weeks)) {
		return ['proposal has no weeks array'];
	}
	const summary = proposal.summary;
	if (summary !== undefined && summary !== null && (typeof summary !== 'string' || summary.length > MAX_SUMMARY_CHARS)) {
		return [`summary must be a string of at most ${MAX_SUMMARY_CHARS} characters, or null`];
	}

	// Structure first, and bail before the baseline pass if anything is
	// malformed: validateWeekAgainstBaseline indexes into sessions/plannedSets
	// assuming they're well-formed arrays, so running it over garbage produces
	// misleading errors (or throws) on top of the real ones. A caller gets the
	// structural problems on their own, which are the ones worth fixing first.
	const structuralErrors = proposal.weeks.flatMap((week, index) => validateWeekStructure(week, index));
	if (structuralErrors.length > 0) return structuralErrors;

	const errors: string[] = [];

	proposal.weeks.forEach((week, index) => {
		errors.push(...validateSessionCount(week, context));

		if (index === 0) {
			errors.push(
				...validateWeekAgainstBaseline(week, [context.deterministicProposal.weeks[0]], context, 'the deterministic proposal', true, raceDates),
			);
		} else {
			const previousWeek = proposal.weeks[index - 1];
			errors.push(...validateWeekAgainstBaseline(week, [context.deterministicProposal.weeks[0], ...proposal.weeks.slice(0, index)], context, 'earlier weeks (the highest value for it)', false, raceDates));

			// Weeks must not overlap or run backwards. Each week is already
			// internally ordered by validateWeekStructure, so comparing the
			// previous week's last date to this one's first is enough.
			const previousRange = weekDateRange(previousWeek);
			const range = weekDateRange(week);
			if (previousRange && range && range.first <= previousRange.last) {
				errors.push(
					`Week ${week.week_number} starts on or before week ${previousWeek.week_number} ends (${range.first} vs ${previousRange.last})`,
				);
			}
		}
	});

	return errors;
}

/** Joins exercise names/patterns back onto an id-only proposal after
 * validation has already confirmed every exercise_id is real. Called once
 * per week in a loop by importProposal — unchanged from the single-week
 * version. */
export function hydrateProposal(input: WeekProposalInput, exercises: Exercise[]): WeekProposal {
	const exerciseById = new Map(exercises.map((e) => [e.id, e]));
	return {
		week_number: input.week_number,
		focus: input.focus ?? null,
		sessions: input.sessions.map((session) => ({
			date: session.date,
			kind: session.kind,
			label: session.label,
			plannedRun: session.plannedRun,
			plannedSets: session.plannedSets.map((set) => {
				const exercise = exerciseById.get(set.exercise_id);
				return { ...set, exercise_name: exercise?.name ?? '', pattern: exercise?.pattern ?? '' };
			}),
		})),
	};
}

interface SpanCheckRow {
	id: number;
	date: string;
	status: string;
	has_sets: number;
	has_run: number;
}

/** Every session whose date falls within [first, last], split into ones a
 * proposal may freely replace (still 'planned', with nothing logged against
 * them yet) and ones that are protected because real training happened on
 * that day — completed, skipped, or carrying a logged set/run even while
 * still nominally 'planned' (logging doesn't move a session off 'planned'
 * until it's explicitly completed, so status alone isn't enough). Shared by
 * importProposal's eager check and insertWeeksFromProposal's re-check at
 * accept time, so the two can't drift on what counts as "already trained". */
async function findReplaceableSessions(db: D1Database, first: string, last: string): Promise<{ replaceableIds: number[]; protectedDates: string[] }> {
	const { results } = await db
		.prepare(
			`SELECT s.id, s.date, s.status,
			        EXISTS (SELECT 1 FROM logged_sets ls WHERE ls.session_id = s.id) AS has_sets,
			        EXISTS (SELECT 1 FROM logged_runs lr WHERE lr.session_id = s.id) AS has_run
			 FROM sessions s WHERE s.date >= ?1 AND s.date <= ?2 ORDER BY s.date`,
		)
		.bind(first, last)
		.all<SpanCheckRow>();

	const replaceableIds: number[] = [];
	const protectedDates: string[] = [];
	for (const row of results) {
		if (row.status !== 'planned' || row.has_sets || row.has_run) protectedDates.push(row.date);
		else replaceableIds.push(row.id);
	}
	return { replaceableIds, protectedDates };
}

/** The [min, max] calendar-date span covered by every session across every
 * week of a proposal — used to decide which existing sessions a re-plan might
 * touch. Null when the proposal has no sessions at all (an all-empty-weeks
 * proposal, which validateSessionCount would reject anyway, but this runs
 * before that). */
function proposalDateSpan(sessions: { date: string }[]): { first: string; last: string } | null {
	if (sessions.length === 0) return null;
	let first = sessions[0].date;
	let last = sessions[0].date;
	for (const s of sessions) {
		if (s.date < first) first = s.date;
		if (s.date > last) last = s.date;
	}
	return { first, last };
}

/**
 * Validates and persists a pasted-back proposal as a pending `generated_plans`
 * row. Rebuilds the deterministic baseline fresh via buildExportContext
 * (sized to match the pasted-back proposal's week count so chain validation
 * has the right number of weeks to compare against) rather than trying to
 * persist/reload the exact one the export handed out — keeps this function
 * self-contained and avoids needing the client to round-trip extra state it
 * has no reason to keep.
 */
export async function importProposal(
	db: D1Database,
	input: MultiWeekProposalInput,
	today: string,
	replace = false,
	source: 'external-import' | 'live-api' = 'external-import',
): Promise<ImportResult> {
	if (input.weeks.length === 0) {
		return { ok: false, errors: ['proposal must include at least one week'] };
	}

	// Refusing outright was too strict: asking the assistant to fix a rejected
	// plan and pasting the corrected one back is the normal path, and it always
	// arrives while the first is still pending. Still not silent — the client
	// has to ask for the replacement explicitly, so a double-import can't
	// quietly discard the plan you were reading.
	const existingPending = await db.prepare(`SELECT id FROM generated_plans WHERE status = 'pending' LIMIT 1`).first<{ id: number }>();
	if (existingPending && !replace) {
		return { ok: false, errors: ['A plan is already pending review — accept or reject it before importing another.'] };
	}

	// The baseline has to be rebuilt for the same start date the export used,
	// because week 1 is validated by date. Recover it from the proposal itself:
	// the Monday of the week its earliest session falls in. A proposal with no
	// readable date falls back to the default and fails structural validation.
	const firstDates = (input.weeks[0]?.sessions ?? []).map((s) => s?.date).filter((d): d is string => isRealIsoDate(d));
	const startDate = firstDates.length > 0 ? weekStartOnOrBefore(firstDates.reduce((a, b) => (a < b ? a : b))) : undefined;
	const context = await buildExportContext(db, input.weeks.length, today, startDate);
	const { results: raceRows } = await db.prepare(`SELECT date FROM races`).all<{ date: string }>();
	const errors = validateProposal(input, context, new Set(raceRows.map((r) => r.date)));
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// A re-plan is allowed to land on top of already-scheduled dates — that's
	// the whole point of regenerating when circumstances change — but only
	// where nothing has actually been trained yet. Checked here (eagerly, but
	// writing nothing) rather than in validateProposal because it's the only
	// rule that needs the database rather than the export context; the actual
	// deletion happens at accept time in insertWeeksFromProposal, which
	// re-checks the same span in case things changed in the meantime.
	const proposedSessions = input.weeks.flatMap((week) => week.sessions);
	const span = proposalDateSpan(proposedSessions);
	if (span) {
		const { protectedDates } = await findReplaceableSessions(db, span.first, span.last);
		if (protectedDates.length > 0) {
			return { ok: false, errors: protectedDates.map((d) => `${d} already has training you've done — the plan can't overwrite it`) };
		}
	}

	const hydrated: MultiWeekProposal = { weeks: input.weeks.map((week) => hydrateProposal(week, context.exerciseCatalogue)) };
	if (typeof input.summary === 'string') hydrated.summary = input.summary;

	// Supersede and insert in one batch, so a failure can't leave the old plan
	// rejected with no replacement stored.
	const statements: D1PreparedStatement[] = [];
	if (existingPending) {
		statements.push(
			db.prepare(`UPDATE generated_plans SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?`).bind(existingPending.id),
		);
	}
	statements.push(
		db
			.prepare(
				`INSERT INTO generated_plans (first_week_number, week_count, plan_json, deterministic_json, source) VALUES (?, ?, ?, ?, ?) RETURNING id`,
			)
			.bind(input.weeks[0].week_number, input.weeks.length, JSON.stringify(hydrated), JSON.stringify(context.deterministicProposal), source),
	);

	const results = await db.batch<{ id: number }>(statements);
	return { ok: true, id: results[results.length - 1].results[0].id };
}

/**
 * Writes every session (and its planned_sets/planned_runs children) across
 * every week of an accepted plan, in two batches.
 *
 * This used to be a plain sequential await-loop, on the grounds that D1's
 * batch() can't feed a generated id into a dependent insert. That's true, but
 * it doesn't force full sequencing — it only forces a split:
 *
 *   Batch 1: every session INSERT ... RETURNING id, in a fixed order.
 *   Batch 2: every planned_sets/planned_runs insert, using the ids batch 1
 *            handed back (results come back positionally, in statement order).
 *
 * Each batch runs inside its own implicit transaction, so a failure part-way
 * through either one rolls that batch back rather than leaving a half-written
 * week behind. That matters here specifically because accept is retryable:
 * the old loop could 500 with N sessions already inserted while leaving the
 * generated_plans row still 'pending', so retrying duplicated everything
 * before the failure point. The remaining (much smaller) window is a failure
 * *between* the two batches, which orphans sessions that have no planned
 * sets — visible and hand-fixable, rather than silently duplicated data.
 *
 * Also re-checks the proposal's date span against the database before writing
 * anything: import already checked this eagerly, but accepting happens after
 * a human-sized review gap, long enough to go and train one of the days the
 * plan is about to overwrite. A session that was untouched at import time but
 * has since been trained on refuses the whole accept (409) rather than
 * silently deleting logged work. Untouched sessions inside the span are
 * deleted in their own batch, ahead of the two below — a small, already
 * -tolerated failure window (see above), not forced into one atomic call.
 */
export async function insertWeeksFromProposal(
	db: D1Database,
	plan: MultiWeekProposal,
	generatedPlanId: number | null = null,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
	// Accepting a plan starts a new block, so its weeks are numbered 1..N by
	// position whatever the proposal said (the export already numbers them that
	// way; this just makes a stale or hand-edited numbering harmless).
	const flattened = plan.weeks.flatMap((week, weekIndex) => week.sessions.map((session) => ({ session, week_number: weekIndex + 1 })));
	if (flattened.length === 0) return { ok: true };

	const span = proposalDateSpan(flattened.map(({ session }) => session));
	if (span) {
		const { replaceableIds, protectedDates } = await findReplaceableSessions(db, span.first, span.last);
		if (protectedDates.length > 0) {
			return { ok: false, errors: protectedDates.map((d) => `${d} already has training you've done — the plan can't overwrite it`) };
		}
		const deleteStatements = deleteSessionStatements(db, replaceableIds);
		if (deleteStatements.length > 0) await db.batch(deleteStatements);
	}

	// The block row: named by position, with the goals as they stand right now.
	const startDate = weekStartOnOrBefore(span!.first); // flattened is non-empty, so a span exists
	const block = await db
		.prepare(
			`INSERT INTO plan_blocks (name, start_date, week_count, goals, goal_tags, generated_plan_id)
			 SELECT 'Block ' || ((SELECT COUNT(*) FROM plan_blocks) + 1), ?1, ?2,
			        COALESCE((SELECT goals FROM settings WHERE id = 1), ''),
			        COALESCE((SELECT goal_tags FROM settings WHERE id = 1), '[]'),
			        ?3
			 RETURNING id`,
		)
		.bind(startDate, plan.weeks.length, generatedPlanId)
		.first<{ id: number }>();
	const blockId = block!.id;

	const sessionRows = await db.batch<{ id: number }>(
		flattened.map(({ session, week_number }) =>
			db
				.prepare(`INSERT INTO sessions (date, kind, label, status, week_number, block_id) VALUES (?, ?, ?, 'planned', ?, ?) RETURNING id`)
				.bind(session.date, session.kind, session.label, week_number, blockId),
		),
	);

	const children: D1PreparedStatement[] = [];
	flattened.forEach(({ session }, index) => {
		// batch() returns one result per statement, in the order submitted.
		const sessionId = sessionRows[index]?.results?.[0]?.id;
		if (sessionId === undefined) throw new Error(`session insert returned no id (index ${index})`);

		for (const set of session.plannedSets) {
			children.push(
				db
					.prepare(
						`INSERT INTO planned_sets (session_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_weight_kg, rest_seconds, notes, superset_group)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(
						sessionId,
						set.exercise_id,
						set.order_index,
						set.target_sets,
						set.rep_low,
						set.rep_high,
						set.target_weight_kg,
						set.rest_seconds,
						set.notes,
						set.superset_group,
					),
			);
		}

		if (session.plannedRun) {
			children.push(
				db
					.prepare(`INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES (?, ?, ?, ?, ?)`)
					.bind(
						sessionId,
						session.plannedRun.run_type,
						session.plannedRun.target_minutes,
						session.plannedRun.target_km,
						session.plannedRun.structure_json,
					),
			);
		}
	});

	if (children.length > 0) await db.batch(children);
	return { ok: true };
}

/** How many untouched planned sessions accepting `plan` would replace, and the
 * date it starts on — the one-line outcome the review screen states before you
 * commit. Same span rule as accept, without writing anything. */
export async function describeAcceptOutcome(db: D1Database, plan: MultiWeekProposal): Promise<{ replaces: number; start_date: string | null }> {
	const span = proposalDateSpan(plan.weeks.flatMap((w) => w.sessions));
	if (!span) return { replaces: 0, start_date: null };
	const { replaceableIds } = await findReplaceableSessions(db, span.first, span.last);
	return { replaces: replaceableIds.length, start_date: weekStartOnOrBefore(span.first) };
}
