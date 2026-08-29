// The seam between sealed bytes and an OrbitDB log.
//
// Ported from Le-Space/yogasuci `src/lib/db/entry-encryption.js`
// (Le-Space/yogasuci#95), including the migration below, which is the half
// that is not obvious and whose absence destroys data.
//
// OrbitDB takes `encryption: { data: { encrypt, decrypt } }` and applies it to
// an entry's payload: `entry.js` encodes the payload to dag-cbor, hands the
// bytes to `encrypt`, and on the way back hands whatever it stored to
// `decrypt` and decodes the result. So both halves speak bytes, and the
// cryptography itself stays in ./db-encryption.js where it can be proven on
// its own.
//
// Encryption is not part of an OrbitDB manifest — that is
// `{ name, type, accessController }` and nothing else (`manifest-store.js`) —
// so switching it on does not change an address. An existing list therefore
// keeps every plaintext entry it already had and starts receiving sealed ones
// beside them, and `entry.js` is unforgiving about the mixture:
//
//   if (decryptPayloadFn) {
//     try { … } catch (e) { throw new Error('Could not decrypt payload') }
//   }
//
// Every todo written so far would become unreadable. Since this function is
// the one being called, it can recognise a payload that was never sealed and
// hand it back in the form OrbitDB expects, which turns a data loss into a
// migration that needs nobody to run anything.

import * as dagCbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';
import { sha256 } from 'multiformats/hashes/sha2';

import { sealer } from './db-encryption.js';

/**
 * OrbitDB's `encryption` option for one database.
 *
 * @param {Uint8Array} rawKey
 * @returns {Promise<{ data: { encrypt: (bytes: Uint8Array) => Promise<Uint8Array>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export async function payloadEncryption(rawKey) {
	const seal = await sealer(rawKey);

	return {
		data: {
			encrypt: (bytes) => seal.seal(bytes),

			/** @param {any} value the stored payload: sealed bytes, or an entry from before */
			async decrypt(value) {
				// Written before this database was encrypted. Re-encoded rather than
				// returned as-is because the caller decodes what comes back, and it
				// only ever held bytes.
				if (!(value instanceof Uint8Array)) {
					const block = await Block.encode({ value, codec: dagCbor, hasher: sha256 });
					return block.bytes;
				}

				return seal.open(value);
			}
		}
	};
}
