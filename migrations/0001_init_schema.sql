-- Migration number: 0001 	 2026-08-03T07:52:18.091Z

-- Exercise catalogue: stable reference
CREATE TABLE exercises (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	modality TEXT NOT NULL CHECK (modality IN ('dumbbell', 'machine', 'cable', 'bodyweight')),
	pattern TEXT NOT NULL,
	increment_kg REAL NOT NULL,
	loading TEXT NOT NULL CHECK (loading IN ('per_hand', 'total', 'bodyweight')),
	shoulder_safe INTEGER NOT NULL DEFAULT 1 CHECK (shoulder_safe IN (0, 1)),
	back_safe INTEGER NOT NULL DEFAULT 1 CHECK (back_safe IN (0, 1)),
	needs_spotter INTEGER NOT NULL DEFAULT 0 CHECK (needs_spotter IN (0, 1)),
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE INDEX idx_exercises_pattern ON exercises (pattern);

-- Any planned session, lift or run
CREATE TABLE sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	date TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('lift', 'run')),
	label TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
	week_number INTEGER NOT NULL
);

CREATE INDEX idx_sessions_date ON sessions (date);
CREATE INDEX idx_sessions_week ON sessions (week_number);

-- Lift prescription
CREATE TABLE planned_sets (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions (id),
	exercise_id INTEGER NOT NULL REFERENCES exercises (id),
	order_index INTEGER NOT NULL,
	target_sets INTEGER NOT NULL,
	rep_low INTEGER NOT NULL,
	rep_high INTEGER NOT NULL,
	target_weight_kg REAL,
	rest_seconds INTEGER NOT NULL,
	notes TEXT
);

CREATE INDEX idx_planned_sets_session ON planned_sets (session_id);

-- Lift reality
CREATE TABLE logged_sets (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions (id),
	exercise_id INTEGER NOT NULL REFERENCES exercises (id),
	set_index INTEGER NOT NULL,
	weight_kg REAL NOT NULL,
	reps INTEGER NOT NULL,
	rir INTEGER NOT NULL CHECK (rir BETWEEN 0 AND 4),
	rest_taken_seconds INTEGER,
	performed_on TEXT NOT NULL,
	logged_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every progress query is "this exercise, over time" — see plan §9.
CREATE INDEX idx_logged_sets_exercise_performed ON logged_sets (exercise_id, performed_on);
CREATE INDEX idx_logged_sets_session ON logged_sets (session_id);

-- Run prescription
CREATE TABLE planned_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions (id),
	run_type TEXT NOT NULL CHECK (run_type IN ('easy', 'tempo', 'intervals', 'long')),
	target_minutes REAL,
	target_km REAL,
	structure_json TEXT
);

CREATE INDEX idx_planned_runs_session ON planned_runs (session_id);

-- Run reality
CREATE TABLE logged_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions (id),
	distance_km REAL NOT NULL,
	duration_seconds INTEGER NOT NULL,
	avg_hr INTEGER,
	rpe_1_10 INTEGER CHECK (rpe_1_10 BETWEEN 1 AND 10),
	performed_on TEXT NOT NULL,
	logged_at TEXT NOT NULL DEFAULT (datetime('now')),
	note TEXT
);

CREATE INDEX idx_logged_runs_performed ON logged_runs (performed_on);
CREATE INDEX idx_logged_runs_session ON logged_runs (session_id);

-- Why a set differs from what was prescribed
CREATE TABLE exercise_swaps (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id INTEGER NOT NULL REFERENCES sessions (id),
	from_exercise_id INTEGER NOT NULL REFERENCES exercises (id),
	to_exercise_id INTEGER NOT NULL REFERENCES exercises (id),
	reason TEXT NOT NULL CHECK (reason IN ('pain', 'equipment_busy', 'preference', 'unavailable')),
	scope TEXT NOT NULL CHECK (scope IN ('this_session', 'permanent')),
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exercise_swaps_session ON exercise_swaps (session_id);
CREATE INDEX idx_exercise_swaps_from ON exercise_swaps (from_exercise_id);

CREATE TABLE bodyweight (
	date TEXT PRIMARY KEY,
	kg REAL NOT NULL
);

CREATE TABLE session_feedback (
	session_id INTEGER PRIMARY KEY REFERENCES sessions (id),
	back_pain_0_3 INTEGER CHECK (back_pain_0_3 BETWEEN 0 AND 3),
	shoulder_pain_0_3 INTEGER CHECK (shoulder_pain_0_3 BETWEEN 0 AND 3),
	energy_1_5 INTEGER CHECK (energy_1_5 BETWEEN 1 AND 5),
	note TEXT
);
