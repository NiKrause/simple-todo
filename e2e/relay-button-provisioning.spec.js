import { expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdir } from 'node:fs/promises';
import {
	createRelayTest,
	createRelayEvidence,
	updateRelayEvidenceStep,
	writeRelayEvidence,
	installEip1193WalletMock
} from '@le-space/playwright';
import { TodoBrowserAgent } from './remote/agent.mjs';
import { selectPeerDialAddress } from './remote/main-scenario.mjs';
import { generateSpanishMnemonic } from '../src/lib/spanish-mnemonic.js';

// Chapter (collab01): provisions a real relay through the Relay Button UI and
// replicates a Spanish-mnemonic-named shared OrbitDB list between two browsers.
// All relay-lifecycle plumbing (wallet mock, deploy → instance → bootstrap
// registration, browser-dialable address selection, CRN erase + Aleph FORGET
// cleanup) comes from the shared @le-space/playwright test kit; the shared-list
// mnemonic flow and the optional relay /health check stay here (issue #29).

const PRIVATE_KEY = process.env.RELAY_BUTTON_E2E_PRIVATE_KEY?.trim();
const SSH_PUBLIC_KEY = process.env.RELAY_BUTTON_E2E_SSH_PUBLIC_KEY?.trim();
const APP_URL = process.env.RELAY_BUTTON_E2E_APP_URL ?? 'http://localhost:4173';
const OUTPUT_DIR = 'test-results/relay-button';
// Must fit several CRN failover attempts: a single failed attempt costs
// 7-13 min (VM boot + config-ack wait + HTTPS activation wait) before the
// controller moves to the next CRN, and two flaky CRNs in a row are routine.
const PROVISION_TIMEOUT = 35 * 60_000;
const REGISTRATION_TIMEOUT = 15 * 60_000;
const RELAY_HEALTH_TIMEOUT = 60_000;
const RELAY_READINESS_TIMEOUT = 10 * 60_000;
const RELAY_DIAL_ATTEMPT_TIMEOUT = 20_000;
const REPLICATION_TIMEOUT = 3 * 60_000;

/**
 * Live progress logging: Playwright shows no output between test start and
 * finish, so a 12-30 minute provisioning run looks frozen in CI logs.
 */
function progress(message) {
	console.log(`[relay-e2e ${new Date().toISOString()}] ${message}`);
}

// Optional relay /health diagnostic over the published 2n6.me address — kept
// from the collab01 chapter (the shared kit's provisionRelay does not probe it).
async function waitForRelayHealth(address, expectedPeerId) {
	const hostname = address.match(/\/dns[46]\/([^/]+)/)?.[1];
	if (!hostname) throw new Error(`Cannot derive relay health URL from ${address}`);
	const healthUrl = `https://${hostname}/health`;
	const deadline = Date.now() + RELAY_HEALTH_TIMEOUT;
	let lastError = 'not attempted';

	while (Date.now() < deadline) {
		try {
			const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
			const body = await response.text();
			if (response.ok && body.includes(expectedPeerId)) return { healthUrl, body };
			lastError = `${response.status}: ${body.slice(0, 300)}`;
		} catch (error) {
			lastError =
				error instanceof Error
					? `${error.message}${error.cause ? ` (${String(error.cause)})` : ''}`
					: String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}

	throw new Error(`Relay health check failed at ${healthUrl}: ${lastError}`);
}

// Dial BOTH browsers at each relay address concurrently and keep retrying until
// both hold a connection to the relay peer, or the readiness window elapses.
// Freshly provisioned relays can take minutes to become browser-dialable (guest
// boot + AutoTLS), so both browsers share one window.
async function connectBrowsersToRelay(agents, addresses, relayPeerId) {
	const attempts = [];
	const deadline = Date.now() + RELAY_READINESS_TIMEOUT;

	while (Date.now() < deadline) {
		for (const address of addresses) {
			await Promise.allSettled(agents.map((agent) => agent.connectToMultiaddr(address)));
			const results = await Promise.allSettled(
				agents.map((agent) => agent.waitForPeerConnection(relayPeerId, RELAY_DIAL_ATTEMPT_TIMEOUT))
			);
			const connected = results.map(({ status }) => status === 'fulfilled');
			attempts.push({ at: new Date().toISOString(), address, connected });
			progress(`relay dial via ${address}: connected=[${connected.join(', ')}]`);
			if (connected.every(Boolean)) return { address, attempts };
			if (Date.now() >= deadline) break;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}

	throw new Error(`browsers did not connect to relay ${relayPeerId}: ${JSON.stringify(attempts)}`);
}

// A placeholder key keeps the file collectable when credentials are absent:
// createRelayTest must run at module scope to register the relayLifecycle
// fixture, but the skips below stop the body from ever using this account.
const RESOLVED_KEY = PRIVATE_KEY
	? PRIVATE_KEY.startsWith('0x')
		? PRIVATE_KEY
		: `0x${PRIVATE_KEY}`
	: `0x${'1'.repeat(64)}`;
const account = privateKeyToAccount(RESOLVED_KEY);
const sharedMnemonic = generateSpanishMnemonic();

const evidence = createRelayEvidence({
	instanceName: `simple-todo-e2e-${Date.now()}`,
	ownerAddress: account.address,
	steps: {
		walletAndManifest: 'Wallet connected and relay manifest accepted',
		instanceProvisioned: 'Aleph relay VM provisioned',
		bootstrapPublished: 'Browser multiaddress published to Aleph',
		healthVerified: 'Optional relay /health diagnostic checked',
		browserAConnected: 'Browser A connected through custom multiaddress',
		browserBConnected: 'Browser B connected through custom multiaddress',
		sharedDatabase: 'Both browsers opened the same Spanish-mnemonic OrbitDB list',
		browserPeersConnected: 'Browser-to-browser relay connection established',
		replicationAToB: 'TODO replicated from browser A to browser B',
		replicationBToA: 'TODO replicated from browser B to browser A',
		cleanup: 'Temporary Aleph relay forgotten and deallocated'
	}
});
evidence.sharedMnemonic = sharedMnemonic;

const relayTest = createRelayTest({ account, evidence });

relayTest.describe('Relay Button', () => {
	relayTest.skip(
		!PRIVATE_KEY,
		'RELAY_BUTTON_E2E_PRIVATE_KEY is required to provision an Aleph relay.'
	);
	relayTest.skip(
		!SSH_PUBLIC_KEY,
		'RELAY_BUTTON_E2E_SSH_PUBLIC_KEY is required to provision an Aleph relay.'
	);
	relayTest.setTimeout(50 * 60_000);

	relayTest(
		'provisions a relay and replicates one mnemonic list between two browsers',
		async ({ browser, relayLifecycle }) => {
			await mkdir(OUTPUT_DIR, { recursive: true });
			const instanceName = evidence.instanceName;
			const startedAt = Date.now();
			const deploymentContext = await browser.newContext();
			await installEip1193WalletMock(deploymentContext, account);
			// Enable @le-space/ui controller tracing so deploy-phase diagnostics
			// reach the browser console, where the handler below forwards them.
			await deploymentContext.addInitScript(() => {
				try {
					localStorage.setItem('LE_SPACE_UI_DEBUG', '1');
				} catch {
					// localStorage may be unavailable; tracing is best-effort.
				}
			});
			const deploymentPage = await deploymentContext.newPage();
			deploymentPage.on('console', (message) => {
				const text = message.text();
				if (
					text.includes('[le-space/ui]') ||
					message.type() === 'error' ||
					message.type() === 'warning'
				) {
					progress(`[deploy-page ${message.type()}] ${text.slice(0, 500)}`);
				}
			});
			deploymentPage.on('pageerror', (error) =>
				progress(`[deploy-page pageerror] ${error.message}`)
			);

			// Mixed-content guard. Deploying from an HTTPS origin used to be
			// impossible because the browser POSTed the guest's configuration to
			// a plain-HTTP setup endpoint (http://<vm-ip>:<port>/…), which a
			// HTTPS page blocks as mixed content. The guest now pulls its config
			// from an Aleph aggregate over HTTPS, so no such request should
			// exist. These collectors fail the test if one reappears — the
			// regression is invisible to a plain green run because this suite is
			// served over http://localhost, where mixed content never applies.
			const insecureGuestRequests = [];
			const mixedContentErrors = [];
			deploymentPage.on('request', (request) => {
				let url;
				try {
					url = new URL(request.url());
				} catch {
					return;
				}
				const host = url.hostname;
				const isLocal =
					host === 'localhost' ||
					host === '127.0.0.1' ||
					host === '::1' ||
					host === '[::1]';
				if (url.protocol === 'http:' && !isLocal) {
					insecureGuestRequests.push(request.url());
					progress(`[mixed-content-guard] insecure request: ${request.url()}`);
				}
			});
			deploymentPage.on('console', (message) => {
				if (/mixed content/i.test(message.text())) {
					mixedContentErrors.push(message.text());
				}
			});

			const pass = (step, detail = '') => {
				updateRelayEvidenceStep(evidence, step, 'passed', detail);
				progress(`PASSED: ${evidence.steps[step].label}${detail ? ` (${detail})` : ''}`);
			};
			const skip = (step, detail = '') => {
				updateRelayEvidenceStep(evidence, step, 'skipped', detail);
			};

			const agentA = new TodoBrowserAgent('relay-e2e-a', browser, APP_URL, REPLICATION_TIMEOUT);
			const agentB = new TodoBrowserAgent('relay-e2e-b', browser, APP_URL, REPLICATION_TIMEOUT);
			let testError = null;

			try {
				progress(
					`starting relay provisioning E2E as ${account.address} (instance ${instanceName})`
				);

				// Chapter: pass the consent modal by opening the shared list named by
				// the mnemonic — this gate must clear before the Relay Button appears.
				await deploymentPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
				const consentModal = deploymentPage.locator('div.fixed.inset-0.z-50');
				await consentModal.waitFor({ state: 'visible', timeout: 15_000 });
				for (const checkbox of await consentModal.locator('input[type="checkbox"]').all()) {
					await checkbox.check();
				}
				await consentModal.getByTestId('shared-list-mnemonic-input').fill(sharedMnemonic);
				await consentModal.getByRole('button', { name: 'Open shared list' }).click();

				// Phase 1: Wallet + manifest + provision (deploy → instance → bootstrap).
				const relay = await relayLifecycle.provision(deploymentPage, {
					instanceName,
					sshPublicKey: SSH_PUBLIC_KEY,
					startedAt,
					provisionTimeoutMs: PROVISION_TIMEOUT,
					registrationTimeoutMs: REGISTRATION_TIMEOUT,
					onPhase: (phase, detail = '') =>
						progress(`provision: ${phase}${detail ? ` (${detail})` : ''}`)
				});
				pass('walletAndManifest');
				evidence.instanceHash = relay.instanceHash;
				evidence.registration = relay.registration;
				evidence.relayAddresses = relay.addresses;
				pass('instanceProvisioned', relay.instanceHash);

				const relayAddresses = relay.addresses;
				expect(
					relayAddresses,
					'new relay must advertise a browser-reachable address'
				).not.toHaveLength(0);
				pass('bootstrapPublished', relayAddresses.join(', '));

				// Chapter: optional /health diagnostic over the 2n6.me address.
				const healthAddress = (relay.registration.content.multiaddrs ?? []).find((address) =>
					/\/dns[46]\/.*\.2n6\.me\/tcp\/443\/(tls\/ws|wss)\/p2p\//.test(address)
				);
				const healthPromise = healthAddress
					? waitForRelayHealth(healthAddress, relay.peerId)
							.then((health) => ({ health }))
							.catch((error) => ({ error }))
					: Promise.resolve({ error: new Error('No 2n6 health address was published.') });

				// Phase 2: Browser A + B open the shared mnemonic list and connect.
				await Promise.all([agentA.open(sharedMnemonic), agentB.open(sharedMnemonic)]);
				const relayConnection = await connectBrowsersToRelay(
					[agentA, agentB],
					relayAddresses,
					relay.peerId
				);
				evidence.relayConnection = relayConnection;
				pass('browserAConnected', relayConnection.address);
				pass('browserBConnected', relayConnection.address);

				const healthResult = await healthPromise;
				if ('health' in healthResult) {
					evidence.health = healthResult.health;
					pass('healthVerified', relay.peerId);
				} else {
					const detail =
						healthResult.error instanceof Error
							? healthResult.error.message
							: String(healthResult.error);
					evidence.healthWarning = detail;
					skip('healthVerified', `Optional HTTP diagnostic unavailable: ${detail}`);
				}

				// Phase 3: Same Spanish-mnemonic OrbitDB list + a direct dial.
				await Promise.all([agentA.waitForPublicDialAddress(), agentB.waitForPublicDialAddress()]);
				const [diagnosticsA, diagnosticsB] = await Promise.all([
					agentA.diagnostics(),
					agentB.diagnostics()
				]);
				expect(diagnosticsA.databaseAddress).toBe(diagnosticsB.databaseAddress);
				expect(diagnosticsA.databaseName).toBe(sharedMnemonic);
				expect(diagnosticsB.databaseName).toBe(sharedMnemonic);
				pass('sharedDatabase', `${sharedMnemonic}: ${diagnosticsA.databaseAddress}`);

				const addressForB = selectPeerDialAddress(diagnosticsB, diagnosticsB.peerId, {
					relayPeerId: relay.peerId
				});
				expect(
					addressForB,
					'browser B must advertise an address through the new relay'
				).toBeTruthy();
				await agentA.connectToMultiaddr(addressForB);
				await Promise.all([
					agentA.waitForPeerConnection(diagnosticsB.peerId),
					agentB.waitForPeerConnection(diagnosticsA.peerId)
				]);
				pass('browserPeersConnected', `${diagnosticsA.peerId} ↔ ${diagnosticsB.peerId}`);

				// Phase 4: Bidirectional OrbitDB replication of the shared list.
				const todoA = `${instanceName}-from-a`;
				const todoB = `${instanceName}-from-b`;
				await agentA.createTodo(todoA);
				await agentB.waitForTodo(todoA);
				pass('replicationAToB', todoA);
				await agentB.createTodo(todoB);
				await agentA.waitForTodo(todoB);
				pass('replicationBToA', todoB);

				evidence.final = {
					agentA: await agentA.diagnostics(),
					agentB: await agentB.diagnostics(),
					relayAddresses,
					addressForB
				};
				await Promise.all([
					agentA.screenshot(`${OUTPUT_DIR}/browser-a.png`),
					agentB.screenshot(`${OUTPUT_DIR}/browser-b.png`),
					deploymentPage.screenshot({ path: `${OUTPUT_DIR}/relay-panel.png`, fullPage: true })
				]);

				// Deployment succeeded — assert it did so without ever touching a
				// guest's plain-HTTP endpoint. On an HTTPS origin such a request
				// is a hard mixed-content failure; here it proves the browser took
				// the Aleph aggregate handoff, not the legacy push path.
				if (insecureGuestRequests.length > 0 || mixedContentErrors.length > 0) {
					throw new Error(
						`Deployment used the insecure push path. ` +
							`Insecure guest requests: ${JSON.stringify(insecureGuestRequests.slice(0, 5))}; ` +
							`mixed-content console errors: ${JSON.stringify(mixedContentErrors.slice(0, 5))}.`
					);
				}
				progress(
					'PASSED: mixed-content guard (no insecure guest requests during deployment)'
				);
			} catch (error) {
				testError = error instanceof Error ? error : new Error(String(error));
				evidence.error = testError.message;
				progress(`FAILED: ${testError.message}`);
				const [diagnosticsA, diagnosticsB] = await Promise.allSettled([
					agentA.diagnostics(),
					agentB.diagnostics()
				]);
				evidence.failureDiagnostics = {
					agentA: diagnosticsA.status === 'fulfilled' ? diagnosticsA.value : null,
					agentB: diagnosticsB.status === 'fulfilled' ? diagnosticsB.value : null
				};
				await Promise.allSettled([
					deploymentPage.screenshot({
						path: `${OUTPUT_DIR}/relay-panel-error.png`,
						fullPage: true
					}),
					agentA.screenshot(`${OUTPUT_DIR}/browser-a-error.png`),
					agentB.screenshot(`${OUTPUT_DIR}/browser-b-error.png`)
				]);
			} finally {
				await Promise.allSettled([agentA.close(), agentB.close()]);
				try {
					progress(`cleanup: erasing and forgetting ${instanceName}...`);
					const results = await relayLifecycle.cleanupAll();
					if (results.length === 0) {
						updateRelayEvidenceStep(evidence, 'cleanup', 'skipped', 'No VM was provisioned.');
					} else {
						pass('cleanup', results[0]?.verificationSummary ?? '');
					}
				} catch (cleanupError) {
					const detail =
						cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
					updateRelayEvidenceStep(evidence, 'cleanup', 'failed', detail);
					progress(`cleanup FAILED: ${detail}`);
				}
				evidence.finishedAt = new Date().toISOString();
				await writeRelayEvidence(`${OUTPUT_DIR}/result.json`, evidence);
				await deploymentContext.close();
			}

			if (testError) throw testError;
		}
	);
});
