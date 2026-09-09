// The wrapped copies: one database key, sealed once per reader who may have it.
//
// Phase 2 of #277. `key-directory.js` says where to find a reader's public
// key; `key-wrapping.js` seals to it; this is where the results are kept so
// the reader can come and get one.
//
// **Not inside the list they unlock.** That is the obvious place and it cannot
// work: the list is sealed under the very key the copy carries, so a reader
// without it could not read the copy either. A separate, unsealed store is
// what breaks the circle.
//
// One store for all lists, keyed by list address and recipient, rather than
// one store per list: a reader opening a list they were granted has to find
// their copy knowing only the address, and a store per list would mean
// deriving and opening a second database before the first.
//
// Publicly writable, and — unlike the directory — that needs no verification
// of who wrote what. A forged copy is simply one that does not open: it was
// not sealed to this reader's key, so AES-GCM refuses it. So every candidate
// is tried and the first that opens is the answer. Nothing has to be trusted,
// which is a better position than checking a signature and hoping the check
// is right.

import { IPFSAccessController } from '@orbitdb/core';

import { unwrapKey, wrapKey } from './key-wrapping.js';
import { importDeviceKey } from './device-keys.js';
import { lookupKey } from './key-directory.js';

export const SHARED_KEYS_NAME = 'privacy01-shared-keys';

/** @param {string} listAddress @param {string} did */
const entryKey = (listAddress, did) => `${listAddress}|${did}`;

/**
 * Open the store the wrapped copies live in.
 *
 * @param {any} orbitdb
 * @returns {Promise<any>}
 */
export async function openSharedKeys(orbitdb) {
	return orbitdb.open(SHARED_KEYS_NAME, {
		type: 'keyvalue',
		create: true,
		sync: true,
		AccessController: IPFSAccessController({ write: ['*'] })
	});
}

/**
 * Seal a list's key for one reader and publish the copy.
 *
 * Returns what happened rather than throwing on the ordinary case: a DID that
 * has been granted write access but has never opened this chapter has no
 * published key, and the person who granted it needs to be told that in words
 * rather than shown a failure. #277 asks for exactly that — "a DID with no
 * published encryption key is named rather than silently skipped".
 *
 * @param {any} orbitdb
 * @param {{ directory: any, store: any }} databases
 * @param {{ listAddress: string, recipientDid: string, databaseKey: Uint8Array }} what
 * @returns {Promise<{ shared: boolean, reason?: 'no-published-key' }>}
 */
export async function shareKeyWith(orbitdb, { directory, store }, what) {
	const { listAddress, recipientDid, databaseKey } = what;
	const published = await lookupKey(orbitdb, directory, recipientDid);
	if (!published) return { shared: false, reason: 'no-published-key' };

	const copy = await wrapKey(databaseKey, await importDeviceKey(published));
	await store.put(entryKey(listAddress, recipientDid), copy);

	return { shared: true };
}

/**
 * The key for a list, if somebody sealed one for this reader.
 *
 * Every candidate is tried, newest first, because a keyvalue index keeps only
 * the last value written under a key and anybody may write one. A copy that
 * was not meant for this reader does not open, so trying costs a failed
 * decryption and settles the question without trusting the writer.
 *
 * @param {any} store
 * @param {{ listAddress: string, did: string, privateKey: CryptoKey }} who
 * @returns {Promise<Uint8Array | null>}
 */
export async function keyForRecipient(store, { listAddress, did, privateKey }) {
	const wanted = entryKey(listAddress, did);
	const entries = (await store?.log?.values?.()) ?? [];

	for (const entry of [...entries].reverse()) {
		const payload = entry?.payload;
		if (payload?.key !== wanted || !payload?.value) continue;

		try {
			const key = await unwrapKey(payload.value, privateKey);
			if (key.length === 32) return key;
		} catch {
			// Sealed for somebody else, or altered. Both look the same from here,
			// and both mean: not this one. The next candidate may be the real one.
		}
	}

	return null;
}
