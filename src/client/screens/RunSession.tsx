import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../../types';
import { fetchSession, logRun } from '../api';
import { readCachedSession, writeCachedSession } from '../sessionCache';

interface RunSessionProps {
	sessionId: number;
	onBack: () => void;
}

interface RunStep {
	kind: string;
	minutes: number;
	effort: string;
	repeat?: number;
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function RunSession({ sessionId, onBack }: RunSessionProps) {
	const [detail, setDetail] = useState<SessionDetail | null>(() => readCachedSession(sessionId));
	const [distance, setDistance] = useState('');
	const [minutes, setMinutes] = useState('');
	const [seconds, setSeconds] = useState('');
	const [rpe, setRpe] = useState<number | null>(null);
	const [avgHr, setAvgHr] = useState('');
	const [note, setNote] = useState('');

	useEffect(() => {
		fetchSession(sessionId).then((fresh) => {
			setDetail(fresh);
			writeCachedSession(sessionId, fresh);
			if (fresh.loggedRun) {
				setDistance(String(fresh.loggedRun.distance_km));
				setMinutes(String(Math.floor(fresh.loggedRun.duration_seconds / 60)));
				setSeconds(String(fresh.loggedRun.duration_seconds % 60));
				setRpe(fresh.loggedRun.rpe_1_10);
				setAvgHr(fresh.loggedRun.avg_hr ? String(fresh.loggedRun.avg_hr) : '');
				setNote(fresh.loggedRun.note ?? '');
			}
		});
	}, [sessionId]);

	if (!detail || !detail.plannedRun) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={onBack}>
					← Back
				</button>
				<p>Loading…</p>
			</main>
		);
	}

	const run = detail.plannedRun;
	const structure: RunStep[] | null = run.structure_json ? (JSON.parse(run.structure_json).steps as RunStep[]) : null;

	function handleLog() {
		const durationSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
		const updated = logRun(
			sessionId,
			{
				distance_km: Number(distance) || 0,
				duration_seconds: durationSeconds,
				avg_hr: avgHr ? Number(avgHr) : null,
				rpe_1_10: rpe,
				performed_on: todayIso(),
				note: note || null,
			},
			detail!,
		);
		setDetail(updated);
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>
			<h1>{run.run_type.charAt(0).toUpperCase() + run.run_type.slice(1)} run</h1>
			<p class="exercise-target">
				{run.target_minutes ? `${run.target_minutes} min` : ''}
				{run.target_km ? ` · ${run.target_km} km` : ''}
			</p>

			{structure && (
				<ol class="run-steps">
					{structure.map((s, i) => (
						<li key={i}>
							{s.repeat ? `${s.repeat} × ` : ''}
							{s.minutes} min {s.kind} ({s.effort.replace('_', ' ')})
						</li>
					))}
				</ol>
			)}

			<label class="field">
				Distance (km)
				<input type="number" inputmode="decimal" value={distance} onInput={(e) => setDistance((e.target as HTMLInputElement).value)} />
			</label>

			<label class="field">
				Duration
				<div class="duration-inputs">
					<input type="number" inputmode="numeric" placeholder="min" value={minutes} onInput={(e) => setMinutes((e.target as HTMLInputElement).value)} />
					<input type="number" inputmode="numeric" placeholder="sec" value={seconds} onInput={(e) => setSeconds((e.target as HTMLInputElement).value)} />
				</div>
			</label>

			<label class="field">
				Avg HR (optional)
				<input type="number" inputmode="numeric" value={avgHr} onInput={(e) => setAvgHr((e.target as HTMLInputElement).value)} />
			</label>

			<div class="tap-row" role="group" aria-label="RPE">
				{Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
					<button type="button" key={v} class={`tap-btn ${rpe === v ? 'tap-btn--selected' : ''}`} onClick={() => setRpe(v)}>
						{v}
					</button>
				))}
			</div>

			<label class="field">
				Note (optional)
				<input type="text" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
			</label>

			<button type="button" class="btn-primary" onClick={handleLog}>
				{detail.loggedRun ? 'Update run' : 'Log run'}
			</button>
		</main>
	);
}
