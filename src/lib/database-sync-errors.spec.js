import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { handleSyncErrors, withSyncErrorHandling } from './database-sync-errors.js';

function resetError() {
	const error = new Error('The stream has been reset');
	error.name = 'StreamResetError';
	return error;
}

function database() {
	return {
		address: '/orbitdb/zdpuTest',
		events: new EventEmitter(),
		access: { events: new EventEmitter() }
	};
}

describe('handleSyncErrors', () => {
	it('is needed: an error event without a listener throws', () => {
		expect(() => new EventEmitter().emit('error', resetError())).toThrow(
			'The stream has been reset'
		);
	});

	it('stops the throw on the database and on its access controller', () => {
		const db = handleSyncErrors(database());
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		try {
			expect(() => db.events.emit('error', resetError())).not.toThrow();
			expect(() => db.access.events.emit('error', resetError())).not.toThrow();
			expect(debug).toHaveBeenCalledTimes(2);
		} finally {
			debug.mockRestore();
		}
	});

	it('adds one listener however often a database is handed back', () => {
		const db = database();
		handleSyncErrors(db);
		handleSyncErrors(db);
		expect(db.events.listenerCount('error')).toBe(1);
		expect(db.access.events.listenerCount('error')).toBe(1);
	});

	it('leaves a database without access controller events alone', () => {
		const db = { address: '/orbitdb/zdpuTest', events: new EventEmitter() };
		expect(handleSyncErrors(db)).toBe(db);
		expect(db.events.listenerCount('error')).toBe(1);
	});
});

describe('withSyncErrorHandling', () => {
	it('handles every database the instance opens', async () => {
		const opened = database();
		/** @type {{ open: (...args: any[]) => Promise<any> }} */
		const orbitdb = { open: vi.fn(async () => opened) };
		withSyncErrorHandling(orbitdb);

		const db = await orbitdb.open('list', { type: 'keyvalue' });

		expect(db).toBe(opened);
		expect(db.events.listenerCount('error')).toBe(1);
	});
});
