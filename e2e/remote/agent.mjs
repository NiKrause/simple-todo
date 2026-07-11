import { expect } from '@playwright/test';

const DEFAULT_TIMEOUT = 120_000;

export class TodoBrowserAgent {
	constructor(name, browser, appUrl, timeout = DEFAULT_TIMEOUT) {
		this.name = name;
		this.browser = browser;
		this.appUrl = appUrl;
		this.timeout = timeout;
		this.context = null;
		this.page = null;
	}

	async open() {
		this.context = await this.browser.newContext();
		this.page = await this.context.newPage();
		await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });

		const modal = this.page.locator('div.fixed.inset-0.z-50');
		await modal.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
		if (await modal.isVisible()) {
			for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
				await checkbox.check();
			}
			await this.page.getByRole('button', { name: 'Proceed to Test the App' }).click();
		}

		await expect(this.todoInput()).toBeEnabled({ timeout: this.timeout });
		await this.page.waitForFunction(
			() => typeof window.__simpleTodoDiagnostics?.getPeerId?.() === 'string',
			undefined,
			{ timeout: this.timeout }
		);
	}

	async diagnostics() {
		return this.page.evaluate(() => {
			const diagnostics = window.__simpleTodoDiagnostics;
			return {
				peerId: diagnostics?.getPeerId?.() ?? null,
				databaseAddress: diagnostics?.getDatabaseAddress?.() ?? null,
				multiaddrs: diagnostics?.getMultiaddrs?.() ?? [],
				connections: diagnostics?.getConnections?.() ?? [],
				appStamp: document.querySelector('header p')?.textContent?.trim() ?? null,
				userAgent: navigator.userAgent
			};
		});
	}

	async createTodo(text) {
		await this.todoInput().fill(text);
		await this.page.getByRole('button', { name: 'Add TODO' }).click();
		await this.waitForTodo(text);
	}

	async waitForTodo(text) {
		await expect(this.page.getByText(text, { exact: true })).toBeVisible({ timeout: this.timeout });
	}

	async screenshot(path) {
		await this.page?.screenshot({ path, fullPage: true });
	}

	async setTestingBotStatus(passed, reason) {
		if (!this.page) return;
		const command = JSON.stringify({
			action: 'setSessionStatus',
			arguments: { passed, reason }
		});
		await this.page.evaluate(() => {}, `testingbot_executor: ${command}`);
	}

	todoInput() {
		return this.page.getByPlaceholder('What needs to be done?');
	}

	async close() {
		await this.context?.close();
	}
}
