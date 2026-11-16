/** The two halves of the History tab: what was logged, and where it is heading. */
export function HistoryTabs({ active }: { active: 'sessions' | 'progress' }) {
	const tab = (id: 'sessions' | 'progress', href: string, label: string) => (
		<a class="seg-item" href={href} aria-current={active === id ? 'page' : undefined}>
			{label}
		</a>
	);
	return (
		<nav class="seg" aria-label="History views">
			{tab('sessions', '#/history', 'Sessions')}
			{tab('progress', '#/progress', 'Progress')}
		</nav>
	);
}
