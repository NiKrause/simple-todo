import { test, expect } from '@playwright/test';

test.describe('Consent Screen', () => {
	test('should display consent modal and allow proceeding after checking all boxes', async ({
		page
	}) => {
		await page.goto('/');

		// Check that the consent modal is visible
		const modal = page.locator('div.fixed.inset-0.z-50');
		await expect(modal).toBeVisible();

		// Check that the title is present in the modal
		await expect(modal.locator('h1').filter({ hasText: 'Simple TODO Example' })).toBeVisible();

		// Check that all required checkboxes are present and initially unchecked
		const relayConnectionCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand this app uses libp2p peer-to-peer networking/ })
			.locator('input[type="checkbox"]');
		const dataVisibilityCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand relay or peer nodes may cache/ })
			.locator('input[type="checkbox"]');
		const globalDatabaseCheckbox = page
			.locator('label')
			.filter({
				hasText: /I understand todos are stored in a shared, unencrypted OrbitDB database/
			})
			.locator('input[type="checkbox"]');
		const replicationTestingCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand collaboration requires another browser or device/ })
			.locator('input[type="checkbox"]');

		// Verify all checkboxes are unchecked initially
		await expect(relayConnectionCheckbox).not.toBeChecked();
		await expect(dataVisibilityCheckbox).not.toBeChecked();
		await expect(globalDatabaseCheckbox).not.toBeChecked();
		await expect(replicationTestingCheckbox).not.toBeChecked();

		// Check that the proceed button is disabled initially
		const proceedButton = page
			.locator('button')
			.filter({ hasText: /Please check all boxes to continue/ });
		await expect(proceedButton).toBeDisabled();

		// Check each required checkbox
		await relayConnectionCheckbox.check();
		await dataVisibilityCheckbox.check();
		await globalDatabaseCheckbox.check();
		await replicationTestingCheckbox.check();

		// Verify all checkboxes are now checked
		await expect(relayConnectionCheckbox).toBeChecked();
		await expect(dataVisibilityCheckbox).toBeChecked();
		await expect(globalDatabaseCheckbox).toBeChecked();
		await expect(replicationTestingCheckbox).toBeChecked();

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
		await expect(page.locator('main h1').filter({ hasText: 'Simple TODO Example' })).toBeVisible();

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
		const relayConnectionCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand this app uses libp2p peer-to-peer networking/ })
			.locator('input[type="checkbox"]');
		const dataVisibilityCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand relay or peer nodes may cache/ })
			.locator('input[type="checkbox"]');
		const globalDatabaseCheckbox = page
			.locator('label')
			.filter({
				hasText: /I understand todos are stored in a shared, unencrypted OrbitDB database/
			})
			.locator('input[type="checkbox"]');
		const replicationTestingCheckbox = page
			.locator('label')
			.filter({ hasText: /I understand collaboration requires another browser or device/ })
			.locator('input[type="checkbox"]');

		await relayConnectionCheckbox.check();
		await dataVisibilityCheckbox.check();
		await globalDatabaseCheckbox.check();
		await replicationTestingCheckbox.check();

		// Click proceed
		const proceedButton = page.locator('button').filter({ hasText: /Proceed to Test the App/ });
		await proceedButton.click();

		// Wait for the app to load
		await page.waitForTimeout(2000);

		// Reload the page
		await page.reload();

		// The consent modal should not appear again
		const modal = page.locator('div.fixed.inset-0.z-50');
		await expect(modal).not.toBeVisible({ timeout: 5000 });

		// Clean up localStorage for next test
		await page.evaluate(() => {
			localStorage.clear();
		});
	});

	test('should display all required consent information', async ({ page }) => {
		await page.goto('/');

		// Check that all expected features are listed
		const expectedFeatures = [
			'No tracking cookies are used',
			'only that consent choice is saved locally',
			'local-first in your browser session',
			'Helia, OrbitDB, and libp2p',
			'connects to relay/bootstrap nodes and other peers',
			'cache, pin, or replicate demo todo data',
			'shared, unencrypted OrbitDB database',
			'IPFS/IPNS or an HTTP gateway'
		];

		for (const feature of expectedFeatures) {
			await expect(
				page
					.locator('li')
					.filter({ hasText: new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
			).toBeVisible();
		}
	});
});
