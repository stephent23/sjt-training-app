import type { RunStep } from '../../types';

// structure_json is an opaque TEXT blob in D1 — a flat list of interval steps,
// deliberately not a nested schema. It can be null, malformed, or written by
// something other than this app (an imported plan), so parsing is always
// best-effort: anything unreadable renders as nothing rather than throwing
// inside a screen.
export function parseRunStructure(json: string | null): RunStep[] | null {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed?.steps)) return null;
		// Individual steps are filtered too, not just the envelope: a step with
		// no `effort` used to throw inside the render below, taking the whole
		// screen with it. Import validation now rejects these, but plans stored
		// before it did are still in the database.
		const steps = (parsed.steps as RunStep[]).filter((s) => s && typeof s.kind === 'string' && typeof s.effort === 'string' && typeof s.minutes === 'number');
		return steps.length > 0 ? steps : null;
	} catch {
		return null;
	}
}

interface RunStructureProps {
	structureJson: string | null;
}

export function RunStructure({ structureJson }: RunStructureProps) {
	const steps = parseRunStructure(structureJson);
	if (!steps) return null;

	return (
		<ol class="run-steps">
			{steps.map((s, i) => (
				<li key={i}>
					{s.repeat ? `${s.repeat} × ` : ''}
					{s.minutes} min {s.kind} ({s.effort.replace('_', ' ')})
				</li>
			))}
		</ol>
	);
}
