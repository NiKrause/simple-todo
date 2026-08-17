import { writable } from 'svelte/store';
import { OrbitDBAccessController } from '@orbitdb/core';

/**
 * The list registry (acl01, issue #114).
 *
 * Which lists you own is itself data, so it lives in its own OrbitDB database
 * rather than in localStorage: it then replicates with the identity, and the
 * same passkey on a second device finds the same lists.
 *
 * ## Why the name is derived from a signature
 *
 * OrbitDB's access controller governs *append*, not read. Anyone who knows an
 * address can replicate and read it. A registry named after the identity — say
 * `todo-lists-${identity.id}` — would therefore be derivable by anyone who has
 * seen your DID, and your DID is attached to every todo you write. That would
 * turn "someone must hand you the address" into "anyone who saw one of your
 * entries can enumerate and read every list you own".
 *
 * Instead the name is derived from a signature the identity produces over a
 * fixed domain string. Ed25519 signatures are deterministic (RFC 8032), so the
 * same identity always derives the same name, on any device, with no extra
 * storage — while nobody without the private key can compute it.
 *
 * The registry itself is still world-readable to anyone who obtains its
 * address. It hides *which* registry is yours, not its contents.
 */

const DOMAIN = 'simple-todo/list-registry/v1';

/**
 * `shared` is the public mnemonic list every browser opens at startup. It is
 * neither owned nor guested: anyone who knows the mnemonic can write to it.
 * @typedef {'owner' | 'guest' | 'shared'} ListRole
 */
/** @typedef {{ address: string, name: string, role: ListRole, createdAt: number }} ListEntry */

/** Lists known to this identity, newest first. */
export const listRegistryStore = writable(/** @type {ListEntry[]} */ ([]));

/** True once the registry database is open; the UI hides the switcher until then. */
export const listRegistryReadyStore = writable(false);

/**
 * The derived database name. Surfaced so the property this whole design rests
 * on — that the name is not derivable from the public DID — is observable, and
 * therefore testable. It is your own name in your own browser; nothing about
 * exposing it here weakens the guarantee.
 */
export const listRegistryNameStore = writable('');

/** @type {any} */
let registryDB = null;
/** @type {Promise<any> | null} */
let opening = null;

/**
 * Derive the registry's database name for this identity.
 *
 * @param {any} orbitdb
 * @returns {Promise<string>}
 */
export async function deriveRegistryName(orbitdb) {
	const identities = orbitdb?.identities;
	const identity = orbitdb?.identity;
	if (!identities?.sign || !identity) {
		throw new Error('Cannot derive the registry name without a signing identity.');
	}

	const signature = await identities.sign(identity, DOMAIN);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(signature)));
	const hex = Array.from(new Uint8Array(digest))
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `list-registry-${hex}`;
}

/**
 * Open (or create) this identity's registry. Safe to call repeatedly; the
 * database is opened once and reused, and concurrent callers share the same
 * in-flight promise.
 *
 * @param {any} orbitdb
 */
export async function openListRegistry(orbitdb) {
	if (registryDB) return registryDB;
	if (opening) return opening;

	opening = (async () => {
		const name = await deriveRegistryName(orbitdb);
		listRegistryNameStore.set(name);
		console.log(`📇 list registry: ${name}`);
		const db = await orbitdb.open(name, {
			type: 'keyvalue',
			create: true,
			sync: true,
			AccessController: OrbitDBAccessController({ write: [orbitdb.identity.id] })
		});
		registryDB = db;
		db.events.on('update', () => {
			void refreshRegistry();
		});
		await refreshRegistry();
		listRegistryReadyStore.set(true);
		// The peer-recovery workaround the earlier chapters need is gone here,
		// and both halves of its premise are why.
		//
		// It existed because "nothing persists locally — Helia runs in memory —
		// so after a reload the entries have to come back from the relay". In
		// this chapter the entries persist in IndexedDB, and there is no relay to
		// ask. So it could never recover anything, while still costing three
		// four-second waits and three sync restarts on every registry open.
		//
		// That was not merely wasted time. The restarts contend with the same
		// IndexedDB the open is using: creating a list went from immediate to
		// over twenty seconds and the switcher never appeared, which is how this
		// was found — four inherited list-registry tests began failing the moment
		// storage became persistent.
		return db;
	})().finally(() => {
		opening = null;
	});

	return opening;
}

/** Re-read the registry into the store. */
async function refreshRegistry() {
	if (!registryDB) return;
	const records = await registryDB.all();
	const entries = records
		.map((/** @type {any} */ record) => (record && 'value' in record ? record.value : record))
		.filter((/** @type {any} */ entry) => entry && typeof entry.address === 'string');
	entries.sort(
		(/** @type {ListEntry} */ a, /** @type {ListEntry} */ b) =>
			(b.createdAt ?? 0) - (a.createdAt ?? 0)
	);
	listRegistryStore.set(entries);
}

/**
 * Record a list. Keyed by address, so re-opening a list you already know
 * updates the entry instead of duplicating it.
 *
 * @param {any} orbitdb
 * @param {{ address: string, name: string, role: ListRole }} entry
 */
export async function rememberList(orbitdb, { address, name, role }) {
	if (!address) return;
	const db = await openListRegistry(orbitdb);

	// Asked of the database rather than of `listRegistryStore`. The store is
	// whatever was last refreshed, and adopting a passkey swaps the registry for
	// a different identity's — so a store still holding the previous identity's
	// entries would answer about a database that has never seen this address.
	// `db` is the registry that was just opened, so it cannot be the wrong one.
	const known = await db.get(address);
	/** @type {ListEntry} */
	const value = {
		address,
		// Keep the name we already had if the caller has none — a guest opening a
		// list by address knows no name for it.
		name: name || known?.name || '',
		role: known?.role === 'owner' ? 'owner' : role,
		createdAt: known?.createdAt ?? Date.now()
	};
	// The default shared list re-registers itself on every startup. Without this
	// check that would append an oplog entry per page load, growing a log that
	// says the same thing every time.
	if (known && known.name === value.name && known.role === value.role) return;
	await db.put(address, value);
	await refreshRegistry();
}

/**
 * Drop a list from the registry. The database itself is untouched — this only
 * removes it from your list of lists.
 *
 * @param {any} orbitdb
 * @param {string} address
 */
export async function forgetList(orbitdb, address) {
	const db = await openListRegistry(orbitdb);
	await db.del(address);
	await refreshRegistry();
}

/** Drop the cached handle; used when the OrbitDB instance goes away. */
export function resetListRegistry() {
	registryDB = null;
	opening = null;
	listRegistryStore.set([]);
	listRegistryReadyStore.set(false);
	listRegistryNameStore.set('');
}
