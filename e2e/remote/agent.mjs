import { SPANISH_MNEMONIC_STORAGE_KEY } from '../../src/lib/spanish-mnemonic.js';
import { VIEW_MODE_STORAGE_KEY } from '../../src/lib/view-mode.js';
import { INTRO_DIALOG_STORAGE_KEY } from '../../src/lib/intro-dialog.js';
import { RELAY_OPT_IN_STORAGE_KEY } from '../../src/lib/relay-availability.js';

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

	/**
	 * @param {string} mnemonic
	 * @param {{ technicalView?: boolean }} [options] `technicalView` is required
	 *   by any caller that drives the network panel or the relay select.
	 */
	async open(mnemonic, { technicalView = false } = {}) {
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
		// qr01 has no consent modal: the app initialises itself on mount, so
		// there is no dialog to fill and no "Open shared list" button to click.
		//
		// The shared list is therefore chosen the way the app itself remembers
		// it — by seeding the mnemonic into localStorage *before* the page runs,
		// so `onMount` picks it up on the first pass. Driving the in-app editor
		// instead would mean opening one list only to restart the whole P2P
		// stack onto another, on every agent, in every test.
		// `technicalView` is not cosmetic: `networkDetails()` and the relay
		// select live inside `P2PStatusNav`, which renders only in the technical
		// view, and the app opens in the simple one. A caller that dials a relay
		// and does not ask for the technical view waits for controls that are
		// not in the DOM — measured as a 50-minute timeout with nothing logged
		// after "opening ...".
		//
		// It stays opt-in rather than becoming the default, because the qr01
		// handover scenario is meant to run through the view an actual user
		// gets. Pinning it there would quietly stop testing that.
		await this.page.addInitScript(
			([
				[mnemonicKey, mnemonicValue],
				[viewKey, viewValue],
				[introKey, introValue],
				[relayKey, relayValue]
			]) => {
				try {
					localStorage.setItem(mnemonicKey, mnemonicValue);
					if (viewValue !== null) localStorage.setItem(viewKey, viewValue);
					localStorage.setItem(introKey, introValue);
					localStorage.setItem(relayKey, relayValue);
				} catch {
					// Storage blocked: the app falls back to a generated mnemonic and
					// the simple view, and whichever assertion needed the specific list
					// or a technical-view control fails there, naming that, not storage.
				}
			},
			[
				[SPANISH_MNEMONIC_STORAGE_KEY, mnemonic],
				[VIEW_MODE_STORAGE_KEY, technicalView ? 'false' : null],
				// The first-launch dialog covers the page; a harness driving the UI
				// would be clicking into an overlay.
				[INTRO_DIALOG_STORAGE_KEY, 'true'],
				// Seeded for every agent, because this is what every remote scenario
				// silently had before the relay became a choice: a node that
				// bootstraps from the configured relay on start. Deciding per
				// scenario would change what the existing ones measure.
				[RELAY_OPT_IN_STORAGE_KEY, 'true']
			]
		);

		remoteProgress(`[${this.name}] opening ${this.appUrl}...`);
		await this.page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });

		await this.todoInput().waitFor({ state: 'visible', timeout: this.timeout });
		await this.page.waitForFunction(
			() => {
				const input = document.querySelector('[data-testid="todo-input"]');
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
				databaseName: diagnostics?.getDatabaseName?.() ?? null,
				databaseAddress: diagnostics?.getDatabaseAddress?.() ?? null,
				databasePeers: diagnostics?.getDatabasePeers?.() ?? [],
				multiaddrs: diagnostics?.getMultiaddrs?.() ?? [],
				connections: diagnostics?.getConnections?.() ?? [],
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
			await this.todoInput().waitFor({ state: 'visible', timeout: attemptTimeout });
			await this.todoInput().fill(text);
			await this.page.getByTestId('todo-add').click();
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
		await this.page.getByText(text, { exact: true }).waitFor({ state: 'visible', timeout });
	}

	async screenshot(path) {
		await this.page?.screenshot({ path, fullPage: true });
	}

	todoInput() {
		return this.page.getByTestId('todo-input');
	}

	async close() {
		await this.context?.close();
	}
}
