import { useEffect, useState } from 'preact/hooks';
import { todayIso, weekStartOnOrAfter } from '../../dates';
import { acceptProposal, fetchPendingProposal, rejectProposal, type PendingProposal } from '../api';
import { AskStep, PasteStep } from '../components/GenerateFlow';
import { GoalsEditor } from '../components/GoalsEditor';
import { Icon } from '../components/Icon';
import { DEFAULT_WEEKS, shortDate, StartPicker, startDateError, WeeksControl } from '../components/PlanSetup';
import { ProposalReview } from '../components/ProposalReview';

// The flow, in order. A phone round trip is: do the first three here, leave for
// the Claude app, come back and do the last two — so where you were is kept.
const STEPS = ['Goals', 'Start & length', 'Ask Claude', 'Paste the answer', 'Review'] as const;
type Step = 1 | 2 | 3 | 4 | 5;

const STORAGE_KEY = 'generate-wizard-v1';

interface Saved {
	step: Step;
	weeks: number;
	startDate: string;
}

function defaults(): Saved {
	return { step: 1, weeks: DEFAULT_WEEKS, startDate: weekStartOnOrAfter(todayIso()) };
}

/** Last saved position and answers. Storage can be missing, blocked or hold
 * junk (private window, cleared site data), so anything off falls back to a
 * fresh start; a start date that has since passed is replaced rather than kept. */
function load(): Saved {
	const fresh = defaults();
	try {
		const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null;
		if (!raw) return fresh;
		const step = Number.isInteger(raw.step) && raw.step! >= 1 && raw.step! <= 4 ? (raw.step as Step) : 1;
		const weeks = Number.isInteger(raw.weeks) && raw.weeks! >= 1 && raw.weeks! <= 12 ? raw.weeks! : fresh.weeks;
		const startDate = typeof raw.startDate === 'string' && startDateError(raw.startDate) === null ? raw.startDate : fresh.startDate;
		return { step, weeks, startDate };
	} catch {
		return fresh;
	}
}

function save(value: Saved) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Not persisting is fine; the flow still works, it just won't resume.
	}
}

function clearSaved() {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// see save()
	}
}

function StepIndicator({ step }: { step: Step }) {
	return (
		<ol class="wizard-steps" aria-label="Progress">
			{STEPS.map((label, i) => {
				const n = i + 1;
				const state = n < step ? 'done' : n === step ? 'now' : 'next';
				return (
					<li key={label} class={`wizard-step wizard-step--${state}`} aria-current={n === step ? 'step' : undefined}>
						<span class="step-n">
							{state === 'done' ? <Icon name="check" /> : n}
							<span class="visually-hidden">
								{state === 'done' ? ' (done) ' : ' '}
								{label}
							</span>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

export function Generate() {
	const [saved, setSaved] = useState<Saved>(load);
	const [proposal, setProposal] = useState<PendingProposal | null | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const [busy, setBusy] = useState(false);
	const [accepted, setAccepted] = useState(false);

	const { weeks, startDate } = saved;
	const update = (patch: Partial<Saved>) =>
		setSaved((current) => {
			const next = { ...current, ...patch };
			save(next);
			return next;
		});

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchPendingProposal()
			.then((proposalResult) => {
				if (cancelled) return;
				setProposal(proposalResult);
			})
			.catch(() => {
				if (cancelled) return;
				setError('Could not load the plan.');
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	if (error) {
		return (
			<main class="screen">
				<h1>New plan</h1>
				<p>{error}</p>
				<button type="button" class="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
					Retry
				</button>
			</main>
		);
	}

	if (proposal === undefined) {
		return (
			<main class="screen">
				<h1>New plan</h1>
				<div class="skeleton-list" aria-hidden="true">
					<span class="skeleton skeleton--block" />
					<span class="skeleton skeleton--row" />
					<span class="skeleton skeleton--row" />
					<span class="skeleton skeleton--row" />
				</div>
			</main>
		);
	}

	// Same retry-token refetch pattern as elsewhere in the app — accepting or
	// rejecting changes the pending-proposal state, so a full refetch is
	// simpler than patching it by hand.
	async function handleAccept() {
		if (!proposal) return;
		setBusy(true);
		try {
			await acceptProposal(proposal.id);
			clearSaved();
			setProposal(null);
			setSaved(defaults());
			setAccepted(true);
			setRetryToken((t) => t + 1);
		} catch {
			setError('Could not accept that plan — try again.');
		} finally {
			setBusy(false);
		}
	}

	async function handleReject() {
		if (!proposal) return;
		setBusy(true);
		try {
			await rejectProposal(proposal.id);
			// Straight back to the paste step: the usual reason to reject is to ask
			// Claude again.
			update({ step: 4 });
			setRetryToken((t) => t + 1);
		} catch {
			setError('Could not reject that plan — try again.');
		} finally {
			setBusy(false);
		}
	}

	if (accepted && !proposal) {
		return (
			<main class="screen">
				<h1>New plan</h1>
				<section class="card wizard-done" role="status">
					<span class="step-n step-n--done">
						<Icon name="check" />
					</span>
					<h2 class="section-heading">Plan accepted</h2>
					<p class="hint">Your new block is on the calendar.</p>
					<a class="btn-primary" href="#/plan" role="button">
						See the plan
					</a>
					<button type="button" class="btn-quiet" onClick={() => setAccepted(false)}>
						Start another plan
					</button>
				</section>
			</main>
		);
	}

	// A plan already waiting wins over wherever the saved step says you were.
	const step: Step = proposal ? 5 : saved.step === 5 ? 4 : saved.step;
	const go = (next: Step) => update({ step: next });
	const dateError = startDateError(startDate);

	return (
		<main class="screen">
			<h1>New plan</h1>
			<StepIndicator step={step} />
			<h2 class="wizard-title">{STEPS[step - 1]}</h2>

			{step === 1 && (
				<>
					<GoalsEditor />
					<button type="button" class="btn-primary" onClick={() => go(2)}>
						Next: start &amp; length
					</button>
				</>
			)}

			{step === 2 && (
				<>
					<section class="card plan-setup">
						<h3 class="section-heading">Starts</h3>
						<StartPicker value={startDate} onChange={(d) => update({ startDate: d })} />

						<h3 class="section-heading">How many weeks</h3>
						<WeeksControl value={weeks} onChange={(w) => update({ weeks: w })} />

						{!dateError && (
							<p class="hint plan-setup-summary">
								A fresh block: Week 1 on {shortDate(startDate)}. Anything you haven't trained yet from then on is replaced when you
								accept.
							</p>
						)}
					</section>
					<button type="button" class="btn-primary" onClick={() => go(3)} disabled={dateError !== null}>
						Next: ask Claude
					</button>
					<button type="button" class="btn-quiet" onClick={() => go(1)}>
						<Icon name="chevron-left" />
						Back
					</button>
				</>
			)}

			{step === 3 && (
				<>
					<AskStep weeks={weeks} startDate={startDate} onNext={() => go(4)} />
					<button type="button" class="btn-quiet" onClick={() => go(2)}>
						<Icon name="chevron-left" />
						Back
					</button>
				</>
			)}

			{step === 4 && (
				<>
					<PasteStep onImported={() => setRetryToken((t) => t + 1)} />
					<button type="button" class="btn-quiet" onClick={() => go(3)}>
						<Icon name="chevron-left" />
						Back
					</button>
				</>
			)}

			{step === 5 && proposal && (
				<ProposalReview
					proposal={proposal.plan}
					deterministic={proposal.deterministic}
					replaces={proposal.replaces}
					startDate={proposal.start_date}
					busy={busy}
					onAccept={handleAccept}
					onReject={handleReject}
				/>
			)}
		</main>
	);
}
