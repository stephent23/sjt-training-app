import { useState } from 'preact/hooks';
import type { ExportPayload } from '../../generator';
import { downloadExport, fetchExportText, ImportRejected, importProposal } from '../api';
import { extractProposal } from '../parseProposal';
import { PROMPT } from '../prompt';

/** One line saying what the assistant is actually going to be working from.
 * The three cases are the three states the export can be in, and they call for
 * genuinely different plans — worth stating before the file is handed over,
 * rather than leaving it to be discovered from an empty JSON array. */
export function describeExport(payload: Partial<ExportPayload>): string {
	const firstWeek = payload.deterministicProposal?.weeks?.[0];
	if (!firstWeek || firstWeek.sessions.length === 0) {
		return `No history yet — the assistant writes your first week from scratch, starting ${payload.weekStartDate ?? 'next Monday'}.`;
	}

	const loggedSets = payload.historyWindow?.loggedSets ?? [];
	const loggedRuns = payload.historyWindow?.loggedRuns ?? [];
	if (loggedSets.length === 0 && loggedRuns.length === 0) {
		return 'Nothing logged yet — weights stay blank until you log some real numbers.';
	}
	return `${loggedSets.length} sets and ${loggedRuns.length} runs logged in the last two weeks.`;
}

/** Above this a chat box starts truncating pastes, and attaching the file is
 * the better route. */
const LARGE_PASTE_KB = 60;

interface GenerateFlowProps {
	onImported: () => void;
}

// The "no proposal pending yet" state on Generate: get your data out, hand it
// to an assistant with the prompt, bring the answer back. No live API call
// anywhere in this component — see docs/generator-design.md for why.
export function GenerateFlow({ onImported }: GenerateFlowProps) {
	const [weeks, setWeeks] = useState(1);
	const [status, setStatus] = useState('');
	const [dataNote, setDataNote] = useState<string | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const [pasted, setPasted] = useState('');
	const [importErrors, setImportErrors] = useState<string[]>([]);
	const [canReplace, setCanReplace] = useState(false);
	const [busy, setBusy] = useState(false);

	/** Both step-1 actions need the export; only what they do with it differs. */
	async function withExport(action: (text: string) => Promise<void> | void, working: string, done: string) {
		setDownloadError(null);
		setDownloading(true);
		setStatus(working);
		try {
			const text = await fetchExportText(weeks);
			setDataNote(describeExport(JSON.parse(text) as Partial<ExportPayload>));
			await action(text);
			setStatus(done);
		} catch (e) {
			setDownloadError(e instanceof Error ? e.message : 'Something went wrong.');
			setStatus('');
		} finally {
			setDownloading(false);
		}
	}

	function handleDownload() {
		// Goes through downloadExport rather than the text we just fetched: it
		// saves from a blob, which is what makes the download work in the
		// installed PWA where a plain anchor writes a 0-byte file.
		return withExport(() => downloadExport(weeks), 'Preparing your data…', 'Downloaded.');
	}

	function copyPromptAndData() {
		return withExport(
			async (text) => {
				const kb = Math.round(text.length / 1024);
				await navigator.clipboard.writeText(`${PROMPT}\n\n----- MY TRAINING DATA (JSON) -----\n${text}`);
				setStatus(
					kb > LARGE_PASTE_KB
						? `Copied, but it's ≈${kb} KB — if the chat truncates it, download the file and attach it instead.`
						: `Copied ≈${kb} KB — paste it into your assistant.`,
				);
			},
			'Preparing your data…',
			'Copied.',
		);
	}

	async function copyPrompt() {
		try {
			await navigator.clipboard.writeText(PROMPT);
			setStatus('Prompt copied.');
		} catch {
			setStatus('Could not copy automatically — select the prompt below and copy it by hand.');
		}
	}

	async function submit(text: string, replace: boolean) {
		setImportErrors([]);
		const parsed = extractProposal(text);
		if (!parsed.ok) {
			setImportErrors([parsed.error]);
			setCanReplace(false);
			return;
		}

		setBusy(true);
		try {
			await importProposal(parsed.value, replace);
			setPasted('');
			setCanReplace(false);
			setStatus('Plan imported — review it below.');
			onImported();
		} catch (e) {
			const errors = e instanceof ImportRejected ? e.errors : [e instanceof Error ? e.message : 'Import failed.'];
			setImportErrors(errors);
			// The only rejection with a one-tap answer, rather than a trip back
			// to the assistant.
			setCanReplace(errors.some((msg) => msg.includes('already pending')));
		} finally {
			setBusy(false);
		}
	}

	async function handleFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		await submit(await file.text(), false);
	}

	return (
		<div>
			<p class="eyebrow" role="status" aria-live="polite">
				{status || ' '}
			</p>

			<div class="row">
				<span class="eyebrow">Step 1 · Your data</span>
				<label class="field">
					How many weeks
					<input
						type="number"
						inputmode="numeric"
						min={1}
						max={12}
						value={weeks}
						onInput={(e) => setWeeks(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
				<p>Download the file to attach it, or copy the prompt and your data together as one paste — easier on a phone.</p>
				<button type="button" class="btn-primary" onClick={handleDownload} disabled={downloading}>
					{downloading ? 'Preparing…' : 'Download your training data'}
				</button>
				<button type="button" class="btn-secondary" onClick={copyPromptAndData} disabled={downloading}>
					Copy prompt + data as one paste
				</button>
				{downloadError && <p class="eyebrow eyebrow--accent">{downloadError}</p>}
				{dataNote && <p class="eyebrow">{dataNote}</p>}
			</div>

			<div class="row">
				<span class="eyebrow">Step 2 · The prompt</span>
				<p>Paste it into ChatGPT, Claude or Gemini with the file attached. Add anything else it should know — an injury, a busy week coming up.</p>
				<button type="button" class="btn-secondary" onClick={copyPrompt}>
					Copy the prompt
				</button>
				<details class="disclosure">
					<summary class="disclosure-summary">Read the prompt</summary>
					<div class="disclosure-body">
						<pre class="prompt-preview">{PROMPT}</pre>
					</div>
				</details>
			</div>

			<div class="row">
				<span class="eyebrow">Step 3 · The answer</span>
				<p>Upload the JSON file your assistant produced, or paste its reply. The explanation can stay in — we'll find the plan.</p>
				<label class="field">
					Upload the answer
					<input type="file" accept="application/json,.json,text/plain" onChange={handleFile} disabled={busy} />
				</label>

				<details class="disclosure">
					<summary class="disclosure-summary">Or paste it instead</summary>
					<div class="disclosure-body">
						<label class="field">
							Assistant's reply
							<textarea rows={6} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} />
						</label>
						<button type="button" class="btn-primary" onClick={() => submit(pasted, false)} disabled={busy || pasted.trim() === ''}>
							{busy ? 'Importing…' : 'Import'}
						</button>
					</div>
				</details>

				{importErrors.length > 0 && (
					<>
						<p class="eyebrow eyebrow--accent">
							{importErrors.length === 1 ? 'That plan was rejected' : `${importErrors.length} problems — the plan was rejected`}
						</p>
						<ul class="error-list">
							{importErrors.map((message, i) => (
								<li key={i}>{message}</li>
							))}
						</ul>
						{canReplace ? (
							<button type="button" class="btn-secondary" onClick={() => submit(pasted, true)} disabled={busy || pasted.trim() === ''}>
								Replace the pending plan
							</button>
						) : (
							<>
								<button type="button" class="btn-secondary btn-small" onClick={() => navigator.clipboard.writeText(importErrors.join('\n'))}>
									Copy these problems
								</button>
								<p class="eyebrow">Paste them back into the same chat and ask for a corrected plan.</p>
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
}
