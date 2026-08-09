// src/generator.ts — weekly generator orchestration (manual export/import, see
// migrations/0004_generator.sql, migrations/0005_generator_multiweek.sql, and
// the approved plan). No AI call lives here: buildExportContext/
// generateNextWeeks produce the deterministic pass as plain JSON for a human
// to paste into whatever AI assistant they have; importProposal validates and
// persists whatever comes back.

import { addDaysIso } from './dates';
import { sqlIn } from './sql';
import { progressExercise, type ExercisePrescription, type LoggedSetForProgression } from './progression';
import { MAX_WEEKLY_RUN_GROWTH, progressRun, type LoggedRunForProgression } from './runProgression';
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

interface LoggedRunRow {
	id: number;
	session_id: number;
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	rpe_1_10: number | null;
	performed_on: string;
	note: string | null;
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
export async function buildExportContext(db: D1Database, weekCount: number): Promise<ExportContext> {
	const settingsRow = await db.prepare(`SELECT * FROM settings WHERE id = 1`).first<{ id: number; goals: string; days_per_week: number }>();
	const goals = settingsRow?.goals ?? '';
	const daysPerWeek = settingsRow?.days_per_week ?? 5;

	const { results: exerciseCatalogue } = await db.prepare(`SELECT * FROM exercises`).all<Exercise>();

	const maxWeekRow = await db.prepare(`SELECT MAX(week_number) AS w FROM sessions`).first<{ w: number | null }>();
	const lastWeekNumber = maxWeekRow?.w ?? null;

	if (lastWeekNumber === null) {
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
			daysPerWeek,
			exerciseCatalogue,
			painFlags,
		};
	}

	const priorWeekNumber = lastWeekNumber - 1;

	// Bulk query 1/5: sessions across the last two weeks (just one if this is week 1).
	const { results: windowSessions } = await db
		.prepare(`SELECT * FROM sessions WHERE week_number IN (?, ?) ORDER BY date`)
		.bind(priorWeekNumber, lastWeekNumber)
		.all<SessionRow>();

	const lastWeekSessions = windowSessions.filter((s) => s.week_number === lastWeekNumber);
	const lastWeekSessionIds = lastWeekSessions.map((s) => s.id);
	const windowSessionIds = windowSessions.map((s) => s.id);

	// Bulk query 2/5: planned_sets joined with exercises, last week only — this is what's actually being progressed.
	const { results: plannedSetRows } = lastWeekSessionIds.length
		? await db
				.prepare(
					`SELECT ps.id, ps.session_id, ps.exercise_id, ps.order_index, ps.target_sets, ps.rep_low, ps.rep_high,
					        ps.target_weight_kg, ps.rest_seconds, ps.notes, ps.superset_group, e.increment_kg
					 FROM planned_sets ps JOIN exercises e ON e.id = ps.exercise_id
					 WHERE ps.session_id IN (${sqlIn(lastWeekSessionIds.length)})
					 ORDER BY ps.session_id, ps.order_index`,
				)
				.bind(...lastWeekSessionIds)
				.all<PlannedSetJoinRow>()
		: { results: [] as PlannedSetJoinRow[] };

	// Bulk query 3/5: logged_sets across the full 2-week window — feeds both the progression pass (last week's subset) and the raw history payload.
	const { results: loggedSetRows } = windowSessionIds.length
		? await db.prepare(`SELECT * FROM logged_sets WHERE session_id IN (${sqlIn(windowSessionIds.length)})`).bind(...windowSessionIds).all<LoggedSetRow>()
		: { results: [] as LoggedSetRow[] };

	// Bulk query 4/5: planned_runs, last week only.
	const { results: plannedRunRows } = lastWeekSessionIds.length
		? await db.prepare(`SELECT * FROM planned_runs WHERE session_id IN (${sqlIn(lastWeekSessionIds.length)})`).bind(...lastWeekSessionIds).all<PlannedRunRow>()
		: { results: [] as PlannedRunRow[] };

	// Bulk query 5/6: logged_runs across the full 2-week window.
	const { results: loggedRunRows } = windowSessionIds.length
		? await db.prepare(`SELECT * FROM logged_runs WHERE session_id IN (${sqlIn(windowSessionIds.length)})`).bind(...windowSessionIds).all<LoggedRunRow>()
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
	const skippedSessions: SessionRow[] = lastWeekSessions.filter((s) => s.status === 'skipped');

	const plannedSetsBySession = new Map<number, PlannedSetJoinRow[]>();
	for (const row of plannedSetRows) {
		const list = plannedSetsBySession.get(row.session_id) ?? [];
		list.push(row);
		plannedSetsBySession.set(row.session_id, list);
	}
	const plannedRunBySession = new Map(plannedRunRows.map((r) => [r.session_id, r]));
	const loggedRunBySession = new Map(loggedRunRows.map((r) => [r.session_id, r]));

	const proposedSessions: ProposedSessionInput[] = [];

	for (const session of lastWeekSessions) {
		const newDate = addDaysIso(session.date, 7);

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
					? { distance_km: loggedRunRow.distance_km, duration_seconds: loggedRunRow.duration_seconds, rpe_1_10: loggedRunRow.rpe_1_10 }
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

	const week1: WeekProposalInput = { week_number: lastWeekNumber + 1, sessions: proposedSessions };

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
		weeks.push({ week_number: lastWeekNumber + w, sessions });
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
		loggedRuns: loggedRunRows.map((r) => ({
			session_id: r.session_id,
			distance_km: r.distance_km,
			duration_seconds: r.duration_seconds,
			avg_hr: r.avg_hr,
			rpe_1_10: r.rpe_1_10,
			performed_on: r.performed_on,
			note: r.note,
		})),
	};

	return {
		deterministicProposal: { weeks },
		speculativeFromWeek: 2,
		reasons,
		historyWindow,
		skippedSessions,
		goals,
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
export async function generateNextWeeks(db: D1Database, weekCount: number): Promise<ExportContext> {
	return buildExportContext(db, weekCount);
}

const RUN_TYPES: readonly RunType[] = ['easy', 'tempo', 'intervals', 'long'];

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
	if (!Array.isArray(week.sessions)) {
		errors.push(`${where()} has no sessions array`);
		return errors; // nothing further is inspectable
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

			session.plannedSets.forEach((set, setIndex) => {
				const setAt = `${at}, set ${setIndex}`;
				if (!isPositiveInt(set.exercise_id)) errors.push(`${setAt} has an invalid exercise_id (${JSON.stringify(set.exercise_id)})`);
				if (!isNonNegativeInt(set.order_index)) errors.push(`${setAt} has an invalid order_index (${JSON.stringify(set.order_index)})`);
				if (!isPositiveInt(set.target_sets)) errors.push(`${setAt} has an invalid target_sets (${JSON.stringify(set.target_sets)}) — must be a positive integer`);
				if (!isNonNegativeInt(set.rep_low)) errors.push(`${setAt} has an invalid rep_low (${JSON.stringify(set.rep_low)})`);
				if (!isNonNegativeInt(set.rep_high)) errors.push(`${setAt} has an invalid rep_high (${JSON.stringify(set.rep_high)})`);
				if (isNonNegativeInt(set.rep_low) && isNonNegativeInt(set.rep_high) && set.rep_high < set.rep_low) {
					errors.push(`${setAt} has rep_high (${set.rep_high}) below rep_low (${set.rep_low})`);
				}
				if (!isNullableNonNegativeNumber(set.target_weight_kg)) {
					errors.push(`${setAt} has an invalid target_weight_kg (${JSON.stringify(set.target_weight_kg)}) — must be null or a non-negative number`);
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
			if (!isNullableNonNegativeNumber(run.target_minutes)) errors.push(`${at} has an invalid target_minutes (${JSON.stringify(run.target_minutes)})`);
			if (!isNullableNonNegativeNumber(run.target_km)) errors.push(`${at} has an invalid target_km (${JSON.stringify(run.target_km)})`);
			if (run.structure_json !== null && run.structure_json !== undefined) {
				if (typeof run.structure_json !== 'string') {
					errors.push(`${at} has a non-string structure_json`);
				} else {
					try {
						JSON.parse(run.structure_json);
					} catch {
						// Stored as an opaque TEXT blob and parsed by the client at
						// render time, so bad JSON here fails silently in the UI later.
						errors.push(`${at} has a structure_json that is not valid JSON`);
					}
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
				errors.push(`${exercise.name} is flagged shoulder-unsafe but a shoulder pain flag is active (week ${week.week_number}, ${session.date})`);
			}
			if (context.painFlags.back && exercise.back_safe === 0) {
				errors.push(`${exercise.name} is flagged back-unsafe but a back pain flag is active (week ${week.week_number}, ${session.date})`);
			}

			// Weight jump vs the baseline week, capped at 10% — only on
			// increases; a decrease (e.g. a deload) is never rejected here. A
			// substituted exercise_id with no matching baseline entry in the
			// baseline week is unconstrained on weight — nothing to compare
			// against.
			const baseline = dateKeyed ? weightBaselineByKey.get(`${session.date}:${set.exercise_id}`) : weightBaselineByExercise.get(set.exercise_id);
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

	if (week.sessions.length !== context.daysPerWeek) {
		errors.push(`Session count (${week.sessions.length}) does not match days_per_week (${context.daysPerWeek}) (week ${week.week_number})`);
	}

	return errors;
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
		if (index === 0) {
			errors.push(...validateWeekAgainstBaseline(week, context.deterministicProposal.weeks[0], context, 'the deterministic proposal', true));
		} else {
			const previousWeek = proposal.weeks[index - 1];
			errors.push(...validateWeekAgainstBaseline(week, previousWeek, context, `week ${previousWeek.week_number}`, false));
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

/**
 * Validates and persists a pasted-back proposal as a pending `generated_plans`
 * row. Rebuilds the deterministic baseline fresh via buildExportContext
 * (sized to match the pasted-back proposal's week count so chain validation
 * has the right number of weeks to compare against) rather than trying to
 * persist/reload the exact one the export handed out — keeps this function
 * self-contained and avoids needing the client to round-trip extra state it
 * has no reason to keep.
 */
export async function importProposal(db: D1Database, input: MultiWeekProposalInput): Promise<ImportResult> {
	if (input.weeks.length === 0) {
		return { ok: false, errors: ['proposal must include at least one week'] };
	}

	const existingPending = await db.prepare(`SELECT id FROM generated_plans WHERE status = 'pending' LIMIT 1`).first<{ id: number }>();
	if (existingPending) {
		return { ok: false, errors: ['A plan is already pending review — accept or reject it before importing another.'] };
	}

	const context = await buildExportContext(db, input.weeks.length);
	const errors = validateProposal(input, context);
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const hydrated: MultiWeekProposal = { weeks: input.weeks.map((week) => hydrateProposal(week, context.exerciseCatalogue)) };

	const row = await db
		.prepare(`INSERT INTO generated_plans (first_week_number, week_count, plan_json, deterministic_json) VALUES (?, ?, ?, ?) RETURNING id`)
		.bind(input.weeks[0].week_number, input.weeks.length, JSON.stringify(hydrated), JSON.stringify(context.deterministicProposal))
		.first<{ id: number }>();

	return { ok: true, id: row!.id };
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
 */
export async function insertWeeksFromProposal(db: D1Database, plan: MultiWeekProposal): Promise<void> {
	const flattened = plan.weeks.flatMap((week) => week.sessions.map((session) => ({ session, week_number: week.week_number })));
	if (flattened.length === 0) return;

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
					.bind(sessionId, session.plannedRun.run_type, session.plannedRun.target_minutes, session.plannedRun.target_km, session.plannedRun.structure_json),
			);
		}
	});

	if (children.length > 0) await db.batch(children);
}
