import { writable } from 'svelte/store';

/**
 * Whether the page shows its technical explanations (escrow01).
 *
 * One switch for the whole page. The header has it, and the consent dialog has
 * the same button: somebody presenting to experts turns it on once, and every
 * budget step then carries its detailed explanation next to the plain one —
 * including after a reload, which a presentation does not always avoid.
 */
export const TECHNICAL_VIEW_STORAGE_KEY = 'simpleTodo.technicalView';

/**
 * @typedef {Pick<Storage, 'getItem' | 'setItem'>} ViewStorage
 */

/**
 * The browser's storage, or null where there is none.
 *
 * A function rather than a value: with site data blocked, Safari and Firefox
 * throw on the property access itself, not only on `getItem`.
 *
 * @returns {ViewStorage | null}
 */
function browserStorage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * @param {{ storage?: () => ViewStorage | null, key?: string }} [options]
 *   `storage` is asked on every read and write, so a test can hand in one that
 *   fails and the page can survive one that starts failing.
 */
export function createTechnicalView({
	storage = browserStorage,
	key = TECHNICAL_VIEW_STORAGE_KEY
} = {}) {
	/** @returns {boolean} */
	function read() {
		try {
			return storage()?.getItem(key) === 'true';
		} catch {
			// Unreadable storage: start simple, the safe default for everyone else.
			return false;
		}
	}

	/** @param {boolean} value */
	function persist(value) {
		try {
			storage()?.setItem(key, value ? 'true' : 'false');
		} catch {
			// Blocked or full: the choice holds for this page and no longer.
		}
	}

	const { subscribe, set } = writable(read());
	let current = false;
	subscribe((value) => (current = value));

	return {
		subscribe,
		/** @param {boolean} value */
		set(value) {
			const next = value === true;
			set(next);
			persist(next);
		},
		toggle() {
			const next = !current;
			set(next);
			persist(next);
		}
	};
}

export const technicalView = createTechnicalView();
