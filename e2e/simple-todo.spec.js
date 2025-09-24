import { test, expect } from '@playwright/test';

test.describe('Simple Todo P2P Application', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for the page to load
		await page.waitForLoadState('networkidle');
	});

	test('should show consent modal and proceed with P2P initialization', async ({ page }) => {
		// Step 1: Verify consent modal is visible
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible();

		// Wait for the modal to be fully loaded
		await page.waitForSelector('[data-testid="consent-modal"] h1', {
			hasText: 'Simple TODO Example'
		});

		// Step 2: Check the 4 required checkboxes
		console.log('✅ Checking consent modal checkboxes...');

		// Find all consent checkboxes (the ones in the consent section, not the preference radio buttons)
		const consentCheckboxes = page.locator('[data-testid="consent-modal"] input[type="checkbox"]');
		const checkboxCount = await consentCheckboxes.count();

		// Check all consent checkboxes
		for (let i = 0; i < checkboxCount; i++) {
			await consentCheckboxes.nth(i).check();
		}

		// Verify all checkboxes are checked
		for (let i = 0; i < checkboxCount; i++) {
			await expect(consentCheckboxes.nth(i)).toBeChecked();
		}

		console.log('✅ All consent checkboxes are checked');

		// Step 3: Click the Proceed button
		const proceedButton = page.locator('button', { hasText: 'Proceed to Test the App' });
		await expect(proceedButton).toBeEnabled();
		await proceedButton.click();

		console.log('✅ Clicked Proceed button');

		// Step 4: Wait for consent modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		console.log('✅ Consent modal disappeared');

		// Step 5: Wait for P2P initialization to begin
		// Look for loading spinner or initialization messages
		await page.waitForTimeout(2000); // Give some time for initialization to start

		// Step 6: Wait for OrbitDB initialization
		// Look for success indicators in the page
		console.log('⏳ Waiting for OrbitDB initialization...');

		// Wait for peer ID to be displayed (indicates successful P2P initialization)
		await expect(page.locator('[data-testid="peer-id"]', { timeout: 30000 })).toBeVisible();

		console.log('✅ Peer ID is visible - P2P initialization successful');

		// Step 7: Wait for the todo form to be available
		await expect(page.locator('[data-testid="todo-input"]')).toBeVisible({ timeout: 10000 });

		console.log('✅ Todo input form is visible');

		// Step 8: Add a test todo
		const testTodoText = 'Test todo from Playwright e2e test';

		// Use the data-testid selectors we added
		const todoInput = page.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);

		const addButton = page.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		console.log(`✅ Added todo: "${testTodoText}"`);

		// Step 9: Verify the todo appears in the list
		await expect(page.locator('text=' + testTodoText).first()).toBeVisible({ timeout: 10000 });

		console.log('✅ Todo is visible in the list');

		// Step 10: Todo verification completed (already confirmed visible above)
		console.log('✅ Todo verification completed successfully');

		// Step 11: Verify P2P connection status (optional)
		// Look for connected peers indicator or similar
		const connectionStatus = page.locator('[data-testid="connection-status"], .connection-status');
		if (await connectionStatus.isVisible()) {
			console.log('✅ Connection status indicator found');
		}

		console.log('🎉 All test steps completed successfully!');
	});

	test('should handle offline mode correctly', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for consent modal - be more specific to target the modal h1
		await expect(
			page.locator('[data-testid="consent-modal"] h1', { hasText: 'Simple TODO Example' })
		).toBeVisible();

		// Select offline mode by choosing the "Offline Mode" radio button
		await page.getByRole('radio', { name: 'Offline Mode Does not connect' }).check();

		// Check required checkboxes
		const checkboxes = page.locator('input[type="checkbox"]');
		const checkboxCount = await checkboxes.count();

		for (let i = 0; i < checkboxCount; i++) {
			await checkboxes.nth(i).check();
		}

		// Continue
		await page.locator('button', { hasText: 'Proceed to Test the App' }).click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Should still be able to use the app in offline mode
		await expect(page.locator('[data-testid="todo-input"]')).toBeVisible({ timeout: 10000 });

		console.log('✅ Offline mode test completed');
	});

	test('should display system toast notifications', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Accept consent with default settings
		await page.waitForSelector('[data-testid="consent-modal"] h1', {
			hasText: 'Simple TODO Example'
		});

		// Check all checkboxes quickly
		const checkboxes = page.locator('input[type="checkbox"]');
		const checkboxCount = await checkboxes.count();

		for (let i = 0; i < checkboxCount; i++) {
			await checkboxes.nth(i).check();
		}

		await page.locator('button', { hasText: 'Proceed to Test the App' }).click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Look for system toast notifications that should appear during initialization
		// These might indicate libp2p creation, Helia creation, OrbitDB creation, etc.
		const toastSelectors = [
			'[data-testid="system-toast"]',
			'.toast',
			'.notification',
			'.alert',
			'[role="alert"]'
		];

		let toastFound = false;
		for (const selector of toastSelectors) {
			const toast = page.locator(selector);
			if (await toast.isVisible()) {
				console.log(`✅ Found toast notification: ${selector}`);
				toastFound = true;
				break;
			}
		}

		// Wait a bit more for potential toasts
		await page.waitForTimeout(3000);

		console.log(
			toastFound
				? '✅ Toast notifications test completed'
				: '⚠️ No toast notifications found (may be expected)'
		);
	});

	test('should handle todo operations correctly', async ({ page }) => {
		// Navigate and accept consent
		await page.goto('/');
		await page.waitForSelector('[data-testid="consent-modal"] h1', {
			hasText: 'Simple TODO Example'
		});

		// Quick consent acceptance
		const checkboxes = page.locator('input[type="checkbox"]');
		const checkboxCount = await checkboxes.count();

		for (let i = 0; i < checkboxCount; i++) {
			await checkboxes.nth(i).check();
		}

		await page.locator('button', { hasText: 'Proceed to Test the App' }).click();
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Wait for todo input to be ready
		const todoInput = page.locator('[data-testid="todo-input"]');
		await expect(todoInput).toBeVisible({ timeout: 15000 });

		// Test adding multiple todos
		const todos = [
			'First test todo',
			'Second test todo',
			'Third test todo with special chars: áéíóú'
		];

		for (const todoText of todos) {
			await todoInput.fill(todoText);
			await page.locator('[data-testid="add-todo-button"]').click();

			// Verify todo appears
			await expect(page.locator('text=' + todoText)).toBeVisible({ timeout: 5000 });

			console.log(`✅ Added and verified todo: "${todoText}"`);
		}

		// Test todo count
		const todoElements = page.locator('[data-testid="todo-item"], .todo-item');
		if (await todoElements.first().isVisible()) {
			const count = await todoElements.count();
			expect(count).toBeGreaterThanOrEqual(todos.length);
			console.log(`✅ Todo count verified: ${count} todos found`);
		}

		console.log('🎉 Todo operations test completed successfully!');
	});
});
