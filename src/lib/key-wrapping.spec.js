import { describe, expect, it } from 'vitest';

import { newKey } from './db-encryption.js';
import { forgetDeviceKeys, importDeviceKey, ownDeviceKeys } from './device-keys.js';
import { unwrapKey, wrapKey } from './key-wrapping.js';

/** A reader with its own key pair, the way the directory would hand it over. */
async function reader(/** @type {string} */ id) {
	forgetDeviceKeys(id);
	const own = await ownDeviceKeys(id);
	return { ...own, published: await importDeviceKey(own.publicKey) };
}

describe('key-wrapping', () => {
	it('hands a key to the reader it was sealed for', async () => {
		const bob = await reader('did:key:bob');
		const databaseKey = newKey();

		const copy = await wrapKey(databaseKey, bob.published);

		expect(Array.from(await unwrapKey(copy, bob.privateKey))).toEqual(Array.from(databaseKey));
	});

	it('does not open for anybody else', async () => {
		// The property the whole envelope rests on: a wrapped copy may replicate
		// publicly precisely because only its recipient can open it.
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');

		const copy = await wrapKey(newKey(), bob.published);

		await expect(unwrapKey(copy, eve.privateKey)).rejects.toThrow();
	});

	it('never wraps the same key the same way twice', async () => {
		// A fresh ephemeral sender pair per wrap. With a static sender the same
		// two devices would derive one secret for every wrap, and a single nonce
		// mistake would then repeat across all of them.
		const bob = await reader('did:key:bob');
		const databaseKey = newKey();

		const first = await wrapKey(databaseKey, bob.published);
		const second = await wrapKey(databaseKey, bob.published);

		expect(first.wrapped).not.toBe(second.wrapped);
		expect(first.ephemeral).not.toBe(second.ephemeral);
		// Both still open, which is what makes the difference harmless.
		expect(Array.from(await unwrapKey(second, bob.privateKey))).toEqual(Array.from(databaseKey));
	});

	it('refuses a tampered copy rather than returning something', async () => {
		const bob = await reader('did:key:bob');
		const copy = await wrapKey(newKey(), bob.published);
		const bytes = atob(copy.wrapped).split('');
		bytes[bytes.length - 1] = String.fromCharCode(bytes[bytes.length - 1].charCodeAt(0) ^ 0xff);

		await expect(
			unwrapKey({ ...copy, wrapped: btoa(bytes.join('')) }, bob.privateKey)
		).rejects.toThrow();
	});

	it('refuses something that is not a wrapped key', async () => {
		const bob = await reader('did:key:bob');

		await expect(
			unwrapKey(
				{ wrapped: btoa('short'), ephemeral: (await wrapKey(newKey(), bob.published)).ephemeral },
				bob.privateKey
			)
		).rejects.toThrow(/not a wrapped key/i);
	});
});

describe('device-keys', () => {
	it('keeps one pair per identity, so a reload can still unwrap', async () => {
		forgetDeviceKeys('did:key:alice');
		const first = await ownDeviceKeys('did:key:alice');
		const copy = await wrapKey(newKey(), await importDeviceKey(first.publicKey));

		// What a reload actually has: the contents of local storage, and nothing
		// held in this module. So the stored private half is imported on its own
		// and asked to do the one job it exists for. `forgetDeviceKeys` cannot
		// stand in for a reload — it deletes the stored pair as well, which is
		// the opposite of what is being proven here.
		const stored = JSON.parse(localStorage.getItem('privacy01.deviceKey.did:key:alice') ?? 'null');
		expect(stored?.publicKey).toBe(first.publicKey);

		const fromStorage = await crypto.subtle.importKey(
			'jwk',
			stored.privateKey,
			{ name: 'ECDH', namedCurve: 'P-256' },
			true,
			['deriveKey', 'deriveBits']
		);

		expect(Array.from(await unwrapKey(copy, fromStorage))).toEqual(
			Array.from(await unwrapKey(copy, first.privateKey))
		);
	});

	it('gives two identities in one browser two pairs', async () => {
		// Two passkeys in one browser are two people here, and what was sealed
		// for one must not open for the other.
		forgetDeviceKeys('did:key:one');
		forgetDeviceKeys('did:key:two');
		const one = await ownDeviceKeys('did:key:one');
		const two = await ownDeviceKeys('did:key:two');

		expect(one.publicKey).not.toBe(two.publicKey);

		const forOne = await wrapKey(newKey(), await importDeviceKey(one.publicKey));
		await expect(unwrapKey(forOne, two.privateKey)).rejects.toThrow();
	});
});
