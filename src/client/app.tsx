import { useEffect, useState } from 'preact/hooks';
import { Shell } from './components/Shell';
import { LiftSession } from './screens/LiftSession';
import { Plan } from './screens/Plan';
import { History } from './screens/History';
import { Preview } from './screens/Preview';
import { Review } from './screens/Review';
import { RunSession } from './screens/RunSession';
import { Today } from './screens/Today';

type View =
	| { name: 'today' }
	| { name: 'plan' }
	| { name: 'history' }
	| { name: 'lift'; sessionId: number }
	| { name: 'run'; sessionId: number }
	| { name: 'review'; sessionId: number }
	| { name: 'preview'; sessionId: number };

const SESSION_ROUTE = /^#\/(lift|run|review|preview)\/(\d+)$/;

function viewFromHash(): View {
	if (location.hash === '#/plan') return { name: 'plan' };
	if (location.hash === '#/history') return { name: 'history' };
	const match = location.hash.match(SESSION_ROUTE);
	if (match) return { name: match[1] as 'lift' | 'run' | 'review' | 'preview', sessionId: Number(match[2]) };
	return { name: 'today' };
}

export function App() {
	const [view, setView] = useState<View>(() => viewFromHash());

	useEffect(() => {
		const onHashChange = () => setView(viewFromHash());
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);

	// Real back navigation — pops history instead of pushing a new empty-hash
	// entry, which is what `location.hash = ''` used to do (so the browser
	// back button walked a growing stack instead of actually going back).
	function goBack() {
		history.back();
	}

	if (view.name === 'lift') return <LiftSession sessionId={view.sessionId} onBack={goBack} />;
	if (view.name === 'run') return <RunSession sessionId={view.sessionId} onBack={goBack} />;
	if (view.name === 'review') return <Review sessionId={view.sessionId} />;
	if (view.name === 'preview') return <Preview sessionId={view.sessionId} onBack={goBack} />;

	if (view.name === 'plan')
		return (
			<Shell active="plan">
				<Plan />
			</Shell>
		);

	if (view.name === 'history')
		return (
			<Shell active="history">
				<History />
			</Shell>
		);

	return (
		<Shell active="today">
			<Today />
		</Shell>
	);
}
