import { describe, it, expect, beforeEach } from 'vitest';
import {
	getPersistentStorageEnabled,
	setPersistentStorageEnabled,
	PERSISTENT_STORAGE_PATHS
} from './storage-mode.js';

const STORAGE_KEY = 'simpleTodo.persistentStorageEnabled';

describe('persistent storage preference', () => {
	beforeEach(() => {
		localStorage.removeItem(STORAGE_KEY);
	});

	it('defaults to in-memory when nothing was chosen', () => {
		// The safer state is the one you get without deciding: this is a public,
		// unencrypted demo database, and it should not land on disk by accident.
		expect(getPersistentStorageEnabled()).toBe(false);
	});

	it('round-trips both choices', () => {
		setPersistentStorageEnabled(true);
		expect(getPersistentStorageEnabled()).toBe(true);
		setPersistentStorageEnabled(false);
		expect(getPersistentStorageEnabled()).toBe(false);
	});

	it('treats anything but the exact string as off', () => {
		// Opt-in must be explicit — a stray value cannot switch persistence on.
		for (const value of ['TRUE', '1', 'yes', '', 'false']) {
			localStorage.setItem(STORAGE_KEY, value);
			expect(getPersistentStorageEnabled()).toBe(false);
		}
	});

	it('survives a storage that throws', () => {
		// Private browsing can throw on access rather than return null.
		const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
		Storage.prototype.getItem = () => {
			throw new Error('denied');
		};
		try {
			expect(getPersistentStorageEnabled()).toBe(false);
			expect(() => setPersistentStorageEnabled(true)).not.toThrow();
		} finally {
			if (original) Object.defineProperty(Storage.prototype, 'getItem', original);
		}
	});
});

describe('PERSISTENT_STORAGE_PATHS', () => {
	it('keeps the three key spaces apart', () => {
		const paths = Object.values(PERSISTENT_STORAGE_PATHS);
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('is frozen so a caller cannot repoint one store at another', () => {
		expect(Object.isFrozen(PERSISTENT_STORAGE_PATHS)).toBe(true);
	});
});
