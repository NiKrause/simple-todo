import { expect, test } from '@playwright/test';
import {
	DEFAULT_ALEPH_BOOTSTRAP_COMPACT_POST_TYPE,
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
const REPLICATION_TIMEOUT = 3 * 60_000;
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

async function waitForBootstrapRegistration({ page, ownerAddress, instanceHash, startedAt }) {
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
		const posts = (
			await Promise.all(
				[DEFAULT_ALEPH_BOOTSTRAP_COMPACT_POST_TYPE, DEFAULT_ALEPH_BOOTSTRAP_POST_TYPE].map(
					(postType) => fetchAlephBootstrapPosts({ pagination: 200, postType })
				)
			).catch((error) => {
				lastSummary = error instanceof Error ? error.message : String(error);
				return [];
			})
		).flat();
		const registration = posts.find(({ address, content }) => {
			const owner = (content?.ownerAddress ?? content?.publisherAddress ?? address)?.toLowerCase();
			const addresses = content?.browserMultiaddrs?.length
				? content.browserMultiaddrs
				: content?.multiaddrs;
			return (
				owner === ownerAddress.toLowerCase() &&
				content?.registrationId?.includes(instanceHash) &&
				Number(content?.updatedAt ?? 0) >= startedAt - 60_000 &&
				(addresses?.length ?? 0) > 0
			);
		});
		if (registration) return registration;
		lastSummary = `${posts.length} posts checked; no current registration for ${instanceHash}.`;
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

function selectBrowserRelayAddress(content) {
	const addresses = content.browserMultiaddrs?.length
		? content.browserMultiaddrs
		: (content.multiaddrs ?? []);
	return (
		addresses.find((address) => /\/dns4\/.*\/tcp\/443\/(tls\/ws|wss)\/p2p\//.test(address)) ??
		addresses.find((address) => address.includes('/tls/ws/')) ??
		addresses.find((address) => address.includes('/wss/')) ??
		addresses[0] ??
		null
	);
}

async function waitForRelayHealth(address, expectedPeerId) {
	const hostname = address.match(/\/dns[46]\/([^/]+)/)?.[1];
	if (!hostname) throw new Error(`Cannot derive relay health URL from ${address}`);
	const healthUrl = `https://${hostname}/health`;
	const deadline = Date.now() + 3 * 60_000;
	let lastError = 'not attempted';

	while (Date.now() < deadline) {
		try {
			const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
			const body = await response.text();
			if (response.ok && body.includes(expectedPeerId)) return { healthUrl, body };
			lastError = `${response.status}: ${body.slice(0, 300)}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
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
				healthVerified: { label: 'Relay /health endpoint and peer ID verified', status: 'pending' },
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
				instanceHash,
				startedAt
			});
			const relayPeerId = registration.content.peerId;
			const relayAddress = selectBrowserRelayAddress(registration.content);
			expect(relayAddress, 'new relay must advertise a browser-reachable address').toBeTruthy();
			evidence.registration = registration;
			evidence.relayAddress = relayAddress;
			pass('bootstrapPublished', relayAddress);
			evidence.health = await waitForRelayHealth(relayAddress, relayPeerId);
			pass('healthVerified', relayPeerId);

			await Promise.all([agentA.open(), agentB.open()]);
			await Promise.all([
				agentA.connectToMultiaddr(relayAddress),
				agentB.connectToMultiaddr(relayAddress)
			]);
			await agentA.waitForPeerConnection(relayPeerId);
			pass('browserAConnected', relayPeerId);
			await agentB.waitForPeerConnection(relayPeerId);
			pass('browserBConnected', relayPeerId);

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
				agentB.waitForPeerConnection(diagnosticsA.peerId),
				agentA.waitForDatabaseSyncPeer(),
				agentB.waitForDatabaseSyncPeer()
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
			await deploymentPage
				.screenshot({ path: `${OUTPUT_DIR}/relay-panel-error.png`, fullPage: true })
				.catch(() => {});
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
