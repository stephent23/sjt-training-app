import { describe, expect, it } from 'vitest';
import { rankSwapCandidates } from '../src/swaps';
import type { Exercise } from '../src/types';

function exercise(overrides: Partial<Exercise>): Exercise {
	return {
		id: 1,
		name: 'Exercise',
		modality: 'dumbbell',
		pattern: 'horizontal_push',
		increment_kg: 2,
		loading: 'per_hand',
		shoulder_safe: 1,
		back_safe: 1,
		needs_spotter: 0,
		is_default: 0,
		...overrides,
	};
}

describe('rankSwapCandidates', () => {
	const from = exercise({ id: 1, name: 'Neutral-grip DB press', pattern: 'horizontal_push' });

	it('only offers exercises with the same movement pattern', () => {
		const pool = [
			from,
			exercise({ id: 2, name: 'Machine chest press', pattern: 'horizontal_push' }),
			exercise({ id: 3, name: 'Cable row', pattern: 'horizontal_pull' }),
		];
		const result = rankSwapCandidates(pool, from, null, new Set());
		expect(result.map((c) => c.name)).toEqual(['Machine chest press']);
	});

	it('excludes the exercise being swapped out of', () => {
		const pool = [from];
		expect(rankSwapCandidates(pool, from, null, new Set())).toHaveLength(0);
	});

	it('excludes anything needing a spotter', () => {
		const pool = [from, exercise({ id: 2, name: 'Barbell bench (hypothetical)', pattern: 'horizontal_push', needs_spotter: 1 })];
		expect(rankSwapCandidates(pool, from, null, new Set())).toHaveLength(0);
	});

	it('requires shoulder_safe when the swap reason is shoulder pain', () => {
		const pool = [
			from,
			exercise({ id: 2, name: 'Incline DB press', pattern: 'horizontal_push', shoulder_safe: 0 }),
			exercise({ id: 3, name: 'Machine chest press', pattern: 'horizontal_push', shoulder_safe: 1 }),
		];
		const result = rankSwapCandidates(pool, from, 'shoulder', new Set());
		expect(result.map((c) => c.name)).toEqual(['Machine chest press']);
	});

	it('requires back_safe when the swap reason is back pain, independent of shoulder_safe', () => {
		const pool = [from, exercise({ id: 2, name: 'Single-arm DB row', pattern: 'horizontal_push', shoulder_safe: 1, back_safe: 0 })];
		const result = rankSwapCandidates(pool, from, 'back', new Set());
		expect(result).toHaveLength(0);
	});

	it('ranks defaults first, then exercises with logged history, then alphabetically', () => {
		const pool = [
			from,
			exercise({ id: 2, name: 'Zzz cable press', pattern: 'horizontal_push', is_default: 0 }),
			exercise({ id: 3, name: 'Aaa machine press', pattern: 'horizontal_push', is_default: 0 }),
			exercise({ id: 4, name: 'Default press', pattern: 'horizontal_push', is_default: 1 }),
		];
		const result = rankSwapCandidates(pool, from, null, new Set([3]));
		expect(result.map((c) => c.name)).toEqual(['Default press', 'Aaa machine press', 'Zzz cable press']);
	});

	it('annotates hasHistory from the provided set without affecting exercises outside it', () => {
		const pool = [from, exercise({ id: 2, name: 'Machine chest press', pattern: 'horizontal_push' })];
		const result = rankSwapCandidates(pool, from, null, new Set([2]));
		expect(result[0].hasHistory).toBe(true);
	});
});
