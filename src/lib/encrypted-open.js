// Opening a todo list that seals what it holds.
//
// Phase 1 of #277: the seam between OrbitDB's `open` and this chapter's
// encryption, so that neither `db-actions.js` nor `p2p.js` has to know how a
// key is found. Ported in spirit from Le-Space/yogasuci's `encrypted-open.js`.
//
// The identifier is the **address**, and that is the whole difficulty. A list
// is created under a name — `orbitdb.open('groceries-m4x2')` — and after a
// reload it is opened by address, because that is what the registry keeps. A
// key filed under the name would be looked for under the address and not
// found, a fresh one would be generated, and the list somebody wrote yesterday
// would be unreadable today. The address is the only identifier both paths
// share, so a newly created list has its key written down once its address
// exists.
//
// A key can arrive two ways. This browser made it, because it made the list;
// or somebody sealed a copy for this reader when they granted it access, and
// `findSharedKey` goes and gets it (#277 phase 2). A copy that opens is
// written down locally, so the second visit costs nothing.
//
// What this does *not* do is invent a key for an address. That would seal
// somebody else's list under a key its owner does not have — a broken list
// rather than a private one. Inventing happens only where a list is created.

import { canRememberKeys, rememberDatabaseKey, storedDatabaseKey } from './database-keys.js';
import { newKey } from './db-encryption.js';
import { payloadEncryption } from './entry-encryption.js';

/** @param {string} target */
const isAddress = (target) => target.trim().startsWith('/orbitdb/');

/**
 * Open a database whose entries are sealed under a key held on this device.
 *
 * Falls back to opening in the clear when no key can be kept — a browser with
 * storage blocked still gets a working list rather than one it cannot read
 * after the next reload.
 *
 * @param {any} orbitdb
 * @param {string} target an existing `/orbitdb/…` address, or a name to create
 * @param {Record<string, any>} options passed through to `orbitdb.open`
 * @param {{ newKey?: () => Uint8Array, findSharedKey?: (address: string) => Promise<Uint8Array | null>, closeExisting?: (address: string) => Promise<void> }} [deps]
 * @returns {Promise<any>}
 */
export async function openEncrypted(orbitdb, target, options = {}, deps = {}) {
	const create = deps.newKey ?? newKey;

	if (isAddress(target)) {
		// Only a key that is already here. Inventing one for an address would
		// seal somebody else's list under a key its owner does not have — and
		// this is also what decides it, rather than the list registry, which does
		// not survive a reload in this chapter (see e2e/list-registry.spec.js)
		// while local storage does.
		const address = target.trim();
		let key = storedDatabaseKey(address);

		if (!key) {
			// Nothing here yet. Somebody may have sealed a copy for this reader
			// when they granted it access; that is what makes a granted list
			// readable rather than a wall of sealed bytes.
			key = (await deps.findSharedKey?.(address)) ?? null;
			if (key) {
				// Written down so the next open does not go looking again. Best
				// effort: a browser without storage still reads this session.
				rememberDatabaseKey(address, key);

				// And the instance already open for this address has to go first.
				// `orbitdb.open` returns a cached database when it has one and
				// ignores the options entirely (`orbitdb.js:121-123`), so a reader
				// that opened this list before it was admitted would get that
				// plain instance back — decryptor passed, no decryptor attached,
				// and the list stays as unreadable as it was.
				await deps.closeExisting?.(address);
			}
		}

		if (!key) return orbitdb.open(target, options);

		return orbitdb.open(target, { ...options, encryption: await payloadEncryption(key) });
	}

	// A name: the database does not exist yet, so its address does not either.
	if (!canRememberKeys()) return orbitdb.open(target, options);

	const key = create();
	const database = await orbitdb.open(target, {
		...options,
		encryption: await payloadEncryption(key)
	});

	const address = database?.address?.toString?.() ?? '';
	if (address) rememberDatabaseKey(address, key);
	else console.warn('Opened an encrypted list with no address to file its key under.');

	return database;
}
