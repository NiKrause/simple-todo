import { expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdir } from 'node:fs/promises';
import {
	createRelayTest,
	createRelayEvidence,
	updateRelayEvidenceStep,
	writeRelayEvidence,
	installEip1193WalletMock,
	waitForPubsubSubscriber,
	RelayButtonDriver
} from '@le-space/playwright';
import { TodoBrowserAgent } from './remote/agent.mjs';
import { selectPeerDialAddress } from './remote/main-scenario.mjs';

// This spec provisions a real relay through the Relay Button UI and replicates
// the default OrbitDB between two browsers. All relay-lifecycle plumbing
// (wallet mock, deploy → instance → bootstrap registration, browser-dialable
// address selection, PubSub readiness, CRN erase + Aleph FORGET cleanup) now
// comes from the shared @le-space/playwright test kit; only the TODO-app
// assertions and the browser-to-browser dial stay here (issue #29).

const PRIVATE_KEY = process.env.RELAY_BUTTON_E2E_PRIVATE_KEY?.trim();
const SSH_PUBLIC_KEY = process.env.RELAY_BUTTON_E2E_SSH_PUBLIC_KEY?.trim();
const APP_URL = process.env.RELAY_BUTTON_E2E_APP_URL ?? 'http://localhost:4173';
const OUTPUT_DIR = 'test-results/relay-button';
const PROVISION_TIMEOUT = 20 * 60_000;
const REGISTRATION_TIMEOUT = 15 * 60_000;
const RELAY_READINESS_TIMEOUT = 10 * 60_000;
const RELAY_DIAL_ATTEMPT_TIMEOUT = 20_000;
const REPLICATION_TIMEOUT = 3 * 60_000;
const PUBSUB_TIMEOUT = 3 * 60_000;
const PUBSUB_TOPIC = 'simple-todos';

/**
 * Live progress logging: Playwright shows no output between test start and
 * finish, so a 12-30 minute provisioning run looks frozen in CI logs.
 */
function progress(message) {
	console.log(`[relay-e2e ${new Date().toISOString()}] ${message}`);
}

/**
 * The kit's default RelayButtonDriver fills the deploy form by placeholder,
 * which fits the js-peer (React) Relay Button. @le-space/ui's Svelte form
 * (SponsorRelayFab) labels its fields with a wrapping `<label><span>…</span>`
 * and sets no placeholder, so the placeholder locators never match and
 * `fill()` hangs. Target the fields by their label text instead — the same
 * selectors this migration otherwise replaced. Kit follow-up (#29 "same
 * page-driver contract for React and Svelte"): teach RelayButtonDriver to
 * accept a label strategy so this override can be dropped.
 */
class SvelteRelayButtonDriver extends RelayButtonDriver {
	async prepare({ instanceName, sshPublicKey }) {
		const launcher = this.page.getByRole('button', { name: this.options.launcherName });
		await launcher.waitFor({ state: 'visible', timeout: 60_000 });
		await launcher.click();
		await this.page.getByLabel('Instance Name').fill(instanceName);
		await this.page.getByText('Advanced', { exact: true }).click();
		await this.page.getByLabel('SSH Public Key').fill(sshPublicKey);
		await this.page
			.getByRole('button', { name: this.options.connectWalletName, exact: true })
			.click();
	}
}

// Dial BOTH browsers at each relay address concurrently and keep retrying
// until both hold a connection to the relay peer, or the readiness window
// elapses. Freshly provisioned relays can take minutes to become
// browser-dialable (guest boot + AutoTLS), so both browsers must share one
// window rather than burning it sequentially — this mirrors the currently
// green main behaviour (a per-agent sequential dial wastes the window and
// can miss a slow relay by a hair).
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

const evidence = createRelayEvidence({
	instanceName: `simple-todo-e2e-${Date.now()}`,
	ownerAddress: account.address,
	steps: {
		walletAndManifest: 'Wallet connected and relay manifest accepted',
		instanceProvisioned: 'Aleph relay VM provisioned',
		bootstrapPublished: 'Browser multiaddress published to Aleph',
		browserAConnected: 'Browser A connected through custom multiaddress',
		browserBConnected: 'Browser B connected through custom multiaddress',
		pubsubReady: 'Both browsers joined the Relay PubSub topic',
		sharedDatabase: 'Both browsers opened the same default OrbitDB address',
		browserPeersConnected: 'Browser-to-browser relay connection established',
		replicationAToB: 'TODO replicated from browser A to browser B',
		replicationBToA: 'TODO replicated from browser B to browser A',
		cleanup: 'Temporary Aleph relay forgotten and deallocated'
	}
});

const relayTest = createRelayTest({ account, evidence });

relayTest.describe('Sponsor Relay button', () => {
	relayTest.skip(
		!PRIVATE_KEY,
		'RELAY_BUTTON_E2E_PRIVATE_KEY is required to provision an Aleph relay.'
	);
	relayTest.skip(
		!SSH_PUBLIC_KEY,
		'RELAY_BUTTON_E2E_SSH_PUBLIC_KEY is required to provision an Aleph relay.'
	);
	relayTest.setTimeout(30 * 60_000);

	relayTest(
		'provisions a relay and replicates the main database between two browsers',
		async ({ browser, relayLifecycle }) => {
			await mkdir(OUTPUT_DIR, { recursive: true });
			const instanceName = evidence.instanceName;
			const startedAt = Date.now();
			const deploymentContext = await browser.newContext();
			await installEip1193WalletMock(deploymentContext, account);
			// Enable @le-space/ui controller tracing so deploy-phase diagnostics
			// (CRN selection, allocation notify, failover) reach the browser
			// console, where the handler below forwards them into the CI log.
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

			const pass = (step, detail = '') => {
				updateRelayEvidenceStep(evidence, step, 'passed', detail);
				progress(`PASSED: ${evidence.steps[step].label}${detail ? ` (${detail})` : ''}`);
			};

			const agentA = new TodoBrowserAgent('relay-e2e-a', browser, APP_URL, REPLICATION_TIMEOUT);
			const agentB = new TodoBrowserAgent('relay-e2e-b', browser, APP_URL, REPLICATION_TIMEOUT);
			let testError = null;

			try {
				progress(
					`starting relay provisioning E2E as ${account.address} (instance ${instanceName})`
				);

				// Phase 1: Wallet + manifest + provision (deploy → instance → bootstrap).
				await deploymentPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
				const relay = await relayLifecycle.provision(deploymentPage, {
					instanceName,
					sshPublicKey: SSH_PUBLIC_KEY,
					startedAt,
					driver: new SvelteRelayButtonDriver(deploymentPage),
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

				// Phase 2: Browser A + B connect to the freshly provisioned relay.
				await Promise.all([agentA.open(), agentB.open()]);
				const relayConnection = await connectBrowsersToRelay(
					[agentA, agentB],
					relayAddresses,
					relay.peerId
				);
				evidence.relayConnection = relayConnection;
				pass('browserAConnected', relayConnection.address);
				pass('browserBConnected', relayConnection.address);

				// Phase 3: Both browsers subscribed to the app PubSub topic via the relay.
				const [subscribersA, subscribersB] = await Promise.all([
					waitForPubsubSubscriber(agentA.page, {
						topic: PUBSUB_TOPIC,
						peerId: relay.peerId,
						timeoutMs: PUBSUB_TIMEOUT,
						stableForMs: 2_000
					}),
					waitForPubsubSubscriber(agentB.page, {
						topic: PUBSUB_TOPIC,
						peerId: relay.peerId,
						timeoutMs: PUBSUB_TIMEOUT,
						stableForMs: 2_000
					})
				]);
				evidence.pubsubReadiness = { agentA: subscribersA, agentB: subscribersB };
				pass('pubsubReady', `${relay.peerId} stable on ${PUBSUB_TOPIC} in both browsers`);

				// Phase 4: Same default OrbitDB + a direct browser-to-browser dial.
				// Both browsers run on the same CI runner and each advertise a public
				// relay-circuit address first (waitForPublicDialAddress), so the direct
				// WebRTC connection is reliable here — unlike the cross-host
				// remote-replication scenario, which is intentionally relay-mediated.
				await Promise.all([agentA.waitForPublicDialAddress(), agentB.waitForPublicDialAddress()]);
				const [diagnosticsA, diagnosticsB] = await Promise.all([
					agentA.diagnostics(),
					agentB.diagnostics()
				]);
				expect(diagnosticsA.databaseAddress).toBe(diagnosticsB.databaseAddress);
				pass('sharedDatabase', diagnosticsA.databaseAddress);

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

				// Phase 5: Bidirectional OrbitDB replication of the app's TODO list.
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
				// Drive the shared cleanup explicitly (CRN erase + Aleph FORGET) so
				// its result lands in the evidence written below; the fixture's
				// automatic teardown then finds nothing tracked and is a no-op.
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
