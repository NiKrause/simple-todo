export const PLAYWRIGHT_VERSION = '1.61.1';

export function connectWithPlaywrightHeaders(connectImpl, wsEndpoint, headers) {
	return connectImpl(wsEndpoint, { headers, timeout: 120_000 });
}
export const ALEPH_API_HOSTS = ['https://api2.aleph.im', 'https://api.aleph.im'];

/**
 * Caller configuration is deliberately ignored after parsing: Phase A has one
 * trusted order and must never inherit api3 or arbitrary API origins.
 * @param {string} value
 */
export function sanitizeAlephApiHosts(value = '') {
	const safeCallerHosts = String(value)
		.split(/[\s,]+/u)
		.map((host) => host.trim().replace(/\/+$/u, ''))
		.filter((host) => ALEPH_API_HOSTS.includes(host));
	return [...new Set([...ALEPH_API_HOSTS, ...safeCallerHosts])];
}

/** @param {unknown} serverVersion @param {string} clientVersion */
export function assertPlaywrightVersion(serverVersion, clientVersion = PLAYWRIGHT_VERSION) {
	if (serverVersion !== clientVersion) {
		throw new Error(
			`Playwright client/server version mismatch: GitHub client is ${clientVersion}, Aleph VM server is ${serverVersion || 'unknown'}. Both must be exactly ${PLAYWRIGHT_VERSION}.`
		);
	}
}

/**
 * @param {{versionUrl?: string, secret?: string, fetchImpl?: typeof globalThis.fetch}} options
 */
export async function verifyAlephPlaywrightEndpoint({
	versionUrl,
	secret,
	fetchImpl = globalThis.fetch
}) {
	if (!versionUrl?.startsWith('https://')) {
		throw new Error('ALEPH_PLAYWRIGHT_VERSION_URL must be an https:// endpoint.');
	}
	if (!secret) throw new Error('ALEPH_PLAYWRIGHT_SECRET is required for the Aleph provider.');
	const headers = { authorization: `Bearer ${secret}` };
	const response = await fetchImpl(versionUrl, { headers, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(`Aleph Playwright version preflight failed with HTTP ${response.status}.`);
	}
	const payload = await response.json();
	assertPlaywrightVersion(payload.playwrightVersion);
	return headers;
}
