import { env } from 'cloudflare:test';
import type { Exercise, Loading, Modality, SessionKind, SessionStatus } from '../src/types';

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
	overrides: Partial<{ date: string; kind: SessionKind; label: string; status: SessionStatus; week_number: number }> = {},
): Promise<number> {
	const s = { date: '2026-08-03', kind: 'lift' as SessionKind, label: 'Lift A', status: 'planned' as SessionStatus, week_number: 1, ...overrides };
	const row = await env.DB.prepare(`INSERT INTO sessions (date, kind, label, status, week_number) VALUES (?, ?, ?, ?, ?) RETURNING id`)
		.bind(s.date, s.kind, s.label, s.status, s.week_number)
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
	}> = {},
): Promise<void> {
	const p = { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: null, rest_seconds: 120, notes: null, ...overrides };
	await env.DB.prepare(
		`INSERT INTO planned_sets (session_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_weight_kg, rest_seconds, notes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(sessionId, exerciseId, p.order_index, p.target_sets, p.rep_low, p.rep_high, p.target_weight_kg, p.rest_seconds, p.notes)
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

export function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}
