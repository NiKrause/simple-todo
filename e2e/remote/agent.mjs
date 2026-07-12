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
		const diagnostics = await this.page.evaluate(() => {
			const diagnostics = window.__simpleTodoDiagnostics;
			return {
				peerId: diagnostics?.getPeerId?.() ?? null,
				databaseAddress:
					window.getTodoDatabaseAddress?.() ?? diagnostics?.getDatabaseAddress?.() ?? null,
				multiaddrs: diagnostics?.getMultiaddrs?.() ?? [],
				connections: diagnostics?.getConnections?.() ?? [],
				databasePeers: diagnostics?.getDatabasePeers?.() ?? [],
				pubsubTopics: diagnostics?.getPubsubTopics?.() ?? [],
				protocols: diagnostics?.getProtocols?.() ?? [],
				databaseTransition: diagnostics?.getDatabaseTransition?.() ?? null,
				appStamp: document.querySelector('header p')?.textContent?.trim() ?? null,
				userAgent: navigator.userAgent
			};
		});
		const visibleDatabaseAddress = await this.page
			.getByTestId('load-todo-db-input')
			.inputValue()
			.catch(() => '');
		return { ...diagnostics, visibleDatabaseAddress };
	}

	async waitForPublicRelayConnection() {
		await this.page.waitForFunction(
			() =>
				(window.__simpleTodoDiagnostics?.getConnections?.() ?? []).some(({ remoteAddr }) =>
					/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
				),
			undefined,
			{ timeout: this.timeout, polling: 1_000 }
		);

		return this.diagnostics();
	}

	async createTodo(text) {
		await this.todoInput().fill(text);
		await this.page.getByRole('button', { name: 'Add TODO' }).click();
		await this.waitForTodo(text);
	}

	async openDatabase(address) {
		const input = this.page.getByTestId('load-todo-db-input');
		await input.fill(address);
		await this.page.getByTestId('load-todo-db-button').click();
		await this.page.waitForFunction(
			(expectedAddress) => {
				const transition = window.__simpleTodoDiagnostics?.getDatabaseTransition?.();
				return (
					transition?.targetAddress === expectedAddress &&
					(transition.status === 'ready' || transition.status === 'failed')
				);
			},
			address,
			{ timeout: this.timeout, polling: 250 }
		);
		const transition = await this.page.evaluate(() =>
			window.__simpleTodoDiagnostics?.getDatabaseTransition?.()
		);
		if (transition?.status === 'failed') {
			throw new Error(`Remote OrbitDB load failed: ${transition.error ?? 'unknown error'}`);
		}
		await expect(this.page.getByText('Todo DB loaded', { exact: true })).toBeVisible({
			timeout: this.timeout
		});
		await expect(input).toHaveValue(address, { timeout: this.timeout });
		await this.waitForActiveDatabase(address);
	}

	async waitForActiveDatabase(address) {
		await this.page.waitForFunction(
			(expectedAddress) => {
				const diagnostics = window.__simpleTodoDiagnostics;
				const activeAddress =
					window.getTodoDatabaseAddress?.() ?? diagnostics?.getDatabaseAddress?.() ?? null;
				const hash = expectedAddress.slice('/orbitdb/'.length);
				return (
					activeAddress === expectedAddress &&
					(diagnostics?.getPubsubTopics?.() ?? []).includes(expectedAddress) &&
					(diagnostics?.getProtocols?.() ?? []).includes(`/orbitdb/heads/orbitdb/${hash}`)
				);
			},
			address,
			{ timeout: this.timeout, polling: 1_000 }
		);
		return this.diagnostics();
	}

	async waitForDatabasePeer(peerId, timeout = this.timeout) {
		await this.page.waitForFunction(
			(expectedPeerId) =>
				(window.__simpleTodoDiagnostics?.getDatabasePeers?.() ?? []).includes(expectedPeerId),
			peerId,
			{ timeout, polling: 1_000 }
		);
		return this.diagnostics();
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

	async getTestingBotSessionDetails() {
		if (!this.page) return null;
		const command = JSON.stringify({ action: 'getSessionDetails' });
		return this.page.evaluate(() => {}, `testingbot_executor: ${command}`);
	}

	todoInput() {
		return this.page.getByPlaceholder('What needs to be done?');
	}

	async close() {
		await this.context?.close();
	}
}
