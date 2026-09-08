import { beforeEach, describe, expect, it } from 'vitest';

import { forgetDatabaseKey, keyForDatabase } from './database-keys.js';
import { openEncrypted } from './encrypted-open.js';

const ADDRESS = '/orbitdb/zdpuTestAddressForEncryptedOpenSpec';

/** An OrbitDB stand-in that records what it was opened with. */
function fakeOrbitDb(address = ADDRESS) {
	/** @type {any[]} */
	const opened = [];
	return {
		opened,
		/** @param {string} target @param {any} options */
		async open(target, options) {
			opened.push({ target, options });
			return { address: { toString: () => address }, name: target };
		}
	};
}

/** @param {any} options */
const sealsEntries = (options) => typeof options?.encryption?.data?.encrypt === 'function';

describe('encrypted-open', () => {
	beforeEach(() => {
		forgetDatabaseKey(ADDRESS);
		forgetDatabaseKey('/orbitdb/zdpuSomeOtherList');
	});

	it('opens a list it holds the key for with an encryptor', async () => {
		const orbitdb = fakeOrbitDb();
		keyForDatabase(ADDRESS); // as if this device had created it earlier

		await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(true);
		// The passed-through options survive rather than being replaced.
		expect(orbitdb.opened[0].options.type).toBe('keyvalue');
	});

	it("opens somebody else's list in the clear instead of inventing a key", async () => {
		// A guest reaches a list by address and holds no key for it. Sealing it
		// would write entries under a key its owner does not have — a broken
		// list rather than a private one. Phase 2 of #277 is what makes a second
		// device a holder.
		const orbitdb = fakeOrbitDb();

		await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(false);
		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).toBeNull();
	});

	it('files a new list under its address, not the name it was created with', async () => {
		// The trap this module exists for: a list is created by name and reopened
		// by address. A key filed under the name is not found on the next load, a
		// fresh one is generated, and yesterday's todos are unreadable.
		const orbitdb = fakeOrbitDb();

		await openEncrypted(orbitdb, 'groceries-m4x2', { type: 'keyvalue' });

		expect(localStorage.getItem('privacy01.dbKey.groceries-m4x2')).toBeNull();
		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).not.toBeNull();
	});

	it('reads the same list back with the same key after a reload', async () => {
		// The acceptance test of Phase 1, at the seam: create under a name, then
		// reopen by address the way the registry does it, and the key must be the
		// one that sealed the entries rather than a new one.
		const creating = fakeOrbitDb();
		await openEncrypted(creating, 'groceries-m4x2', { type: 'keyvalue' });
		const sealedWith = localStorage.getItem(`privacy01.dbKey.${ADDRESS}`);

		const reopening = fakeOrbitDb();
		await openEncrypted(reopening, ADDRESS, { type: 'keyvalue' });

		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).toBe(sealedWith);
		expect(sealsEntries(reopening.opened[0].options)).toBe(true);
	});

	it('opens in the clear rather than sealing what it could never open again', async () => {
		// No storage: a key that lives only for this page load would seal entries
		// nothing can read after a reload — worse than not sealing them at all.
		const orbitdb = fakeOrbitDb();
		const setItem = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('storage is blocked');
		};

		try {
			await openEncrypted(orbitdb, 'groceries-m4x2', { type: 'keyvalue' });
		} finally {
			localStorage.setItem = setItem;
		}

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(false);
		expect(orbitdb.opened[0].options.type).toBe('keyvalue');
	});

	it('gives two lists two keys', async () => {
		await openEncrypted(fakeOrbitDb(), 'one-list', {});
		await openEncrypted(fakeOrbitDb('/orbitdb/zdpuSomeOtherList'), 'other-list', {});

		expect(Array.from(keyForDatabase(ADDRESS) ?? [])).not.toEqual(
			Array.from(keyForDatabase('/orbitdb/zdpuSomeOtherList') ?? [])
		);
	});
});
