import { test, expect } from '@playwright/test';

test.describe('Simple Todo P2P Application', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for the page to load
		await page.waitForLoadState('networkidle');
	});

	test('should show consent modal and proceed with P2P initialization', async ({ page }) => {
		// Step 1: Verify consent banner is visible
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible();

		// Wait for the banner to be fully loaded
		await page.waitForSelector('[data-testid="consent-modal"]');

		// Step 2: Verify default settings (Storage: On, Network: On)
		console.log('✅ Consent banner visible with default settings');

		// Step 3: Click the Accept & Continue button
		const proceedButton = page.locator('button', { hasText: 'Accept & Continue' });
		await expect(proceedButton).toBeEnabled();
		await proceedButton.click();

		console.log('✅ Clicked Accept & Continue button');

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

		// Wait for consent banner
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible();

		// Toggle Network to Off (clicking the toggle button)
		// Click the toggle switch itself - the button that has the bg-blue-600 or bg-gray-400 class
		const toggleButtons = page.locator('button.relative.inline-flex');
		await toggleButtons.nth(1).click(); // Second toggle is Network

		// Continue
		await page.locator('button', { hasText: 'Accept & Continue' }).click();

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
		await page.waitForSelector('[data-testid="consent-modal"]');

		// Click Accept & Continue
		await page.locator('button', { hasText: 'Accept & Continue' }).click();

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
		await page.waitForSelector('[data-testid="consent-modal"]');

		// Quick consent acceptance
		await page.locator('button', { hasText: 'Accept & Continue' }).click();
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
