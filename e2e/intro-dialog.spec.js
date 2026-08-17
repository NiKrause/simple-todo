import { test, expect } from '@playwright/test';
import { openReadyApp, todoInput } from './open-app.mjs';
import { buildInviteLink } from '../src/lib/invite-link.js';

// Chapter (qr01), issue #213: the app opened straight into a list, so a first
// visitor had no way to learn that it works without internet, what the codes
// are for, or why a hotspot helps.
//
// `intro: true` on every `openReadyApp` here is what makes these tests real —
// every other spec has the dialog pinned away, because it covers the page.

const timeout = 90_000;

test.describe('the first-launch introduction', () => {
	test('appears once, and stays gone when dismissed for good', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, timeout });
			await expect(page.getByTestId('intro-dialog')).toBeVisible({ timeout });

			// Dismissed without the checkbox: this visit only.
			await page.getByTestId('intro-close').click();
			await expect(page.getByTestId('intro-dialog')).toBeHidden();

			await page.reload();
			await expect(page.getByTestId('intro-dialog')).toBeVisible({ timeout });

			// Now for good.
			await page.getByTestId('intro-dont-show').check();
			await page.getByTestId('intro-close').click();
			await expect(page.getByTestId('intro-dialog')).toBeHidden();

			await page.reload();
			await expect(todoInput(page)).toBeVisible({ timeout });
			await expect(page.getByTestId('intro-dialog')).toBeHidden();

			// Dismissing is not a one-way door.
			await page.getByTestId('intro-reopen').click();
			await expect(page.getByTestId('intro-dialog')).toBeVisible({ timeout });
		} finally {
			await context.close();
		}
	});

	test('speaks both languages and keeps the technical part behind the switch', async ({
		browser
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, timeout });
			const dialog = page.getByTestId('intro-dialog');
			await expect(dialog).toBeVisible({ timeout });

			// Read off the button rather than the prose. The explanatory sentences
			// are the part most likely to be reworded, and a test that pins them
			// turns every copy edit into a failing test for no benefit; the button
			// label is short, language-specific and part of the contract.
			await dialog.getByTestId('language-de').click();
			await expect(dialog.getByTestId('intro-close')).toHaveText("Los geht's");
			await dialog.getByTestId('language-en').click();
			await expect(dialog.getByTestId('intro-close')).toHaveText('Get started');

			// The browser-and-NAT detail is for whoever asks for it.
			await expect(page.getByTestId('intro-technical')).toBeHidden();
			await dialog.getByTestId('view-mode-toggle').click();
			await expect(page.getByTestId('intro-technical')).toBeVisible();
			await expect(page.getByTestId('intro-technical')).toContainText('symmetric NAT');
			await expect(page.getByTestId('intro-technical')).toContainText('NymVPN');
		} finally {
			await context.close();
		}
	});

	test('reaches a verdict about this network, and shows it is working meanwhile', async ({
		browser
	}) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await openReadyApp(page, { intro: true, timeout });

			// The probe runs for up to six seconds, so "checking" has to be visible
			// and has to look like work rather than like a stall.
			const verdict = page.getByTestId('intro-network-verdict');
			await expect(verdict).toBeVisible({ timeout });

			// Which verdict depends on the network running this, so the assertion is
			// that it *settles* — and that it settles on one of the states the
			// package actually reports. `local only` on a mobile network is a
			// correct answer; the bug this replaced was reporting `open` there,
			// because it counted host candidates every device always has.
			await expect(verdict).toHaveAttribute('data-state', /^(open|relay|symmetric|blocked)$/, {
				timeout
			});
		} finally {
			await context.close();
		}
	});

	test('stays out of the way of someone who followed a shared link', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			// That person came to accept a list. An introduction in front of it
			// would be between them and the only thing they arrived to do.
			const link = buildInviteLink('probe-payload', 'http://localhost/');
			const hash = new URL(link).hash;
			await openReadyApp(page, { url: `/${hash}`, intro: true, timeout });

			await expect(todoInput(page)).toBeVisible({ timeout });
			await expect(page.getByTestId('intro-dialog')).toBeHidden();
		} finally {
			await context.close();
		}
	});
});
