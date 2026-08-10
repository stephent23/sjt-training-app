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

// How a session actually felt. Pain scores here are what drive the
// generator's shoulder_safe/back_safe validation — before this was captured,
// those checks could never fire because the flags were hardcoded false.
export interface SessionFeedback {
	back_pain_0_3: number | null;
	shoulder_pain_0_3: number | null;
	energy_1_5: number | null;
	note: string | null;
}

export interface SessionDetail {
	session: SessionRow;
	plannedSets: PlannedSetDetail[];
	plannedRun: PlannedRunDetail | null;
	loggedRun: LoggedRunEntry | null;
	feedback: SessionFeedback | null;
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

// Weekly generator (manual export/import) — see migrations/0004_generator.sql.
export interface ProposedRun { run_type: RunType; target_minutes: number | null; target_km: number | null; structure_json: string | null; }
export interface ProposedSetInput { exercise_id: number; order_index: number; target_sets: number; rep_low: number; rep_high: number; target_weight_kg: number | null; rest_seconds: number; notes: string | null; superset_group: number | null; }
export interface ProposedSessionInput { date: string; kind: SessionKind; label: string; plannedSets: ProposedSetInput[]; plannedRun: ProposedRun | null; }
// `focus` is an optional one-word label for what a week is for ("deload",
// "volume", "race week"). Display-only — nothing branches on it — but it's how
// a deload becomes something the review screen can state rather than something
// you have to infer from the numbers.
export interface WeekProposalInput { week_number: number; focus?: string | null; sessions: ProposedSessionInput[]; }

export interface ProposedSet extends ProposedSetInput { exercise_name: string; pattern: string; }
export interface ProposedSession extends Omit<ProposedSessionInput, 'plannedSets'> { plannedSets: ProposedSet[]; }
export interface WeekProposal extends Omit<WeekProposalInput, 'sessions'> { sessions: ProposedSession[]; }

// Multi-week wrapper (generate-many-weeks-at-once) — thin reuse of the
// per-week shapes above so hydrateProposal/insert logic loop rather than
// duplicate. See migrations/0005_generator_multiweek.sql.
export interface MultiWeekProposalInput { weeks: WeekProposalInput[]; }
export interface MultiWeekProposal { weeks: WeekProposal[]; }

export interface Settings {
	goals: string;
	days_per_week: number;
}
