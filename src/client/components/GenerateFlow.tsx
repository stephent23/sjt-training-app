import { useEffect, useRef, useState } from 'preact/hooks';
import type { ExportPayload } from '../../generator';
import { fetchExportText, ImportRejected, importProposal, saveText } from '../api';
import { extractProposal } from '../parseProposal';
import { PROMPT } from '../prompt';
import { Icon } from './Icon';
import { shortDate } from './PlanSetup';

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

const EXPORT_FILENAME = 'training-export.json';

/** Can this browser hand a file to another app's share sheet? Phones: yes,
 * which is what lets the data go straight into the Claude app. Desktop
 * browsers mostly can't, and get the copy-and-paste route instead. */
function canShareFiles(): boolean {
	try {
		if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
		return navigator.canShare({ files: [new File(['{}'], EXPORT_FILENAME, { type: 'application/json' })] });
	} catch {
		return false;
	}
}

interface AskStepProps {
	weeks: number;
	startDate: string;
	onNext: () => void;
}

/** "Ask Claude": get the training data and the prompt in front of an assistant
 * with as few taps as the device allows. The export is fetched as soon as the
 * step opens, so by the time you tap the big button the data is already in hand
 * — which is also what keeps navigator.share inside the browser's brief window
 * after a tap, rather than after a network wait. No live API call anywhere —
 * see docs/generator-design.md. */
export function AskStep({ weeks, startDate, onNext }: AskStepProps) {
	const [payload, setPayload] = useState<Partial<ExportPayload> | null>(null);
	const [status, setStatus] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const exportRequest = useRef<{ key: string; text: Promise<string> } | null>(null);

	/** The one in-flight (or settled) export for these inputs. Started on demand
	 * as well as by the prefetch below: effects run after paint, so a tap can
	 * land before the prefetch has begun — and awaiting nothing there would save
	 * a file containing `null`. A failed request is dropped so the next tap
	 * retries instead of replaying the same error forever. */
	function exportFor(): Promise<string> {
		const key = `${weeks}|${startDate}`;
		if (exportRequest.current?.key !== key) {
			const text = fetchExportText(weeks, startDate);
			exportRequest.current = { key, text };
			text.catch(() => {
				if (exportRequest.current?.text === text) exportRequest.current = null;
			});
		}
		return exportRequest.current.text;
	}

	useEffect(() => {
		setPayload(null);
		setError(null);
		const request = exportFor();
		const stillCurrent = () => exportRequest.current?.text === request;
		request
			.then((text) => {
				if (!stillCurrent()) return;
				try {
					setPayload(JSON.parse(text) as Partial<ExportPayload>);
				} catch {
					setPayload({});
				}
			})
			.catch((e) => {
				// stillCurrent() is already false here (a failure drops the cache),
				// so compare against the inputs instead.
				if (exportRequest.current !== null && !stillCurrent()) return;
				setError(e instanceof Error ? e.message : 'Something went wrong.');
			});
	}, [weeks, startDate]);

	/** Every action needs the export; only what it does with it differs. The
	 * action returns the line to show when it's done. */
	async function withExport(action: (text: string) => Promise<string>) {
		setBusy(true);
		setError(null);
		try {
			const text = await exportFor();
			setStatus(await action(text));
		} catch (e) {
			// Closing the share sheet is a decision, not a failure.
			if (e instanceof DOMException && e.name === 'AbortError') setStatus('');
			else {
				setError(e instanceof Error ? e.message : 'Something went wrong.');
				setStatus('');
			}
		} finally {
			setBusy(false);
		}
	}

	const share = () =>
		withExport(async (text) => {
			const file = new File([text], EXPORT_FILENAME, { type: 'application/json' });
			await navigator.share({ files: [file], text: PROMPT, title: 'Training plan request' });
			return 'Shared — come back here when Claude has answered.';
		});

	const copyAll = () =>
		withExport(async (text) => {
			const kb = Math.round(text.length / 1024);
			await navigator.clipboard.writeText(`${PROMPT}\n\n----- MY TRAINING DATA (JSON) -----\n${text}`);
			return kb > LARGE_PASTE_KB
				? `Copied, but it's ≈${kb} KB — if the chat truncates it, download the file and attach it instead.`
				: `Copied ≈${kb} KB — paste it into Claude.`;
		});

	// Goes through saveText rather than a plain anchor to the API: it saves from
	// a blob, which is what works in the installed PWA where an anchor writes a
	// 0-byte file.
	const download = () =>
		withExport(async (text) => {
			saveText(text, EXPORT_FILENAME);
			return 'Downloaded.';
		});

	const sharing = canShareFiles();
	const goalCount = (payload?.goalTags?.length ?? 0) + ((payload?.goals ?? '').trim() ? 1 : 0);

	return (
		<div class="step-panel">
			<p class="badge badge--status" role="status" aria-live="polite" hidden={!status}>
				{status}
			</p>

			<ul class="chip-summary" aria-label="What is being sent">
				<li class="chip">
					{weeks} {weeks === 1 ? 'week' : 'weeks'}
				</li>
				<li class="chip">Starts {shortDate(startDate)}</li>
				<li class="chip">
					{payload ? `${goalCount} ${goalCount === 1 ? 'goal' : 'goals'}` : 'Loading your data…'}
				</li>
			</ul>
			{payload && <p class="hint">{describeExport(payload)}</p>}

			{sharing ? (
				<button type="button" class="btn-primary" onClick={share} disabled={busy}>
					{busy ? 'Preparing…' : 'Share with Claude'}
				</button>
			) : (
				<button type="button" class="btn-primary" onClick={copyAll} disabled={busy}>
					{busy ? 'Preparing…' : 'Copy prompt + data'}
				</button>
			)}
			<p class="hint">
				{sharing
					? 'Opens your share sheet — pick Claude and send. The file and the instructions go together.'
					: 'One paste: the instructions and your data together. Then open Claude and paste it in.'}
			</p>

			<a class="btn-secondary" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
				Open Claude
			</a>
			{sharing && (
				<button type="button" class="btn-secondary" onClick={copyAll} disabled={busy}>
					Copy prompt + data as one paste
				</button>
			)}
			<button type="button" class="btn-secondary" onClick={download} disabled={busy}>
				Download your training data
			</button>
			{error && <p class="eyebrow eyebrow--accent">{error}</p>}

			<details class="disclosure">
				<summary class="disclosure-summary">Read the prompt</summary>
				<div class="disclosure-body">
					<pre class="prompt-preview">{PROMPT}</pre>
				</div>
			</details>

			<button type="button" class="btn-quiet" onClick={onNext}>
				I've asked Claude — paste the answer
				<Icon name="chevron-right" />
			</button>
		</div>
	);
}

/** The message that goes back to the assistant when a plan is rejected. */
export function fixItMessage(errors: string[]): string {
	return `The app rejected the plan you gave me. Please fix these problems and send back the complete corrected JSON (same format, every week):\n\n${errors
		.map((e) => `- ${e}`)
		.join('\n')}`;
}

interface PasteStepProps {
	onImported: () => void;
	onBack?: () => void;
}

/** "Paste the answer": one big paste-from-clipboard button, a file upload, and
 * a textarea for when the clipboard can't be read. Whatever arrives is
 * validated at once; a rejection is a list you can hand straight back. */
export function PasteStep({ onImported, onBack }: PasteStepProps) {
	const [status, setStatus] = useState('');
	const [pasted, setPasted] = useState('');
	const [manualOpen, setManualOpen] = useState(false);
	const [importErrors, setImportErrors] = useState<string[]>([]);
	const [canReplace, setCanReplace] = useState(false);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);

	async function submit(text: string, replace: boolean) {
		setImportErrors([]);
		setCopied(false);
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
			setStatus('Plan imported — review it next.');
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

	async function pasteFromClipboard() {
		setStatus('');
		try {
			const text = await navigator.clipboard.readText();
			if (text.trim() === '') {
				setStatus('The clipboard is empty — copy Claude’s reply first.');
				return;
			}
			setPasted(text);
			await submit(text, false);
		} catch {
			// Blocked, or not supported (some browsers only allow it from a
			// secure, focused page): the textarea does the same job.
			setManualOpen(true);
			setStatus('Could not read the clipboard — paste the reply into the box below.');
		}
	}

	async function handleFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		await submit(await file.text(), false);
	}

	async function copyErrors() {
		try {
			await navigator.clipboard.writeText(fixItMessage(importErrors));
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div class="step-panel">
			<p class={status ? 'badge badge--status' : 'visually-hidden'} role="status" aria-live="polite">
				{status}
			</p>
			<p class="hint">Copy Claude's whole reply, then tap the button. The explanation can stay in — we'll find the plan.</p>

			<button type="button" class="btn-primary" onClick={pasteFromClipboard} disabled={busy}>
				{busy ? 'Checking…' : 'Paste from clipboard'}
			</button>

			<label class="field">
				Or upload the JSON file
				<input type="file" accept="application/json,.json,text/plain" onChange={handleFile} disabled={busy} />
			</label>

			<details class="disclosure" open={manualOpen} onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}>
				<summary class="disclosure-summary">Or paste it here instead</summary>
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
				<div class="card error-card" role="alert">
					{/* The count is the heading: how bad is it, before the detail. */}
					<h3 class="error-card-title">
						<Icon name="alert" />
						{importErrors.length === 1 ? 'That plan was rejected' : `${importErrors.length} problems — plan rejected`}
					</h3>
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
							<button type="button" class="btn-primary" onClick={copyErrors}>
								{copied ? 'Copied — paste it to Claude' : 'Copy errors for Claude'}
							</button>
							<p class="hint">Paste them into the same chat; Claude will send a corrected plan. Then tap Paste from clipboard again.</p>
						</>
					)}
				</div>
			)}

			{onBack && (
				<button type="button" class="btn-quiet" onClick={onBack}>
					<Icon name="chevron-left" />
					Back
				</button>
			)}
		</div>
	);
}
