import type { ComponentChildren } from 'preact';

interface ShellProps {
	active: 'today' | 'plan' | 'history';
	children: ComponentChildren;
}

export function Shell({ active, children }: ShellProps) {
	return (
		<div class="shell">
			<div class="shell-content">{children}</div>
			<nav class="tabbar">
				<a href="#/" class="tabbar-item" aria-current={active === 'today' ? 'page' : undefined}>
					Today
				</a>
				<a href="#/plan" class="tabbar-item" aria-current={active === 'plan' ? 'page' : undefined}>
					Plan
				</a>
				<a href="#/history" class="tabbar-item" aria-current={active === 'history' ? 'page' : undefined}>
					History
				</a>
			</nav>
		</div>
	);
}
