import { test, expect } from '@playwright/test';
import { consentModal, privacyClauses, passConsent } from './consent.mjs';

/**
 * The app in German.
 *
 * Everything else in this suite runs in English, which is the default and
 * therefore proves nothing about the half that was added — a catalogue can be
 * complete and still reach no component, and the failure looks like a working
 * app to anybody testing in English.
 *
 * The surface is checked past the dialog on purpose. Translating the consent
 * screen alone would leave a language switch that changes one page, which is
 * the outcome this was meant to avoid.
 */

const germanFirst = async (page) => {
	await page.addInitScript(() => {
		try {
			localStorage.setItem('simpleTodo.locale', 'de');
		} catch {
			/* storage blocked: the test below will say so plainly */
		}
	});
	await page.goto('/');
};

test.describe('German', () => {
	test('the dialog and the app behind it both follow the stored choice', async ({ page }) => {
		await germanFirst(page);

		// The dialog.
		await expect(consentModal(page).locator('dialog')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('consent-technical')).toHaveText('Technisch');
		await expect(privacyClauses(page).first()).toContainText('Wir betreiben keinen Server');
		await expect(privacyClauses(page).last()).toContainText('keine Tracking-Cookies');

		// And the app behind it, which is the half a dialog-only translation
		// would have left in English.
		await passConsent(page, { relay: false, persistent: false });
		await expect(page.getByRole('heading', { name: 'Neue Aufgabe' })).toBeVisible({
			timeout: 60_000
		});
		await expect(page.getByPlaceholder('Was ist zu tun?')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Hinzufügen' })).toBeVisible();
		await expect(page.getByText('Noch nichts da.', { exact: false })).toBeVisible();
	});

	test('the flag switches the language without a reload, and it survives one', async ({ page }) => {
		await page.goto('/');

		// English to begin with, since nothing is stored and the runner's browser
		// asks for English.
		await expect(page.getByTestId('consent-technical')).toHaveText('Technical');

		await consentModal(page).getByTestId('language-de').click();
		await expect(page.getByTestId('consent-technical')).toHaveText('Technisch');

		// The clauses are rebuilt by the element on every repaint, so they are the
		// part most likely to keep the language they were first painted in.
		await expect(privacyClauses(page).first()).toContainText('Wir betreiben keinen Server');

		await page.reload();
		await expect(page.getByTestId('consent-technical')).toHaveText('Technisch');
	});
});
