import { test, expect } from '@playwright/test';
import { acceptNotice, consentModal, isAccepted, waitForConsent } from './consent.mjs';

test.describe('Consent Screen', () => {
	test('should display consent modal and allow proceeding after checking all boxes', async ({
		page
	}) => {
		await page.goto('/');

		// Check that the consent modal is visible
		await waitForConsent(page);
		const modal = consentModal(page);

		// The title is the element's own heading, in its shadow tree.
		expect(
			await page.evaluate(
				() =>
					document.querySelector('[data-testid="consent-modal"]').shadowRoot.querySelector('h2')
						?.textContent
			)
		).toContain('Simple-Todo');

		// One gate, where three acknowledgements used to be. Those confirmed
		// sentences this dialog had just asserted, and a tick against a line
		// somebody has read confirms only that they can read.
		// The acceptance tick is the element's, in its shadow tree.
		expect(await isAccepted(page)).toBe(false);

		// The storage choice replaced the fourth acknowledgement. It is a choice,
		// not a confirmation: it starts on the safe side and must never gate the
		// proceed button, so ticking nothing here still lets a user continue.
		const memoryOption = page.getByTestId('consent-storage-memory');
		const indexedDbOption = page.getByTestId('consent-storage-indexeddb');
		await expect(memoryOption).toBeChecked();
		await expect(indexedDbOption).not.toBeChecked();

		// Check that the proceed button is disabled initially
		const proceedButton = page.locator('button').filter({ hasText: /Please accept to continue/ });
		await expect(proceedButton).toBeDisabled();

		await acceptNotice(page);
		expect(await isAccepted(page)).toBe(true);

		// Check that the proceed button is now enabled and text changed
		const enabledProceedButton = page
			.locator('button')
			.filter({ hasText: /Proceed to Test the App/ });
		await expect(enabledProceedButton).toBeEnabled();

		// Click the proceed button
		await enabledProceedButton.click();

		// Wait for modal to close and main app to be visible
		await expect(modal).not.toBeVisible();

		// Check that the main app content is now visible (outside the modal)
		await expect(page.locator('main h1').filter({ hasText: 'Simple-Todo' })).toBeVisible();

		// Check for the loading spinner or main app content
		const loadingSpinner = page.locator('text=Initializing P2P connection');
		const addTodoForm = page.getByRole('textbox', { name: 'What needs to be done?' });

		// Either loading spinner should be visible, or the todo form should be visible
		await expect(loadingSpinner.or(addTodoForm)).toBeVisible();
	});

	test('should remember consent decision when checkbox is checked', async ({ page }) => {
		await page.goto('/');

		// Check the "Don't show this again" checkbox
		const rememberCheckbox = page
			.locator('label')
			.filter({ hasText: /Don't show this again/ })
			.locator('input[type="checkbox"]');
		await rememberCheckbox.check();

		// Check all required consent checkboxes
		await acceptNotice(page);

		// Click proceed
		const proceedButton = page.locator('button').filter({ hasText: /Proceed to Test the App/ });
		await proceedButton.click();

		// Wait for the app to load
		await page.waitForTimeout(2000);

		// Reload the page
		await page.reload();

		// The consent modal should not appear again
		const modal = page.getByTestId('consent-modal');
		await expect(modal).not.toBeVisible({ timeout: 5000 });

		// Clean up localStorage for next test
		await page.evaluate(() => {
			localStorage.clear();
		});
	});

	test('should display all required consent information', async ({ page }) => {
		await page.goto('/');

		// What the notice itself still lists. The privacy sentences moved into the
		// panel the element draws beside it - they are clauses now, assembled from
		// the choices, and asserted where they live rather than here.
		const expectedFeatures = [
			'No tracking cookies are used',
			'only that consent choice is saved locally',
			'connects to relay/bootstrap nodes and other peers'
		];

		for (const feature of expectedFeatures) {
			await expect(
				page
					.locator('li')
					.filter({ hasText: new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
			).toBeVisible();
		}
	});

	test('says it is a demonstration, without frightening anybody off', async ({ page }) => {
		await page.goto('/');
		// It is a demonstration and saying so is fair. A warning that sends people
		// away is not a warning, it is a door - so this asserts the words are there
		// and that they are the calm ones.
		const warning = page.getByTestId('consent-warning');
		await expect(warning).toBeVisible();
		await expect(warning).toContainText('working demonstration');
		await expect(warning).toContainText('somewhere else as well');
	});

	test('the relay sentences appear with the relay, and not without it', async ({ page }) => {
		// Telling somebody their browser connects to relay nodes, in an app they
		// have just switched the relay off in, describes a different app than the
		// one they chose.
		await page.goto('/');

		const relayToggle = page.getByTestId('consent-relay-network');
		await expect(relayToggle).toBeChecked();
		await expect(page.getByTestId('consent-relay-feature').first()).toBeVisible();

		await relayToggle.uncheck();
		await expect(page.getByTestId('consent-relay-feature')).toHaveCount(0);

		await relayToggle.check();
		await expect(page.getByTestId('consent-relay-feature').first()).toBeVisible();
	});
});
