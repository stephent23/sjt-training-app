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

/** 1 = pale (warmup, cooldown, recovery, easy), 2 = middle, 3 = solid (work).
 * Efforts are free text written by the generator or an import, so this is a
 * keyword read of kind + effort, not an enum. The effort word is always printed
 * beside the bar — the shade is a glance, never the only carrier. */
function effortLevel(step: RunStep): 1 | 2 | 3 {
	const text = `${step.kind} ${step.effort}`.toLowerCase();
	if (/warm|cool|recover|easy|walk|jog|rest|gentle/.test(text)) return 1;
	if (/hard|fast|threshold|interval|vo2|max|race|sprint|work/.test(text)) return 3;
	return 2;
}

export function RunStructure({ structureJson }: RunStructureProps) {
	const steps = parseRunStructure(structureJson);
	if (!steps) return null;

	// Bar length is duration, relative to the longest single step.
	const longest = Math.max(...steps.map((s) => s.minutes), 1);

	return (
		<ol class="run-steps">
			{steps.map((s, i) => (
				<li key={i} class={`run-step run-step--l${effortLevel(s)}${s.repeat ? ' run-step--repeat' : ''}`}>
					<span class="run-step-name">
						{s.repeat ? <span class="run-step-repeat">{s.repeat} ×</span> : null}
						{s.kind}
					</span>
					<span class="run-step-effort">{s.effort.replace('_', ' ')}</span>
					<span class="run-step-min">{s.minutes} min</span>
					<span class="run-step-bar" style={{ '--len': String(Math.max(0.08, s.minutes / longest)) }} aria-hidden="true" />
				</li>
			))}
		</ol>
	);
}
