import { useEffect, useState } from 'preact/hooks';
import { Shell } from './components/Shell';
import { LiftSession } from './screens/LiftSession';
import { Generate } from './screens/Generate';
import { Goals } from './screens/Goals';
import { Plan } from './screens/Plan';
import { History } from './screens/History';
import { Preview } from './screens/Preview';
import { Review } from './screens/Review';
import { RunEditor } from './screens/RunEditor';
import { RunSession } from './screens/RunSession';
import { Today } from './screens/Today';

type View =
	| { name: 'today' }
	| { name: 'plan' }
	| { name: 'history' }
	| { name: 'generate' }
	| { name: 'goals' }
	| { name: 'lift'; sessionId: number }
	| { name: 'run'; sessionId: number }
	| { name: 'review'; sessionId: number }
	| { name: 'preview'; sessionId: number }
	| { name: 'run-new' }
	| { name: 'run-edit'; sessionId: number };

const SESSION_ROUTE = /^#\/(lift|run|review|preview)\/(\d+)$/;
const RUN_EDIT_ROUTE = /^#\/run\/(\d+)\/edit$/;

function viewFromHash(): View {
	if (location.hash === '#/plan') return { name: 'plan' };
	if (location.hash === '#/history') return { name: 'history' };
	if (location.hash === '#/generate') return { name: 'generate' };
	if (location.hash === '#/goals') return { name: 'goals' };
	if (location.hash === '#/run/new') return { name: 'run-new' };
	const editMatch = location.hash.match(RUN_EDIT_ROUTE);
	if (editMatch) return { name: 'run-edit', sessionId: Number(editMatch[1]) };
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

	return <Shell active={tabFor(view)}>{screenFor(view, goBack)}</Shell>;
}

/** Which tab a screen belongs to, if any. A session opened from Today keeps
 * Today lit; review, preview and the run editor belong to no tab. */
function tabFor(view: View): 'today' | 'plan' | 'history' | 'generate' | 'goals' | undefined {
	switch (view.name) {
		case 'today':
		case 'lift':
		case 'run':
			return 'today';
		case 'plan':
		case 'history':
		case 'generate':
		case 'goals':
			return view.name;
		default:
			return undefined;
	}
}

function screenFor(view: View, goBack: () => void) {
	switch (view.name) {
		case 'lift':
			return <LiftSession sessionId={view.sessionId} onBack={goBack} />;
		case 'run':
			return <RunSession sessionId={view.sessionId} onBack={goBack} />;
		case 'review':
			return <Review sessionId={view.sessionId} />;
		case 'preview':
			return <Preview sessionId={view.sessionId} onBack={goBack} />;
		case 'goals':
			return <Goals />;
		case 'run-new':
			return <RunEditor />;
		case 'run-edit':
			return <RunEditor sessionId={view.sessionId} />;
		case 'plan':
			return <Plan />;
		case 'history':
			return <History />;
		case 'generate':
			return <Generate />;
		default:
			return <Today />;
	}
}
