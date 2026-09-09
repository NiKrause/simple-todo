import { describe, expect, it } from 'vitest';

import { lookupKey, publishOwnKey } from './key-directory.js';

/**
 * A directory whose log can be written by anybody, which is what the real one
 * is. `writtenBy` is the identity that signed the entry — the thing a forged
 * entry cannot get right.
 */
function fakeDirectory(
	/** @type {{key: string, value: string, writtenBy: string}[]} */ entries = []
) {
	const log = entries.map(({ key, value, writtenBy }) => ({
		identity: `hash-of-${writtenBy}`,
		payload: { op: 'PUT', key, value }
	}));

	return {
		puts: /** @type {any[]} */ ([]),
		log: { values: async () => log },
		async put(/** @type {string} */ key, /** @type {string} */ value) {
			this.puts.push({ key, value });
			log.push({ identity: 'hash-of-did:key:me', payload: { op: 'PUT', key, value } });
		}
	};
}

/** Resolves an identity hash the way OrbitDB does, back to the DID that signed. */
const fakeOrbitDb = (did = 'did:key:me') => ({
	identity: { id: did },
	identities: {
		getIdentity: async (/** @type {string} */ hash) => ({ id: hash.replace('hash-of-', '') })
	}
});

describe('key-directory', () => {
	it('finds the key somebody published for themselves', async () => {
		const directory = fakeDirectory([
			{ key: 'did:key:bob', value: 'bobs-public-key', writtenBy: 'did:key:bob' }
		]);

		expect(await lookupKey(fakeOrbitDb(), directory, 'did:key:bob')).toBe('bobs-public-key');
	});

	it('ignores a key somebody published under a DID that is not theirs', async () => {
		// The attack this defence exists for: Eve puts her own key under Bob's
		// DID, Alice seals the database key to it, and Eve reads the list while
		// Bob cannot. Writing *as* Bob would need Bob's signing key, so the
		// identity on the entry is what gives her away.
		const directory = fakeDirectory([
			{ key: 'did:key:bob', value: 'eves-public-key', writtenBy: 'did:key:eve' }
		]);

		expect(await lookupKey(fakeOrbitDb(), directory, 'did:key:bob')).toBeNull();
	});

	it('still finds the honest entry when a forged one sits beside it', async () => {
		// A forgery must not shadow the real key, whichever order they arrive in.
		const directory = fakeDirectory([
			{ key: 'did:key:bob', value: 'bobs-public-key', writtenBy: 'did:key:bob' },
			{ key: 'did:key:bob', value: 'eves-public-key', writtenBy: 'did:key:eve' }
		]);

		expect(await lookupKey(fakeOrbitDb(), directory, 'did:key:bob')).toBe('bobs-public-key');
	});

	it('prefers the newest key its owner published', async () => {
		const directory = fakeDirectory([
			{ key: 'did:key:bob', value: 'old-key', writtenBy: 'did:key:bob' },
			{ key: 'did:key:bob', value: 'new-key', writtenBy: 'did:key:bob' }
		]);

		expect(await lookupKey(fakeOrbitDb(), directory, 'did:key:bob')).toBe('new-key');
	});

	it('says null for a reader who has never published one', async () => {
		// Not a throw: granted-but-never-opened-the-app is a thing the caller
		// can explain, and an exception would turn it into a failure.
		expect(await lookupKey(fakeOrbitDb(), fakeDirectory(), 'did:key:nobody')).toBeNull();
	});

	it('publishes once and not again on the next start', async () => {
		const directory = fakeDirectory();
		const orbitdb = fakeOrbitDb();

		const published = await publishOwnKey(orbitdb, directory);
		await publishOwnKey(orbitdb, directory);

		expect(directory.puts).toHaveLength(1);
		expect(directory.puts[0]).toEqual({ key: 'did:key:me', value: published });
	});
});
