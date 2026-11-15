import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

interface ShellProps {
	active: 'today' | 'plan' | 'history' | 'generate';
	children: ComponentChildren;
}

const TABS: { id: ShellProps['active']; href: string; label: string; icon: IconName }[] = [
	{ id: 'today', href: '#/', label: 'Today', icon: 'today' },
	{ id: 'plan', href: '#/plan', label: 'Plan', icon: 'calendar' },
	{ id: 'history', href: '#/history', label: 'History', icon: 'history' },
	{ id: 'generate', href: '#/generate', label: 'New plan', icon: 'plus' },
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
