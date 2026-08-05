// Grouping of planned sets into what you actually perform: a solo exercise, or
// a superset done in rounds. Pure — no DB, no DOM, no clock — same shape as
// setDefaults.ts / progression.ts, so it's unit-testable without a runtime.
//
// `planned_sets.superset_group` is a nullable int with no foreign key: rows
// sharing a non-null value within one session are performed together. Nothing
// enforces pair-ness, so everything here is generic over N members.

import type { PlannedSetDetail } from './types';

export interface ExerciseGroup {
	/** `sg-<superset_group>` or `ps-<planned_sets.id>`. The prefixes make a
	 *  collision between the two id spaces impossible. */
	key: string;
	isSuperset: boolean;
	/** At least one, ordered by (order_index, id). */
	members: PlannedSetDetail[];
	/** Min order_index across members — the group's position in the list. */
	orderIndex: number;
	/** Max rest_seconds across NON-SKIPPED members: the rest taken after a
	 *  whole round, not between members within one. */
	restSeconds: number;
	/** Max target_sets across NON-SKIPPED members. 0 when every member is skipped. */
	rounds: number;
}

export interface RoundSlot {
	exercise: PlannedSetDetail;
	setIndex: number;
	/** `${planned_sets.id}-${setIndex}` — unique even if two rows in a session
	 *  somehow share an exercise_id, which an exercise_id-based key would not be. */
	slotKey: string;
}

export interface Round {
	/** 1-based, and equal to the set_index every slot in it logs against. */
	roundIndex: number;
	slots: RoundSlot[];
}

function isActive(member: PlannedSetDetail): boolean {
	return member.status !== 'skipped';
}

/**
 * Buckets planned sets into groups, in the order they should be shown.
 *
 * A group's position is the MINIMUM order_index of its members, so a superset
 * at order 7/8 sits after a solo at 6. Members of one group that aren't
 * contiguous in order_index are still pulled together at that minimum — the
 * only sane reading of "these are performed together", and the case doesn't
 * arise in practice.
 */
export function groupPlannedSets(plannedSets: PlannedSetDetail[]): ExerciseGroup[] {
	// Sort a copy. The server does order by order_index, but this array is
	// rebuilt by logSet/setExerciseStatus in the client and reloaded from
	// localStorage, so don't depend on ordering established elsewhere.
	const sorted = [...plannedSets].sort((a, b) => a.order_index - b.order_index || a.id - b.id);

	const byGroup = new Map<string, PlannedSetDetail[]>();
	for (const row of sorted) {
		const key = row.superset_group == null ? `ps-${row.id}` : `sg-${row.superset_group}`;
		const members = byGroup.get(key) ?? [];
		members.push(row);
		byGroup.set(key, members);
	}

	const groups: ExerciseGroup[] = [];
	for (const [key, members] of byGroup) {
		// Only count members you're actually going to do. Skipping the member
		// with the long rest shouldn't leave you resting for work you dropped.
		const active = members.filter(isActive);
		const restPool = active.length > 0 ? active : members;

		groups.push({
			key,
			// A lone row carrying a stale superset_group is not a superset. This
			// also stops it rendering a "Superset" badge with no partner.
			isSuperset: members.length > 1,
			members,
			orderIndex: Math.min(...members.map((m) => m.order_index)),
			restSeconds: Math.max(...restPool.map((m) => m.rest_seconds)),
			rounds: active.length > 0 ? Math.max(...active.map((m) => m.target_sets)) : 0,
		});
	}

	return groups.sort((a, b) => a.orderIndex - b.orderIndex || Math.min(...a.members.map((m) => m.id)) - Math.min(...b.members.map((m) => m.id)));
}

/**
 * The rounds of a group, in performance order. Round n holds every non-skipped
 * member that has an nth set, so members with fewer target_sets simply drop out
 * of the later rounds and a skipped member appears nowhere.
 */
export function buildRounds(group: ExerciseGroup): Round[] {
	const rounds: Round[] = [];
	for (let roundIndex = 1; roundIndex <= group.rounds; roundIndex++) {
		const slots = group.members
			.filter((member) => isActive(member) && member.target_sets >= roundIndex)
			.map((exercise) => ({ exercise, setIndex: roundIndex, slotKey: `${exercise.id}-${roundIndex}` }));
		rounds.push({ roundIndex, slots });
	}
	return rounds;
}

export function isRoundComplete(round: Round): boolean {
	return round.slots.length > 0 && round.slots.every((slot) => slot.exercise.logged.some((l) => l.set_index === slot.setIndex));
}

/**
 * Rest to start after logging a set in `roundIndex`, or null for "no timer".
 *
 * Null mid-round is the whole point of a superset: you go straight into the
 * next exercise. It also protects the progression signal — LiftSession only
 * attributes `rest_taken_seconds` when a timer was running, so an intra-round
 * log records null, and `progressExercise`'s `restWasShort` check (which
 * compares against the FULL prescribed rest) never sees a spuriously short
 * value it would otherwise use to hold weight back.
 */
export function restAfterRound(group: ExerciseGroup, roundIndex: number): number | null {
	const round = buildRounds(group)[roundIndex - 1];
	if (!round) return null;
	return isRoundComplete(round) ? group.restSeconds : null;
}
