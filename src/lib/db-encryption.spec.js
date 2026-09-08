import { describe, expect, it } from 'vitest';

import { newKey, sealer } from './db-encryption.js';

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
