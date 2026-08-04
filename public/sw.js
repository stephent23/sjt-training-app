// Offline shell for the training log.
//
// The app was already local-first for WRITES (see src/client/sync.ts: logged
// sets land in localStorage and flush to the network later), but none of that
// helped if you couldn't load the page in the first place — which is exactly
// what happens in a basement gym. This caches the shell so the app opens and
// runs on a dead connection; the queued writes then sync when signal returns.
//
// Bump CACHE_VERSION whenever the shell assets change, so old caches are
// dropped on activate rather than serving a stale bundle forever.
const CACHE_VERSION = 'ta-shell-v1';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css'];

self.addEventListener('install', (event) => {
	// addAll fails the whole install if any asset 404s, which is what we want:
	// a half-cached shell is worse than none, because it half-works offline.
	event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// API responses are deliberately never cached. Serving a stale session or
	// a stale plan would be worse than an honest failure: useSession already
	// falls back to its own localStorage copy of the session and flags it as
	// "showing the last saved copy", which is accurate, whereas a cached API
	// response would look indistinguishable from fresh data.
	if (url.pathname.startsWith('/api/')) return;

	// Navigations: network first (so a deploy is picked up promptly), falling
	// back to the cached shell when offline. `not_found_handling:
	// single-page-application` means any client route returns index.html.
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error())));
		return;
	}

	// Static assets: cache first (they're content-stable between deploys),
	// but refresh the entry in the background so the next load gets any
	// update without ever blocking this one on the network.
	event.respondWith(
		caches.match(request).then((cached) => {
			const network = fetch(request)
				.then((response) => {
					if (response.ok) {
						const copy = response.clone();
						caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
					}
					return response;
				})
				.catch(() => cached ?? Response.error());
			return cached ?? network;
		}),
	);
});
