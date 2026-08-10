import { useEffect, useState } from 'preact/hooks';
import { acceptProposal, fetchPendingProposal, rejectProposal, type PendingProposal } from '../api';
import { GenerateFlow } from '../components/GenerateFlow';
import { GoalsEditor } from '../components/GoalsEditor';
import { ProposalReview } from '../components/ProposalReview';

export function Generate() {
	const [proposal, setProposal] = useState<PendingProposal | null | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);
	const [busy, setBusy] = useState(false);

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
				<h1>Generate</h1>
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
				<h1>Generate</h1>
				<p>Loading…</p>
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
			<h1>Generate</h1>
			<p class="lede">Export your data, hand it to any AI assistant, bring the plan back.</p>

			<GoalsEditor />

			{proposal ? (
				<ProposalReview proposal={proposal.plan} busy={busy} onAccept={handleAccept} onReject={handleReject} />
			) : (
				<GenerateFlow onImported={() => setRetryToken((t) => t + 1)} />
			)}
		</main>
	);
}
