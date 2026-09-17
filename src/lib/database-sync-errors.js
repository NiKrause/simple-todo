// OrbitDB reports a failed heads exchange as an `error` event, and nobody
// listened.
//
// Sync (`@orbitdb/core/src/sync.js`) catches a failed exchange and emits
// `error` on the database's events. Those are Node's EventEmitter — the
// `events` polyfill in the page — which throws an `error` event that has no
// listener. Sync emits it inside a queued task whose promise nobody awaits,
// so every failed exchange surfaced as an uncaught rejection.
//
// escrow01's two-browser runs logged 560–1150 of them within a few seconds,
// all `StreamResetError: The stream has been reset`. orbitdb-relay 0.10.2 hangs
// up on every subscriber of a database after a fresh `/pinning/sync`; once the
// browsers are back, each one's list registry and the relay's on-demand heads
// handler reset each other's exchange about every 25 ms until the relay keeps
// the registry open (NiKrause/orbitdb-relay#59). The flow itself never failed.
// The page drowned in errors.
//
// Nothing is lost by listening instead: Sync has already dropped the peer, and
// the next subscription change starts a new exchange.

/** @type {WeakSet<object>} */
const listening = new WeakSet();

/**
 * Listen for Sync errors on a database and on its access controller's
 * database, which OrbitDB opens itself, past `orbitdb.open`.
 *
 * @template T
 * @param {T} database
 * @returns {T}
 */
export function handleSyncErrors(database) {
	const db = /** @type {any} */ (database);
	const sources = [
		{ events: db?.events, label: 'database' },
		{ events: db?.access?.events, label: 'access controller' }
	];
	for (const { events, label } of sources) {
		if (typeof events?.on !== 'function' || listening.has(events)) continue;
		listening.add(events);
		events.on('error', (/** @type {unknown} */ error) => {
			console.debug(`OrbitDB sync error (${label} ${db.address}):`, error);
		});
	}
	return database;
}

/**
 * Make every database this OrbitDB instance opens report Sync errors instead
 * of throwing them.
 *
 * @template T
 * @param {T} orbitdb
 * @returns {T}
 */
export function withSyncErrorHandling(orbitdb) {
	const instance = /** @type {any} */ (orbitdb);
	const open = instance.open;
	instance.open = async (/** @type {any[]} */ ...args) => handleSyncErrors(await open(...args));
	return orbitdb;
}
