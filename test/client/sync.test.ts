import { beforeEach, describe, expect, it, vi } from 'vitest';

// sync.ts registers window listeners and reads localStorage at import time,
// so each test gets a fresh module instance with a clean store.
async function freshSync() {
	localStorage.clear();
	vi.resetModules();
	return import('../../src/client/sync');
}

function queued(): { url: string; method: string; body: unknown }[] {
	return JSON.parse(localStorage.getItem('ta:queue') ?? '[]');
}

function okResponse(): Response {
	return new Response('{}', { status: 200 });
}

function errorResponse(status: number): Response {
	return new Response('{}', { status });
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('enqueue', () => {
	it('persists the write to localStorage before any network call, so a set survives a crash mid-flush', async () => {
		// Never resolves: the write must already be durable regardless.
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
		const { enqueue } = await freshSync();

		enqueue('/api/sessions/1/sets', { reps: 8 });

		expect(queued()).toHaveLength(1);
		expect(queued()[0].url).toBe('/api/sessions/1/sets');
	});

	it('defaults to POST but honours an explicit method', async () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
		const { enqueue } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		enqueue('/api/sessions/1/feedback', {}, 'PUT');

		expect(queued().map((q) => q.method)).toEqual(['POST', 'PUT']);
	});
});

describe('flush', () => {
	it('drains the queue in FIFO order', async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				seen.push(url);
				return okResponse();
			}),
		);
		const { enqueue, flush } = await freshSync();

		enqueue('/first', {});
		enqueue('/second', {});
		enqueue('/third', {});
		await flush();

		expect(seen).toEqual(['/first', '/second', '/third']);
		expect(queued()).toHaveLength(0);
	});

	// Regression: flush() used to snapshot the queue once at entry and then
	// write `snapshot.slice(1)` back to localStorage. Anything enqueued while a
	// request was in flight was therefore overwritten by that stale snapshot —
	// logging two sets in quick succession silently destroyed the second.
	it('does not lose writes enqueued while a request is already in flight', async () => {
		const seen: string[] = [];
		let releaseFirst: (() => void) | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				seen.push(url);
				if (url === '/first') await new Promise<void>((resolve) => (releaseFirst = resolve));
				return okResponse();
			}),
		);
		const { enqueue, flush } = await freshSync();

		enqueue('/first', {}); // starts a flush that parks inside fetch
		const draining = flush();
		enqueue('/second', {}); // arrives mid-flight
		enqueue('/third', {});

		releaseFirst!();
		await draining;
		await flush();

		expect(seen).toEqual(['/first', '/second', '/third']);
		expect(queued()).toHaveLength(0);
	});

	it('stops on a network failure and leaves the item queued for a later retry', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		const { enqueue, flush } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		await flush();

		expect(queued()).toHaveLength(1);
	});

	it('stops on a 5xx and leaves the item queued — the worker being unhappy is not the write being wrong', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => errorResponse(500)));
		const { enqueue, flush } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		await flush();

		expect(queued()).toHaveLength(1);
	});

	it('DROPS a 4xx rather than retrying forever, so one bad write cannot block every later one', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => (url === '/bad' ? errorResponse(400) : okResponse())),
		);
		const { enqueue, flush } = await freshSync();

		enqueue('/bad', {});
		enqueue('/good', {});
		await flush();

		// Both leave the queue: the 400 is discarded, the good one succeeds.
		expect(queued()).toHaveLength(0);
	});

	it('logs a dropped 4xx to console.error rather than failing silently', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn(async () => errorResponse(422)));
		const { enqueue, flush } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		await flush();

		expect(consoleError).toHaveBeenCalledOnce();
	});

	it('a blocked item stops the ones behind it from being sent at all (order is preserved, not skipped)', async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				seen.push(url);
				return url === '/blocker' ? errorResponse(503) : okResponse();
			}),
		);
		const { enqueue, flush } = await freshSync();

		enqueue('/blocker', {});
		enqueue('/behind-it', {});
		await flush();

		expect(seen).toEqual(['/blocker']);
		expect(queued().map((q) => q.url)).toEqual(['/blocker', '/behind-it']);
	});

	it('is re-entrant-safe: a second concurrent flush does not double-send', async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				seen.push(url);
				await new Promise((r) => setTimeout(r, 5));
				return okResponse();
			}),
		);
		const { enqueue, flush } = await freshSync();

		enqueue('/only-once', {});
		await Promise.all([flush(), flush()]);

		expect(seen).toEqual(['/only-once']);
	});

	it('recovers from corrupted localStorage instead of throwing', async () => {
		localStorage.setItem('ta:queue', 'not json');
		vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
		vi.resetModules();
		const { pendingCount, flush } = await import('../../src/client/sync');

		expect(pendingCount()).toBe(0);
		await expect(flush()).resolves.toBeUndefined();
	});
});

describe('pendingCount', () => {
	it('counts the whole queue with no prefix', async () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
		const { enqueue, pendingCount } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		enqueue('/api/sessions/2/sets', {});

		expect(pendingCount()).toBe(2);
	});

	it('scopes to a prefix so one session’s stuck write does not make another session look unsynced', async () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
		const { enqueue, pendingCount } = await freshSync();

		enqueue('/api/sessions/1/sets', {});
		enqueue('/api/sessions/2/sets', {});
		enqueue('/api/sessions/2/status', {}, 'PATCH');

		expect(pendingCount('/api/sessions/1/')).toBe(1);
		expect(pendingCount('/api/sessions/2/')).toBe(2);
		expect(pendingCount('/api/sessions/3/')).toBe(0);
	});
});
