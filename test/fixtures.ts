import { env } from 'cloudflare:test';
import type {
	Exercise,
	Loading,
	LoggedRunEntry,
	Modality,
	PlannedSetStatus,
	RunType,
	SessionKind,
	SessionOrigin,
	SessionStatus,
} from '../src/types';

// Re-exported so callers (e.g. test/sessions.today.test.ts) compare against
// the exact same Europe/London-based "today" the route itself computes —
// a second, independently-computed todayIso() here would drift from the
// route's answer right at the GMT/BST boundary and make those tests flaky.
export { todayIso } from '../src/dates';

export async function insertExercise(overrides: Partial<Omit<Exercise, 'id'>> = {}): Promise<number> {
	const e = {
		name: 'Test Exercise',
		modality: 'dumbbell' as Modality,
		pattern: 'horizontal_push',
		increment_kg: 2,
		loading: 'per_hand' as Loading,
		shoulder_safe: 1 as const,
		back_safe: 1 as const,
		needs_spotter: 0 as const,
		is_default: 0 as const,
		...overrides,
	};
	const row = await env.DB.prepare(
		`INSERT INTO exercises (name, modality, pattern, increment_kg, loading, shoulder_safe, back_safe, needs_spotter, is_default)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
	)
		.bind(e.name, e.modality, e.pattern, e.increment_kg, e.loading, e.shoulder_safe, e.back_safe, e.needs_spotter, e.is_default)
		.first<{ id: number }>();
	return row!.id;
}

export async function insertSession(
	overrides: Partial<{ date: string; kind: SessionKind; label: string; status: SessionStatus; week_number: number; origin: SessionOrigin }> = {},
): Promise<number> {
	const s = {
		date: '2026-08-03',
		kind: 'lift' as SessionKind,
		label: 'Lift A',
		status: 'planned' as SessionStatus,
		week_number: 1,
		origin: 'planned' as SessionOrigin,
		...overrides,
	};
	const row = await env.DB.prepare(`INSERT INTO sessions (date, kind, label, status, week_number, origin) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
		.bind(s.date, s.kind, s.label, s.status, s.week_number, s.origin)
		.first<{ id: number }>();
	return row!.id;
}

export async function insertPlannedSet(
	sessionId: number,
	exerciseId: number,
	overrides: Partial<{
		order_index: number;
		target_sets: number;
		rep_low: number;
		rep_high: number;
		target_weight_kg: number | null;
		rest_seconds: number;
		notes: string | null;
		status: PlannedSetStatus;
		superset_group: number | null;
	}> = {},
): Promise<void> {
	const p = {
		order_index: 1,
		target_sets: 3,
		rep_low: 8,
		rep_high: 10,
		target_weight_kg: null,
		rest_seconds: 120,
		notes: null,
		status: 'planned' as PlannedSetStatus,
		superset_group: null,
		...overrides,
	};
	await env.DB.prepare(
		`INSERT INTO planned_sets (session_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_weight_kg, rest_seconds, notes, status, superset_group)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			sessionId,
			exerciseId,
			p.order_index,
			p.target_sets,
			p.rep_low,
			p.rep_high,
			p.target_weight_kg,
			p.rest_seconds,
			p.notes,
			p.status,
			p.superset_group,
		)
		.run();
}

export async function insertPlannedRun(
	sessionId: number,
	overrides: Partial<{ run_type: RunType; target_minutes: number | null; target_km: number | null; structure_json: string | null }> = {},
): Promise<void> {
	const p = { run_type: 'easy' as RunType, target_minutes: 30, target_km: null, structure_json: null, ...overrides };
	await env.DB.prepare(`INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES (?, ?, ?, ?, ?)`)
		.bind(sessionId, p.run_type, p.target_minutes, p.target_km, p.structure_json)
		.run();
}

export async function insertLoggedRun(sessionId: number, overrides: Partial<LoggedRunEntry> = {}): Promise<void> {
	const l: LoggedRunEntry = {
		distance_km: 5,
		duration_seconds: 1800,
		avg_hr: 140,
		max_hr: null,
		avg_cadence_spm: null,
		elevation_gain_m: null,
		aerobic_training_effect: null,
		rpe_1_10: 4,
		interval_pace_seconds_per_km: null,
		performed_on: '2026-07-27',
		note: null,
		...overrides,
	};
	await env.DB.prepare(
		`INSERT INTO logged_runs (session_id, distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m,
		                          aerobic_training_effect, rpe_1_10, interval_pace_seconds_per_km, performed_on, note)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			sessionId,
			l.distance_km,
			l.duration_seconds,
			l.avg_hr,
			l.max_hr,
			l.avg_cadence_spm,
			l.elevation_gain_m,
			l.aerobic_training_effect,
			l.rpe_1_10,
			l.interval_pace_seconds_per_km,
			l.performed_on,
			l.note,
		)
		.run();
}

export async function insertLoggedSet(
	sessionId: number,
	exerciseId: number,
	overrides: Partial<{ set_index: number; weight_kg: number; reps: number; rir: number; rest_taken_seconds: number | null; performed_on: string }> = {},
): Promise<void> {
	const l = { set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: 120, performed_on: '2026-07-27', ...overrides };
	await env.DB.prepare(
		`INSERT INTO logged_sets (session_id, exercise_id, set_index, weight_kg, reps, rir, rest_taken_seconds, performed_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(sessionId, exerciseId, l.set_index, l.weight_kg, l.reps, l.rir, l.rest_taken_seconds, l.performed_on)
		.run();
}
