// Local-first write queue. A logged set is already safe (in localStorage,
// rendered on screen) before this ever talks to the network. Failures just
// leave the write queued for the next trigger — nothing is lost.

interface QueuedWrite {
	id: string;
	url: string;
	method: 'POST' | 'PATCH';
	body: unknown;
	createdAt: number;
}

const QUEUE_KEY = 'ta:queue';

function readQueue(): QueuedWrite[] {
	try {
		const raw = localStorage.getItem(QUEUE_KEY);
		return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
	} catch {
		return [];
	}
}

function writeQueue(queue: QueuedWrite[]): void {
	localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): void {
	const queue = readQueue();
	queue.push({ id: crypto.randomUUID(), url, method, body, createdAt: Date.now() });
	writeQueue(queue);
	void flush();
}

// With no prefix: total queue length (a general "still syncing" indicator).
// With a prefix (e.g. `/api/sessions/42/`): count scoped to that session, so
// a stuck write for one session doesn't make an unrelated session's screen
// think ITS writes are still in flight.
export function pendingCount(urlPrefix?: string): number {
	const queue = readQueue();
	if (urlPrefix === undefined) return queue.length;
	return queue.filter((item) => item.url.startsWith(urlPrefix)).length;
}

let flushing = false;

export async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		let queue = readQueue();
		while (queue.length > 0) {
			const next = queue[0];
			let res: Response;
			try {
				res = await fetch(next.url, {
					method: next.method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(next.body),
				});
			} catch {
				break; // network's down — stop and retry later, item stays queued
			}
			if (!res.ok) {
				if (res.status >= 400 && res.status < 500) {
					// Permanently invalid request (e.g. a validation bug) — retrying
					// forever would just block every later write behind it. Drop it,
					// but make sure it's visible.
					console.error(`sync: dropping request that the server rejected (${res.status}): ${next.method} ${next.url}`);
				} else {
					break; // 5xx — the worker's unhappy, stop and retry later
				}
			}
			queue = queue.slice(1);
			writeQueue(queue);
		}
	} finally {
		flushing = false;
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => void flush());
	window.addEventListener('focus', () => void flush());
}
