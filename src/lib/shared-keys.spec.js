import { describe, expect, it } from 'vitest';

import { newKey } from './db-encryption.js';
import { forgetDeviceKeys, importDeviceKey, ownDeviceKeys } from './device-keys.js';
import { wrapKey } from './key-wrapping.js';
import { keyForRecipient, shareKeyWith } from './shared-keys.js';

const LIST = '/orbitdb/zdpuSharedKeysSpecList';

/** A reader with a published key, the way the directory would hold it. */
async function reader(/** @type {string} */ did) {
	forgetDeviceKeys(did);
	const own = await ownDeviceKeys(did);
	return { did, ...own };
}

/** The store, whose log anybody may have written to. */
function fakeStore(/** @type {{key: string, value: any}[]} */ entries = []) {
	const log = entries.map(({ key, value }) => ({ payload: { op: 'PUT', key, value } }));
	return {
		log: { values: async () => log },
		async put(/** @type {string} */ key, /** @type {any} */ value) {
			log.push({ payload: { op: 'PUT', key, value } });
		}
	};
}

describe('shared-keys', () => {
	it('hands a granted reader the key that was sealed for them', async () => {
		const bob = await reader('did:key:bob');
		const databaseKey = newKey();
		const store = fakeStore();

		await store.put(
			`${LIST}|${bob.did}`,
			await wrapKey(databaseKey, await importDeviceKey(bob.publicKey))
		);

		const found = await keyForRecipient(store, {
			listAddress: LIST,
			did: bob.did,
			privateKey: bob.privateKey
		});

		expect(Array.from(found ?? [])).toEqual(Array.from(databaseKey));
	});

	it('gives nothing to somebody no copy was made for', async () => {
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');
		const store = fakeStore();

		await store.put(
			`${LIST}|${bob.did}`,
			await wrapKey(newKey(), await importDeviceKey(bob.publicKey))
		);

		// Eve reads Bob's entry key as well as her own; neither opens for her.
		expect(
			await keyForRecipient(store, { listAddress: LIST, did: bob.did, privateKey: eve.privateKey })
		).toBeNull();
		expect(
			await keyForRecipient(store, { listAddress: LIST, did: eve.did, privateKey: eve.privateKey })
		).toBeNull();
	});

	it('finds the real copy even when a forged one was written over it', async () => {
		// Anybody may write to this store, and a keyvalue index keeps only the
		// last value under a key. So a copy sealed to the wrong key can shadow
		// the real one — unless every candidate is tried, which is what makes
		// this store need no trust in its writers at all.
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');
		const databaseKey = newKey();
		const store = fakeStore();

		await store.put(
			`${LIST}|${bob.did}`,
			await wrapKey(databaseKey, await importDeviceKey(bob.publicKey))
		);
		await store.put(
			`${LIST}|${bob.did}`,
			await wrapKey(newKey(), await importDeviceKey(eve.publicKey))
		);

		const found = await keyForRecipient(store, {
			listAddress: LIST,
			did: bob.did,
			privateKey: bob.privateKey
		});

		expect(Array.from(found ?? [])).toEqual(Array.from(databaseKey));
	});

	it('keeps two lists apart', async () => {
		const bob = await reader('did:key:bob');
		const store = fakeStore();

		await store.put(
			`${LIST}|${bob.did}`,
			await wrapKey(newKey(), await importDeviceKey(bob.publicKey))
		);

		expect(
			await keyForRecipient(store, {
				listAddress: '/orbitdb/zdpuAnotherListEntirely',
				did: bob.did,
				privateKey: bob.privateKey
			})
		).toBeNull();
	});

	it('says why nothing was shared when the reader published no key', async () => {
		// Granted write access but never opened the chapter, so there is nothing
		// to seal to. The person granting has to be told in words.
		const store = fakeStore();
		const directory = { log: { values: async () => [] } };

		const result = await shareKeyWith(
			{ identities: { getIdentity: async () => null } },
			{ directory, store },
			{ listAddress: LIST, recipientDid: 'did:key:absent', databaseKey: newKey() }
		);

		expect(result).toEqual({ shared: false, reason: 'no-published-key' });
	});
});
