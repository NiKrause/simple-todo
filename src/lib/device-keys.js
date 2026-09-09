// The key pair that lets somebody else hand this browser a database key.
//
// Ported from Le-Space/yogasuci `src/lib/db/device-keys.js`
// (Le-Space/yogasuci#95), which is where this shipped first.
//
// Separate from the identity key, and that separation is not incidental. The
// identity is Ed25519 and signs; it has no key agreement, and behind WebAuthn
// it cannot even be exported to try. A database key has to *reach* a second
// reader, which needs agreement, so this is a second pair with one job:
// unwrapping what was sealed for it (#277 phase 2).
//
// Scoped by identity rather than by browser. Two passkeys in one browser are
// two people as far as this chapter is concerned, and what was sealed for one
// must not open for the other.
//
// The private half sits in local storage as an exported JWK. Worth saying
// plainly: it is no better protected than the database keys it unwraps.
// Binding it to the passkey is phase 1.5 and is a different change.

const STORAGE_PREFIX = 'privacy01.deviceKey.';
const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

/**
 * @typedef {object} DeviceKeyPair
 * @property {CryptoKey} privateKey for unwrapping keys addressed to this identity
 * @property {string} publicKey base64 JWK, the half that goes into the directory
 */

/** @type {Map<string, DeviceKeyPair>} */
const cache = new Map();

/** @param {string} identityId */
const storageKeyFor = (identityId) => `${STORAGE_PREFIX}${identityId}`;

/**
 * This identity's encryption key pair, made once and kept.
 *
 * @param {string} identityId the OrbitDB identity this pair belongs to
 * @returns {Promise<DeviceKeyPair>}
 */
export async function ownDeviceKeys(identityId) {
	const cached = cache.get(identityId);
	if (cached) return cached;

	const stored = read(identityId);
	if (stored) {
		const pair = {
			privateKey: await crypto.subtle.importKey('jwk', stored.privateKey, CURVE, true, [
				'deriveKey',
				'deriveBits'
			]),
			publicKey: stored.publicKey
		};
		cache.set(identityId, pair);
		return pair;
	}

	const generated = await crypto.subtle.generateKey(CURVE, true, ['deriveKey', 'deriveBits']);
	const privateKey = await crypto.subtle.exportKey('jwk', generated.privateKey);
	const publicKey = encode(await crypto.subtle.exportKey('jwk', generated.publicKey));

	write(identityId, { privateKey, publicKey });

	const pair = { privateKey: generated.privateKey, publicKey };
	cache.set(identityId, pair);
	return pair;
}

/**
 * Read somebody else's published key.
 *
 * @param {string} value the string a directory entry carried
 * @returns {Promise<CryptoKey>}
 */
export async function importDeviceKey(value) {
	return crypto.subtle.importKey('jwk', decode(value), CURVE, true, []);
}

/** For tests, and for a sign-out that must not leave the next identity this key. */
export function forgetDeviceKeys(identityId) {
	cache.delete(identityId);
	try {
		localStorage.removeItem(storageKeyFor(identityId));
	} catch {
		// Nothing to clean up without storage.
	}
}

/** @param {any} jwk */
function encode(jwk) {
	return btoa(JSON.stringify(jwk));
}

/** @param {string} value */
function decode(value) {
	return JSON.parse(atob(value));
}

/**
 * @param {string} identityId
 * @returns {{ privateKey: any, publicKey: string } | null}
 */
function read(identityId) {
	try {
		const raw = localStorage.getItem(storageKeyFor(identityId));
		return raw ? JSON.parse(raw) : null;
	} catch {
		// Storage denied, or something else wrote here. A new pair is made
		// instead, which costs this identity every key already wrapped for its
		// old one — it has to be granted again. Loud would be worse: there is
		// nothing the reader could do about it here.
		return null;
	}
}

/**
 * @param {string} identityId
 * @param {{ privateKey: any, publicKey: string }} pair
 */
function write(identityId, pair) {
	try {
		localStorage.setItem(storageKeyFor(identityId), JSON.stringify(pair));
	} catch {
		// The pair still works for this page load; the next one makes another.
	}
}
