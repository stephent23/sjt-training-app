import { Icon } from './Icon';
interface SessionScreenFallbackProps {
	error: string | null;
	onBack: () => void;
	onRetry: () => void;
}

// The identical "no session loaded yet" state that LiftSession, RunSession,
// Preview and Review each hand-rolled: a back button, then either the error
// with a retry or a skeleton in the shape of a session header and a couple of
// cards. Kept as one component so the four screens can't drift apart on
// wording or on which controls are offered.
export function SessionScreenFallback({ error, onBack, onRetry }: SessionScreenFallbackProps) {
	return (
		<main class="screen">
			<button type="button" class="back-btn" onClick={onBack}>
				<Icon name="chevron-left" />
				Back
			</button>
			{error ? (
				<>
					<p>{error}</p>
					<button type="button" class="btn-secondary" onClick={onRetry}>
						Retry
					</button>
				</>
			) : (
				<div class="skeleton-list" aria-hidden="true">
					<span class="skeleton skeleton--title" style={{ width: '55%' }} />
					<span class="skeleton skeleton--block" />
					<span class="skeleton skeleton--row" />
					<span class="skeleton skeleton--row" />
					<span class="skeleton skeleton--row" />
				</div>
			)}
		</main>
	);
}
