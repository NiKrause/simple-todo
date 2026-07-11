const deployModulePath =
	process.env.ALEPH_DEPLOY_MODULE_PATH ??
	'/tmp/le-space-deployer/node_modules/@le-space/node/index.js';
const maxAttempts = Number.parseInt(process.env.ALEPH_SITE_PUBLISH_ATTEMPTS ?? '3', 10);
const initialDelayMs = Number.parseInt(
	process.env.ALEPH_SITE_PUBLISH_RETRY_DELAY_MS ?? '15000',
	10
);

if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
	throw new Error('ALEPH_SITE_PUBLISH_ATTEMPTS must be a positive integer.');
}

if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0) {
	throw new Error('ALEPH_SITE_PUBLISH_RETRY_DELAY_MS must be a non-negative integer.');
}

const { runSiteMode } = await import(deployModulePath);

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
	try {
		await runSiteMode();
		break;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const transientFailure =
			/HTTP (?:408|425|429|5\d\d)\b/i.test(message) ||
			/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(message);

		if (!transientFailure || attempt === maxAttempts) {
			throw error;
		}

		const delayMs = initialDelayMs * 2 ** (attempt - 1);
		console.warn(
			`Aleph site publication attempt ${attempt}/${maxAttempts} failed transiently: ${message}`
		);
		console.warn(`Retrying the same site build in ${delayMs}ms.`);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}
