import { beforeEach, describe, expect, it } from 'vitest';

import { forgetDatabaseKey, keyForDatabase } from './database-keys.js';

const NAME = 'luna-camino-verde';

describe('database-keys', () => {
	beforeEach(() => forgetDatabaseKey(NAME));

	it('returns the same key on a second call, which is what survives a reload', () => {
		const first = keyForDatabase(NAME);
		const second = keyForDatabase(NAME);

		expect(first).toHaveLength(32);
		expect(Array.from(second ?? [])).toEqual(Array.from(first ?? []));
	});

	it('gives different databases different keys', () => {
		const one = keyForDatabase(NAME);
		const other = keyForDatabase('otra-lista-azul');
		forgetDatabaseKey('otra-lista-azul');

		expect(Array.from(other ?? [])).not.toEqual(Array.from(one ?? []));
	});

	it('refuses a stored key that is not readable rather than replacing it', () => {
		keyForDatabase(NAME);
		localStorage.setItem(`privacy01.dbKey.${NAME}`, 'not base64 ***');

		// Replacing it would seal new entries under a key that cannot open the
		// old ones — silently, and only noticed once something is unreadable.
		expect(() => keyForDatabase(NAME)).toThrow();
	});

	it('forgets a key on request', () => {
		const first = keyForDatabase(NAME);
		forgetDatabaseKey(NAME);
		const second = keyForDatabase(NAME);

		expect(Array.from(second ?? [])).not.toEqual(Array.from(first ?? []));
	});
});
