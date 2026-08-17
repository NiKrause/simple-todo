import { test, expect } from '@playwright/test';
import { todoInput, openListTab } from './open-app.mjs';
import { SITE_TODOS } from '../src/lib/site-todos.js';

// The chapter's premise, tested rather than asserted in a README.
//
// Everything else here runs against a dev/preview server that is always
// reachable, so "works with no internet" was a claim about a service worker
// nobody had ever taken offline. It was written, emitted into the build and
// registered — and that is exactly as far as the evidence went.
//
// Two failure modes only appear on a *document* request, which is why the
// reload matters and why an in-page click would miss both:
//
//   - the document never being precached, which hides behind the fetch handler
//     caching it on the first online visit;
//   - the cache key not matching the URL actually requested. This chapter
//     documents `?ice=host`, and a lookup comparing the whole URL misses every
//     entry the moment that parameter is present.

const timeout = 90_000;

test.describe('offline PWA', () => {
	test('the app opens with the network gone, with and without a query string', async ({
		page,
		context
	}) => {
		test.setTimeout(timeout * 2);

		await page.goto('/');
		await expect(todoInput(page)).toBeVisible({ timeout });

		// Controlled, not merely registered: an installed-but-not-controlling
		// worker answers nothing, and the difference is invisible while online.
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
			timeout
		});

		// The install precaches; give it the moment it needs before pulling the
		// plug, or this tests the fetch handler's leftovers instead.
		await page.waitForFunction(
			async () => {
				const keys = await caches.keys();
				if (!keys.length) return false;
				const cache = await caches.open(keys[0]);
				return (await cache.keys()).length > 0;
			},
			undefined,
			{ timeout }
		);

		await context.setOffline(true);

		// 1. A plain reload with no network at all.
		await page.reload();
		await expect(todoInput(page)).toBeVisible({ timeout });

		// 2. The same, carrying the query string the chapter tells people to use
		//    on a site with no uplink.
		await page.goto('/?ice=host');
		await expect(todoInput(page)).toBeVisible({ timeout });
		await expect(page).toHaveURL(/\?ice=host/);

		// What this does NOT prove, stated rather than implied: that the worker's
		// `ignoreSearch` is what served it.
		//
		// Removing that option left this test green. The navigation fallback
		// catches the query URL and returns the shell anyway, so the two paths
		// are indistinguishable from here — one layer covering the next, which
		// is how this family of bugs stays invisible.
		//
		// `ignoreSearch` is therefore defensive rather than load-bearing in this
		// chapter, and is kept for the case the fallback does not cover: a
		// sub-resource carrying a query, and any later chapter with more than one
		// route, where answering every navigation with the start page would be
		// wrong. It is not claimed to be tested, because it is not.

		// The app is genuinely running, not a cached shell that renders and then
		// dies: the transfer panel only exists once the client has booted.
		await expect(page.getByTestId('qr-transfer')).toBeVisible({ timeout });

		await context.setOffline(false);
	});

	test('todos survive an offline reload', async ({ page, context }) => {
		test.setTimeout(timeout * 2);

		// The question the other two tests only answer separately. One shows the
		// shell opening with no network; the other shows OrbitDB data surviving a
		// reload while a (peerless) network is still up. Neither shows both at
		// once, and "obviously it follows" is how tonight's other bugs got in.
		await page.goto('/');
		await expect(todoInput(page)).toBeVisible({ timeout });
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
			timeout
		});

		await openListTab(page, 'create');
		await page.getByTestId('new-list-seed-site').click();
		await expect(page.getByTestId('new-list-created')).toBeVisible({ timeout });
		await expect(page.getByText(SITE_TODOS[0], { exact: true })).toBeVisible({ timeout });
		const address = await page.evaluate(() => window.__simpleTodoE2E.getDatabaseAddress());

		await context.setOffline(true);
		await page.reload();
		await expect(todoInput(page)).toBeVisible({ timeout });

		// The app opens its default list on mount, so reopen the one just made —
		// the way a person would, and the only way that proves the blocks came
		// off this device rather than the shell merely rendering.
		await openListTab(page, 'create');
		await expect(page.getByTestId('list-switcher')).toBeVisible({ timeout });
		await page.locator(`[data-testid="list-switcher-open"][data-address="${address}"]`).click();

		for (const todo of SITE_TODOS) {
			await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });
		}
		expect(await page.evaluate(() => window.__simpleTodoE2E.getConnectedPeerIds())).toEqual([]);

		await context.setOffline(false);
	});

	test('the document itself is precached, not merely fetched on the way past', async ({ page }) => {
		test.setTimeout(timeout);

		await page.goto('/');
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, {
			timeout
		});

		// Distinguishes a real precache from a lucky first visit. `prerendered`
		// was missing from the install list at first, and nothing showed it:
		// the page still opened offline because the fetch handler had stored it
		// on the way through.
		const precachedDocument = await page.waitForFunction(
			async () => {
				const keys = await caches.keys();
				for (const key of keys) {
					const cache = await caches.open(key);
					const entries = await cache.keys();
					const hit = entries.find((request) => {
						const path = new URL(request.url).pathname;
						return path === '/' || path.endsWith('.html');
					});
					if (hit) return new URL(hit.url).pathname;
				}
				return false;
			},
			undefined,
			{ timeout }
		);

		expect(await precachedDocument.jsonValue()).toBeTruthy();
	});
});
