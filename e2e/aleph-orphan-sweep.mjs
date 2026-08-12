import { createHash } from 'node:crypto';
import { forgetAlephMessages } from '@le-space/core';

// A safety net under `relayLifecycle.cleanupAll()`, which can only clean what
// `provision()` handed it. Run 31620282999 showed that is not enough: the
// tracked INSTANCE was forgotten correctly, and a *second* INSTANCE carrying
// the same `metadata.name` appeared at 17:06:12 UTC — inside the cleanup window,
// after `provision()` had already returned. Nothing tracked it, so nothing
// cleaned it, and the test still reported "Aleph VM ... was left running" while
// naming the instance that was in fact gone.
//
// This sweeps by owner + instance name instead of by remembered hash, so it
// catches an orphan no matter which code path created it. What creates the
// second INSTANCE is still unknown; this stops it costing money in the
// meantime, and — because the sweep reports exactly what it found — the next
// run says which hash survived instead of guessing.

const HASH_PATTERN = /^[a-f0-9]{64}$/iu;

/**
 * Instances that belong to this run and are still alive.
 *
 * The listing endpoint omits forgotten messages entirely, so presence is the
 * liveness signal — do NOT filter on `status`, which the listing leaves
 * undefined (the single-message endpoint sets it, the listing does not).
 *
 * @param {Array<any>} messages as returned in `messages` by the listing endpoint
 * @param {{ instanceName: string, ignoreHashes?: Iterable<string> }} options
 * @returns {string[]} item hashes, deduplicated
 */
export function selectOrphanInstanceHashes(messages, { instanceName, ignoreHashes = [] }) {
	const ignored = new Set([...ignoreHashes].map((hash) => hash.toLowerCase()));
	const hashes = new Set();

	for (const message of messages ?? []) {
		if (message?.content?.metadata?.name !== instanceName) continue;
		const hash = String(message?.item_hash ?? '').toLowerCase();
		if (!HASH_PATTERN.test(hash) || ignored.has(hash)) continue;
		hashes.add(hash);
	}

	return [...hashes];
}

/**
 * @param {{ ownerAddress: string, apiHost: string, fetch: typeof globalThis.fetch, pagination?: number }} options
 * @returns {Promise<Array<any>>}
 */
async function listInstanceMessages({ ownerAddress, apiHost, fetch, pagination = 60 }) {
	const url = new URL('/api/v0/messages.json', apiHost);
	url.searchParams.set('addresses', ownerAddress);
	url.searchParams.set('msgType', 'INSTANCE');
	url.searchParams.set('pagination', String(pagination));

	const response = await fetch(url.toString(), { cache: 'no-cache' });
	if (!response.ok) throw new Error(`INSTANCE listing failed: ${response.status}`);
	const payload = await response.json();
	return Array.isArray(payload?.messages) ? payload.messages : [];
}

/**
 * Find and forget any INSTANCE for `instanceName` that survived cleanup.
 *
 * Never throws: a sweep that fails must not mask the test's own result, and the
 * caller decides what a leftover means. The summary distinguishes "nothing was
 * left" from "the sweep could not tell", which the old failure message could not.
 *
 * @param {{
 *   account: { address: string, signMessage: (input: { message: string }) => Promise<string> },
 *   instanceName: string,
 *   apiHosts: string[],
 *   fetch?: typeof globalThis.fetch,
 *   ignoreHashes?: Iterable<string>
 * }} options
 * @returns {Promise<{ swept: string[], survived: string[], checked: boolean, detail: string }>}
 */
export async function sweepOrphanInstances({
	account,
	instanceName,
	apiHosts,
	fetch = globalThis.fetch.bind(globalThis),
	ignoreHashes = []
}) {
	let messages = null;
	let listError = 'No Aleph API host attempted.';

	for (const apiHost of apiHosts) {
		try {
			messages = await listInstanceMessages({
				ownerAddress: account.address,
				apiHost,
				fetch
			});
			listError = '';
			break;
		} catch (error) {
			listError = error instanceof Error ? error.message : String(error);
		}
	}

	if (messages === null) {
		return {
			swept: [],
			survived: [],
			checked: false,
			detail: `orphan sweep could not list INSTANCEs: ${listError}`
		};
	}

	const orphans = selectOrphanInstanceHashes(messages, { instanceName, ignoreHashes });
	if (orphans.length === 0) {
		return { swept: [], survived: [], checked: true, detail: 'no orphaned INSTANCE remained' };
	}

	const signer = (/** @type {string} */ _sender, /** @type {string} */ payload) =>
		account.signMessage({ message: payload });
	const hasher = (/** @type {string} */ content) =>
		createHash('sha256').update(content).digest('hex');

	const swept = [];
	const survived = [];

	for (const hash of orphans) {
		let forgotten = false;
		for (const apiHost of apiHosts) {
			try {
				const result = await forgetAlephMessages({
					sender: account.address,
					hashes: [hash],
					reason: `Orphan sweep after Relay Button cleanup (${instanceName})`,
					signer,
					hasher,
					fetch,
					apiHost,
					sync: true
				});
				if (result.status === 'rejected') continue;
				forgotten = true;
				break;
			} catch {
				// try the next host
			}
		}
		(forgotten ? swept : survived).push(hash);
	}

	const parts = [];
	if (swept.length) parts.push(`forgot orphaned INSTANCE(s): ${swept.join(', ')}`);
	if (survived.length) parts.push(`FAILED to forget: ${survived.join(', ')}`);

	return { swept, survived, checked: true, detail: parts.join('; ') };
}
