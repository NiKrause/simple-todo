import { describe, expect, it } from 'vitest';

import * as dagCbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';
import { sha256 } from 'multiformats/hashes/sha2';

import { newKey, sealer } from './db-encryption.js';
import { payloadEncryption } from './entry-encryption.js';

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);
/** @param {Uint8Array} value */
const text = (value) => new TextDecoder().decode(value);

/**
 * What OrbitDB does with whatever `decrypt` returns.
 *
 * `entry.js:181-182` hands the bytes straight to `Block.decode` and uses the
 * `.value`, so a test that stops at "some bytes came back" stops one step
 * short of the guarantee. This is that step, with the same codec and hasher.
 *
 * @param {Uint8Array} decrypted
 */
const asOrbitDbReadsIt = async (decrypted) =>
	(await Block.decode({ bytes: decrypted, codec: dagCbor, hasher: sha256 })).value;

/** A payload shaped the way the todo list actually writes them. */
const todoPayload = {
	op: 'PUT',
	key: 'todo_1788464831143_z2kcdly3v',
	value: {
		text: 'buy milk',
		assignee: null,
		completed: false,
		createdAt: '2026-09-03T19:27:41.971Z'
	}
};

describe('entry-encryption', () => {
	it('seals and opens what OrbitDB hands it', async () => {
		const { data } = await payloadEncryption(newKey());
		const sealed = await data.encrypt(bytes('milk'));

		expect(sealed).not.toEqual(bytes('milk'));
		expect(text(await data.decrypt(sealed))).toBe('milk');
	});

	it('returns a real todo unchanged through the round trip', async () => {
		const { data } = await payloadEncryption(newKey());
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });

		const sealed = await data.encrypt(encoded.bytes);

		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(todoPayload);
	});

	it('gives back the same todo that was written before encryption', async () => {
		const { data } = await payloadEncryption(newKey());

		// Not a Uint8Array: what `entry.js` stored before this database was
		// sealed. The assertion is the whole point of the migration — not that
		// bytes come back, but that they decode to the todo somebody wrote. A
		// passthrough that returned different bytes would satisfy "is a
		// Uint8Array, length > 0" and still lose every existing entry.
		const decoded = await asOrbitDbReadsIt(await data.decrypt(todoPayload));

		expect(decoded).toEqual(todoPayload);
	});

	it('reads a log holding both, which is what switching encryption on creates', async () => {
		// Encryption is not in the manifest, so turning it on keeps the address
		// and the old entries. The mixture is the normal state of a migrated
		// list, not an edge case, and one encryptor has to read both.
		const { data } = await payloadEncryption(newKey());
		const older = { op: 'PUT', key: 'todo_before', value: { text: 'written in plaintext' } };
		const newer = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });

		const sealed = await data.encrypt(newer.bytes);

		expect(await asOrbitDbReadsIt(await data.decrypt(older))).toEqual(older);
		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(todoPayload);
	});

	it('refuses a sealed payload under the wrong key instead of treating it as old', async () => {
		// The passthrough decides on the type alone. Sealed bytes stay sealed
		// bytes, so a reader without the key has to be told rather than handed
		// ciphertext that would then fail to decode as a todo.
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const sealed = await (await sealer(newKey())).seal(encoded.bytes);
		const { data } = await payloadEncryption(newKey());

		await expect(data.decrypt(sealed)).rejects.toThrow();
	});
});
