import { useState } from 'preact/hooks';
import type { MultiWeekProposalInput } from '../../types';
import { importProposal } from '../api';

// Kept verbatim in sync with the plan doc's section 6 — tool-agnostic on
// purpose: this gets pasted into whatever AI assistant the person has
// (ChatGPT, Claude, Gemini, anything), not just Claude Code.
const PROMPT = `I'm attaching my training data as JSON. It contains a deterministically-computed
proposal for the next several weeks of training (deterministicProposal — trust
week 1's arithmetic, it already applied standard progressive-overload rules),
the reasons behind each of those calls (deterministicReasons), my last two
weeks of actual logged sets and runs (historyWindow), any sessions I skipped
(skippedSessions), my stated goals if any (goals), and the valid exercise
catalogue with safety flags (exerciseCatalogue).

You don't have to keep the same exercises every week. Feel free to substitute
a different exercise for variety, as long as it targets the same movement
pattern (see \`pattern\` on each entry in exerciseCatalogue) and respects the
safety flags (shoulder_safe/back_safe/needs_spotter) — the same rules this
app already uses for manual swaps. Weeks beyond the first are your best
judgement anyway (see below), so that's the natural place to introduce
variety; changing week 1 is fine too if it clearly serves my stated goals.

Weeks 2 onward in deterministicProposal are flat copies of week 1 — there's
no real performance data for them yet (they haven't happened). Don't just
repeat week 1's numbers verbatim: apply real periodization judgement
(progressive overload assumptions, a deload week if appropriate, exercise
rotation) across them.

Please review the deterministic proposal and adjust it using judgement the
mechanical rules can't apply:
- Sessions I skipped: don't blindly advance that exercise — consider holding or
  reshuffling rather than compounding a missed week.
- My stated goals should shift emphasis (volume, exercise choice, run/lift
  balance) if relevant.
- Two consecutive rough sessions, or reps consistently missing target: consider
  a deload rather than mechanically holding again.
- Rising running distance/effort: hold or reduce lifting volume rather than
  increasing both at once.
- Anything else I tell you (how I'm feeling, an injury, a schedule constraint):
  weight it in.

Return ONLY the adjusted plan as JSON, in exactly this shape, with every week
from deterministicProposal.weeks present even if you didn't change it:

{
  "weeks": [
    {
      "week_number": <int>,
      "sessions": [
        {
          "date": "YYYY-MM-DD", "kind": "lift" | "run", "label": "...",
          "plannedSets": [
            { "exercise_id": <int, must exist in exerciseCatalogue>, "order_index": <int>,
              "target_sets": <int>, "rep_low": <int>, "rep_high": <int>,
              "target_weight_kg": <number|null>, "rest_seconds": <int>,
              "notes": <string|null>, "superset_group": <int|null> }
          ],
          "plannedRun": { "run_type": "easy"|"tempo"|"intervals"|"long",
            "target_minutes": <number|null>, "target_km": <number|null>,
            "structure_json": <string|null> } | null
        }
      ]
    }
  ]
}

Explain in plain language what you changed and why before giving me the JSON.`;

interface GenerateFlowProps {
	onImported: () => void;
}

// The entire "no proposal pending yet" state on Generate: download the
// export, copy the prompt into any AI assistant, paste the answer back. No
// live API call anywhere in this component — see the plan doc's context
// section for why (unauthenticated Worker, no paid key reachable from the
// public net).
export function GenerateFlow({ onImported }: GenerateFlowProps) {
	const [weeks, setWeeks] = useState(1);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState<string | null>(null);
	const [pasted, setPasted] = useState('');
	const [importError, setImportError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function copyPrompt() {
		setCopyError(null);
		try {
			await navigator.clipboard.writeText(PROMPT);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopyError('Could not copy automatically — select the text below and copy it by hand.');
		}
	}

	async function handleImport() {
		setImportError(null);
		let parsed: MultiWeekProposalInput;
		try {
			parsed = JSON.parse(pasted);
		} catch {
			setImportError("That doesn't look like valid JSON — make sure you pasted the assistant's full answer.");
			return;
		}

		setBusy(true);
		try {
			await importProposal(parsed);
			setPasted('');
			onImported();
		} catch (e) {
			setImportError(e instanceof Error ? e.message : 'Import failed.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div>
			<h2 class="section-heading">Generate</h2>

			<div class="row">
				<span class="eyebrow">Step 1 — Download</span>
				<label class="field">
					How many weeks
					<input
						type="number"
						min={1}
						max={12}
						value={weeks}
						onInput={(e) => setWeeks(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
				<p>Download your training data as a JSON file.</p>
				<a class="btn-secondary" href={`/api/generator/export?weeks=${weeks}`} download="training-export.json">
					Download your training data
				</a>
			</div>

			<div class="row">
				<span class="eyebrow">Step 2 — Copy the prompt</span>
				<p>Paste this into any AI assistant (ChatGPT, Claude, Gemini, whatever you have), along with the file you just downloaded.</p>
				<button type="button" class="btn-secondary" onClick={copyPrompt}>
					{copied ? 'Copied!' : 'Copy instructions'}
				</button>
				{copyError && <p class="eyebrow--accent">{copyError}</p>}
				<pre class="prompt-preview">{PROMPT}</pre>
			</div>

			<div class="row">
				<span class="eyebrow">Step 3 — Paste the result</span>
				<p>Paste the assistant's JSON answer below and import it.</p>
				<label class="field">
					Assistant's answer
					<textarea rows={8} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} />
				</label>
				{importError && <p class="eyebrow--accent">{importError}</p>}
				<button type="button" class="btn-primary" onClick={handleImport} disabled={busy || pasted.trim() === ''}>
					{busy ? 'Importing…' : 'Import'}
				</button>
			</div>
		</div>
	);
}
