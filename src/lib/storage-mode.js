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
