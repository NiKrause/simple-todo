import { MemoryStorage } from '@orbitdb/core';

/**
 * Where this browser keeps the todo data it holds.
 *
 * Like the relay-network choice, this is made on the consent screen and has to
 * outlive it: consent can be remembered, in which case the modal never renders
 * again and `initializeP2P()` runs straight from `onMount`. It also has to be
 * readable *before* Helia and OrbitDB are constructed, because it decides which
 * stores they are built with — changing it afterwards would mean tearing the
 * node down and rebuilding it.
 *
 * Two settings, not one, because persistence today is half on. OrbitDB already
 * writes its log through `ComposedStorage(LRUStorage, LevelStorage)` under
 * `directory`, and `level` resolves to `browser-level` (IndexedDB) in a browser
 * — so heads survive a reload. Helia is created without a blockstore, so it
 * falls back to `MemoryBlockstore`/`MemoryDatastore` and the blocks those heads
 * point at do not. That mismatch is issue #144; the toggle is what lets a user
 * choose which half they get rather than being surprised by it.
 */
const STORAGE_KEY = 'simpleTodo.persistentStorageEnabled';

/**
 * Defaults to false — in memory only.
 *
 * This is a public, unencrypted demo database. Writing it into IndexedDB by
 * default would leave a stranger's todos on the machine of anyone who opened
 * the page once, and the consent screen would be announcing that fact rather
 * than asking. Persistence is opt-in for the same reason the relay toggle is
 * opt-out: the safer state is the one you get without deciding.
 *
 * @returns {boolean}
 */
export function getPersistentStorageEnabled() {
	if (typeof localStorage === 'undefined') {
		return false;
	}

	try {
		return localStorage.getItem(STORAGE_KEY) === 'true';
	} catch {
		// Private browsing modes can throw on access rather than return null.
		return false;
	}
}

/**
 * @param {boolean} enabled
 */
export function setPersistentStorageEnabled(enabled) {
	if (typeof localStorage === 'undefined') {
		return;
	}

	try {
		localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
	} catch {
		// Not being able to remember the choice is survivable; the session still
		// honours it because the caller passes it on directly.
	}
}

/**
 * Level paths for one browser's persistent stores.
 *
 * Separate paths per concern: Helia's blockstore holds content-addressed blocks,
 * its datastore holds pins and routing records, and OrbitDB's `directory` holds
 * the log. Sharing one path would let three different key spaces collide in a
 * single Level database.
 *
 * `browser-level` maps each path to its own IndexedDB database, so these names
 * are what a user sees in devtools — hence the readable prefix rather than a
 * bare `./orbitdb`.
 */
export const PERSISTENT_STORAGE_PATHS = Object.freeze({
	blockstore: 'simple-todo/helia-blocks',
	datastore: 'simple-todo/helia-data',
	orbitdb: 'simple-todo/orbitdb'
});

/**
 * Log storages for one database, memory-only when the user asked for that.
 *
 * `Database` defaults `headsStorage` and `indexStorage` to
 * `ComposedStorage(LRUStorage, LevelStorage)` under `directory`, which
 * `browser-level` puts in IndexedDB — so without this, an in-memory session
 * still left `orbitdb/<address>/log/_heads/` and `.../log/_index/` behind. That
 * is the half of #144 the storage choice has to answer for, and the test
 * asserting IndexedDB is empty is what caught it.
 *
 * `entryStorage` is left alone: it defaults through Helia's blockstore, which
 * already follows the same choice.
 *
 * Lives here rather than in p2p.js because db-actions.js opens databases too,
 * and p2p.js already imports from db-actions.js — putting it there closed an
 * import cycle that broke both modules at load time.
 *
 * @returns {Promise<{ headsStorage?: any, indexStorage?: any }>}
 */
export async function createLogStorages() {
	if (getPersistentStorageEnabled()) return {};

	const [headsStorage, indexStorage] = await Promise.all([MemoryStorage(), MemoryStorage()]);
	return { headsStorage, indexStorage };
}

/**
 * Every IndexedDB database this app can have written, by name prefix.
 *
 * `browser-level` prefixes each Level path with `level-js-`, so
 * `simple-todo/helia-blocks` surfaces as `level-js-simple-todo/helia-blocks`.
 * The second prefix is OrbitDB's own default `./orbitdb`, which earlier builds
 * wrote to whatever the user had picked — a browser that ran this app before
 * the storage choice existed still has those, and "delete what was written"
 * has to mean them too.
 */
const OWNED_DATABASE_PREFIXES = ['level-js-simple-todo/', 'level-js-orbitdb/'];

/**
 * Delete what a persistent session wrote.
 *
 * Without this the switch is only half honest: #183 stopped an in-memory
 * session from writing, but a browser that ran persistent first still had its
 * blocks, log and keystore sitting in IndexedDB afterwards. Someone choosing
 * "nothing on this device" in that order was told one thing and got another.
 *
 * Prefix-matched rather than deleting by known path: the OrbitDB log opens one
 * database per address (`…/orbitdb/<address>/log/_heads/`), so the exact set is
 * not knowable up front. Other origins are unreachable from here, and nothing
 * outside these two prefixes belongs to this app.
 *
 * Never throws — a browser that cannot enumerate (Firefox has no
 * `indexedDB.databases()`) or refuses a delete must not block the user from
 * proceeding. It returns what it managed to remove so a caller can say so.
 *
 * @returns {Promise<{ deleted: string[], enumerable: boolean }>}
 */
export async function wipePersistentStorage() {
	if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
		return { deleted: [], enumerable: false };
	}

	/** @type {string[]} */
	const deleted = [];
	try {
		const databases = await indexedDB.databases();
		const owned = databases
			.map((database) => database.name)
			.filter(
				/** @returns {name is string} */
				(name) =>
					typeof name === 'string' && OWNED_DATABASE_PREFIXES.some((p) => name.startsWith(p))
			);

		await Promise.all(
			owned.map(
				(name) =>
					new Promise((resolve) => {
						const request = indexedDB.deleteDatabase(name);
						// `blocked` fires when another tab still holds the database open.
						// Resolving rather than hanging keeps the consent screen usable;
						// the caller reports what actually went.
						request.onsuccess = () => {
							deleted.push(name);
							resolve(undefined);
						};
						request.onerror = () => resolve(undefined);
						request.onblocked = () => resolve(undefined);
					})
			)
		);
	} catch {
		// Enumeration itself can fail in private modes.
	}

	return { deleted, enumerable: true };
}
