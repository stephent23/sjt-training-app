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

/** Where a session came from. 'planned' is everything the generator wrote;
 * 'manual' is a run recorded by hand after the fact. The distinction exists
 * because the export copies the anchor week forward to build the next plan,
 * and a run that was never planned must not become a fixture of every future
 * week — see migrations/0008_manual_runs.sql. */
export type SessionOrigin = 'planned' | 'manual';

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
	origin: SessionOrigin;
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

/** Everything a Garmin shows on its post-run summary. Only distance and
 * duration are required — the rest are copied across by hand, so any of them
 * can be skipped. Pace is never stored: it is distance over duration, and a
 * stored copy would just be a second thing to keep in step. */
export interface LoggedRunEntry {
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	max_hr: number | null;
	avg_cadence_spm: number | null;
	elevation_gain_m: number | null;
	aerobic_training_effect: number | null;
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

export type LogRunInput = LoggedRunEntry;

export interface SessionSummary {
	id: number;
	date: string;
	kind: SessionKind;
	label: string;
	status: SessionStatus;
	week_number: number;
	origin: SessionOrigin;
	exercise_count: number;
	planned_set_count: number;
	logged_set_count: number;
	run_type: RunType | null;
	target_minutes: number | null;
	target_km: number | null;
	has_logged_run: boolean;
	/** What the run actually was, so a finished run doesn't read on a list row
	 * exactly like one nobody has done yet. Null for lifts and unlogged runs. */
	logged_distance_km: number | null;
	logged_duration_seconds: number | null;
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
export interface ProposedRun {
	run_type: RunType;
	target_minutes: number | null;
	target_km: number | null;
	structure_json: string | null;
}
export interface ProposedSetInput {
	exercise_id: number;
	order_index: number;
	target_sets: number;
	rep_low: number;
	rep_high: number;
	target_weight_kg: number | null;
	rest_seconds: number;
	notes: string | null;
	superset_group: number | null;
}
export interface ProposedSessionInput {
	date: string;
	kind: SessionKind;
	label: string;
	plannedSets: ProposedSetInput[];
	plannedRun: ProposedRun | null;
}
// `focus` is an optional one-word label for what a week is for ("deload",
// "volume", "race week"). Display-only — nothing branches on it — but it's how
// a deload becomes something the review screen can state rather than something
// you have to infer from the numbers.
export interface WeekProposalInput {
	week_number: number;
	focus?: string | null;
	sessions: ProposedSessionInput[];
}

export interface ProposedSet extends ProposedSetInput {
	exercise_name: string;
	pattern: string;
}
export interface ProposedSession extends Omit<ProposedSessionInput, 'plannedSets'> {
	plannedSets: ProposedSet[];
}
export interface WeekProposal extends Omit<WeekProposalInput, 'sessions'> {
	sessions: ProposedSession[];
}

// Multi-week wrapper (generate-many-weeks-at-once) — thin reuse of the
// per-week shapes above so hydrateProposal/insert logic loop rather than
// duplicate. See migrations/0005_generator_multiweek.sql.
export interface MultiWeekProposalInput {
	weeks: WeekProposalInput[];
}
export interface MultiWeekProposal {
	weeks: WeekProposal[];
}

/** The tick-box vocabulary behind free-text goals, grouped only for how the
 * editor lays them out — the server treats it as one flat allowlist. Adding a
 * slug here is all it takes to offer it; the prompt explains what they mean. */
export const GOAL_TAG_GROUPS = {
	'What I want': ['build_strength', 'build_muscle', 'lose_fat', 'run_endurance', 'run_speed', 'stay_injury_free', 'maintain'],
	'Where to push': ['upper_body', 'lower_body', 'core', 'posterior_chain'],
	'What to work around': ['protect_shoulder', 'protect_back', 'limited_time', 'calorie_deficit', 'race_training'],
} as const;

export const GOAL_TAGS: readonly string[] = Object.values(GOAL_TAG_GROUPS).flat();

/** goal_tags is a JSON array in one TEXT column (migration 0006). A value
 * written before that column existed, or hand-edited, shouldn't take down the
 * settings screen or the export — unreadable reads as no tags. Shared by both
 * readers so the leniency can't drift between them. */
export function parseGoalTags(raw: string | undefined | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
	} catch {
		return [];
	}
}

export const MODALITIES: readonly Modality[] = ['dumbbell', 'machine', 'cable', 'bodyweight'];
export const LOADINGS: readonly Loading[] = ['per_hand', 'total', 'bodyweight'];

/** The optional run metrics copied off a watch, with the bounds both sides
 * enforce. The route rejects anything outside them; the Review form uses the
 * same list to build its inputs and to refuse to commit a typo. One list, so
 * the two can't disagree about what a plausible cadence is. */
export const RUN_METRIC_FIELDS = [
	{ key: 'avg_hr', label: 'Avg HR', min: 20, max: 250, integer: true },
	{ key: 'max_hr', label: 'Max HR', min: 20, max: 250, integer: true },
	{ key: 'avg_cadence_spm', label: 'Cadence (spm)', min: 20, max: 300, integer: true },
	{ key: 'elevation_gain_m', label: 'Elevation (m)', min: 0, max: 10000, integer: false },
	{ key: 'aerobic_training_effect', label: 'Training effect', min: 0, max: 5, integer: false },
	{ key: 'rpe_1_10', label: 'RPE (1-10)', min: 1, max: 10, integer: true },
] as const;

export type RunMetricField = (typeof RUN_METRIC_FIELDS)[number]['key'];

export const RUN_TYPES: readonly RunType[] = ['easy', 'tempo', 'intervals', 'long'];

/** A run recorded by hand rather than planned — what the run editor sends,
 * for a brand-new run and for a correction to one already recorded alike. The
 * optional watch metrics are the same RUN_METRIC_FIELDS list the logging route
 * and the Review form already share, so all three agree on what a plausible
 * cadence is.
 *
 * There is no `label`: it is derived from the run type server-side, because a
 * second name for "easy run" is a second thing to keep in step. */
export interface ManualRunInput extends Record<RunMetricField, number | null> {
	date: string;
	run_type: RunType;
	distance_km: number;
	duration_seconds: number;
	note: string | null;
}

export interface Settings {
	goals: string;
	days_per_week: number;
	goal_tags: string[];
}
