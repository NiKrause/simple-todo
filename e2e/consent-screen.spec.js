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
