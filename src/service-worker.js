/// <reference types="@sveltejs/kit" />

/**
 * Offline support — a prerequisite for this chapter, not a nicety.
 *
 * `acl01` links `static/manifest.json`, which makes the app installable, and
 * stops there. An installed PWA without a service worker still fetches its
 * shell over the network on every launch, so on a construction site with no
 * internet Bob's phone gets a blank page and the scenario ends before the
 * first QR code is drawn. "Bob has the app already" only holds if the app can
 * open with nothing reachable.
 *
 * SvelteKit registers this file automatically when it exists. The build is
 * prerendered and client-rendered (`prerender = true`, `ssr = false`), so the
 * whole shell is static files and precaching it is enough — no server, which
 * is the point of the app anyway.
 */

import { build, files, version } from '$service-worker';

const CACHE = `qr01-${version}`;

// `build` is content-hashed, `files` is everything in static/. Both are known
// at build time, so the install can precache the entire app in one go.
const PRECACHE = [...build, ...files];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			// Take over without waiting for every old tab to close: a stale shell
			// talking to a fresh one is a worse failure than a reload.
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

	// Only GET is cacheable, and only our own origin is ours to serve. Anything
	// cross-origin — an Aleph API call, a STUN lookup's sibling traffic — goes
	// straight to the network untouched.
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Content-hashed build assets can never go stale under their own name,
			// so cache-first is both correct and the fastest path.
			if (build.includes(url.pathname)) {
				const hit = await cache.match(request);
				if (hit) return hit;
			}

			// Everything else — the shell, static files — is served from cache and
			// refreshed in the background. Network-first would be wrong here: on
			// the site there is no network, and waiting for it to time out is
			// exactly the delay this chapter cannot afford. Stale-while-revalidate
			// gives an instant offline launch and still picks up a new deployment
			// the next time the app is opened with a connection.
			const cached = await cache.match(request);
			const network = fetch(request)
				.then((response) => {
					if (response.ok) cache.put(request, response.clone());
					return response;
				})
				.catch(() => null);

			if (cached) {
				event.waitUntil(network);
				return cached;
			}

			const response = await network;
			if (response) return response;

			// Offline and never cached. For a navigation the prerendered entry is
			// still the right answer — the app routes on the client anyway.
			if (request.mode === 'navigate') {
				const shell = await cache.match('/');
				if (shell) return shell;
			}

			return new Response('Offline and not cached.', {
				status: 503,
				headers: { 'content-type': 'text/plain; charset=utf-8' }
			});
		})()
	);
});
