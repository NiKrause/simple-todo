import { describe, expect, it } from 'vitest';
import {
	ALEPH_API_HOSTS,
	assertPlaywrightVersion,
	sanitizeAlephApiHosts,
	verifyAlephPlaywrightEndpoint
} from '../../e2e/remote/aleph-provider-contract.mjs';

describe('Aleph remote Playwright provider', () => {
	it('keeps api2 then api and removes api3 and arbitrary caller hosts', () => {
		expect(
			sanitizeAlephApiHosts('https://api3.aleph.im, https://api.aleph.im, https://evil.test')
		).toEqual(ALEPH_API_HOSTS);
		expect(sanitizeAlephApiHosts('https://api3.aleph.im')).toEqual(ALEPH_API_HOSTS);
	});

	it('fails fast on a client/server version mismatch', () => {
		expect(() => assertPlaywrightVersion('1.60.0')).toThrow(/version mismatch.*1\.61\.1/iu);
	});

	it('uses Bearer auth when checking the pinned server version', async () => {
		/** @type {HeadersInit | undefined} */
		let observedHeaders;
		/** @param {string | URL | Request} _url @param {RequestInit} [options] */
		async function fetchImpl(_url, options) {
			observedHeaders = options?.headers;
			return new Response(JSON.stringify({ playwrightVersion: '1.61.1' }), { status: 200 });
		}
		const headers = await verifyAlephPlaywrightEndpoint({
			versionUrl: 'https://runner.example/version',
			secret: 'per-run-secret',
			fetchImpl
		});
		expect(headers).toEqual({ authorization: 'Bearer per-run-secret' });
		expect(observedHeaders).toEqual(headers);
	});
});
