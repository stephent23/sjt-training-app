// Local-first write queue. A logged set is already safe (in localStorage,
// rendered on screen) before this ever talks to the network. Failures just
// leave the write queued for the next trigger — nothing is lost.

interface QueuedWrite {
	id: string;
	url: string;
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

export function enqueue(url: string, body: unknown): void {
	const queue = readQueue();
	queue.push({ id: crypto.randomUUID(), url, body, createdAt: Date.now() });
	writeQueue(queue);
	void flush();
}

export function pendingCount(): number {
	return readQueue().length;
}

let flushing = false;

export async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		let queue = readQueue();
		while (queue.length > 0) {
			const next = queue[0];
			try {
				const res = await fetch(next.url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(next.body),
				});
				if (!res.ok) throw new Error(`sync failed: ${res.status}`);
			} catch {
				break; // network's down or the worker's unhappy — stop and retry later
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
