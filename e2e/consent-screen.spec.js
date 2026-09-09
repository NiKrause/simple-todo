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

	test('says what this chapter does to your data, in plain words', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const statement = (await clauses(page)).join(' ');

		// Both kinds of list, because naming only one would be false either way.
		expect(statement).toContain('three Spanish words');
		expect(statement).toContain('A passkey says who wrote something');

		// And the sentence this chapter exists to make people read: a passkey
		// proves authorship and protects nothing. The three words are still
		// enough to read everything, including for the relay that stores it.
		expect(statement).toContain('does not make it private');
		expect(statement).toContain('nothing here is encrypted');
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
			expect(statement).toContain('nichts verschlüsselt');
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
