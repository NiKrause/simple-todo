import { test, expect } from '@playwright/test';
import { openReadyApp, pinTechnicalView, todoInput } from './open-app.mjs';
import { buildInviteLink } from '../src/lib/invite-link.js';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

// Chapter (qr01), issue #213: the app opened straight into a list, so a first
// visitor had no way to learn that it works without internet, what the codes
// are for, or why a hotspot helps.
//
// `intro: true` on every `openReadyApp` here is what makes these tests real —
// every other spec has the dialog pinned away, because it covers the page.
// `relay: false` for the same reason: every other spec seeds the relay opt-in
// to keep the connection it always had, and this is the one place where what an
// untouched start does is the subject rather than the setup.

const timeout = 90_000;

// The dialog is `<qr-intro>` from the transport package, so half of what these
// tests touch lives in its shadow root. Playwright's locators pierce an open
// one, and the element exposes the two checkboxes as parts precisely so nobody
// has to reach for "whichever input comes first" — which is how a hidden second
// box once silently broke "do not show again" upstream.
//
// What the app slots in keeps its own `data-testid`: those nodes are ours.
const intro = (page) => page.getByTestId('intro-dialog');
const shown = (page) => intro(page).locator('dialog');
const dontShow = (page) => intro(page).locator('input[part=dont-show]');
const verdictOf = (page) => intro(page).locator('.verdict');
const technicalOf = (page) => intro(page).locator('.tech');
const relayBox = (page) => intro(page).locator('input[part=relay-opt-in]');
const relayResult = (page) => intro(page).locator('.relay-result');

test.describe('the first-launch introduction', () => {
	test('appears once, and stays gone when dismissed for good', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, relay: false, timeout });
			await expect(shown(page)).toBeVisible({ timeout });

			// Dismissed without the checkbox: this visit only.
			await page.getByTestId('intro-close').click();
			await expect(shown(page)).toBeHidden();

			await page.reload();
			await expect(shown(page)).toBeVisible({ timeout });

			// Now for good.
			await dontShow(page).check();
			await page.getByTestId('intro-close').click();
			await expect(shown(page)).toBeHidden();

			await page.reload();
			await expect(todoInput(page)).toBeVisible({ timeout });
			await expect(shown(page)).toBeHidden();

			// Dismissing is not a one-way door.
			await page.getByTestId('intro-reopen').click();
			await expect(shown(page)).toBeVisible({ timeout });
		} finally {
			await context.close();
		}
	});

	test('speaks both languages and keeps the technical part behind the switch', async ({
		browser
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, relay: false, timeout });
			const dialog = intro(page);
			// The host element, not the dialog inside it: `<qr-intro>` puts its
			// `<dialog>` in the top layer, so the host itself has no box and never
			// counts as visible. It is still the right *scope* for the locators
			// below — which is why `shown()` exists separately.
			await expect(shown(page)).toBeVisible({ timeout });

			// Read off the button rather than the prose. The explanatory sentences
			// are the part most likely to be reworded, and a test that pins them
			// turns every copy edit into a failing test for no benefit; the button
			// label is short, language-specific and part of the contract.
			await dialog.getByTestId('language-de').click();
			await expect(dialog.getByTestId('intro-close')).toHaveText("Los geht's");
			await dialog.getByTestId('language-en').click();
			await expect(dialog.getByTestId('intro-close')).toHaveText('Get started');

			// The browser-and-NAT detail is for whoever asks for it.
			await expect(technicalOf(page)).toBeHidden();
			await dialog.getByTestId('view-mode-toggle').click();
			await expect(technicalOf(page)).toBeVisible();
			await expect(technicalOf(page)).toContainText('symmetric NAT');
			await expect(technicalOf(page)).toContainText('NymVPN');

			// The chips come with it, painted from the measurement the element
			// already made rather than from a probe of their own. Asserted because
			// the cheap mistake here is a second STUN wave nobody notices — and the
			// cheaper one is chips that stay empty because nobody handed them the
			// result.
			const chips = page.getByTestId('intro-network-chips');
			await expect(chips).toBeVisible();
			await expect(chips).toContainText(/IPv4|IPv6/, { timeout });
		} finally {
			await context.close();
		}
	});

	test('reaches a verdict about this network, and shows it is working meanwhile', async ({
		browser
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, relay: false, timeout });

			// The probe runs for up to six seconds, so "checking" has to be visible
			// and has to look like work rather than like a stall.
			const verdict = verdictOf(page);
			await expect(verdict).toBeVisible({ timeout });

			// Which verdict depends on the network running this, so the assertion is
			// that it *settles* — and on one of the states the element reports.
			// These are the element's three, not the four the probe distinguishes:
			// it folds `symmetric` and `blocked` into `unreliable` and `none`
			// because the advice for them is the same. `unreliable` on a mobile
			// network is a correct answer; the bug this replaced was reporting a
			// working network there, from host candidates every device always has.
			await expect(verdict).toHaveAttribute('data-state', /^(ok|unreliable|none)$/, {
				timeout
			});

			// The advice has to follow the verdict, not sit there regardless.
			// Telling somebody on a working network to install a VPN is the kind of
			// boilerplate that teaches people to skip the dialog.
			const state = await verdict.getAttribute('data-state');
			const advice = page.getByTestId('intro-vpn-advice');
			if (state === 'ok') {
				await expect(advice).toBeHidden();
			} else {
				await expect(advice).toBeVisible();
				await expect(advice.getByRole('link', { name: 'NymVPN' })).toHaveAttribute(
					'href',
					'https://nymvpn.com/'
				);
			}
		} finally {
			await context.close();
		}
	});

	test('stays out of the way of someone who followed a shared link', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			// That person came to accept a list. An introduction in front of it
			// would be between them and the only thing they arrived to do.
			const link = buildInviteLink('probe-payload', 'http://localhost/');
			const hash = new URL(link).hash;
			await openReadyApp(page, { url: `/${hash}`, intro: true, timeout });

			await expect(todoInput(page)).toBeVisible({ timeout });
			await expect(shown(page)).toBeHidden();
		} finally {
			await context.close();
		}
	});
});

test.describe('connecting through a relay', () => {
	// A relay is the second way in, for the case the QR path cannot serve —
	// the other person is not here to scan anything. It is off until asked for,
	// and the claim that goes with that is not a UI state: an untouched start
	// must not reach anybody. So this watches the wire, not the checkbox.

	test('an untouched start reaches nobody', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		/** @type {string[]} */
		const offOrigin = [];
		/** @type {string[]} */
		const sockets = [];
		// Compared against the configured preview origin rather than `page.url()`:
		// the listener also sees the requests made before navigation resolves,
		// when `page.url()` is still `about:blank` and every origin looks foreign.
		const ownOrigin = new URL(PREVIEW_ORIGIN).origin;
		page.on('request', (request) => {
			if (new URL(request.url()).origin !== ownOrigin) offOrigin.push(request.url());
		});
		page.on('websocket', (ws) => sockets.push(ws.url()));

		try {
			await openReadyApp(page, { intro: true, relay: false, timeout });

			const optIn = relayBox(page);
			await expect(optIn).toBeVisible({ timeout });
			await expect(optIn).not.toBeChecked();
			// No verdict line, because nothing was asked. An "unknown" here would
			// read as a failed check rather than a check that never ran.
			await expect(relayResult(page)).toBeHidden();

			// Give the app the same window a ticked box would have used.
			await page.waitForTimeout(5_000);

			// The relay is a websocket dial and Aleph discovery is an HTTPS request
			// to a foreign origin. Neither may have happened.
			expect(sockets, `dialled: ${sockets.join(', ')}`).toEqual([]);
			expect(offOrigin, `requested: ${offOrigin.join(', ')}`).toEqual([]);
		} finally {
			await context.close();
		}
	});

	test('ticking the box checks at once, and says what it found', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, relay: false, timeout });

			await relayBox(page).check();

			// Immediately, not on the next connection attempt. An opt-in whose
			// effect is invisible leaves the person guessing, which is the state
			// this replaces.
			const result = relayResult(page);
			await expect(result).toBeVisible({ timeout: 5_000 });

			// Which answer depends on what is reachable from here, so the assertion
			// is that it settles on one of them rather than staying on the spinner.
			await expect(result).toHaveAttribute('data-state', /^(baked|aleph|none)$/, { timeout });

			// And that it is remembered: the point of the switch is not having to
			// find it again.
			await page.reload();
			await expect(relayBox(page)).toBeChecked({ timeout });
		} finally {
			await context.close();
		}
	});
});

test.describe('the introduction as a modal', () => {
	test('while it is open nothing behind it can be reached, and afterwards everything can', async ({
		browser
	}) => {
		// The introduction is a <dialog> opened with showModal(): it sits in the
		// top layer and makes the rest of the document inert. That is right for an
		// introduction — it is the only thing on screen until somebody dismisses
		// it — and it is a stronger claim than the overlay it replaced, which only
		// covered the page and left what was under it clickable.
		//
		// It is pinned here because the difference is invisible until something
		// drives the app without dismissing the dialog first. When that happened
		// it cost a 50-minute test timeout in the relay provisioning suite, with
		// the widget mounted, reporting `wallet: null`, and nothing able to click
		// it.
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			// The relay button lives in the technical view, so pin it: this test is
			// about what the dialog does to the page beneath, not about which
			// controls that page shows.
			await pinTechnicalView(page);
			await openReadyApp(page, { intro: true, relay: false, timeout });
			await expect(shown(page)).toBeVisible({ timeout });

			const relayButton = page.getByTestId('relay-button-slot').locator('button').first();
			await expect(relayButton).toHaveCount(1);

			// A trial click resolves only if the element could actually be clicked.
			await expect(relayButton.click({ trial: true, timeout: 3_000 })).rejects.toThrow(/Timeout/);

			await page.getByTestId('intro-close').click();
			await expect(shown(page)).toBeHidden();

			// And the barrier is gone with it, rather than lingering as an inert
			// document nobody can use.
			await relayButton.click({ trial: true, timeout: 10_000 });
		} finally {
			await context.close();
		}
	});
});
