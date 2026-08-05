import { describe, expect, it } from 'vitest';
import { buildRounds, groupPlannedSets, isRoundComplete, restAfterRound } from '../src/supersets';
import { loggedSets, plannedSet } from './factories';

describe('groupPlannedSets', () => {
	it('gives every ungrouped exercise its own non-superset group, in order_index order', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1 }),
			plannedSet({ id: 2, order_index: 2 }),
			plannedSet({ id: 3, order_index: 3 }),
		]);

		expect(groups).toHaveLength(3);
		expect(groups.map((g) => g.key)).toEqual(['ps-1', 'ps-2', 'ps-3']);
		expect(groups.every((g) => !g.isSuperset)).toBe(true);
	});

	it('buckets rows sharing a superset_group into one group, members in order_index order', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 8, order_index: 8, superset_group: 1, exercise_name: 'Triceps pushdown' }),
			plannedSet({ id: 7, order_index: 7, superset_group: 1, exercise_name: 'DB bicep curl' }),
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('sg-1');
		expect(groups[0].isSuperset).toBe(true);
		expect(groups[0].members.map((m) => m.exercise_name)).toEqual(['DB bicep curl', 'Triceps pushdown']);
	});

	// The code this replaces used `.find()` to locate "the partner", which
	// silently ignored any third member of a group.
	it('keeps all three members of a three-way superset', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 4 }),
			plannedSet({ id: 2, order_index: 2, superset_group: 4 }),
			plannedSet({ id: 3, order_index: 3, superset_group: 4 }),
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].members).toHaveLength(3);
	});

	it('treats a lone row carrying a superset_group as a normal exercise, not a superset', () => {
		const groups = groupPlannedSets([plannedSet({ id: 1, superset_group: 9 })]);

		expect(groups[0].isSuperset).toBe(false);
		expect(groups[0].members).toHaveLength(1);
	});

	it('does not merge two different superset groups', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1 }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1 }),
			plannedSet({ id: 3, order_index: 3, superset_group: 2 }),
			plannedSet({ id: 4, order_index: 4, superset_group: 2 }),
		]);

		expect(groups.map((g) => g.key)).toEqual(['sg-1', 'sg-2']);
	});

	it('positions a group by the minimum order_index of its members', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 6 }),
			plannedSet({ id: 2, order_index: 7, superset_group: 1 }),
			plannedSet({ id: 3, order_index: 8, superset_group: 1 }),
			plannedSet({ id: 4, order_index: 9 }),
		]);

		expect(groups.map((g) => g.key)).toEqual(['ps-1', 'sg-1', 'ps-4']);
	});

	it('sorts a scrambled input rather than trusting the given order', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 3, order_index: 3 }),
			plannedSet({ id: 1, order_index: 1 }),
			plannedSet({ id: 2, order_index: 2 }),
		]);

		expect(groups.map((g) => g.orderIndex)).toEqual([1, 2, 3]);
	});

	it('takes rounds and rest from the longest/longest-resting member', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 3, rest_seconds: 0 }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 4, rest_seconds: 90 }),
		]);

		expect(groups[0].rounds).toBe(4);
		expect(groups[0].restSeconds).toBe(90);
	});

	// Skipping the member that carries the long rest shouldn't leave you
	// resting for work you've dropped.
	it('ignores skipped members when computing rounds and rest', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 3, rest_seconds: 60 }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 5, rest_seconds: 180, status: 'skipped' }),
		]);

		expect(groups[0].rounds).toBe(3);
		expect(groups[0].restSeconds).toBe(60);
	});

	it('reports zero rounds when every member is skipped', () => {
		const groups = groupPlannedSets([
			plannedSet({ id: 1, superset_group: 1, status: 'skipped' }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, status: 'skipped' }),
		]);

		expect(groups[0].rounds).toBe(0);
	});
});

describe('buildRounds', () => {
	it('pairs each member set into a round, in member order', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 7, order_index: 7, superset_group: 1, target_sets: 3, exercise_name: 'DB bicep curl' }),
			plannedSet({ id: 8, order_index: 8, superset_group: 1, target_sets: 3, exercise_name: 'Triceps pushdown' }),
		]);

		const rounds = buildRounds(group);
		expect(rounds).toHaveLength(3);
		expect(rounds[0].slots.map((s) => s.exercise.exercise_name)).toEqual(['DB bicep curl', 'Triceps pushdown']);
		expect(rounds[0].slots.map((s) => s.setIndex)).toEqual([1, 1]);
		expect(rounds[2].slots.map((s) => s.setIndex)).toEqual([3, 3]);
	});

	it('drops a member from rounds beyond its own target_sets', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 3, exercise_name: 'A' }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 2, exercise_name: 'B' }),
		]);

		const rounds = buildRounds(group);
		expect(rounds).toHaveLength(3);
		expect(rounds[1].slots.map((s) => s.exercise.exercise_name)).toEqual(['A', 'B']);
		expect(rounds[2].slots.map((s) => s.exercise.exercise_name)).toEqual(['A']);
	});

	it('gives a skipped member no slot in any round', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, exercise_name: 'A' }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, exercise_name: 'B', status: 'skipped' }),
		]);

		expect(buildRounds(group).every((r) => r.slots.every((s) => s.exercise.exercise_name === 'A'))).toBe(true);
	});

	it('returns no rounds when every member is skipped', () => {
		const [group] = groupPlannedSets([plannedSet({ id: 1, superset_group: 1, status: 'skipped' })]);

		expect(buildRounds(group)).toEqual([]);
	});

	it('gives a solo exercise one slot per round', () => {
		const [group] = groupPlannedSets([plannedSet({ id: 1, target_sets: 4 })]);

		const rounds = buildRounds(group);
		expect(rounds).toHaveLength(4);
		expect(rounds.every((r) => r.slots.length === 1)).toBe(true);
	});

	it('keys slots by planned_set id, so two rows sharing an exercise_id stay distinct', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, exercise_id: 5 }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, exercise_id: 5 }),
		]);

		const keys = buildRounds(group)[0].slots.map((s) => s.slotKey);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('isRoundComplete / restAfterRound', () => {
	function supersetGroup(aLogged: number, bLogged: number) {
		return groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 3, rest_seconds: 0, logged: loggedSets(aLogged) }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 3, rest_seconds: 90, logged: loggedSets(bLogged) }),
		])[0];
	}

	it('a solo exercise rests after every set, using its own prescribed rest', () => {
		const [group] = groupPlannedSets([plannedSet({ id: 1, target_sets: 3, rest_seconds: 150, logged: loggedSets(1) })]);

		expect(restAfterRound(group, 1)).toBe(150);
	});

	// This is the superset rule: no timer between members, full rest after.
	it('returns null mid-round, so there is no timer between superset members', () => {
		expect(restAfterRound(supersetGroup(1, 0), 1)).toBeNull();
	});

	it('returns the longest member rest once the round is complete', () => {
		expect(restAfterRound(supersetGroup(1, 1), 1)).toBe(90);
	});

	it('only rests after the last member of a three-way superset', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 2, rest_seconds: 0, logged: loggedSets(1) }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 2, rest_seconds: 0, logged: loggedSets(1) }),
			plannedSet({ id: 3, order_index: 3, superset_group: 1, target_sets: 2, rest_seconds: 120, logged: [] }),
		]);

		expect(restAfterRound(group, 1)).toBeNull();
	});

	it('completes a round without its skipped member', () => {
		const [group] = groupPlannedSets([
			plannedSet({ id: 1, order_index: 1, superset_group: 1, target_sets: 3, rest_seconds: 60, logged: loggedSets(1) }),
			plannedSet({ id: 2, order_index: 2, superset_group: 1, target_sets: 3, rest_seconds: 90, status: 'skipped' }),
		]);

		expect(restAfterRound(group, 1)).toBe(60);
	});

	it('returns null for a round that does not exist', () => {
		expect(restAfterRound(supersetGroup(0, 0), 9)).toBeNull();
	});

	it('an empty round is not complete', () => {
		expect(isRoundComplete({ roundIndex: 1, slots: [] })).toBe(false);
	});
});
