#!/usr/bin/env node
/**
 * Fails fast when `static/rootfs-manifest.json` points at a rootfs image that no
 * longer exists on Aleph.
 *
 * The Relay Button provisions real relays from that manifest. When the
 * referenced STORE message is pruned or forgotten, the deploy is rejected deep
 * inside the Aleph tooling with a bare `error 301 — Referenced message(s): …`,
 * which reads like an infrastructure outage rather than a stale pin. Checking it
 * up front turns that into an actionable message.
 */
import { readFile } from 'node:fs/promises';

const MANIFEST_PATH = process.env.ROOTFS_MANIFEST_PATH || 'static/rootfs-manifest.json';
const API_HOSTS = (process.env.ALEPH_API_HOSTS || 'https://api2.aleph.im,https://api.aleph.im')
	.split(',')
	.map((host) => host.trim())
	.filter(Boolean);
const TIMEOUT_MS = Number(process.env.ROOTFS_MANIFEST_CHECK_TIMEOUT_MS || 15_000);

const ITEM_HASH_RE = /^[a-f0-9]{64}$/iu;

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const { rootfsItemHash, rootfsCid, version, profile } = manifest;

if (!ITEM_HASH_RE.test(rootfsItemHash ?? '')) {
	throw new Error(
		`${MANIFEST_PATH}: rootfsItemHash must be a 64 character hex value, got ${JSON.stringify(rootfsItemHash)}`
	);
}

/**
 * @param {string} apiHost
 * @returns {Promise<{ found: boolean, detail: string }>}
 */
async function lookup(apiHost) {
	const url = new URL('/api/v0/messages.json', apiHost);
	url.searchParams.set('hashes', rootfsItemHash);
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) return { found: false, detail: `HTTP ${response.status}` };
	const payload = await response.json();
	const message = payload.messages?.[0];
	if (!message) return { found: false, detail: 'no STORE message returned' };
	if (message.type !== 'STORE') return { found: false, detail: `unexpected type ${message.type}` };
	return { found: true, detail: `STORE, item_type=${message.content?.item_type ?? 'unknown'}` };
}

const observations = [];
for (const apiHost of API_HOSTS) {
	try {
		const result = await lookup(apiHost);
		if (result.found) {
			console.log(
				`✓ rootfs ${rootfsItemHash.slice(0, 12)}… (${profile} ${version}) is available on Aleph — ${result.detail} via ${apiHost}`
			);
			process.exit(0);
		}
		observations.push(`${apiHost}: ${result.detail}`);
	} catch (error) {
		observations.push(`${apiHost}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

throw new Error(
	[
		`Rootfs referenced by ${MANIFEST_PATH} is gone from Aleph.`,
		`  rootfsItemHash: ${rootfsItemHash}`,
		`  rootfsCid:      ${rootfsCid}`,
		`  version:        ${profile} ${version}`,
		'',
		'Every Relay Button provisioning will fail with "Aleph rejected this deployment',
		'(error 301)" until the manifest is bumped to a rootfs that is still published.',
		'Publish a fresh rootfs (orbitdb-relay "Aleph Rootfs Build, Publish & Deploy")',
		'and update the manifest with the new rootfsItemHash/rootfsCid.',
		'',
		`Checked: ${observations.join(' | ')}`
	].join('\n')
);
