/**
 * Which account belongs to a DID (escrow01).
 *
 * Alice delegates a todo to Bob's DID; the escrow pays an address. Nothing
 * derives one from the other: Bob's account is a random key's address that
 * his passkey took over. So every passkey publishes its account in a small
 * OrbitDB database of its own, and Alice's app looks it up there before a
 * lock.
 *
 * The database is keyed to the DID through its access controller: write
 * `[did]`. Its address follows from its name and that controller, so anyone
 * can open Bob's without being told where it is, and OrbitDB accepts only
 * entries Bob's identity signed. That is what makes an entry Bob's claim.
 *
 * It is not enough on its own, and the caller checks the chain as well: an
 * account whose passkey is registered in Calibur (`isPasskeyAccount` in
 * sepolia-chain.js). Registering a public key needs no private key, so a stranger
 * could register Bob's key in their own account — but they cannot publish
 * that account under Bob's DID.
 */

import { IPFSAccessController } from '@orbitdb/core';
import { getAddress, isAddress } from 'viem';

export const ACCOUNT_DIRECTORY_NAME = 'simple-todo-escrow01-account-v1';
const ENTRY_KEY = 'account';

/**
 * @typedef {{ address: `0x${string}`, chainId: number, publishedAt: string }} PublishedAccount
 */

/**
 * @param {() => any} getOrbitdb the session's OrbitDB instance
 */
export function createAccountDirectory(getOrbitdb) {
	/** @type {Map<string, Promise<any>>} */
	const opened = new Map();

	/** @param {string} did */
	function open(did) {
		const orbitdb = getOrbitdb();
		if (!orbitdb) throw new Error('OrbitDB is not running.');
		const key = `${orbitdb.identity.id}\n${did}`;
		const known = opened.get(key);
		if (known) return known;
		const database = orbitdb.open(ACCOUNT_DIRECTORY_NAME, {
			type: 'keyvalue',
			AccessController: IPFSAccessController({ write: [did] })
		});
		database.catch(() => opened.delete(key));
		opened.set(key, database);
		return database;
	}

	return {
		/**
		 * Publish this session's account. Only its own DID can: OrbitDB refuses
		 * the entry otherwise.
		 *
		 * @param {string} did
		 * @param {{ address: `0x${string}`, chainId: number }} account
		 */
		async publish(did, { address, chainId }) {
			const database = await open(did);
			const current = parsePublished(await database.get(ENTRY_KEY), chainId);
			if (current && current.address === getAddress(address)) return;
			await database.put(ENTRY_KEY, {
				address: getAddress(address),
				chainId,
				publishedAt: new Date().toISOString()
			});
		},

		/**
		 * The account `did` published, waiting up to `timeoutMs` for it to
		 * replicate from another peer.
		 *
		 * @param {string} did
		 * @param {{ chainId: number, timeoutMs?: number }} options
		 * @returns {Promise<PublishedAccount | null>}
		 */
		async lookup(did, { chainId, timeoutMs = 20_000 }) {
			const database = await open(did);
			const read = async () => parsePublished(await database.get(ENTRY_KEY), chainId);
			const found = await read();
			if (found || timeoutMs <= 0) return found;

			return new Promise((resolve) => {
				let settled = false;
				/** @param {PublishedAccount | null} value */
				const finish = (value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					database.events.off('update', onUpdate);
					resolve(value);
				};
				const onUpdate = () => {
					void read().then((value) => value && finish(value));
				};
				const timer = setTimeout(() => void read().then(finish), timeoutMs);
				database.events.on('update', onUpdate);
			});
		}
	};
}

/**
 * A published entry, or null for anything malformed or for another chain.
 *
 * @param {any} value
 * @param {number} chainId
 * @returns {PublishedAccount | null}
 */
export function parsePublished(value, chainId) {
	if (!value || typeof value !== 'object' || value.chainId !== chainId) return null;
	if (typeof value.address !== 'string' || !isAddress(value.address)) return null;
	return {
		address: getAddress(value.address),
		chainId,
		publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : ''
	};
}
