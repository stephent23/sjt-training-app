// src/generator.ts — weekly generator orchestration (manual export/import, see
// migrations/0004_generator.sql and the approved plan). No AI call lives
// here: buildExportContext/generateNextWeek produce the deterministic pass
// as plain JSON for a human to paste into whatever AI assistant they have;
// importProposal validates and persists whatever comes back.

import { addDaysIso } from './dates';
import { progressExercise, type ExercisePrescription, type LoggedSetForProgression } from './progression';
import { MAX_WEEKLY_RUN_GROWTH, progressRun, type LoggedRunForProgression } from './runProgression';
import type {
	Exercise,
	LoggedRunEntry,
	LoggedSetEntry,
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
	deterministicProposal: WeekProposalInput;
	reasons: Record<string, string>;
	historyWindow: HistoryWindow;
	skippedSessions: SessionRow[];
	goals: string;
	daysPerWeek: number;
	exerciseCatalogue: Exercise[];
	painFlags: PainFlags;
}

export type ImportResult = { ok: true; id: number } | { ok: false; errors: string[] };

function sqlIn(n: number): string {
	return n > 0 ? Array(n).fill('?').join(',') : 'NULL';
}

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
 * week and returns the full bundle a live AI review call would have been
 * sent. Five bulk queries regardless of week count — sessions,
 * planned_sets+exercises joined, logged_sets, planned_runs, logged_runs, all
 * via `WHERE id IN (...)` — never N+1 per exercise (this is a 2-week window,
 * not a single session).
 */
export async function buildExportContext(db: D1Database): Promise<ExportContext> {
	const settingsRow = await db.prepare(`SELECT * FROM settings WHERE id = 1`).first<{ id: number; goals: string; days_per_week: number }>();
	const goals = settingsRow?.goals ?? '';
	const daysPerWeek = settingsRow?.days_per_week ?? 5;

	const { results: exerciseCatalogue } = await db.prepare(`SELECT * FROM exercises`).all<Exercise>();

	const maxWeekRow = await db.prepare(`SELECT MAX(week_number) AS w FROM sessions`).first<{ w: number | null }>();
	const lastWeekNumber = maxWeekRow?.w ?? null;

	const painFlags: PainFlags = { shoulder: false, back: false }; // no feedback-capture UI yet — see plan risk #5

	if (lastWeekNumber === null) {
		// No sessions exist at all yet — nothing to progress from.
		return {
			deterministicProposal: { week_number: 1, sessions: [] },
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

	// Bulk query 5/5: logged_runs across the full 2-week window.
	const { results: loggedRunRows } = windowSessionIds.length
		? await db.prepare(`SELECT * FROM logged_runs WHERE session_id IN (${sqlIn(windowSessionIds.length)})`).bind(...windowSessionIds).all<LoggedRunRow>()
		: { results: [] as LoggedRunRow[] };

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
		deterministicProposal: { week_number: lastWeekNumber + 1, sessions: proposedSessions },
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
export async function generateNextWeek(db: D1Database): Promise<ExportContext> {
	return buildExportContext(db);
}

/**
 * Checks a pasted-back (or hand-crafted) WeekProposalInput against the
 * context that produced it. Empty array = valid.
 */
export function validateProposal(proposal: WeekProposalInput, context: ExportContext): string[] {
	const errors: string[] = [];
	const exerciseById = new Map(context.exerciseCatalogue.map((e) => [e.id, e]));

	// Baselines keyed exactly like `reasons` — the deterministic proposal's
	// own values for the same slot are the reference point for "how big a
	// jump is this", not last week's actual logged numbers.
	const weightBaselineByKey = new Map<string, number | null>();
	const longRunBaselineByDate = new Map<string, number | null>();
	for (const session of context.deterministicProposal.sessions) {
		for (const set of session.plannedSets) {
			weightBaselineByKey.set(`${session.date}:${set.exercise_id}`, set.target_weight_kg);
		}
		if (session.plannedRun?.run_type === 'long') {
			longRunBaselineByDate.set(session.date, session.plannedRun.target_km);
		}
	}

	for (const session of proposal.sessions) {
		for (const set of session.plannedSets) {
			const exercise = exerciseById.get(set.exercise_id);
			if (!exercise) {
				errors.push(`Unknown exercise_id ${set.exercise_id} (${session.date})`);
				continue;
			}

			if (context.painFlags.shoulder && exercise.shoulder_safe === 0) {
				errors.push(`${exercise.name} is flagged shoulder-unsafe but a shoulder pain flag is active (${session.date})`);
			}
			if (context.painFlags.back && exercise.back_safe === 0) {
				errors.push(`${exercise.name} is flagged back-unsafe but a back pain flag is active (${session.date})`);
			}

			// Weight jump vs the deterministic baseline, capped at 10% — only on
			// increases; a decrease (e.g. a deload) is never rejected here.
			const baseline = weightBaselineByKey.get(`${session.date}:${set.exercise_id}`);
			if (baseline !== undefined && baseline !== null && baseline > 0 && set.target_weight_kg !== null && set.target_weight_kg > baseline) {
				const jump = (set.target_weight_kg - baseline) / baseline;
				if (jump > 0.1) {
					errors.push(
						`Weight jump for exercise_id ${set.exercise_id} on ${session.date} exceeds 10% vs the deterministic proposal (${baseline}kg -> ${set.target_weight_kg}kg)`,
					);
				}
			}
		}

		if (session.plannedRun?.run_type === 'long') {
			const baselineKm = longRunBaselineByDate.get(session.date) ?? null;
			if (baselineKm !== null && baselineKm > 0 && session.plannedRun.target_km !== null && session.plannedRun.target_km > baselineKm) {
				const growth = (session.plannedRun.target_km - baselineKm) / baselineKm;
				if (growth > MAX_WEEKLY_RUN_GROWTH) {
					errors.push(
						`Long run growth on ${session.date} exceeds the ${MAX_WEEKLY_RUN_GROWTH * 100}% cap vs the deterministic proposal (${baselineKm}km -> ${session.plannedRun.target_km}km)`,
					);
				}
			}
		}
	}

	if (proposal.sessions.length !== context.daysPerWeek) {
		errors.push(`Session count (${proposal.sessions.length}) does not match days_per_week (${context.daysPerWeek})`);
	}

	return errors;
}

/** Joins exercise names/patterns back onto an id-only proposal after
 * validation has already confirmed every exercise_id is real. */
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
 * rather than trying to persist/reload the exact one the export handed out —
 * keeps this function self-contained and avoids needing the client to
 * round-trip extra state it has no reason to keep.
 */
export async function importProposal(db: D1Database, input: WeekProposalInput): Promise<ImportResult> {
	const existingPending = await db.prepare(`SELECT id FROM generated_plans WHERE status = 'pending' LIMIT 1`).first<{ id: number }>();
	if (existingPending) {
		return { ok: false, errors: ['A plan is already pending review — accept or reject it before importing another.'] };
	}

	const context = await buildExportContext(db);
	const errors = validateProposal(input, context);
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const hydrated = hydrateProposal(input, context.exerciseCatalogue);

	const row = await db
		.prepare(`INSERT INTO generated_plans (week_number, plan_json, deterministic_json) VALUES (?, ?, ?) RETURNING id`)
		.bind(input.week_number, JSON.stringify(hydrated), JSON.stringify(context.deterministicProposal))
		.first<{ id: number }>();

	return { ok: true, id: row!.id };
}

/**
 * Plain sequential INSERTs into sessions/planned_sets/planned_runs — same
 * shape as seeds/week1_sessions.sql. Not atomic across the whole week (D1
 * batch() can't chain a generated id into a dependent insert — plan risk #3);
 * low-probability/low-severity, fixable by hand if it ever bites.
 */
export async function insertWeekFromProposal(db: D1Database, plan: WeekProposal): Promise<void> {
	for (const session of plan.sessions) {
		const sessionRow = await db
			.prepare(`INSERT INTO sessions (date, kind, label, status, week_number) VALUES (?, ?, ?, 'planned', ?) RETURNING id`)
			.bind(session.date, session.kind, session.label, plan.week_number)
			.first<{ id: number }>();
		const sessionId = sessionRow!.id;

		for (const set of session.plannedSets) {
			await db
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
				)
				.run();
		}

		if (session.plannedRun) {
			await db
				.prepare(`INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES (?, ?, ?, ?, ?)`)
				.bind(sessionId, session.plannedRun.run_type, session.plannedRun.target_minutes, session.plannedRun.target_km, session.plannedRun.structure_json)
				.run();
		}
	}
}
