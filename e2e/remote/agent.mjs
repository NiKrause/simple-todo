const DEFAULT_TIMEOUT = 120_000;

export class TodoBrowserAgent {
	constructor(name, browser, appUrl, timeout = DEFAULT_TIMEOUT) {
		this.name = name;
		this.browser = browser;
		this.appUrl = appUrl;
		this.timeout = timeout;
		this.context = null;
		this.page = null;
		this.log = [];
	}

	async open() {
		this.context = await this.browser.newContext();
		this.page = await this.context.newPage();
		this.page.on('console', (message) => {
			const text = message.text();
			if (
				!/(todo|orbitdb|database peer|entry updated|connect|dial|relay|tls|websocket|pinning)/i.test(
					text
				)
			) {
				return;
			}
			this.log.push(`[${message.type()}] ${text}`);
			if (this.log.length > 200) this.log.shift();
		});
		await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });

		const modal = this.page.locator('div.fixed.inset-0.z-50');
		await modal.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
		if (await modal.isVisible()) {
			for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
				await checkbox.check();
			}
			await this.page.getByRole('button', { name: 'Proceed to Test the App' }).click();
		}

		await this.todoInput().waitFor({ state: 'visible', timeout: this.timeout });
		await this.page.waitForFunction(
			() => {
				const input = document.querySelector('input[placeholder="What needs to be done?"]');
				return input instanceof HTMLInputElement && !input.disabled;
			},
			undefined,
			{ timeout: this.timeout }
		);
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
				databaseAddress: diagnostics?.getDatabaseAddress?.() ?? null,
				databasePeers: diagnostics?.getDatabasePeers?.() ?? [],
				multiaddrs: diagnostics?.getMultiaddrs?.() ?? [],
				connections: diagnostics?.getConnections?.() ?? [],
				appStamp: document.querySelector('header p')?.textContent?.trim() ?? null,
				userAgent: navigator.userAgent
			};
		});
		return { ...diagnostics, log: this.log.slice(-100) };
	}

	async waitForReachableRelayOptions() {
		const select = this.page.getByTestId('reachable-relay-select');
		await select.waitFor({ state: 'attached', timeout: this.timeout });
		await this.page.waitForFunction(
			() =>
				document.querySelectorAll(
					'[data-testid="reachable-relay-select"] option[data-ping-verified="true"]'
				).length > 0,
			undefined,
			{ timeout: this.timeout, polling: 500 }
		);

		return select.locator('option[data-ping-verified="true"]').evaluateAll((options) =>
			options.map((option) => ({
				address: option.value,
				label: option.textContent?.trim() ?? ''
			}))
		);
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

	async waitForPublicDialAddress() {
		await this.page.waitForFunction(
			() => {
				const peerId = window.__simpleTodoDiagnostics?.getPeerId?.();
				return (window.__simpleTodoDiagnostics?.getMultiaddrs?.() ?? []).some(
					(address) =>
						address.endsWith(`/p2p/${peerId}`) &&
						address.includes('/p2p-circuit/') &&
						(/\/dns[46]\//.test(address) ||
							/\/ip4\/(?!127\.)/.test(address) ||
							/\/ip6\//.test(address))
				);
			},
			undefined,
			{ timeout: this.timeout, polling: 1_000 }
		);

		return this.diagnostics();
	}

	async connectToMultiaddr(address) {
		const networkDetails = this.page.getByTestId('network-details');
		if ((await networkDetails.getAttribute('open')) === null) {
			await networkDetails.getByText('Network details', { exact: true }).click();
		}

		await networkDetails.getByLabel('Use a custom multiaddress').check();
		await networkDetails
			.getByPlaceholder('/dns4/example.com/tcp/443/wss/p2p/12D3KooW...')
			.fill(address);
		await networkDetails.getByRole('button', { name: 'Connect', exact: true }).click();
	}

	async waitForPeerConnection(peerId, timeout = this.timeout) {
		await this.page.waitForFunction(
			(expectedPeerId) =>
				(window.__simpleTodoDiagnostics?.getConnections?.() ?? []).some(
					({ remotePeer }) => remotePeer === expectedPeerId
				),
			peerId,
			{ timeout, polling: 1_000 }
		);

		return this.diagnostics();
	}

	async createTodo(text) {
		await this.todoInput().fill(text);
		await this.page.getByRole('button', { name: 'Add TODO' }).click();
		await this.waitForTodo(text);
	}

	async waitForTodo(text) {
		await this.page
			.getByText(text, { exact: true })
			.waitFor({ state: 'visible', timeout: this.timeout });
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
		return this.page.getByRole('textbox', { name: 'What needs to be done?' });
	}

	async close() {
		await this.context?.close();
	}
}
