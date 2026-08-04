// Local-first write queue. A logged set is already safe (in localStorage,
// rendered on screen) before this ever talks to the network. Failures just
// leave the write queued for the next trigger — nothing is lost.

interface QueuedWrite {
	id: string;
	url: string;
	method: 'POST' | 'PATCH' | 'PUT';
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

export function enqueue(url: string, body: unknown, method: 'POST' | 'PATCH' | 'PUT' = 'POST'): void {
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

// Holds the in-flight run, not just a boolean. A concurrent caller gets that
// same promise back rather than a no-op resolved one, so `await flush()`
// always means "the queue has been drained as far as it can be" instead of
// sometimes meaning "someone else is doing it, good luck". Still exactly one
// drain loop at a time — the promise is shared, not a second run.
let flushing: Promise<void> | null = null;

export function flush(): Promise<void> {
	if (flushing) return flushing;
	flushing = drain().finally(() => {
		flushing = null;
	});
	return flushing;
}

async function drain(): Promise<void> {
	// The queue is re-read from storage on every iteration, and the item just
	// handled is removed BY ID rather than by position.
	//
	// Both of those matter, and neither is theoretical. enqueue() appends while
	// a flush is in flight (logging set 2 while set 1's POST is still going),
	// and enqueue's own `void flush()` returns the run already in progress — so
	// this loop is the only thing that will ever send those later items.
	// Working from a snapshot taken at entry meant they were not merely skipped
	// but actively destroyed: the loop wrote its own shortened copy of the
	// stale snapshot back over a localStorage value that had since grown,
	// silently deleting every set logged during the flush.
	for (;;) {
		const queue = readQueue();
		if (queue.length === 0) return;

		const next = queue[0];
		let res: Response;
		try {
			res = await fetch(next.url, {
				method: next.method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(next.body),
			});
		} catch {
			return; // network's down — stop and retry later, item stays queued
		}

		if (!res.ok) {
			if (res.status >= 400 && res.status < 500) {
				// Permanently invalid request (e.g. a validation bug) — retrying
				// forever would just block every later write behind it. Drop it,
				// but make sure it's visible.
				console.error(`sync: dropping request that the server rejected (${res.status}): ${next.method} ${next.url}`);
			} else {
				return; // 5xx — the worker's unhappy, stop and retry later
			}
		}

		writeQueue(readQueue().filter((item) => item.id !== next.id));
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => void flush());
	window.addEventListener('focus', () => void flush());
}
