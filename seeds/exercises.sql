-- Exercise catalogue seed. No barbell work — modality is always dumbbell,
-- machine, cable, or bodyweight, so needs_spotter is always 0 (see plan §5).

INSERT INTO exercises (name, modality, pattern, increment_kg, loading, shoulder_safe, back_safe, needs_spotter, is_default) VALUES
-- horizontal_push
('Neutral-grip DB press', 'dumbbell', 'horizontal_push', 2.0, 'per_hand', 1, 1, 0, 1),
('Machine chest press', 'machine', 'horizontal_push', 5.0, 'total', 1, 1, 0, 0),
('Incline DB press', 'dumbbell', 'horizontal_push', 2.0, 'per_hand', 0, 1, 0, 0),
('Cable chest press', 'cable', 'horizontal_push', 2.5, 'total', 1, 1, 0, 0),
('Push-ups', 'bodyweight', 'horizontal_push', 0, 'bodyweight', 1, 1, 0, 0),

-- vertical_pull
('Pull-ups', 'bodyweight', 'vertical_pull', 0, 'bodyweight', 1, 1, 0, 1),
('Lat pulldown', 'cable', 'vertical_pull', 5.0, 'total', 1, 1, 0, 0),
('Assisted pull-up machine', 'machine', 'vertical_pull', 5.0, 'total', 1, 1, 0, 0),

-- horizontal_pull
('Cable row', 'cable', 'horizontal_pull', 5.0, 'total', 1, 1, 0, 1),
('Chest-supported row', 'machine', 'horizontal_pull', 5.0, 'total', 1, 1, 0, 0),
('Single-arm DB row', 'dumbbell', 'horizontal_pull', 2.0, 'per_hand', 1, 0, 0, 0),

-- vertical_push
('Machine shoulder press', 'machine', 'vertical_push', 5.0, 'total', 1, 1, 0, 1),
('DB shoulder press', 'dumbbell', 'vertical_push', 2.0, 'per_hand', 0, 1, 0, 0),

-- hinge
('Cable pull-through', 'cable', 'hinge', 5.0, 'total', 1, 1, 0, 1),
('DB Romanian deadlift', 'dumbbell', 'hinge', 2.0, 'per_hand', 1, 0, 0, 0),
('45-degree back extension', 'machine', 'hinge', 5.0, 'total', 1, 0, 0, 0),

-- squat
('Goblet squat', 'dumbbell', 'squat', 2.0, 'total', 1, 1, 0, 1),
('Leg press', 'machine', 'squat', 5.0, 'total', 1, 1, 0, 0),
('Hack squat machine', 'machine', 'squat', 5.0, 'total', 1, 1, 0, 0),

-- single_leg
('Bulgarian split squat', 'dumbbell', 'single_leg', 2.0, 'per_hand', 1, 1, 0, 1),
('Walking lunge', 'dumbbell', 'single_leg', 2.0, 'per_hand', 1, 1, 0, 0),

-- hamstring_curl / knee_extension (isolation, lower body)
('Leg curl machine', 'machine', 'hamstring_curl', 5.0, 'total', 1, 1, 0, 1),
('Leg extension machine', 'machine', 'knee_extension', 5.0, 'total', 1, 1, 0, 1),

-- isolation, upper body
('Lateral raise', 'dumbbell', 'lateral_raise', 1.0, 'per_hand', 1, 1, 0, 1),
('Cable lateral raise', 'cable', 'lateral_raise', 2.5, 'total', 1, 1, 0, 0),
('DB bicep curl', 'dumbbell', 'elbow_flexion', 1.0, 'per_hand', 1, 1, 0, 1),
('Cable curl', 'cable', 'elbow_flexion', 2.5, 'total', 1, 1, 0, 0),
('Triceps pushdown', 'cable', 'elbow_extension', 2.5, 'total', 1, 1, 0, 1),
('Overhead triceps extension', 'dumbbell', 'elbow_extension', 1.0, 'per_hand', 0, 1, 0, 0),

-- core
('Dead bug', 'bodyweight', 'core', 0, 'bodyweight', 1, 1, 0, 1),
('Side plank', 'bodyweight', 'core', 0, 'bodyweight', 1, 1, 0, 0),
('Pallof press', 'cable', 'core', 2.5, 'total', 1, 1, 0, 0);
