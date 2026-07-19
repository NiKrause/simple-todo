import { expect, test } from '@playwright/test';
import {
	DEFAULT_ALEPH_BOOTSTRAP_POST_TYPE,
	fetchAlephBootstrapPosts
} from '@le-space/aleph-bootstrap';
import { privateKeyToAccount } from 'viem/accounts';
import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent } from './remote/agent.mjs';
import { selectPeerDialAddress } from './remote/main-scenario.mjs';

const PRIVATE_KEY = process.env.RELAY_BUTTON_E2E_PRIVATE_KEY?.trim();
const APP_URL = process.env.RELAY_BUTTON_E2E_APP_URL ?? 'http://localhost:4173';
const OUTPUT_DIR = 'test-results/relay-button';
const PROVISION_TIMEOUT = 20 * 60_000;
const RELAY_HEALTH_TIMEOUT = 60_000;
const REPLICATION_TIMEOUT = 3 * 60_000;
const RELAY_DIAL_ATTEMPT_TIMEOUT = 20_000;
const RELAY_READINESS_TIMEOUT = 8 * 60_000;
const TEST_SSH_PUBLIC_KEY = process.env.RELAY_BUTTON_E2E_SSH_PUBLIC_KEY?.trim();

function installWalletProvider(context, account) {
	return context.exposeBinding(
		'__relayE2eWalletRequest',
		async (_source, { method, params = [] }) => {
			switch (method) {
				case 'eth_requestAccounts':
				case 'eth_accounts':
					return [account.address];
				case 'eth_chainId':
					return '0x1';
				case 'personal_sign': {
					const payload = params.find(
						(value) =>
							typeof value === 'string' &&
							value.startsWith('0x') &&
							value.toLowerCase() !== account.address.toLowerCase()
					);
					if (!payload) throw new Error('personal_sign did not contain a hex payload.');
					return account.signMessage({ message: { raw: payload } });
				}
				default:
					throw new Error(`Unsupported E2E wallet method: ${method}`);
			}
		}
	);
}

async function injectWallet(context) {
	await context.addInitScript(() => {
		const listeners = new Map();
		Object.defineProperty(window, 'ethereum', {
			configurable: true,
			value: {
				isMetaMask: true,
				request: (request) => window.__relayE2eWalletRequest(request),
				on(event, listener) {
					const eventListeners = listeners.get(event) ?? new Set();
					eventListeners.add(listener);
					listeners.set(event, eventListeners);
				},
				removeListener(event, listener) {
					listeners.get(event)?.delete(listener);
				}
			}
		});
	});
}

async function waitForBootstrapRegistration({
	page,
	ownerAddress,
	instanceName,
	instanceHash,
	startedAt
}) {
	const deadline = Date.now() + PROVISION_TIMEOUT;
	let lastSummary = 'No bootstrap posts returned.';

	while (Date.now() < deadline) {
		const deploymentFailure = await page.evaluate(() => {
			const error = document.querySelector('aside.panel .alert.error')?.textContent?.trim();
			const status = document.querySelector('aside.panel .status-text')?.textContent?.trim();
			if (error) return error;
			if (status === 'Deployment failed') return status;
			return null;
		});
		if (deploymentFailure) {
			throw new Error(`Sponsor Relay deployment failed: ${deploymentFailure}`);
		}
		const posts = await fetchAlephBootstrapPosts({
			pagination: 200,
			postType: DEFAULT_ALEPH_BOOTSTRAP_POST_TYPE
		}).catch((error) => {
			lastSummary = error instanceof Error ? error.message : String(error);
			return [];
		});
		const registration = posts.find(({ address, content }) => {
			const owner = (content?.ownerAddress ?? content?.publisherAddress ?? address)?.toLowerCase();
			const registrationId = content?.registrationId ?? '';
			const addresses = content?.browserMultiaddrs?.length
				? content.browserMultiaddrs
				: content?.multiaddrs;
			return (
				owner === ownerAddress.toLowerCase() &&
				(registrationId.includes(instanceName) || registrationId.includes(instanceHash)) &&
				Number(content?.updatedAt ?? 0) >= startedAt - 60_000 &&
				(addresses?.length ?? 0) > 0
			);
		});
		if (registration) return registration;
		lastSummary = `${posts.length} posts checked; no current registration for ${instanceName} (${instanceHash}).`;
		await new Promise((resolve) => setTimeout(resolve, 10_000));
	}

	throw new Error(`Relay bootstrap registration timed out. ${lastSummary}`);
}

async function waitForDeploymentInstance(page, instanceName) {
	const outcome = await page.waitForFunction(
		(expectedName) => {
			const instance = [...document.querySelectorAll('details')].find((element) =>
				element.textContent?.includes(expectedName)
			);
			if (instance) return { status: 'instance' };
			const error = document.querySelector('aside.panel .alert.error');
			if (error?.textContent?.trim()) return { status: 'error', message: error.textContent.trim() };
			const status = document.querySelector('aside.panel .status-text')?.textContent?.trim();
			if (status === 'Deployment failed') return { status: 'error', message: status };
			return null;
		},
		instanceName,
		{ timeout: PROVISION_TIMEOUT, polling: 500 }
	);
	const result = await outcome.jsonValue();
	if (result?.status === 'error') {
		throw new Error(`Sponsor Relay deployment failed: ${result.message}`);
	}
	const instance = page.locator('details').filter({ hasText: instanceName }).first();
	const apiHref = await instance
		.getByRole('link', { name: 'API', exact: true })
		.getAttribute('href');
	const instanceHash = apiHref?.match(/\/messages\/([^/?#]+)/)?.[1];
	if (!instanceHash) throw new Error(`Could not read the Aleph instance hash for ${instanceName}.`);
	return { instance, instanceHash };
}

function selectBrowserRelayAddresses(content) {
	const addresses = content.browserMultiaddrs?.length
		? content.browserMultiaddrs
		: (content.multiaddrs ?? []);
	return addresses
		.filter((address) => /\/(tls\/ws|wss)\/p2p\//.test(address))
		.sort((left, right) => {
			const rank = (address) =>
				address.includes('.libp2p.direct/') ? 0 : address.includes('/dns4/') ? 1 : 2;
			return rank(left) - rank(right);
		});
}

async function connectBrowsersToRelay(agents, addresses, relayPeerId) {
	const attempts = [];
	const deadline = Date.now() + RELAY_READINESS_TIMEOUT;
	while (Date.now() < deadline) {
		for (const address of addresses) {
			const dialResults = await Promise.allSettled(
				agents.map((agent) => agent.connectToMultiaddr(address))
			);
			const results = await Promise.allSettled(
				agents.map((agent) => agent.waitForPeerConnection(relayPeerId, RELAY_DIAL_ATTEMPT_TIMEOUT))
			);
			attempts.push({
				at: new Date().toISOString(),
				address,
				dialSubmitted: dialResults.map(({ status }) => status === 'fulfilled'),
				connected: results.map(({ status }) => status === 'fulfilled')
			});
			if (results.every(({ status }) => status === 'fulfilled')) return { address, attempts };
			if (Date.now() >= deadline) break;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}

	throw new Error(
		`Browsers did not connect to relay ${relayPeerId}. Attempts: ${JSON.stringify(attempts)}`
	);
}

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

async function deleteProvisionedRelay(page, instanceName) {
	if (!page || page.isClosed()) return;
	await page
		.getByRole('button', { name: 'Refresh' })
		.click()
		.catch(() => {});
	const instance = page.locator('details').filter({ hasText: instanceName }).first();
	await instance.waitFor({ state: 'visible', timeout: 60_000 });
	await instance.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(instance).toBeHidden({ timeout: 3 * 60_000 });
}

test.describe('Sponsor Relay button', () => {
	test.skip(!PRIVATE_KEY, 'RELAY_BUTTON_E2E_PRIVATE_KEY is required to provision an Aleph relay.');
	test.skip(
		!TEST_SSH_PUBLIC_KEY,
		'RELAY_BUTTON_E2E_SSH_PUBLIC_KEY is required to provision an Aleph relay.'
	);
	test.setTimeout(30 * 60_000);

	test('provisions a relay and replicates the main database between two browsers', async ({
		browser
	}) => {
		await mkdir(OUTPUT_DIR, { recursive: true });
		const account = privateKeyToAccount(
			PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`
		);
		const instanceName = `simple-todo-e2e-${Date.now()}`;
		const startedAt = Date.now();
		const deploymentContext = await browser.newContext();
		await installWalletProvider(deploymentContext, account);
		await injectWallet(deploymentContext);
		const deploymentPage = await deploymentContext.newPage();
		const agentA = new TodoBrowserAgent('relay-e2e-a', browser, APP_URL, REPLICATION_TIMEOUT);
		const agentB = new TodoBrowserAgent('relay-e2e-b', browser, APP_URL, REPLICATION_TIMEOUT);
		let deployed = false;
		let cleanupError = null;
		let testError = null;
		const evidence = {
			instanceName,
			ownerAddress: account.address,
			startedAt: new Date(startedAt).toISOString(),
			steps: {
				walletAndManifest: {
					label: 'Wallet connected and relay manifest accepted',
					status: 'pending'
				},
				instanceProvisioned: { label: 'Aleph relay VM provisioned', status: 'pending' },
				bootstrapPublished: { label: 'Browser multiaddress published to Aleph', status: 'pending' },
				healthVerified: {
					label: 'Optional relay /health diagnostic checked',
					status: 'pending'
				},
				browserAConnected: {
					label: 'Browser A connected through custom multiaddress',
					status: 'pending'
				},
				browserBConnected: {
					label: 'Browser B connected through custom multiaddress',
					status: 'pending'
				},
				sharedDatabase: {
					label: 'Both browsers opened the same default OrbitDB address',
					status: 'pending'
				},
				browserPeersConnected: {
					label: 'Browser-to-browser relay connection established',
					status: 'pending'
				},
				replicationAToB: {
					label: 'TODO replicated from browser A to browser B',
					status: 'pending'
				},
				replicationBToA: {
					label: 'TODO replicated from browser B to browser A',
					status: 'pending'
				},
				cleanup: { label: 'Temporary Aleph relay deleted', status: 'pending' }
			}
		};
		const pass = (step, detail = '') => {
			evidence.steps[step] = { ...evidence.steps[step], status: 'passed', detail };
		};
		const skip = (step, detail = '') => {
			evidence.steps[step] = { ...evidence.steps[step], status: 'skipped', detail };
		};

		try {
			await deploymentPage.goto(APP_URL, { waitUntil: 'domcontentloaded' });
			await deploymentPage.getByRole('button', { name: 'Sponsor Relay' }).click();
			await deploymentPage.getByLabel('Instance Name').fill(instanceName);
			await deploymentPage.getByText('Advanced', { exact: true }).click();
			await deploymentPage.getByLabel('SSH Public Key').fill(TEST_SSH_PUBLIC_KEY);
			await deploymentPage.getByRole('button', { name: 'Connect MetaMask' }).click();
			const deployButton = deploymentPage.getByRole('button', { name: 'Deploy Relay' });
			await expect(deployButton).toBeEnabled({ timeout: 120_000 });
			pass('walletAndManifest');
			await deployButton.click();
			const { instanceHash } = await waitForDeploymentInstance(deploymentPage, instanceName);
			deployed = true;
			evidence.instanceHash = instanceHash;
			pass('instanceProvisioned', instanceHash);

			const registration = await waitForBootstrapRegistration({
				page: deploymentPage,
				ownerAddress: account.address,
				instanceName,
				instanceHash,
				startedAt
			});
			const relayPeerId = registration.content.peerId;
			const relayAddresses = selectBrowserRelayAddresses(registration.content);
			expect(
				relayAddresses,
				'new relay must advertise a browser-reachable address'
			).not.toHaveLength(0);
			evidence.registration = registration;
			evidence.relayAddresses = relayAddresses;
			pass('bootstrapPublished', relayAddresses.join(', '));
			const healthAddress = (registration.content.multiaddrs ?? []).find((address) =>
				/\/dns[46]\/.*\.2n6\.me\/tcp\/443\/(tls\/ws|wss)\/p2p\//.test(address)
			);
			const healthPromise = healthAddress
				? waitForRelayHealth(healthAddress, relayPeerId)
						.then((health) => ({ health }))
						.catch((error) => ({ error }))
				: Promise.resolve({ error: new Error('No 2n6 health address was published.') });

			await Promise.all([agentA.open(), agentB.open()]);
			const relayConnection = await connectBrowsersToRelay(
				[agentA, agentB],
				relayAddresses,
				relayPeerId
			);
			evidence.relayAddress = relayConnection.address;
			evidence.relayDialAttempts = relayConnection.attempts;
			pass('browserAConnected', relayPeerId);
			pass('browserBConnected', relayPeerId);
			const healthResult = await healthPromise;
			if ('health' in healthResult) {
				evidence.health = healthResult.health;
				pass('healthVerified', relayPeerId);
			} else {
				const detail =
					healthResult.error instanceof Error
						? healthResult.error.message
						: String(healthResult.error);
				evidence.healthWarning = detail;
				skip('healthVerified', `Optional HTTP diagnostic unavailable: ${detail}`);
			}

			await Promise.all([agentA.waitForPublicDialAddress(), agentB.waitForPublicDialAddress()]);
			const [diagnosticsA, diagnosticsB] = await Promise.all([
				agentA.diagnostics(),
				agentB.diagnostics()
			]);
			expect(diagnosticsA.databaseAddress).toBe(diagnosticsB.databaseAddress);
			pass('sharedDatabase', diagnosticsA.databaseAddress);
			const addressForB = selectPeerDialAddress(diagnosticsB, diagnosticsB.peerId, {
				relayPeerId
			});
			expect(addressForB, 'browser B must advertise an address through the new relay').toBeTruthy();
			await agentA.connectToMultiaddr(addressForB);
			await Promise.all([
				agentA.waitForPeerConnection(diagnosticsB.peerId),
				agentB.waitForPeerConnection(diagnosticsA.peerId)
			]);
			pass('browserPeersConnected', `${diagnosticsA.peerId} ↔ ${diagnosticsB.peerId}`);

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
		}

		await Promise.allSettled([agentA.close(), agentB.close()]);
		if (deployed) {
			try {
				await deleteProvisionedRelay(deploymentPage, instanceName);
				pass('cleanup');
			} catch (error) {
				cleanupError = error instanceof Error ? error : new Error(String(error));
				evidence.steps.cleanup.status = 'failed';
				evidence.steps.cleanup.detail = cleanupError.message;
			}
		} else {
			evidence.steps.cleanup = {
				...evidence.steps.cleanup,
				status: 'skipped',
				detail: 'No VM was submitted.'
			};
		}
		evidence.finishedAt = new Date().toISOString();
		await writeFile(`${OUTPUT_DIR}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
		await deploymentContext.close();
		if (cleanupError) throw cleanupError;
		if (testError) throw testError;
	});
});
