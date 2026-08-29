import { describe, expect, it } from 'vitest';

import { newKey, sealer } from './db-encryption.js';
import { payloadEncryption } from './entry-encryption.js';

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);
/** @param {Uint8Array} value */
const text = (value) => new TextDecoder().decode(value);

describe('db-encryption', () => {
	it('round-trips a payload under its key', async () => {
		const seal = await sealer(newKey());
		const sealed = await seal.seal(bytes('milk'));

		expect(text(await seal.open(sealed))).toBe('milk');
	});

	it('never repeats a nonce', async () => {
		const seal = await sealer(newKey());
		const nonces = new Set();

		for (let i = 0; i < 500; i++) {
			const sealed = await seal.seal(bytes(`todo ${i}`));
			nonces.add(sealed.subarray(0, 12).toString());
		}

		// The reason this module exists rather than @orbitdb/simple-encryption,
		// whose 0.0.2 reused one nonce for 32000 messages
		// (orbitdb/simple-encryption#3).
		expect(nonces.size).toBe(500);
	});

	it('refuses a wrong key rather than returning nothing', async () => {
		const sealed = await (await sealer(newKey())).seal(bytes('milk'));
		const other = await sealer(newKey());

		await expect(other.open(sealed)).rejects.toThrow();
	});

	it('refuses tampered bytes', async () => {
		const key = newKey();
		const seal = await sealer(key);
		const sealed = await seal.seal(bytes('milk'));
		sealed[sealed.length - 1] ^= 0xff;

		await expect((await sealer(key)).open(sealed)).rejects.toThrow();
	});

	it('rejects a key of the wrong size', async () => {
		await expect(sealer(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
	});
});

describe('entry-encryption', () => {
	it('seals and opens what OrbitDB hands it', async () => {
		const { data } = await payloadEncryption(newKey());
		const sealed = await data.encrypt(bytes('milk'));

		expect(sealed).not.toEqual(bytes('milk'));
		expect(text(await data.decrypt(sealed))).toBe('milk');
	});

	it('passes through an entry written before encryption was switched on', async () => {
		const { data } = await payloadEncryption(newKey());

		// Not a Uint8Array: what `entry.js` stored before this database was
		// sealed. Returning it re-encoded is what turns the mixture from a data
		// loss into a migration.
		const decoded = await data.decrypt({ text: 'bought before', completed: false });

		expect(decoded).toBeInstanceOf(Uint8Array);
		expect(decoded.length).toBeGreaterThan(0);
	});
});
