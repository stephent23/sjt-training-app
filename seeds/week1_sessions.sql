-- Hardcoded first week: Lift A, Lift B, three runs. No generator yet (plan §11 step 3).
-- No training history exists, so lift weights are left NULL and flagged as
-- calibration rather than guessed — real numbers get logged from the gym.

INSERT INTO sessions (date, kind, label, status, week_number) VALUES
('2026-08-03', 'lift', 'Lift A', 'planned', 1),
('2026-08-04', 'run', 'Easy run', 'planned', 1),
('2026-08-05', 'lift', 'Lift B', 'planned', 1),
('2026-08-06', 'run', 'Intervals', 'planned', 1),
('2026-08-08', 'run', 'Long run', 'planned', 1);

-- Lift A: squat pattern, horizontal + vertical push, lateral raise, triceps, core.
-- Lateral raise + Triceps pushdown are paired as a superset (superset_group 1):
-- short rest after the first half, normal rest after the second, before moving on.
INSERT INTO planned_sets (session_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_weight_kg, rest_seconds, notes, superset_group) VALUES
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Goblet squat'), 1, 3, 8, 10, NULL, 150, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.', NULL),
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Neutral-grip DB press'), 2, 3, 6, 10, NULL, 150, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.', NULL),
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Machine shoulder press'), 3, 3, 10, 12, NULL, 100, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.', NULL),
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Lateral raise'), 4, 3, 12, 15, NULL, 15, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR. Superset with triceps pushdown — short rest, then go straight into the next exercise.', 1),
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Triceps pushdown'), 5, 3, 12, 15, NULL, 60, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR. Superset with lateral raise — full rest after this before the next exercise.', 1),
((SELECT id FROM sessions WHERE date = '2026-08-03' AND label = 'Lift A'), (SELECT id FROM exercises WHERE name = 'Dead bug'), 6, 3, 10, 12, NULL, 45, 'Bodyweight — reps per side.', NULL);

-- Lift B: hinge, vertical + horizontal pull, single-leg, hamstring curl, biceps
INSERT INTO planned_sets (session_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_weight_kg, rest_seconds, notes) VALUES
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'Cable pull-through'), 1, 3, 10, 12, NULL, 120, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.'),
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'Pull-ups'), 2, 3, 6, 10, NULL, 150, 'Bodyweight — use assisted machine if 3x6 unbroken isn''t there yet.'),
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'Cable row'), 3, 3, 10, 12, NULL, 100, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.'),
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'Bulgarian split squat'), 4, 3, 8, 10, NULL, 90, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR. Rest is per side.'),
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'Leg curl machine'), 5, 3, 12, 15, NULL, 60, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.'),
((SELECT id FROM sessions WHERE date = '2026-08-05' AND label = 'Lift B'), (SELECT id FROM exercises WHERE name = 'DB bicep curl'), 6, 3, 12, 15, NULL, 60, 'Calibration — no history yet; log a weight you can hit for the target reps at ~2 RIR.');

-- Easy run: steady, duration + effort only
INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES
((SELECT id FROM sessions WHERE date = '2026-08-04' AND label = 'Easy run'), 'easy', 30, 5, NULL);

-- Intervals: flat step list, not nested
INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES
((SELECT id FROM sessions WHERE date = '2026-08-06' AND label = 'Intervals'), 'intervals', 42.5, NULL, '{"steps":[{"kind":"warmup","minutes":10,"effort":"easy"},{"kind":"work","minutes":3,"effort":"comfortably_hard","repeat":5},{"kind":"recovery","minutes":1.5,"effort":"jog","repeat":5},{"kind":"cooldown","minutes":10,"effort":"easy"}]}');

-- Long run: steady, duration + effort only
INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES
((SELECT id FROM sessions WHERE date = '2026-08-08' AND label = 'Long run'), 'long', 60, 9, NULL);
