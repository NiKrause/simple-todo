import { expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdir } from 'node:fs/promises';
import {
	createRelayTest,
	createRelayEvidence,
	updateRelayEvidenceStep,
	writeRelayEvidence,
	installEip1193WalletMock,
	SUPPORTED_ALEPH_API_HOSTS
} from '@le-space/playwright';
import { TodoBrowserAgent } from './remote/agent.mjs';
import { selectPeerDialAddress } from './remote/main-scenario.mjs';
import { sweepOrphanInstances } from './aleph-orphan-sweep.mjs';

// This spec provisions a real relay through the Relay Button UI and replicates
// the default OrbitDB between two browsers. All relay-lifecycle plumbing
// (wallet mock, deploy → instance → bootstrap registration, browser-dialable
// address selection, CRN erase + Aleph FORGET cleanup) now comes from the
// shared @le-space/playwright test kit; only the TODO-app assertions and the
// browser-to-browser dial stay here (issue #29).

const PRIVATE_KEY = process.env.RELAY_BUTTON_E2E_PRIVATE_KEY?.trim();
const SSH_PUBLIC_KEY = process.env.RELAY_BUTTON_E2E_SSH_PUBLIC_KEY?.trim();
const APP_URL = process.env.RELAY_BUTTON_E2E_APP_URL ?? 'http://localhost:4173';
const OUTPUT_DIR = 'test-results/relay-button';
// Must fit several CRN failover attempts: a single failed attempt costs
// 7-13 min (VM boot + config-ack wait + HTTPS activation wait) before the
// controller moves to the next CRN, and two flaky CRNs in a row are routine.
const PROVISION_TIMEOUT = 35 * 60_000;
const REGISTRATION_TIMEOUT = 15 * 60_000;
const RELAY_READINESS_TIMEOUT = 10 * 60_000;
const RELAY_DIAL_ATTEMPT_TIMEOUT = 20_000;
const REPLICATION_TIMEOUT = 3 * 60_000;

/**
 * Accept the consent modal, the way `TodoBrowserAgent.open` already does for
 * the two browser peers.
 *
 * The deployment page never did this. It did not look like it mattered: the
 * modal does not stop `openNetworkDetails` (which sets `open` in JS rather than
 * clicking) and `toBeVisible()` on the launcher passes straight through an
 * overlay. So the test reported progress right up to the point where the shared
 * kit clicks the launcher — and that click never became actionable, with no
 * action timeout to cut it short, so it consumed the entire 75-minute budget.
 * Every failure since the launchers moved into the panel looked like a
 * provisioning hang and was none.
 *
 * Verified both directions against this build: with the modal up, clicking the
 * launcher times out ("waiting for element to be visible, enabled and stable");
 * with it dismissed, the same click succeeds.
 *
 * @param {import('@playwright/test').Page} page
 */
async function acceptConsent(page) {
	const modal = page.locator('div.fixed.inset-0.z-50');

	await modal.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	if (!(await modal.isVisible())) return;

	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).toBeHidden();
}

/**
 * Expand the network panel that now holds both launchers.
 *
 * Set rather than clicked, unlike the other specs. This page runs the relay
 * panel's controller, which re-renders on a 30-second refresh cycle; Playwright
 * kept restarting its actionability check on the summary and the click never
 * completed, burning the full 50-minute test budget on one `click()`.
 *
 * Clicking the disclosure is still covered by `manual-multiaddr-connection` and
 * `default-database-collaboration`, which have no such polling — so driving it
 * directly here loses no coverage of the behaviour itself.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openNetworkDetails(page) {
	const networkDetails = page.getByTestId('network-details');

	await networkDetails.evaluate((element) => {
		if (element instanceof HTMLDetailsElement) {
			element.open = true;
		}
	});

	await expect(networkDetails).toHaveAttribute('open', '');
	await expect(page.getByRole('button', { name: 'Relay Button' })).toBeVisible();
}

/**
 * Live progress logging: Playwright shows no output between test start and
 * finish, so a 12-30 minute provisioning run looks frozen in CI logs.
 */
function progress(message) {
	console.log(`[relay-e2e ${new Date().toISOString()}] ${message}`);
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
	// 75, not 50. The phase budgets above already sum to 63 minutes
	// (35 provision + 15 registration + 10 readiness + 3 replication), so a
	// 50-minute cap could never let them all run — the test was unwinnable on
	// paper the moment provisioning turned slow, which CRN failover across eight
	// candidates made routine. The remainder covers app startup for three
	// browsers and the CRN erase + Aleph FORGET at the end.
	relayTest.setTimeout(75 * 60_000);

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
					host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
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

			const agentA = new TodoBrowserAgent('relay-e2e-a', browser, APP_URL, REPLICATION_TIMEOUT);
			const agentB = new TodoBrowserAgent('relay-e2e-b', browser, APP_URL, REPLICATION_TIMEOUT);
			let testError = null;
			/** Cleanup failures used to be swallowed — see the rethrow below. */
			let cleanupError = null;

			try {
				progress(
					`starting relay provisioning E2E as ${account.address} (instance ${instanceName})`
				);

				// Phase 1: Wallet + manifest + provision (deploy → instance → bootstrap).
				await deploymentPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });

				// Consent first: until it is accepted the app never initialises, and
				// nothing on the page below it can be clicked.
				await acceptConsent(deploymentPage);
				progress('consent accepted on the deployment page');

				// The Relay Button no longer floats over the app; it sits inside the
				// collapsed "Network details" panel next to the manual connect form.
				// The shared test kit waits for a *visible* launcher, so the panel has
				// to be expanded first - the same two steps a person now takes.
				await openNetworkDetails(deploymentPage);
				progress('network panel expanded, launcher visible');

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

				// Phase 3: Same default OrbitDB + a direct browser-to-browser dial.
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
				progress('PASSED: mixed-content guard (no insecure guest requests during deployment)');
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
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					updateRelayEvidenceStep(evidence, 'cleanup', 'failed', detail);
					progress(`cleanup FAILED: ${detail}`);
					cleanupError = new Error(`Relay Button cleanup failed for ${instanceName}: ${detail}`, {
						cause: error instanceof Error ? error : undefined
					});
				}

				// Always sweep, including after a clean run. `cleanupAll` can only
				// clean what `provision()` handed it, and run 31620282999 proved that
				// is not the whole story: the tracked INSTANCE was forgotten
				// correctly while a second one carrying the same `metadata.name`
				// appeared *during* cleanup and stayed alive, costing credits nobody
				// was watching. Sweeping by owner + name catches it whichever code
				// path created it.
				//
				// Nothing is passed as `ignoreHashes` on purpose: if `cleanupAll`
				// failed to forget the tracked instance, that instance is exactly
				// what still needs forgetting.
				const sweep = await sweepOrphanInstances({
					account,
					instanceName,
					apiHosts: SUPPORTED_ALEPH_API_HOSTS
				});
				progress(`orphan sweep: ${sweep.detail}`);
				evidence.orphanSweep = sweep;

				if (sweep.survived.length > 0) {
					// Still running and still billable — the only case that is about money.
					cleanupError = new Error(
						`Aleph VM ${instanceName} was left running: could not forget ${sweep.survived.join(', ')}`,
						{ cause: cleanupError ?? undefined }
					);
				} else if (sweep.swept.length > 0) {
					// Money is safe, but something created an INSTANCE the lifecycle
					// never knew about. Worth a red run: that is a real defect, and
					// staying green is how it went unnoticed in the first place.
					updateRelayEvidenceStep(evidence, 'cleanup', 'failed', sweep.detail);
					cleanupError = new Error(
						`Relay Button cleanup left an untracked INSTANCE for ${instanceName}; the sweep forgot ${sweep.swept.join(', ')}`,
						{ cause: cleanupError ?? undefined }
					);
				} else if (cleanupError && sweep.checked) {
					// The old message asserted "was left running" from a cleanup error
					// alone. That was wrong on 31620282999 — the named VM was gone.
					// Keep the run red, but say what is actually true.
					cleanupError = new Error(
						`${cleanupError.message} (no INSTANCE for ${instanceName} survived — nothing is billing)`,
						{ cause: cleanupError }
					);
				}
				evidence.finishedAt = new Date().toISOString();
				await writeRelayEvidence(`${OUTPUT_DIR}/result.json`, evidence);
				await deploymentContext.close();
			}

			// The provisioning failure is the more informative one, so it wins.
			if (testError) throw testError;
			// A surviving VM burns credits until the janitor's next sweep, up to
			// ~7 h later at a 6 h cron against a 1 h TTL. Reporting the run green
			// hid exactly that: four orphans from four "successful" runs drained
			// the E2E wallet by ~811k credits before anyone looked (#88).
			if (cleanupError) throw cleanupError;
		}
	);
});
