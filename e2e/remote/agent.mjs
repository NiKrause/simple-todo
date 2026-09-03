import { passConsent } from '../consent.mjs';

const DEFAULT_TIMEOUT = 120_000;

/** Timestamped live progress line so CI logs show what remote runs are doing. */
export function remoteProgress(message) {
	console.log(`[remote-e2e ${new Date().toISOString()}] ${message}`);
}

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
			const type = message.type();
			const relevant =
				/(todo|orbitdb|database peer|entry updated|connect|dial|relay|tls|websocket|pinning)/i.test(
					text
				);
			if (!relevant && type !== 'error' && type !== 'warning') {
				return;
			}
			this.log.push(`[${type}] ${text}`);
			if (this.log.length > 200) this.log.shift();
			// Stream warnings/errors and relay-related lines live into the CI log:
			// buried browser console output (e.g. TooManyOutboundProtocolStreams
			// during relay pings) has repeatedly been the actual root cause.
			if (type === 'error' || type === 'warning' || /relay|dial|connect/i.test(text)) {
				remoteProgress(`[${this.name} ${type}] ${text.slice(0, 400)}`);
			}
		});
		this.page.on('pageerror', (error) => {
			remoteProgress(`[${this.name} pageerror] ${error.message}`);
		});
		this.page.on('requestfailed', (request) => {
			remoteProgress(
				`[${this.name} requestfailed] ${request.url().slice(0, 160)} :: ${request.failure()?.errorText}`
			);
		});
		remoteProgress(`[${this.name}] opening ${this.appUrl}...`);
		await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });

		// The consent screen is a `qr-intro` element since #298, and its controls
		// live in a shadow tree. The markup this used to reach for
		// (`div.fixed.inset-0.z-50`, "Proceed to Test the App") stopped matching,
		// so the dialog was never dismissed, the app never initialised, and the
		// wait below timed out after two minutes with nothing in the log to say
		// why. The specs share one helper for this walk; so does this, which is
		// how it stays fixed the next time the dialog is rearranged.
		await passConsent(this.page);

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
				connectionEvents: diagnostics?.getConnectionEvents?.() ?? [],
				pubsub: diagnostics?.getPubsubState?.() ?? null,
				appStamp: document.querySelector('header p')?.textContent?.trim() ?? null,
				userAgent: navigator.userAgent
			};
		});
		return { ...diagnostics, log: this.log.slice(-100) };
	}

	async waitForReachableRelayOptions() {
		// #38: discovery no longer runs on page load. The dropdown is
		// pre-populated with the build-time snapshot (data-prevalidated);
		// live ping-verified entries (data-ping-verified) appear only after a
		// manual refresh. Both are dialable, so accept either.
		const optionSelector =
			'[data-testid="reachable-relay-select"] option[data-ping-verified="true"], ' +
			'[data-testid="reachable-relay-select"] option[data-prevalidated="true"]';
		const select = this.page.getByTestId('reachable-relay-select');
		await select.waitFor({ state: 'attached', timeout: this.timeout });
		await this.page.waitForFunction(
			(selector) => document.querySelectorAll(selector).length > 0,
			optionSelector,
			{ timeout: this.timeout, polling: 500 }
		);

		return select
			.locator('option[data-ping-verified="true"], option[data-prevalidated="true"]')
			.evaluateAll((options) =>
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

	async waitForDialAddress({ requirePublic = false } = {}) {
		await this.page.waitForFunction(
			(publicOnly) => {
				const peerId = window.__simpleTodoDiagnostics?.getPeerId?.();
				return (window.__simpleTodoDiagnostics?.getMultiaddrs?.() ?? []).some(
					(address) =>
						address.endsWith(`/p2p/${peerId}`) &&
						address.includes('/p2p-circuit/') &&
						(!publicOnly ||
							/\/dns[46]\//.test(address) ||
							/\/ip4\/(?!127\.)/.test(address) ||
							/\/ip6\/(?!::1\/)/.test(address))
				);
			},
			requirePublic,
			{ timeout: this.timeout, polling: 1_000 }
		);

		return this.diagnostics();
	}

	async waitForPublicDialAddress() {
		return this.waitForDialAddress({ requirePublic: true });
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

	async waitForDatabaseSyncPeer(timeout = this.timeout) {
		await this.page.waitForFunction(
			() => (window.__simpleTodoDiagnostics?.getDatabasePeers?.() ?? []).length > 0,
			undefined,
			{ timeout, polling: 1_000 }
		);
		return this.diagnostics();
	}

	async createTodo(text, { attempts = 3, attemptTimeout = 40_000 } = {}) {
		let lastError;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			// Never submit the same text twice. A previous attempt that timed out
			// has not necessarily failed — creation against the production relay
			// has been measured at 85 s, far past `attemptTimeout`, so the todo
			// lands moments after we gave up on it. Re-submitting then produced a
			// second identical entry, and every later `getByText(text)` died of a
			// strict-mode violation: a working app failing the run because the
			// retry, not the app, duplicated the todo.
			if ((await this.page.getByText(text, { exact: true }).count()) > 0) return;

			await this.todoInput().waitFor({ state: 'visible', timeout: attemptTimeout });
			await this.todoInput().fill(text);
			await this.page.getByRole('button', { name: 'Add TODO' }).click();
			try {
				await this.waitForTodo(text, attemptTimeout);
				return;
			} catch (error) {
				lastError = error;
				this.log.push(
					`[warning] TODO creation attempt ${attempt}/${attempts} did not become visible within ${attemptTimeout}ms`
				);
			}
		}

		throw new Error(
			`${this.name} could not create local TODO "${text}" after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
		);
	}

	async waitForTodo(text, timeout = this.timeout) {
		// `.first()`: the question here is "did this todo arrive", and a second
		// copy is still a yes. Without it, a duplicate makes the locator throw a
		// strict-mode violation instead of resolving — turning "arrived twice"
		// into an error that reads like "never arrived".
		await this.page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout });
	}

	async screenshot(path) {
		await this.page?.screenshot({ path, fullPage: true });
	}

	todoInput() {
		return this.page.getByRole('textbox', { name: 'What needs to be done?' });
	}

	async close() {
		await this.context?.close();
	}
}
