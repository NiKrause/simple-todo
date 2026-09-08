// Where a database key lives on this device.
//
// Phase 1 of #277 and deliberately the simplest thing that can be true: one
// random key per database, kept in local storage, never leaving this browser.
// That is enough for a single device to seal its own list and read it back
// after a reload, and it is not enough for two devices to share one — they
// would each invent a key and neither could read the other.
//
// Sharing is Phase 2, where the key is wrapped to the other device's public
// key and handed over with the QR code that already travels between them. This
// module is the seam that will change: callers ask for the key of a database,
// not for local storage.

const STORAGE_PREFIX = 'privacy01.dbKey.';

/** @param {string} databaseKey how this database is identified locally */
function storageKeyFor(databaseKey) {
	return `${STORAGE_PREFIX}${databaseKey}`;
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** @param {string} value */
function fromBase64(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * The key for a database, generating and remembering one on first use.
 *
 * Returns null when there is no storage to remember it in. A key that only
 * lives for this page load is worse than none: it would seal entries nothing
 * can ever open again, including this device after a reload.
 *
 * @param {string} databaseKey
 * @param {{ newKey?: () => Uint8Array }} [deps]
 * @returns {Uint8Array | null}
 */
export function keyForDatabase(databaseKey, deps = {}) {
	const create = deps.newKey ?? (() => crypto.getRandomValues(new Uint8Array(32)));

	let stored = null;
	try {
		stored = localStorage.getItem(storageKeyFor(databaseKey));
	} catch {
		return null;
	}

	if (stored) {
		try {
			const bytes = fromBase64(stored);
			if (bytes.length === 32) return bytes;
		} catch {
			// Unreadable rather than absent. Replacing it would seal new entries
			// under a key that cannot open the old ones, so say so instead.
			throw new Error(`The stored key for ${databaseKey} is not readable.`);
		}
		throw new Error(`The stored key for ${databaseKey} has the wrong length.`);
	}

	const fresh = create();
	try {
		localStorage.setItem(storageKeyFor(databaseKey), toBase64(fresh));
	} catch {
		return null;
	}
	return fresh;
}

/**
 * The key this device already has for a database, or null.
 *
 * Read-only on purpose, and the difference from `keyForDatabase` matters: it
 * is what distinguishes a list this browser sealed from somebody else's list
 * reached by address. Generating one on the way past would seal a guest's list
 * under a key its owner does not have.
 *
 * @param {string} databaseKey
 * @returns {Uint8Array | null}
 */
export function storedDatabaseKey(databaseKey) {
	let stored = null;
	try {
		stored = localStorage.getItem(storageKeyFor(databaseKey));
	} catch {
		return null;
	}
	if (!stored) return null;

	try {
		const bytes = fromBase64(stored);
		if (bytes.length === 32) return bytes;
	} catch {
		throw new Error(`The stored key for ${databaseKey} is not readable.`);
	}
	throw new Error(`The stored key for ${databaseKey} has the wrong length.`);
}

/**
 * Whether a key stored now would still be here after a reload.
 *
 * Asked *before* a database is created rather than after: opening one with an
 * encryptor whose key cannot be written down seals entries that nothing will
 * ever open again, including this browser. Better to find that out while the
 * list is still empty.
 *
 * @returns {boolean}
 */
export function canRememberKeys() {
	const probe = `${STORAGE_PREFIX}probe`;
	try {
		localStorage.setItem(probe, 'probe');
		localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

/**
 * Write down a key that was generated before its database had an address.
 *
 * A list is created under a name and reopened by address, so the address is
 * the only identifier both paths share — see `encrypted-open.js`.
 *
 * @param {string} databaseKey
 * @param {Uint8Array} key
 * @returns {boolean} whether it was written down
 */
export function rememberDatabaseKey(databaseKey, key) {
	try {
		localStorage.setItem(storageKeyFor(databaseKey), toBase64(key));
		return true;
	} catch {
		return false;
	}
}

/** @param {string} databaseKey */
export function forgetDatabaseKey(databaseKey) {
	try {
		localStorage.removeItem(storageKeyFor(databaseKey));
	} catch {
		// Nothing to forget without storage.
	}
}
