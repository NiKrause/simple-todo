import { test, expect } from '@playwright/test';
import { RelayButtonDriver } from '@le-space/playwright';

import { passConsent } from './consent.mjs';
import { openSection } from './sections.mjs';

// escrow01: the page used to show everything at once, and on a phone the todos
// began three screens down. Now it opens on the todos, and the lists, the
// account and the network are one tab away. The fragment names the open tab.

const timeout = 90_000;
const TABS = /** @type {const} */ (['aufgaben', 'listen', 'konto', 'netzwerk']);

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ remember?: boolean }} [options]
 */
async function openReadyApp(page, { remember = false } = {}) {
	await page.goto('/');
	await passConsent(page, { remember });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** The sections on screen, by test id. @param {import('@playwright/test').Page} page */
const shownSections = (page) =>
	page.$$eval('section[data-testid^="section-"]', (sections) =>
		sections.filter((section) => !section.hidden).map((section) => section.dataset.testid)
	);

test.describe('the page in tabs', () => {
	test('opens on the todos, with the lists, the account and the network one tab away', async ({
		page
	}) => {
		await openReadyApp(page);

		expect(await shownSections(page)).toEqual(['section-aufgaben']);
		await expect(page.getByTestId('tab-aufgaben')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByTestId('active-list-heading')).toBeVisible();
		// What used to stand above the todos is not on screen.
		for (const testid of ['new-private-list', 'open-database-form', 'p2p-status-nav']) {
			await expect(page.getByTestId(testid)).toBeHidden();
		}

		for (const section of [...TABS.slice(1), 'aufgaben']) {
			await openSection(page, /** @type {any} */ (section));
			expect(await shownSections(page)).toEqual([`section-${section}`]);
			await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
			expect(new URL(page.url()).hash).toBe(`#${section}`);
		}

		// The switch to another list is where the todos are.
		await page.getByTestId('switch-list').click();
		await expect(page.getByTestId('section-listen')).toBeVisible();
		expect(await shownSections(page)).toEqual(['section-listen']);
	});

	test('a half-typed todo and a half-typed list name survive a trip through the tabs', async ({
		page
	}) => {
		// Hidden, not unmounted: a tab switch must not throw away what somebody
		// was in the middle of writing.
		await openReadyApp(page);
		await page.getByPlaceholder('What needs to be done?').fill('half a todo');
		await openSection(page, 'listen');
		await page.getByTestId('new-list-name').fill('half a list');

		await openSection(page, 'netzwerk');
		await openSection(page, 'aufgaben');
		await expect(page.getByPlaceholder('What needs to be done?')).toHaveValue('half a todo');
		await openSection(page, 'listen');
		await expect(page.getByTestId('new-list-name')).toHaveValue('half a list');
	});

	test('the back button goes back a tab, and a reload stays on the tab it was on', async ({
		page
	}) => {
		await openReadyApp(page, { remember: true });
		await openSection(page, 'konto');
		await openSection(page, 'listen');

		await page.goBack();
		await expect(page.getByTestId('section-konto')).toBeVisible();
		await expect(page.getByTestId('tab-konto')).toHaveAttribute('aria-current', 'page');

		// Consent was remembered, so the reload starts the app without the dialog.
		await page.reload();
		await expect(page.getByTestId('section-konto')).toBeVisible({ timeout });
		expect(await shownSections(page)).toEqual(['section-konto']);

		await page.goBack();
		await expect(page.getByTestId('section-aufgaben')).toBeVisible();
	});

	test('the auditor view opens from the account tab, and still from its own address', async ({
		page
	}) => {
		await openReadyApp(page, { remember: true });
		await openSection(page, 'konto');
		await page.getByTestId('auditor-view-open').click();

		await expect(page.getByTestId('auditor-banner')).toBeVisible();
		expect(await shownSections(page)).toEqual([]);
		// It has no tab of its own, so no tab claims to be open.
		await expect(page.locator('[aria-current="page"]')).toHaveCount(0);

		await page.getByTestId('auditor-view-close').click();
		await expect(page.getByTestId('section-aufgaben')).toBeVisible();
		await expect(page.getByTestId('auditor-banner')).toHaveCount(0);

		// `#pruefstelle` was a link people were given before the tabs existed.
		const second = await page.context().newPage();
		await second.goto('/#pruefstelle');
		await expect(second.getByTestId('auditor-banner')).toBeVisible({ timeout });
	});

	test('the dot in the header says what the status panel says, and leads to it', async ({
		page
	}) => {
		await openReadyApp(page);
		const dot = page.getByTestId('network-status-dot');
		await expect(dot).toBeVisible();

		// Asserted against the panel rather than against a relay: whichever state
		// the network is in, the dot must not tell a different story. Past the
		// start, so the two are not merely agreeing that nothing has happened yet.
		await expect(dot).not.toHaveAttribute('data-state', 'starting', { timeout });
		await expect
			.poll(async () => {
				const panel = ((await page.getByTestId('p2p-status-label').textContent()) ?? '').trim();
				return (await dot.getAttribute('title')) === panel.replace(/\.$/, '');
			})
			.toBe(true);

		await dot.click();
		await expect(page.getByTestId('section-netzwerk')).toBeVisible();
		expect(await shownSections(page)).toEqual(['section-netzwerk']);
		await expect(page.getByTestId('p2p-status-nav')).toBeVisible();
	});
});

test.describe('the tabs on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('sit at the foot, clear of the relay button, and nothing scrolls sideways', async ({
		page
	}) => {
		await openReadyApp(page);
		const tabs = page.getByTestId('section-tabs');

		const bar = await tabs.boundingBox();
		expect(bar, 'the tab bar has a box').not.toBeNull();
		expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(844);
		expect(await tabs.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');

		// The relay button floats above the bar, not over a tab.
		const launcher = await new RelayButtonDriver(page).launcherBox();
		expect(launcher.y + launcher.height).toBeLessThanOrEqual(bar?.y ?? 0);

		for (const section of TABS) {
			await openSection(page, section);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
				`${section} scrolls sideways`
			).toBe(true);
		}

		// The last todo can be scrolled out from under the bar.
		await openSection(page, 'aufgaben');
		for (const text of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']) {
			await page.getByPlaceholder('What needs to be done?').fill(`phone ${text}`);
			await page.getByRole('button', { name: 'Add TODO' }).click();
			await expect(page.getByText(`phone ${text}`, { exact: true })).toBeVisible({ timeout });
		}
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const last = await page.getByTestId('todo-item').last().boundingBox();
		const barNow = await tabs.boundingBox();
		expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(barNow?.y ?? 0);
	});
});
