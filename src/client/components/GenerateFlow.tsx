import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchExportText, ImportRejected, importProposal, saveText } from '../api';
import { extractProposal } from '../parseProposal';
import { PROMPT } from '../prompt';
import { Icon } from './Icon';

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

/** The message that goes back to the assistant when a plan is rejected. */
export function fixItMessage(errors: string[]): string {
	return `The app rejected the plan you gave me. Please fix these problems and send back the complete corrected JSON (same format, every week):\n\n${errors
		.map((e) => `- ${e}`)
		.join('\n')}`;
}

interface PlanRequestProps {
	weeks: number;
	startDate: string;
	/** Disables both actions, e.g. while the start date is not a usable Monday. */
	disabled?: boolean;
	/** Whether step 1 has been done (kept by the caller so it survives a trip to the Claude app). */
	asked: boolean;
	onAsked: () => void;
	onImported: () => void;
	/** Set when revising the block in progress: the export and import both carry it. */
	adjustBlockId?: number;
}

/** The two things this screen does: get the training data and the prompt in
 * front of an assistant ("1"), and bring its answer back ("2"). No live API call
 * anywhere — see docs/generator-design.md. */
export function PlanRequest({ weeks, startDate, disabled, asked, onAsked, onImported, adjustBlockId }: PlanRequestProps) {
	const [status, setStatus] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [pasted, setPasted] = useState('');
	const [importErrors, setImportErrors] = useState<string[]>([]);
	const [canReplace, setCanReplace] = useState(false);
	const [copied, setCopied] = useState(false);
	const exportRequest = useRef<{ key: string; text: Promise<string> } | null>(null);

	/** The one in-flight (or settled) export for these inputs. Started on demand
	 * as well as by the prefetch below: effects run after paint, so a tap can
	 * land before the prefetch has begun — and awaiting nothing there would save
	 * a file containing `null`. Prefetching also keeps navigator.share inside the
	 * browser's brief window after a tap. A failed request is dropped so the next
	 * tap retries instead of replaying the same error forever. */
	function exportFor(): Promise<string> {
		const key = `${weeks}|${startDate}|${adjustBlockId ?? ''}`;
		if (exportRequest.current?.key !== key) {
			const text = fetchExportText(weeks, startDate, adjustBlockId);
			exportRequest.current = { key, text };
			text.catch(() => {
				if (exportRequest.current?.text === text) exportRequest.current = null;
			});
		}
		return exportRequest.current.text;
	}

	useEffect(() => {
		setError(null);
		// A prefetch failure is shown by the action that needs it, not here.
		exportFor().catch(() => {});
	}, [weeks, startDate, adjustBlockId]);

	/** Every export action needs the text; only what it does with it differs.
	 * It returns the line to show when done, and whether that completes step 1. */
	async function withExport(action: (text: string) => Promise<string>, asking = false) {
		setBusy(true);
		setError(null);
		try {
			const text = await exportFor();
			setStatus(await action(text));
			if (asking) onAsked();
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
		}, true);

	const copyAll = () =>
		withExport(async (text) => {
			const kb = Math.round(text.length / 1024);
			await navigator.clipboard.writeText(`${PROMPT}\n\n----- MY TRAINING DATA (JSON) -----\n${text}`);
			return kb > LARGE_PASTE_KB
				? `Copied, but it's ≈${kb} KB — if the chat truncates it, download the file and attach it instead.`
				: 'Copied — paste it into Claude.';
		}, true);

	// Goes through saveText rather than a plain anchor to the API: it saves from
	// a blob, which is what works in the installed PWA where an anchor writes a
	// 0-byte file.
	const download = () =>
		withExport(async (text) => {
			saveText(text, EXPORT_FILENAME);
			return 'Downloaded.';
		});

	async function submit(text: string, replace: boolean) {
		setImportErrors([]);
		setCopied(false);
		setStatus('');
		const parsed = extractProposal(text);
		if (!parsed.ok) {
			setImportErrors([parsed.error]);
			setCanReplace(false);
			return;
		}

		setBusy(true);
		try {
			await importProposal(parsed.value, replace, adjustBlockId);
			setPasted('');
			setCanReplace(false);
			setStatus('Plan imported');
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
			setMoreOpen(true);
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

	const sharing = canShareFiles();
	const off = busy || disabled;
	const number = (n: number) => <span class="step-n">{n}</span>;

	return (
		<>
			<button type="button" class={asked ? 'btn-secondary btn-step' : 'btn-primary btn-step'} onClick={sharing ? share : copyAll} disabled={off}>
				{number(1)}
				{sharing ? 'Share with Claude' : 'Copy for Claude'}
			</button>
			<button type="button" class={asked ? 'btn-primary btn-step' : 'btn-secondary btn-step'} onClick={pasteFromClipboard} disabled={off}>
				{number(2)}
				Paste Claude’s answer
			</button>

			<p class="status-line" role="status" aria-live="polite" hidden={!status}>
				{status}
			</p>
			{error && <p class="eyebrow--accent run-field-error" role="alert">{error}</p>}

			{importErrors.length > 0 && (
				<div class="card error-card" role="alert">
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
						<button type="button" class="btn-primary" onClick={copyErrors}>
							{copied ? 'Copied — paste it to Claude' : 'Copy errors for Claude'}
						</button>
					)}
				</div>
			)}

			<details class="disclosure" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
				<summary class="disclosure-summary">More options</summary>
				<div class="disclosure-body">
					<a class="btn-secondary" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
						Open Claude
					</a>
					{sharing && (
						<button type="button" class="btn-secondary" onClick={copyAll} disabled={off}>
							Copy prompt + data
						</button>
					)}
					<button type="button" class="btn-secondary" onClick={download} disabled={off}>
						Download your training data
					</button>
					<label class="field">
						Upload a file
						<input type="file" accept="application/json,.json,text/plain" onChange={handleFile} disabled={busy} />
					</label>
					<label class="field">
						Paste text
						<textarea rows={5} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} />
					</label>
					<button type="button" class="btn-secondary" onClick={() => submit(pasted, false)} disabled={busy || pasted.trim() === ''}>
						{busy ? 'Importing…' : 'Import'}
					</button>
					<details class="disclosure">
						<summary class="disclosure-summary">Read the prompt</summary>
						<pre class="prompt-preview">{PROMPT}</pre>
					</details>
				</div>
			</details>
		</>
	);
}
