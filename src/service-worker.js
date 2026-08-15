/// <reference types="@sveltejs/kit" />
import { build, files, prerendered, version } from '$service-worker';

// Serving the app itself without a network.
//
// The data half already works: with the IndexedDB storage choice, todos, log
// and blocks are all local. What was missing is the shell — every load fetched
// the HTML and JS over HTTP, so a browser with no connection got nothing to run
// and the local data was unreachable. #144 asked for a reload that finds a todo
// offline and could not have it; its e2e had to cut the network *after* the app
// had started instead.
//
// Deliberately not a caching framework. Two rules, because this app only has
// two kinds of same-origin request.

const CACHE = `simple-todo-${version}`;

// `build` is hashed and immutable, `files` is everything in static/ — icons,
// the web app manifest, robots.txt — and `prerendered` is the HTML itself.
// Leaving that last one out is what made the first attempt fail with
// ERR_FAILED: the worker was installed and controlling the page, but had no
// document to answer a navigation with.
//
// All three are safe to serve from cache indefinitely: a new deployment changes
// `version`, which changes the cache name, and the old one is deleted below.
const PRECACHE = [...build, ...files, ...prerendered];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			// Take over straight away rather than waiting for every tab to close.
			// The alternative leaves a user who just reloaded staring at the old
			// build with no way to know why, and there is no cross-tab state here
			// that a version skew could corrupt — the data lives in IndexedDB and
			// is read through whichever build is running.
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only GET can be replayed from a cache. And only our own origin: the app
	// talks to Aleph, IPFS gateways and relays, and a service worker that
	// answered for those would be caching other people's data and hiding real
	// network failures from code that handles them.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Hashed build assets never change under the same name, so the cache is
			// authoritative and going to the network first would only add latency.
			if (PRECACHE.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(request);
				// Opaque and error responses are not worth keeping; caching a 404
				// would make it permanent for this version.
				if (response.status === 200 && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch (error) {
				const cached = await cache.match(request);
				if (cached) return cached;

				// A navigation with nothing cached for that exact URL still has to
				// render something: this app is a single prerendered page, so the
				// entry the precache does hold is the right answer for any route.
				if (request.mode === 'navigate') {
					const shell = await cache.match('/');
					if (shell) return shell;
				}

				throw error;
			}
		})()
	);
});
