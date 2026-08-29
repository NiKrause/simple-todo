// Sealing a todo so that only the holders of a key can read it.
//
// OrbitDB replicates whole databases and has no read permissions: whoever
// holds an address and reaches a peer that has it reads everything in it. In
// this chapter the address is handed over by QR, and the mnemonic that names
// the database is recoverable from the manifest anyway, so the protection has
// to be in the data rather than in who may connect (#261, #277).
//
// Ported from Le-Space/yogasuci `src/lib/db/encryption.js`, where this shipped
// in August (Le-Space/yogasuci#95). Kept as readable source rather than a
// dependency because this repository is a tutorial and the point is that a
// reader can see it.
//
// Written by hand rather than taken from `@orbitdb/simple-encryption`, whose
// 0.0.2 generates one nonce and reuses it for up to 32000 messages
// (orbitdb/simple-encryption#3). In AES-GCM a repeated nonce under one key
// discloses the XOR of the plaintexts and lets the authentication subkey be
// recovered, so entries can be forged as well as read. What this does instead
// is the boring, correct thing: a fresh random nonce for every entry,
// prepended to the ciphertext, and the key imported once rather than derived
// per call.

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

/** @returns {Uint8Array} a key nobody has seen before */
export function newKey() {
	return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/**
 * Seal and open bytes under one key.
 *
 * Deliberately bytes in, bytes out, with no knowledge of OrbitDB: the part
 * that has to be right is the cryptography, and it is provable on its own.
 *
 * @param {Uint8Array} rawKey
 */
export async function sealer(rawKey) {
	if (!(rawKey instanceof Uint8Array) || rawKey.length !== KEY_BYTES) {
		throw new Error(`A key must be ${KEY_BYTES} bytes.`);
	}

	const key = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (rawKey),
		'AES-GCM',
		false,
		['encrypt', 'decrypt']
	);

	return {
		/**
		 * @param {Uint8Array} bytes
		 * @returns {Promise<Uint8Array>} nonce ‖ ciphertext
		 */
		async seal(bytes) {
			const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
			const sealed = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (nonce) },
					key,
					/** @type {BufferSource} */ (bytes)
				)
			);

			const out = new Uint8Array(nonce.length + sealed.length);
			out.set(nonce, 0);
			out.set(sealed, nonce.length);
			return out;
		},

		/**
		 * @param {Uint8Array} bytes nonce ‖ ciphertext
		 * @returns {Promise<Uint8Array>}
		 */
		async open(bytes) {
			if (!(bytes instanceof Uint8Array) || bytes.length <= NONCE_BYTES) {
				throw new Error('Not a sealed payload.');
			}

			// Throws on a wrong key or tampered bytes, which is the point of GCM
			// and must stay a throw: a caller that silently got nothing back would
			// write an empty todo rather than report a problem.
			return new Uint8Array(
				await crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (bytes.subarray(0, NONCE_BYTES)) },
					key,
					/** @type {BufferSource} */ (bytes.subarray(NONCE_BYTES))
				)
			);
		}
	};
}
