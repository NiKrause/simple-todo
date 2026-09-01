import { expect } from '@playwright/test';
import { consentModal, passConsent } from './consent.mjs';
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
	// The dialog may already have been dismissed on a previous load.
	const modal = consentModal(page);
	await modal.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	if (!(await modal.isVisible())) return;

	await passConsent(page);
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

/**
 * Flatten an `AggregateError` into a message that names what actually failed.
 *
 * `cleanupAll` throws `AggregateError`, whose own `.message` is the useless
 * constant "One or more Relay Button cleanups failed" — the individual causes
 * live in `.errors` and were being dropped on the floor. Every red run and the
 * evidence JSON therefore said only that *something* in cleanup broke, which is
 * why identifying the real cause (a 120 s wait for a bootstrap registration the
 * test's wallet is not the sender of, and so can never forget) took a second
 * 12-minute provisioning run instead of being legible in the first.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
	if (error instanceof AggregateError) {
		const causes = error.errors.map((inner) => describeError(inner)).join('; ');
		return causes ? `${error.message}: ${causes}` : error.message;
	}
	return error instanceof Error ? error.message : String(error);
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

			// Dial failures are expected on this page and carry no signal. Under
			// E2E_RELAY_MODE=isolated the bootstrap addresses point nowhere on
			// purpose: nothing listens on /ip4/127.0.0.1/tcp/4001/ws (the default
			// RELAY_BOOTSTRAP_ADDR), and E2E_PUBLIC_RELAY_BOOTSTRAP_ADDR sits on
			// port 9, which Chrome refuses outright as an unsafe port. libp2p
			// retries both for the whole provisioning window at a steady ~25
			// failures per minute — in run 31875248033 that was 313 of the step's
			// 770 lines, burying the [le-space/ui] deploy tracing that a failure
			// actually has to be read from. So forward one of each kind verbatim,
			// then only count the repeats.
			//
			// The suppression lives here rather than upstream on purpose: the
			// mixed-content collector below is a separate `console` listener and
			// still receives every message, so its assertions are unaffected.
			const DIAL_NOISE_PATTERNS = [
				{ label: 'ERR_CONNECTION_REFUSED', pattern: /ERR_CONNECTION_REFUSED/ },
				{ label: 'ERR_UNSAFE_PORT', pattern: /ERR_UNSAFE_PORT/ },
				{
					label: 'Failed to dial pubsub-discovered peer',
					pattern: /Failed to dial pubsub-discovered peer/
				}
			];
			const DIAL_NOISE_SUMMARY_INTERVAL = 60_000;
			/** @type {Map<string, number>} noise label -> lines withheld since the last summary */
			const suppressedDialFailures = new Map();
			/** Labels already shown verbatim once, so the log names what it is dropping. */
			const sampledDialFailures = new Set();
			let lastDialSummaryAt = Date.now();

			// Driven by arriving messages rather than a timer (no interval to clear,
			// nothing keeping the process alive), which means the last stretch of
			// noise can outlive the final periodic summary — hence the flush in
			// `finally` below, after which no count is lost.
			const summarizeDialFailures = () => {
				if (suppressedDialFailures.size === 0) return;
				const counts = [...suppressedDialFailures.entries()];
				const total = counts.reduce((sum, [, count]) => sum + count, 0);
				// Sorted by label, not by insertion: consecutive summaries then list
				// the same kinds in the same order and can be read down the column.
				const detail = counts
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([label, count]) => `${count}x ${label}`)
					.join(', ');
				suppressedDialFailures.clear();
				lastDialSummaryAt = Date.now();
				progress(`[deploy-page] suppressed ${total} dial failures (${detail})`);
			};

			deploymentPage.on('console', (message) => {
				const text = message.text();
				const type = message.type();
				// Controller tracing is never collapsed, even if a trace happens to
				// mention a dial failure: forwarding it is why this handler exists.
				const isTrace = text.includes('[le-space/ui]');
				// Unchanged forwarding predicate, applied before the noise test so
				// this can only ever drop lines the old handler printed, never
				// promote a level it already ignored.
				if (!isTrace && type !== 'error' && type !== 'warning') return;

				const noise = isTrace
					? undefined
					: DIAL_NOISE_PATTERNS.find(({ pattern }) => pattern.test(text));

				if (noise) {
					if (!sampledDialFailures.has(noise.label)) {
						sampledDialFailures.add(noise.label);
						progress(`[deploy-page ${type}] ${text.slice(0, 500)} (repeats suppressed)`);
						return;
					}
					// Counts only what was actually withheld, so the sample line
					// above is not double-reported in the totals.
					suppressedDialFailures.set(
						noise.label,
						(suppressedDialFailures.get(noise.label) ?? 0) + 1
					);
					if (Date.now() - lastDialSummaryAt >= DIAL_NOISE_SUMMARY_INTERVAL) {
						summarizeDialFailures();
					}
					return;
				}

				progress(`[deploy-page ${type}] ${text.slice(0, 500)}`);
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
				// Close the deployment page BEFORE erasing the VM, not after.
				//
				// `provision()` returns as soon as the relay is usable — its
				// browser-reachable multiaddr is published and dialable, which is
				// everything this test asserts. The deploy controller behind the
				// page is not finished at that point: it keeps polling for the
				// slower 2n6 HTTPS route ("2n6 activation N/120") and, if that
				// probe fails, treats the CRN as bad and fails over to another one.
				//
				// Leaving the page open through cleanup made the test its own
				// saboteur. `cleanupAll()` erased the VM out from under the still
				// running controller, which ~2 minutes later concluded "NtS9
				// failed: The relay VM did not confirm that it [is running].
				// Cleaning up this attempt before retrying another CRN", FORGOT the
				// instance (racing our own FORGET, which is what made `cleanupAll`
				// throw its AggregateError) and then provisioned a *brand new*
				// INSTANCE on a different CRN. Nothing tracked that one, so the
				// orphan sweep below caught it and — correctly, by its own rules —
				// failed the run for an untracked instance.
				//
				// That is what kept this workflow red on every run since the sweep
				// landed in #157, while every functional assertion passed —
				// including both replication directions. 31875248033
				// (464fd753… → aa99bf80…) and 31873229839 (d4e32d01… → dc177395…)
				// are the same sequence twice, and the Aleph INSTANCE listing for
				// the E2E wallet shows neither orphan survived. Closing the
				// context here removes the controller before it can observe the
				// erase, so there is no failover and no orphan to sweep.
				//
				// Consequence, by design: `cleanupRelay` opens with a UI delete
				// (`driver.requestDelete`) and silently falls through to the signed
				// API path — CRN erase + Aleph FORGET — when that throws. With the
				// page gone the UI attempt always throws, so cleanup now always
				// takes the API path. That is the path that actually works here
				// (the UI attempt was already failing its 20 s verification in the
				// runs above), it needs no page, and it is the one whose erase and
				// forget summaries the evidence records. Asserting the UI delete
				// button itself is a separate test, not this one's job.
				//
				// Settled, never thrown: a rejection here would abort the `finally`
				// before `cleanupAll()` and the orphan sweep ever ran, turning a
				// closed page into a VM that bills forever — the exact leak #157
				// exists to prevent.
				// Last flush, immediately before the page that produces the noise goes
				// away. #173 put this at the end of `finally`, where the page used to
				// close; this branch closes it here instead, so the flush follows it
				// rather than staying behind and dropping the tail.
				summarizeDialFailures();
				await Promise.allSettled([deploymentContext.close(), agentA.close(), agentB.close()]);
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
					const detail = describeError(error);
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
