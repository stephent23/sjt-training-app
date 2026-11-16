import { useEffect, useState } from 'preact/hooks';
import { todayIso, weekStartOnOrAfter } from '../../dates';
import { acceptProposal, fetchActiveBlock, fetchPendingProposal, fetchRaces, fetchSettings, rejectProposal, type PendingProposal } from '../api';
import { PlanRequest } from '../components/GenerateFlow';
import { Icon } from '../components/Icon';
import { DEFAULT_WEEKS, adjustLengthLine, adjustRangeLine, blockEndLine, StartPicker, startDateError, WeeksControl } from '../components/PlanSetup';
import { ProposalReview } from '../components/ProposalReview';
import { goalsSummary } from '../goalsSummary';
import type { ActiveBlock, Race } from '../../types';

const STORAGE_KEY = 'generate-plan-v2';

interface Saved {
	weeks: number;
	startDate: string;
	/** Step 1 done — so coming back from the Claude app shows step 2 ready. */
	asked: boolean;
	/** Revise the block in progress, or start a new one. Only offered while a block is in progress. */
	mode: 'adjust' | 'new';
	/** Length when adjusting; null means "whatever is left of the block". */
	adjustWeeks: number | null;
}

function defaults(): Saved {
	return { weeks: DEFAULT_WEEKS, startDate: weekStartOnOrAfter(todayIso()), asked: false, mode: 'adjust', adjustWeeks: null };
}

/** Last saved answers. Storage can be missing, blocked or hold junk (private
 * window, cleared site data), so anything off falls back to a fresh start; a
 * start date that has since passed is replaced rather than kept. */
function load(): Saved {
	const fresh = defaults();
	try {
		const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | null;
		if (!raw) return fresh;
		const weeks = Number.isInteger(raw.weeks) && raw.weeks! >= 1 && raw.weeks! <= 12 ? raw.weeks! : fresh.weeks;
		const startDate = typeof raw.startDate === 'string' && startDateError(raw.startDate) === null ? raw.startDate : fresh.startDate;
		const adjustWeeks = Number.isInteger(raw.adjustWeeks) && raw.adjustWeeks! >= 1 && raw.adjustWeeks! <= 12 ? raw.adjustWeeks! : null;
		return { weeks, startDate, asked: raw.asked === true && startDate === raw.startDate, mode: raw.mode === 'new' ? 'new' : 'adjust', adjustWeeks };
	} catch {
		return fresh;
	}
}

function save(value: Saved | null) {
	try {
		if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Not persisting is fine; the screen still works, it just won't resume.
	}
}

export function Generate() {
	const [saved, setSaved] = useState<Saved>(load);
	const [proposal, setProposal] = useState<PendingProposal | null | undefined>(undefined);
	const [goals, setGoals] = useState<{ headline: string; detail: string } | null>(null);
	const [races, setRaces] = useState<Race[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const [busy, setBusy] = useState(false);
	const [accepted, setAccepted] = useState<{ updated: string | null } | null>(null);
	const [block, setBlock] = useState<ActiveBlock | null>(null);

	const { weeks, startDate, asked } = saved;
	// Adjusting is only on offer while the block has weeks left to revise.
	const canAdjust = block !== null && block.weeks_remaining > 0;
	const adjusting = canAdjust && saved.mode === 'adjust';
	const adjustLen = adjusting ? (saved.adjustWeeks ?? block.weeks_remaining) : weeks;
	// Changing what is asked for makes a previous "asked" stale unless told otherwise.
	const update = (patch: Partial<Saved>, keepAsked = false) =>
		setSaved((current) => {
			const next = { ...current, ...patch };
			if (!keepAsked) next.asked = false;
			save(next);
			return next;
		});

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchPendingProposal()
			.then((result) => {
				if (!cancelled) setProposal(result);
			})
			.catch(() => {
				if (!cancelled) setError('Could not load the plan.');
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	useEffect(() => {
		let cancelled = false;
		fetchActiveBlock()
			.then((result) => {
				if (!cancelled) setBlock(result);
			})
			.catch(() => {
				// No choice shown: New plan behaves as it always has.
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	useEffect(() => {
		let cancelled = false;
		Promise.all([fetchSettings(), fetchRaces()])
			.then(([settings, races]) => {
				if (cancelled) return;
				setGoals(goalsSummary(settings, races, todayIso()));
				setRaces(races);
			})
			.catch(() => {
				// The card falls back to a plain invitation.
			});
		return () => {
			cancelled = true;
		};
	}, []);

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
				</div>
			</main>
		);
	}

	// Accepting or rejecting changes the pending-proposal state, so a full
	// refetch is simpler than patching it by hand.
	async function handleAccept() {
		if (!proposal) return;
		setBusy(true);
		try {
			await acceptProposal(proposal.id);
			save(null);
			setProposal(null);
			setSaved(defaults());
			setAccepted({ updated: proposal.block?.name ?? null });
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
				<section class="card done-card" role="status">
					<h2 class="section-heading">{accepted.updated ? `${accepted.updated} updated` : 'Plan accepted'}</h2>
					<a class="btn-primary" href="#/plan" role="button">
						See the plan
					</a>
				</section>
			</main>
		);
	}

	if (proposal) {
		return (
			<main class="screen">
				<h1>New plan</h1>
				<ProposalReview
					proposal={proposal.plan}
					deterministic={proposal.deterministic}
					replaces={proposal.replaces}
					startDate={proposal.start_date}
					block={proposal.block}
					firstWeekNumber={proposal.first_week_number}
					busy={busy}
					onAccept={handleAccept}
					onReject={handleReject}
				/>
			</main>
		);
	}

	return (
		<main class="screen">
			<h1>New plan</h1>
			<a class="card card--link goals-link" href="#/goals">
				<span class="goals-link-main">
					<span class="goals-link-headline">{goals?.headline ?? 'Set your goals'}</span>
					{goals && <span class="rv-session-meta">{goals.detail}</span>}
				</span>
				<Icon name="chevron-right" />
			</a>

			{canAdjust && (
				<div class="tap-row mode-row" role="group" aria-label="What to plan">
					{(['adjust', 'new'] as const).map((m) => (
						<button
							key={m}
							type="button"
							class={`tap-btn ${saved.mode === m ? 'tap-btn--selected' : ''}`}
							aria-pressed={saved.mode === m}
							onClick={() => saved.mode !== m && update({ mode: m })}
						>
							{m === 'adjust' ? `Adjust ${block.name}` : 'New block'}
						</button>
					))}
				</div>
			)}

			<section class="card plan-setup">
				{adjusting ? (
					<>
						<p class="rv-session-meta">{adjustRangeLine(block, adjustLen)}</p>
						<h2 class="section-heading">Length</h2>
						<WeeksControl value={adjustLen} onChange={(w) => update({ adjustWeeks: w })} />
						<p class="rv-session-meta">{adjustLengthLine(block, adjustLen)}</p>
					</>
				) : (
					<>
						<h2 class="section-heading">Starts</h2>
						<StartPicker value={startDate} onChange={(d) => update({ startDate: d })} />
						<h2 class="section-heading">Length</h2>
						<WeeksControl value={weeks} onChange={(w) => update({ weeks: w })} />
						<p class="rv-session-meta">{blockEndLine(startDate, weeks, races, todayIso())}</p>
					</>
				)}
			</section>

			<PlanRequest
				weeks={adjustLen}
				startDate={adjusting ? block.next_monday : startDate}
				adjustBlockId={adjusting ? block.id : undefined}
				disabled={!adjusting && startDateError(startDate) !== null}
				asked={asked}
				onAsked={() => update({ asked: true }, true)}
				onImported={() => setRetryToken((t) => t + 1)}
			/>
		</main>
	);
}
