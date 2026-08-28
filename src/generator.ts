// src/generator.ts — weekly generator orchestration (manual export/import, see
// migrations/0004_generator.sql, migrations/0005_generator_multiweek.sql, and
// the approved plan). No AI call lives here: buildExportContext/
// generateNextWeeks produce the deterministic pass as plain JSON for a human
// to paste into whatever AI assistant they have; importProposal validates and
// persists whatever comes back.

import { addDaysIso } from './dates';
import { deleteSessionStatements } from './sessionDelete';
import { sqlIn } from './sql';
import { progressExercise, type ExercisePrescription, type LoggedSetForProgression } from './progression';
import { MAX_WEEKLY_RUN_GROWTH, progressRun, type LoggedRunForProgression } from './runProgression';
import { parseGoalTags, RUN_TYPES } from './types';
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

/** Last-2-weeks raw history payload — full rows, not derived stats (plan §4). */
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
export interface ExportPayload extends ExportContext {
	today: string;
	weekStartDate: string;
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

/** The smallest positive multiple-of-7-days shift that lands strictly after
 * `today` — used to move a stale anchor week's dates into the future while
 * preserving its day-of-week pattern. A single +7 is only enough when the
 * anchor is less than a week behind today; a longer-neglected plan needs
 * more. */
function smallestWeeklyShiftAfter(dateIso: string, today: string): number {
	let k = 1;
	while (addDaysIso(dateIso, 7 * k) <= today) k++;
	return k;
}

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
export async function buildExportContext(db: D1Database, weekCount: number, today: string): Promise<ExportContext> {
	const settingsRow = await db
		.prepare(`SELECT * FROM settings WHERE id = 1`)
		.first<{ id: number; goals: string; days_per_week: number; goal_tags: string }>();
	const goals = settingsRow?.goals ?? '';
	const goalTags = parseGoalTags(settingsRow?.goal_tags);
	const daysPerWeek = settingsRow?.days_per_week ?? 5;

	const { results: exerciseCatalogue } = await db.prepare(`SELECT * FROM exercises`).all<Exercise>();

	// maxWeekNumber ("newest scheduled week") and anchorWeekNumber ("newest
	// LOGGED week") are different questions. Multi-week accept inserts weeks
	// maxWeekNumber+1..+N as unlogged 'planned' rows in one go, so right after
	// that MAX(week_number) points at a week nobody has trained yet. The
	// proposal is still numbered from maxWeekNumber (no gaps, no duplicate week
	// headings in the client), but progression has to read from whatever week
	// was actually logged.
	const maxWeekRow = await db.prepare(`SELECT MAX(week_number) AS w FROM sessions`).first<{ w: number | null }>();
	const maxWeekNumber = maxWeekRow?.w ?? null;

	if (maxWeekNumber === null) {
		const painFlags: PainFlags = { shoulder: false, back: false }; // no sessions => no feedback to read
		// No sessions exist at all yet — nothing to progress from for week 1,
		// and with no week-1 baseline there's nothing to flat-copy for weeks
		// 2..N either. We still respect the requested weekCount by returning
		// that many empty weeks (numbered 1..weekCount) rather than collapsing
		// to a single empty week — the caller asked for N weeks, and an empty
		// N-week shape is more useful/consistent for it to render than a
		// silently-truncated 1-week one, even though every week is empty.
		return {
			deterministicProposal: {
				weeks: Array.from({ length: weekCount }, (_, i) => ({ week_number: i + 1, sessions: [] })),
			},
			speculativeFromWeek: 2,
			reasons: {},
			historyWindow: { loggedSets: [], loggedRuns: [] },
			skippedSessions: [],
			goals,
			goalTags,
			daysPerWeek,
			exerciseCatalogue,
			painFlags,
		};
	}

	const anchorWeekRow = await db
		.prepare(
			`SELECT MAX(s.week_number) AS w FROM sessions s
			 WHERE EXISTS (SELECT 1 FROM logged_sets ls WHERE ls.session_id = s.id)
			    OR EXISTS (SELECT 1 FROM logged_runs lr WHERE lr.session_id = s.id)`,
		)
		.first<{ w: number | null }>();
	const anchorWeekNumber = anchorWeekRow?.w ?? null;

	if (anchorWeekNumber === null) {
		// Sessions exist (a plan was scheduled), but nothing has ever been
		// logged against any of them — a plan nobody has started. There's
		// nothing to progress from, so this is the same empty shape as
		// cold-start, just numbered on from the sessions that already exist
		// instead of from 1.
		const painFlags: PainFlags = { shoulder: false, back: false };
		return {
			deterministicProposal: {
				weeks: Array.from({ length: weekCount }, (_, i) => ({ week_number: maxWeekNumber + i + 1, sessions: [] })),
			},
			speculativeFromWeek: 2,
			reasons: {},
			historyWindow: { loggedSets: [], loggedRuns: [] },
			skippedSessions: [],
			goals,
			goalTags,
			daysPerWeek,
			exerciseCatalogue,
			painFlags,
		};
	}

	const priorWeekNumber = anchorWeekNumber - 1;

	// Bulk query 1/5: sessions across the last two LOGGED-anchored weeks (just one if this is week 1).
	const { results: windowSessions } = await db
		.prepare(`SELECT * FROM sessions WHERE week_number IN (?, ?) ORDER BY date`)
		.bind(priorWeekNumber, anchorWeekNumber)
		.all<SessionRow>();

	const anchorWeekSessions = windowSessions.filter((s) => s.week_number === anchorWeekNumber);
	// A run recorded by hand (migrations/0008_manual_runs.sql) must not become a
	// template for every future week — validateSessionCount requires week 1 to
	// hold exactly days_per_week sessions, so an extra copied-forward session
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

	// Bulk query 5/6: logged_runs across the full 2-week window.
	const { results: loggedRunRows } = windowSessionIds.length
		? // Columns listed rather than SELECT * so `logged_at` (an internal audit
			// timestamp) doesn't leak into the exported history window.
			await db
				.prepare(
					`SELECT id, session_id, distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m,
					        aerobic_training_effect, rpe_1_10, performed_on, note
					 FROM logged_runs WHERE session_id IN (${sqlIn(windowSessionIds.length)})`,
				)
				.bind(...windowSessionIds)
				.all<LoggedRunRow>()
		: { results: [] as LoggedRunRow[] };

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

	// The anchor week can be several weeks behind today (multi-week accept
	// schedules ahead; the anchor only moves once something is actually
	// logged), so a flat +7 can propose a date that's already in the past.
	// Shift by whichever multiple of 7 days clears today, computed once from
	// the earliest date among the sessions being progressed — the tightest
	// constraint, since it needs the largest shift — and applied uniformly to
	// every session in the week so it moves as a unit (day-of-week pattern
	// preserved, no need for it to also clear today session-by-session).
	const earliestDate = sessionsToProgress.reduce<string | null>(
		(min, s) => (min === null || s.date < min ? s.date : min),
		null,
	);
	const shiftDays = earliestDate !== null ? 7 * smallestWeeklyShiftAfter(earliestDate, today) : 7;

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

	// Numbered from maxWeekNumber (the newest SCHEDULED week), not the anchor —
	// a duplicate week number would split a week heading in the client's
	// SessionList grouping, whereas a numbering gap (when the anchor is behind
	// maxWeekNumber) is harmless.
	const week1: WeekProposalInput = { week_number: maxWeekNumber + 1, sessions: proposedSessions };

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
		weeks.push({ week_number: maxWeekNumber + w, sessions });
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
export async function generateNextWeeks(db: D1Database, weekCount: number, today: string): Promise<ExportContext> {
	return buildExportContext(db, weekCount, today);
}

/** True only for a real calendar date in YYYY-MM-DD form. The regex alone
 * would accept 2026-02-31 / 2026-13-01, which insert happily (sessions.date
 * has no CHECK constraint) and then never match a Today/History query again —
 * silent data corruption rather than a loud failure. Round-tripping through
 * Date.UTC catches the overflow. */
function isRealIsoDate(value: unknown): value is string {
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
	baselineWeek: WeekProposalInput,
	context: ExportContext,
	baselineDescription: string,
	dateKeyed: boolean,
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
	for (const session of baselineWeek.sessions) {
		for (const set of session.plannedSets) {
			weightBaselineByKey.set(`${session.date}:${set.exercise_id}`, set.target_weight_kg);
			weightBaselineByExercise.set(set.exercise_id, set.target_weight_kg);
		}
		if (session.plannedRun?.run_type === 'long') {
			longRunBaselineByDate.set(session.date, session.plannedRun.target_km);
			longRunBaseline = session.plannedRun.target_km;
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

			// Weight jump vs the baseline week, capped at 10% — only on
			// increases; a decrease (e.g. a deload) is never rejected here. A
			// substituted exercise_id with no matching baseline entry in the
			// baseline week is unconstrained on weight — nothing to compare
			// against.
			const baseline = dateKeyed
				? weightBaselineByKey.get(`${session.date}:${set.exercise_id}`)
				: weightBaselineByExercise.get(set.exercise_id);
			if (baseline !== undefined && baseline !== null && baseline > 0 && set.target_weight_kg !== null && set.target_weight_kg > baseline) {
				const jump = (set.target_weight_kg - baseline) / baseline;
				if (jump > 0.1) {
					errors.push(
						`Weight jump for exercise_id ${set.exercise_id} on ${session.date} (week ${week.week_number}) exceeds 10% vs ${baselineDescription} (${baseline}kg -> ${set.target_weight_kg}kg)`,
					);
				}
			}
		}

		if (session.plannedRun?.run_type === 'long') {
			const baselineKm = (dateKeyed ? longRunBaselineByDate.get(session.date) : longRunBaseline) ?? null;
			if (baselineKm !== null && baselineKm > 0 && session.plannedRun.target_km !== null && session.plannedRun.target_km > baselineKm) {
				const growth = (session.plannedRun.target_km - baselineKm) / baselineKm;
				if (growth > MAX_WEEKLY_RUN_GROWTH) {
					errors.push(
						`Long run growth on ${session.date} (week ${week.week_number}) exceeds the ${MAX_WEEKLY_RUN_GROWTH * 100}% cap vs ${baselineDescription} (${baselineKm}km -> ${session.plannedRun.target_km}km)`,
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
 * drop one, because a deload week that trains a day less is legitimate
 * periodisation and the old exact-equality rule made it un-importable. Never
 * more than `days_per_week`, and never zero — with days_per_week of 1 the
 * floor and the target are the same number.
 */
function validateSessionCount(week: WeekProposalInput, context: ExportContext, isFirstWeek: boolean): string[] {
	const target = context.daysPerWeek;
	const floor = isFirstWeek ? target : Math.max(1, target - 1);
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
export function validateProposal(proposal: MultiWeekProposalInput, context: ExportContext): string[] {
	if (!Array.isArray(proposal?.weeks)) {
		return ['proposal has no weeks array'];
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
		errors.push(...validateSessionCount(week, context, index === 0));

		if (index === 0) {
			errors.push(
				...validateWeekAgainstBaseline(week, context.deterministicProposal.weeks[0], context, 'the deterministic proposal', true),
			);
		} else {
			const previousWeek = proposal.weeks[index - 1];
			errors.push(...validateWeekAgainstBaseline(week, previousWeek, context, `week ${previousWeek.week_number}`, false));

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
export async function importProposal(db: D1Database, input: MultiWeekProposalInput, today: string, replace = false): Promise<ImportResult> {
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

	const context = await buildExportContext(db, input.weeks.length, today);
	const errors = validateProposal(input, context);
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
				`INSERT INTO generated_plans (first_week_number, week_count, plan_json, deterministic_json) VALUES (?, ?, ?, ?) RETURNING id`,
			)
			.bind(input.weeks[0].week_number, input.weeks.length, JSON.stringify(hydrated), JSON.stringify(context.deterministicProposal)),
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
export async function insertWeeksFromProposal(db: D1Database, plan: MultiWeekProposal): Promise<{ ok: true } | { ok: false; errors: string[] }> {
	const flattened = plan.weeks.flatMap((week) => week.sessions.map((session) => ({ session, week_number: week.week_number })));
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

	const sessionRows = await db.batch<{ id: number }>(
		flattened.map(({ session, week_number }) =>
			db
				.prepare(`INSERT INTO sessions (date, kind, label, status, week_number) VALUES (?, ?, ?, 'planned', ?) RETURNING id`)
				.bind(session.date, session.kind, session.label, week_number),
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
