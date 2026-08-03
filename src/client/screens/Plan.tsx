import { useEffect, useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { acceptProposal, fetchPendingProposal, fetchSessions, rejectProposal, setSessionDate, type PendingProposal } from '../api';
import { GenerateWeekFlow } from '../components/GenerateWeekFlow';
import { GoalsEditor } from '../components/GoalsEditor';
import { ProposalReview } from '../components/ProposalReview';
import { SessionList } from '../components/SessionRow';

// Plan is a preview of what's coming, not a place to log from — a planned
// session here is read-only (#/preview/:id). Logging happens on the day
// itself, via Today. Completed/skipped sessions go to Review, same as
// everywhere else that links to a resolved session.
function linkFor(s: SessionSummary): string {
	if (s.status === 'planned') return `#/preview/${s.id}`;
	return `#/review/${s.id}`;
}

export function Plan() {
	const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
	const [proposal, setProposal] = useState<PendingProposal | null | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		Promise.all([fetchSessions({ from: todayIso(), order: 'asc' }), fetchPendingProposal()])
			.then(([sessionsResult, proposalResult]) => {
				if (cancelled) return;
				setSessions(sessionsResult);
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
				<h1>Plan</h1>
				<p>{error}</p>
				<button type="button" class="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
					Retry
				</button>
			</main>
		);
	}

	if (sessions === undefined || proposal === undefined) {
		return (
			<main class="screen">
				<h1>Plan</h1>
				<p>Loading…</p>
			</main>
		);
	}

	async function handleReschedule(session: SessionSummary, date: string) {
		// Refetch afterward rather than re-sorting locally — moving a date can
		// change both sort order and which week a session groups under, and
		// getting that right server-side (already sorted/filtered by the same
		// query Plan always uses) is simpler than duplicating that logic here.
		try {
			await setSessionDate(session.id, date);
			setRetryToken((t) => t + 1);
		} catch {
			setError('Could not move that session — try again.');
		}
	}

	// Same retry-token refetch pattern as handleReschedule above — accepting
	// or rejecting changes both the pending-proposal state and (on accept)
	// the session list itself, so a full refetch is simpler than patching
	// both pieces of local state by hand.
	async function handleAccept() {
		if (!proposal) return;
		setBusy(true);
		try {
			await acceptProposal(proposal.id);
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

	return (
		<main class="screen">
			<h1>Plan</h1>

			<GoalsEditor />

			{proposal ? (
				<ProposalReview proposal={proposal.plan} busy={busy} onAccept={handleAccept} onReject={handleReject} />
			) : (
				<GenerateWeekFlow onImported={() => setRetryToken((t) => t + 1)} />
			)}

			<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing planned." onReschedule={handleReschedule} />
		</main>
	);
}
