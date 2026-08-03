import { useEffect, useState } from 'preact/hooks';
import { LiftSession } from './screens/LiftSession';
import { RunSession } from './screens/RunSession';
import { Today } from './screens/Today';

type View = { name: 'today' } | { name: 'lift'; sessionId: number } | { name: 'run'; sessionId: number };

function viewFromHash(): View {
	const match = location.hash.match(/^#\/(lift|run)\/(\d+)$/);
	if (match) return { name: match[1] as 'lift' | 'run', sessionId: Number(match[2]) };
	return { name: 'today' };
}

export function App() {
	const [view, setView] = useState<View>(() => viewFromHash());

	useEffect(() => {
		const onHashChange = () => setView(viewFromHash());
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);

	function openSession(id: number, kind: 'lift' | 'run') {
		location.hash = `#/${kind}/${id}`;
	}

	function goBack() {
		location.hash = '';
	}

	if (view.name === 'lift') return <LiftSession sessionId={view.sessionId} onBack={goBack} />;
	if (view.name === 'run') return <RunSession sessionId={view.sessionId} onBack={goBack} />;
	return <Today onOpenSession={openSession} />;
}
