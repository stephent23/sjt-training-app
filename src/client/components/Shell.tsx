import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

type Tab = 'today' | 'plan' | 'history' | 'generate' | 'goals';

interface ShellProps {
	/** The tab to mark current; omitted on screens that belong to no tab (a
	 * run being edited, a review) — the bar is still there to leave by. */
	active?: Tab;
	children: ComponentChildren;
}

const TABS: { id: Tab; href: string; label: string; icon: IconName }[] = [
	{ id: 'today', href: '#/', label: 'Today', icon: 'today' },
	{ id: 'plan', href: '#/plan', label: 'Plan', icon: 'calendar' },
	{ id: 'history', href: '#/history', label: 'History', icon: 'history' },
	{ id: 'generate', href: '#/generate', label: 'New plan', icon: 'plus' },
	{ id: 'goals', href: '#/goals', label: 'Goals', icon: 'flag' },
];

export function Shell({ active, children }: ShellProps) {
	return (
		<div class="shell">
			<div class="shell-content">{children}</div>
			<nav class="tabbar" aria-label="Sections">
				<span class="tabbar-brand">Training</span>
				{TABS.map((tab) => (
					<a key={tab.id} href={tab.href} class="tabbar-item" aria-current={active === tab.id ? 'page' : undefined}>
						<Icon name={tab.icon} size="md" />
						<span>{tab.label}</span>
					</a>
				))}
			</nav>
		</div>
	);
}
