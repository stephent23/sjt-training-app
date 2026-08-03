import { useEffect, useRef, useState } from 'preact/hooks';
import { logRun, setSessionStatus } from '../api';
import { todayIso } from '../../dates';
import { useSession } from '../useSession';
import { TapGroup } from '../components/TapGroup';
import type { RunStep } from '../../types';

interface RunSessionProps {
	sessionId: number;
	onBack: () => void;
}

function parseStructure(json: string | null): RunStep[] | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed?.steps) ? parsed.steps : null;
	} catch {
		return null;
	}
}

export function RunSession({ sessionId, onBack }: RunSessionProps) {
	const { detail, error, setDetail, reload } = useSession(sessionId);
	const [distance, setDistance] = useState('');
	const [minutes, setMinutes] = useState('');
	const [seconds, setSeconds] = useState('');
	const [rpe, setRpe] = useState<number | null>(null);
	const [avgHr, setAvgHr] = useState('');
	const [note, setNote] = useState('');

	// Seed the form from loggedRun exactly once. A plain `[detail]` dependency
	// would re-run on every background refetch too — including one that
	// resolves while the user is mid-edit but hasn't hit "Log run" yet (nothing
	// queued yet, so useSession's pendingCount guard doesn't protect this),
	// silently overwriting their in-progress typing with the server's older
	// values. Seeding once is enough: the user's own optimistic update after
	// logging already reflects in these fields without needing to re-seed.
	const seededRef = useRef(false);
	useEffect(() => {
		if (seededRef.current) return;
		if (detail?.loggedRun) {
			seededRef.current = true;
			const lr = detail.loggedRun;
			setDistance(String(lr.distance_km));
			setMinutes(String(Math.floor(lr.duration_seconds / 60)));
			setSeconds(String(lr.duration_seconds % 60));
			setRpe(lr.rpe_1_10);
			setAvgHr(lr.avg_hr ? String(lr.avg_hr) : '');
			setNote(lr.note ?? '');
		}
	}, [detail]);

	if (!detail || !detail.plannedRun) {
		return (
			<main class="screen">
				<button type="button" class="back-btn" onClick={onBack}>
					← Back
				</button>
				{error ? (
					<>
						<p>{error}</p>
						<button type="button" class="btn-secondary" onClick={reload}>
							Retry
						</button>
					</>
				) : (
					<p>Loading…</p>
				)}
			</main>
		);
	}

	const run = detail.plannedRun;
	const structure = parseStructure(run.structure_json);

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

	function handleComplete() {
		setSessionStatus(sessionId, 'completed');
		setDetail({ ...detail!, session: { ...detail!.session, status: 'completed' } });
		location.hash = '#/';
	}

	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				← Back
			</button>
			{error && <p class="eyebrow">{error}</p>}
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

			<TapGroup options={Array.from({ length: 10 }, (_, i) => i + 1)} value={rpe} onChange={setRpe} label={(v) => String(v)} ariaLabel="RPE" />

			<label class="field">
				Note (optional)
				<input type="text" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
			</label>

			<button type="button" class="btn-primary" onClick={handleLog}>
				{detail.loggedRun ? 'Update run' : 'Log run'}
			</button>

			<button type="button" class="btn-secondary" onClick={handleComplete} disabled={detail.session.status === 'completed'}>
				{detail.session.status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
		</main>
	);
}
