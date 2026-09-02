import { test, expect } from '@playwright/test';
import {
	acceptNotice,
	consentModal,
	isAccepted,
	privacyClauses,
	waitForConsent
} from './consent.mjs';

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

	test('the statement covers everything it has to, and says it once', async ({ page }) => {
		await page.goto('/');

		// This used to read the notice above the panel. The notice said what the
		// panel says - one line of it almost word for word - so it is gone, and
		// the assertion follows the sentences to the copy that is actually being
		// consented to.
		const clauses = privacyClauses(page);

		for (const claim of [
			'no server',
			'public IPFS gateway',
			'Relay and bootstrap nodes',
			'memory only',
			'No tracking cookies'
		]) {
			await expect(clauses.filter({ hasText: claim })).toHaveCount(1);
		}

		// Cookies last. It is the only line about this dialog rather than about
		// the app, and the order is the reason it reads as a footnote instead of
		// as the first thing somebody is told.
		await expect(clauses.last()).toContainText('No tracking cookies');

		// And exactly once each: saying a thing twice in a consent notice leaves
		// a reader working out whether the two versions differ.
		await expect(clauses).toHaveCount(5);
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

	test('the relay sentence follows the relay, and says the opposite without it', async ({
		page
	}) => {
		// Telling somebody their browser connects to relay nodes, in an app they
		// have just switched the relay off in, describes a different app than the
		// one they chose.
		//
		// This used to assert a pair of bullets in a notice above the statement.
		// The notice is gone - it said what the statement says - so the assertion
		// moved to where the sentence now lives. Which is the better place for it
		// anyway: this is the copy somebody is being asked to accept.
		await page.goto('/');
		const clauses = privacyClauses(page);

		const relayToggle = page.getByTestId('consent-relay-network');
		await expect(relayToggle).toBeChecked();
		await expect(clauses.filter({ hasText: 'Relay and bootstrap nodes' })).toHaveCount(1);
		await expect(clauses.filter({ hasText: 'No relay is contacted' })).toHaveCount(0);

		// Off does not merely remove the sentence - it replaces it. A statement
		// that goes quiet about relays says less than one that says none is used.
		await relayToggle.uncheck();
		await expect(clauses.filter({ hasText: 'No relay is contacted' })).toHaveCount(1);
		await expect(clauses.filter({ hasText: 'Relay and bootstrap nodes' })).toHaveCount(0);

		await relayToggle.check();
		await expect(clauses.filter({ hasText: 'Relay and bootstrap nodes' })).toHaveCount(1);
	});

	test('a choice flashes the lines it rewrote, and nothing on arrival', async ({ page }) => {
		// The panel is the point of assembling a statement, and a switch three
		// inches away was rewriting its sentences silently.
		await page.goto('/');
		const clauses = privacyClauses(page);
		await expect(clauses.first()).toBeVisible();

		// Nothing is marked on the first paint. Everything is new then, and a
		// statement that flashes in full on arrival tells nobody which line their
		// choice moved.
		await expect(clauses.locator('.changed')).toHaveCount(0);
		await expect(page.locator('[data-testid=consent-modal] .privacy li.changed')).toHaveCount(0);

		await page.getByTestId('consent-relay-network').uncheck();

		// Exactly one: the relay clause was rewritten and the other four were not.
		// `toHaveCount(1)` rather than a lower bound, because marking the whole
		// list would be the same failure as marking none of it.
		const marked = page.locator('[data-testid=consent-modal] .privacy li.changed');
		await expect(marked).toHaveCount(1);
		await expect(marked).toContainText('No relay is contacted');

		// The storage choice moves a different line.
		await page.getByTestId('consent-storage-indexeddb').check();
		const afterStorage = page.locator('[data-testid=consent-modal] .privacy li.changed');
		await expect(afterStorage).toHaveCount(1);
		await expect(afterStorage).toContainText('kept in this browser');
	});
});
