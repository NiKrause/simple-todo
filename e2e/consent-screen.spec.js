import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import {
	acceptNotice,
	consentModal,
	isConsentOpen,
	passConsent,
	waitForConsent
} from './consent.mjs';

const timeout = 30000;

/**
 * The statement the dialog assembles, read from the element's shadow tree.
 *
 * @param {import('@playwright/test').Page} page
 */
const clauses = (page) =>
	page.$$eval('[data-testid="consent-modal"]', (els) =>
		[...(els[0].shadowRoot?.querySelectorAll('.privacy ul li') ?? [])].map(
			(item) => item.textContent?.trim() ?? ''
		)
	);

/** The English catalogue, which mirrors the element's own defaults. */
const en = JSON.parse(
	readFileSync(fileURLToPath(new URL('../src/lib/i18n/en.json', import.meta.url)), 'utf8')
);

test.describe('Consent screen', () => {
	test('will not let you out until the statement is accepted', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toBeDisabled();

		await acceptNotice(page);
		await expect(proceed).toBeEnabled();

		await proceed.click();
		expect(await isConsentOpen(page)).toBe(false);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	});

	test('names the requirement that is actually holding the button', async ({ page }) => {
		// One label for two blockers sent people to a field that was already
		// filled: the mnemonic arrives generated and valid, so what holds the
		// button is the tick further down.
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveText('Confirm the notice first');

		await page.getByTestId('shared-list-mnemonic-input').fill('not a mnemonic at all');
		await expect(proceed).toHaveText('Enter three Spanish words to continue');

		await page.getByTestId('shared-list-mnemonic-input').fill('brisa-arena-sal');
		await acceptNotice(page);
		await expect(proceed).toHaveText('Open shared list');
		await expect(proceed).toBeEnabled();
	});

	test('a failed start is readable, not hidden behind the dialog it reopens', async ({ page }) => {
		// Every failure in the proceed handler reopens the dialog, and the alert
		// it sets renders in <main> — behind it. The consent screen coming back
		// with nothing to read was the app's whole failure signal.
		await page.goto('/');
		await waitForConsent(page);

		// Nothing was ever registered in this profile, so recovery cannot succeed.
		await page.getByTestId('identity-mode-existing').check();
		await acceptNotice(page);
		await page.getByTestId('consent-proceed').click();

		const alert = page.getByTestId('consent-error');
		await expect(alert).toBeVisible({ timeout });
		await expect(alert).toContainText('No passkey is stored in this browser');
		// The message a person can act on, not the one about the network stack.
		await expect(alert).not.toContainText('P2P');
		expect(await isConsentOpen(page)).toBe(true);

		// And it is on top of the dialog, not merely present in the document.
		const onTop = await alert.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
			return el === hit || el.contains(hit);
		});
		expect(onTop).toBe(true);
	});

	test('hands the element every string it has, in the language on screen', async ({ browser }) => {
		// The app used to pass three of the element's thirty-four strings, so the
		// rest stayed on its English defaults and the dialog mixed languages in
		// adjacent lines. Two failures are possible and both are silent, so both
		// are asserted: a key the element grew that this app does not translate,
		// and a key whose German is missing — `svelte-i18n` then falls back to
		// English, which looks like a decision rather than a hole.
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();
		await page.goto('/');
		await waitForConsent(page);

		const keys = await page.evaluate(() =>
			Object.keys(document.querySelector('[data-testid="consent-modal"]').strings)
		);

		const supplied = new Set([
			...Object.keys(en.consent.element),
			// Renamed on the way in, because this app already had names for them.
			'title',
			'close',
			'dontShow',
			// Functions of a count, so they cannot travel in the plain map.
			'relayReachable',
			'relayDiscovered',
			'technical'
		]);
		expect(keys.filter((key) => !supplied.has(key))).toEqual([]);

		const stillEnglish = await page.evaluate((defaults) => {
			const host = document.querySelector('[data-testid="consent-modal"]');
			const shown = `${host.shadowRoot?.textContent ?? ''} ${document.body.textContent ?? ''}`;
			return Object.entries(defaults)
				.filter(([, value]) => typeof value === 'string' && value.length > 20)
				.filter(([, value]) => shown.includes(value))
				.map(([key]) => key);
		}, en.consent.element);
		expect(stillEnglish).toEqual([]);

		await context.close();
	});

	test('says what this chapter does to your data, in plain words', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const statement = (await clauses(page)).join(' ');

		// Both kinds of list, because naming only one would be false either way.
		expect(statement).toContain('three Spanish words');
		expect(statement).toContain('encrypted');

		// And the two limits that matter more than the reassurance: where the key
		// lives, and that handing it over cannot be undone. A consent screen that
		// says "encrypted" and stops there promises more than this chapter keeps.
		expect(statement).toContain('kept in this browser');
		expect(statement).toContain('cannot be taken back');
	});

	test('rewrites the line a choice changes, and only that line', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const before = await clauses(page);
		await page.getByTestId('identity-mode-create').check();
		await expect
			.poll(async () => (await clauses(page)).filter((c, i) => c !== before[i]).length)
			.toBe(1);
	});

	test('offers the technical view beside the plain one', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const isTechnical = () =>
			page.$eval('[data-testid="consent-modal"]', (el) => el.technical === true);

		expect(await isTechnical()).toBe(false);
		await page.getByTestId('consent-technical').click();
		await expect.poll(isTechnical).toBe(true);
	});

	test('on a phone, the acceptance tick is reachable from the foot', async ({ browser }) => {
		// The dialog's body scrolls and its foot does not, so the tick that the
		// button names can sit a screen and a half above the fold while the
		// button naming it is in view.
		const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		await page.goto('/');
		await waitForConsent(page);

		const tickBox = () =>
			page.$eval('[data-testid="consent-modal"]', (el) => {
				const tick = el.shadowRoot?.querySelector('input[part=accept]');
				const box = tick.getBoundingClientRect();
				return { top: box.top, onScreen: box.top >= 0 && box.bottom <= window.innerHeight };
			});

		expect((await tickBox()).onScreen).toBe(false);
		await page.getByTestId('consent-show-notice').click();
		await expect.poll(async () => (await tickBox()).onScreen).toBe(true);

		await context.close();
	});

	test('the close control that does nothing is not on screen', async ({ page }) => {
		// The element disables its own close on purpose — this dialog is a
		// decision, not something to dismiss. A visible cross that does nothing,
		// in the corner people reach for to get out, is worse than no cross.
		await page.goto('/');
		await waitForConsent(page);

		const dead = await page.$eval('[data-testid="consent-modal"]', (el) => {
			const control = el.shadowRoot?.querySelector('button[disabled]');
			return control ? { hidden: control.hidden, aria: control.getAttribute('aria-hidden') } : null;
		});
		expect(dead).toEqual({ hidden: true, aria: 'true' });
	});

	test('build metadata waits in the technical view', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		await expect(page.getByTestId('consent-version')).toHaveCount(0);
		await page.getByTestId('consent-technical').click();
		await expect(page.getByTestId('consent-version')).toBeVisible();
	});

	test('the technical view answers about this chapter, not about NAT', async ({ page }) => {
		// The switch used to reveal the element's own four bullets — phones
		// closing invites, Chrome on Android and IPv6, carrier NAT, VPNs. All
		// true, all about whether two browsers can reach each other, and none of
		// it what somebody flips this switch to find out here.
		await page.goto('/');
		await waitForConsent(page);
		await page.getByTestId('consent-technical').click();

		const bullets = await page.$eval('[data-testid="consent-modal"]', (el) =>
			[...(el.shadowRoot?.querySelectorAll('.tech li') ?? [])].map((li) => li.textContent ?? '')
		);
		const chapter = bullets.join(' ');

		// The four questions this chapter is actually asked about.
		expect(chapter).toContain('did:key');
		expect(chapter).toContain('AES-GCM-256');
		expect(chapter).toContain('ECDH P-256');
		expect(chapter).toContain('privacy01.dbKey');

		// And the element's network bullets are gone from it.
		expect(chapter).not.toContain('carrier NAT');
		expect(chapter).not.toContain('Chrome on Android');
	});

	test('speaks German to a German browser', async ({ browser }) => {
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();

		try {
			await page.goto('/');
			await waitForConsent(page);

			const statement = (await clauses(page)).join(' ');
			expect(statement).toContain('Wir betreiben keinen Server');
			expect(statement).toContain('verschlüsselt');
			// Not a single English clause left behind: a half-translated statement
			// reads as a decision rather than an omission.
			expect(statement).not.toContain('We run no server');
		} finally {
			await context.close();
		}
	});

	test('remembers the decision when asked to', async ({ page }) => {
		await page.goto('/');
		await passConsent(page, { remember: true });

		const savedMnemonic = await page.evaluate(() =>
			localStorage.getItem('simpleTodo.sharedListMnemonic.v1')
		);
		expect(savedMnemonic).toMatch(/^.+-.+-.+$/);

		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
		await page.reload();

		// The dialog is asked, not measured: the host is 0x0 once it upgrades.
		await page.waitForTimeout(3000);
		expect(await isConsentOpen(page)).toBe(false);

		const sharedListDetails = page.getByTestId('shared-list-details');
		await expect(sharedListDetails).toBeVisible({ timeout });
		await sharedListDetails.getByText('Shared list', { exact: true }).click();
		await expect(sharedListDetails.getByTestId('active-shared-list-name')).toHaveText(
			savedMnemonic ?? ''
		);

		await page.evaluate(() => localStorage.clear());
	});
});

// `consentModal` is exported for specs that need the host itself; referenced
// here so the import stays honest about what this file uses.
void consentModal;
