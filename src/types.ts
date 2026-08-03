// Shapes shared between the Worker routes and the Preact client. Both sides
// import this file directly — no code generation, no separate package.

export type Modality = 'dumbbell' | 'machine' | 'cable' | 'bodyweight';
export type Loading = 'per_hand' | 'total' | 'bodyweight';
export type SwapReason = 'pain' | 'equipment_busy' | 'preference' | 'unavailable';
export type SwapScope = 'this_session' | 'permanent';
export type SessionKind = 'lift' | 'run';
export type SessionStatus = 'planned' | 'completed' | 'skipped';
export type RunType = 'easy' | 'tempo' | 'intervals' | 'long';
export type PlannedSetStatus = 'planned' | 'skipped';

export interface Exercise {
	id: number;
	name: string;
	modality: Modality;
	pattern: string;
	increment_kg: number;
	loading: Loading;
	shoulder_safe: 0 | 1;
	back_safe: 0 | 1;
	needs_spotter: 0 | 1;
	is_default: 0 | 1;
}

export interface SessionRow {
	id: number;
	date: string;
	kind: SessionKind;
	label: string;
	status: SessionStatus;
	week_number: number;
}

export interface LoggedSetEntry {
	set_index: number;
	weight_kg: number;
	reps: number;
	rir: number;
	rest_taken_seconds: number | null;
	performed_on: string;
}

export interface PlannedSetDetail {
	id: number;
	exercise_id: number;
	exercise_name: string;
	pattern: string;
	loading: Loading;
	increment_kg: number;
	order_index: number;
	target_sets: number;
	rep_low: number;
	rep_high: number;
	target_weight_kg: number | null;
	rest_seconds: number;
	notes: string | null;
	status: PlannedSetStatus;
	superset_group: number | null;
	lastWeek: LoggedSetEntry[];
	logged: LoggedSetEntry[];
}

export interface PlannedRunDetail {
	id: number;
	run_type: RunType;
	target_minutes: number | null;
	target_km: number | null;
	structure_json: string | null;
}

// Shape of the parsed `structure_json.steps` array on PlannedRunDetail —
// a flat list of interval steps, e.g. {"steps":[{"kind":"warmup","minutes":10,"effort":"easy"},...]}.
export interface RunStep {
	kind: string;
	minutes: number;
	effort: string;
	repeat?: number;
}

export interface LoggedRunEntry {
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	rpe_1_10: number | null;
	performed_on: string;
	note: string | null;
}

export interface SessionDetail {
	session: SessionRow;
	plannedSets: PlannedSetDetail[];
	plannedRun: PlannedRunDetail | null;
	loggedRun: LoggedRunEntry | null;
}

export interface LogSetInput {
	exercise_id: number;
	set_index: number;
	weight_kg: number;
	reps: number;
	rir: number;
	rest_taken_seconds: number | null;
	performed_on: string;
}

export interface LogRunInput {
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	rpe_1_10: number | null;
	performed_on: string;
	note: string | null;
}

export interface SessionSummary {
	id: number;
	date: string;
	kind: SessionKind;
	label: string;
	status: SessionStatus;
	week_number: number;
	exercise_count: number;
	planned_set_count: number;
	logged_set_count: number;
	run_type: RunType | null;
	target_minutes: number | null;
	target_km: number | null;
	has_logged_run: boolean;
}

export interface SwapCandidate extends Exercise {
	hasHistory: boolean;
}

export interface ApplySwapInput {
	session_id: number;
	planned_set_id: number;
	from_exercise_id: number;
	to_exercise_id: number;
	reason: SwapReason;
	scope: SwapScope;
}
