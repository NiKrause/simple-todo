import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sanitizeAlephApiHosts } from '../e2e/remote/aleph-provider-contract.mjs';

const outputPath = 'test-results/remote-main/aleph-cleanup.json';
await mkdir('test-results/remote-main', { recursive: true });
const instanceHash = process.env.ALEPH_PLAYWRIGHT_INSTANCE_HASH?.trim();
const result = {
	instanceHash: instanceHash || null,
	runtimeErase: null,
	forget: null,
	apiConfirmation: {},
	schedulerDeallocated: false
};

async function finish(payload, failed = false) {
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
	if (process.env.GITHUB_STEP_SUMMARY) {
		await appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`\n## Aleph Playwright cleanup\n\n` +
				`- Exact INSTANCE: \`${payload.instanceHash ?? 'none'}\`\n` +
				`- Runtime erase: \`${payload.runtimeErase?.status ?? (payload.skipped ? 'skipped' : 'unknown')}\`\n` +
				`- Owner FORGET: \`${payload.forget?.status ?? (payload.skipped ? 'skipped' : 'unknown')}\`\n` +
				`- api2 confirmed: \`${payload.apiConfirmation?.['https://api2.aleph.im'] ?? false}\`\n` +
				`- api confirmed: \`${payload.apiConfirmation?.['https://api.aleph.im'] ?? false}\`\n` +
				`- Scheduler deallocated: \`${payload.schedulerDeallocated ?? false}\`\n`
		);
	}
	if (failed) process.exitCode = 1;
}

if (!instanceHash) {
	await finish({ ...result, skipped: true, reason: 'No INSTANCE hash was produced.' });
} else {
	if (!/^[a-f0-9]{64}$/iu.test(instanceHash))
		throw new Error('Refusing cleanup: invalid exact INSTANCE hash.');
	const nodeModulePath = process.env.LE_SPACE_NODE_MODULE_PATH;
	const coreModulePath = process.env.LE_SPACE_CORE_MODULE_PATH;
	if (!nodeModulePath || !coreModulePath) throw new Error('Cleanup module paths are required.');
	const [{ createPrivateKeyIdentity }, { eraseInstanceOnCrn, forgetAlephMessages }] =
		await Promise.all([
			import(pathToFileURL(nodeModulePath)),
			import(pathToFileURL(coreModulePath))
		]);
	const identity = await createPrivateKeyIdentity(process.env.ALEPH_VM_PRIVATE_KEY);
	const hosts = sanitizeAlephApiHosts(process.env.ALEPH_VM_API_HOSTS);
	const fetchImpl = globalThis.fetch.bind(globalThis);
	const hasher = async (content) => createHash('sha256').update(content).digest('hex');

	try {
		result.runtimeErase = await eraseInstanceOnCrn({
			sender: identity.address,
			signer: identity.signer,
			instanceHash,
			fetch: fetchImpl,
			apiHost: hosts[0]
		});
	} catch (error) {
		result.runtimeErase = {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error)
		};
	}

	let forgetError;
	for (const apiHost of hosts) {
		try {
			result.forget = await forgetAlephMessages({
				sender: identity.address,
				hashes: [instanceHash],
				reason: `Phase A Playwright runner cleanup for ${instanceHash}`,
				signer: identity.signer,
				hasher,
				fetch: fetchImpl,
				apiHost,
				sync: true
			});
			break;
		} catch (error) {
			forgetError = error;
		}
	}
	if (!result.forget) {
		result.forget = {
			status: 'failed',
			error: forgetError instanceof Error ? forgetError.message : String(forgetError)
		};
	}

	for (const apiHost of hosts) {
		let confirmed = false;
		for (let attempt = 0; attempt < 18; attempt += 1) {
			const response = await fetch(`${apiHost}/api/v0/messages/${instanceHash}`, {
				cache: 'no-store'
			}).catch(() => null);
			if (response?.status === 404 || response?.status === 410) {
				confirmed = true;
				break;
			}
			const payload = response?.ok ? await response.json().catch(() => ({})) : {};
			if (
				payload.forgotten === true ||
				payload.forgotten_by ||
				String(payload.status).toLowerCase() === 'forgotten'
			) {
				confirmed = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
		result.apiConfirmation[apiHost] = confirmed;
	}

	for (let attempt = 0; attempt < 18; attempt += 1) {
		const response = await fetch(
			`https://scheduler.api.aleph.cloud/api/v0/allocation/${instanceHash}`,
			{ cache: 'no-store' }
		).catch(() => null);
		if (response?.status === 404 || response?.status === 410) {
			result.schedulerDeallocated = true;
			break;
		}
		const payload = response?.ok ? await response.json().catch(() => null) : null;
		if (response?.ok && payload && (payload.vm_ipv6 === null || payload.node === null)) {
			result.schedulerDeallocated = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000));
	}

	const failed =
		!result.forget ||
		result.forget.status === 'failed' ||
		!hosts.every((host) => result.apiConfirmation[host] === true) ||
		result.schedulerDeallocated !== true;
	await finish(result, failed);
}
