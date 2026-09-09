// Where a reader publishes the key that others seal to.
//
// Phase 2 of #277. The envelope in ./key-wrapping.js seals a database key to
// one recipient's public key, which means the sender has to *find* that key
// first. `acl01`'s own registry cannot serve: it is opened `write:
// [identity.id]`, private per identity, so nobody else can read it. This is
// the small public directory #277 asks for, and it is the same shape as
// yogasuci's key store.
//
// Publicly writable, because everybody publishes their own entry and nobody
// can be asked to approve them first.
//
// **Which is exactly why a lookup verifies the writer.** A directory keyed by
// DID that anybody may write to invites the one attack that would void the
// whole envelope: Eve puts *her* public key under Bob's DID, Alice grants Bob,
// the key is wrapped to Eve, and Eve reads the list while Bob cannot. So an
// entry counts only when the identity that signed it is the DID it claims.
// OrbitDB carries that on the log entry, and it is not forgeable — writing as
// Bob needs Bob's signing key.
//
// The cost is that a lookup walks the log instead of asking the index, and
// resolves one identity per candidate entry. For a directory holding one entry
// per reader that is the right trade: the index cannot answer "who wrote
// this", and that is the only question that makes the answer trustworthy.

import { IPFSAccessController } from '@orbitdb/core';

import { ownDeviceKeys } from './device-keys.js';

export const KEY_DIRECTORY_NAME = 'privacy01-key-directory';

/**
 * Open the shared directory.
 *
 * @param {any} orbitdb
 * @returns {Promise<any>}
 */
export async function openKeyDirectory(orbitdb) {
	return orbitdb.open(KEY_DIRECTORY_NAME, {
		type: 'keyvalue',
		create: true,
		sync: true,
		AccessController: IPFSAccessController({ write: ['*'] })
	});
}

/**
 * Put this identity's encryption key where others can seal to it.
 *
 * Idempotent: republishing the same key on every start would add an entry to
 * a shared log on every page load, for nothing.
 *
 * @param {any} orbitdb
 * @param {any} directory
 * @returns {Promise<string>} the published public key
 */
export async function publishOwnKey(orbitdb, directory) {
	const did = orbitdb.identity.id;
	const { publicKey } = await ownDeviceKeys(did);

	if ((await lookupKey(orbitdb, directory, did)) === publicKey) return publicKey;

	await directory.put(did, publicKey);
	return publicKey;
}

/**
 * The key somebody published for themselves, or null.
 *
 * Null rather than a throw when there is none: a DID that has never opened
 * this chapter has no key, and the caller has something useful to say about
 * that ("granted, but they have not published a key yet") which an exception
 * would turn into a failure.
 *
 * @param {any} orbitdb
 * @param {any} directory
 * @param {string} did
 * @returns {Promise<string | null>}
 */
export async function lookupKey(orbitdb, directory, did) {
	const entries = (await directory.log?.values?.()) ?? [];

	// Newest first: a reader who republished after losing their pair has two
	// entries, and the later one is the one to seal to.
	for (const entry of [...entries].reverse()) {
		const payload = entry?.payload;
		if (payload?.key !== did) continue;

		const identity = await orbitdb.identities?.getIdentity?.(entry.identity);
		if (identity?.id !== did) {
			// Somebody wrote a key under a DID that is not theirs. Skipped rather
			// than trusted, and skipped quietly rather than thrown: the honest
			// entry may be further down the same log.
			continue;
		}

		return payload.value ?? null;
	}

	return null;
}
