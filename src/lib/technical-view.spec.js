import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { TECHNICAL_VIEW_STORAGE_KEY, createTechnicalView } from './technical-view.js';

/** A storage in a map, so each test starts from nothing and leaves nothing. */
function memoryStorage(initial = /** @type {Record<string, string>} */ ({})) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		/** @param {string} key */
		getItem: (key) => values.get(key) ?? null,
		/** @param {string} key @param {string} value */
		setItem: (key, value) => void values.set(key, value)
	};
}

/** What Safari and Firefox hand out with site data blocked. */
const blocked = {
	getItem() {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	},
	setItem() {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	}
};

describe('the technical view setting', () => {
	afterEach(() => {
		localStorage.removeItem(TECHNICAL_VIEW_STORAGE_KEY);
	});

	it('lives under the chapter’s simpleTodo. prefix', () => {
		expect(TECHNICAL_VIEW_STORAGE_KEY).toBe('simpleTodo.technicalView');
	});

	it('starts simple when nothing was chosen', () => {
		const storage = memoryStorage();
		expect(get(createTechnicalView({ storage: () => storage }))).toBe(false);
	});

	it('starts technical when that was chosen last time', () => {
		const storage = memoryStorage({ [TECHNICAL_VIEW_STORAGE_KEY]: 'true' });
		expect(get(createTechnicalView({ storage: () => storage }))).toBe(true);
	});

	it('reads anything but "true" as simple', () => {
		for (const stored of ['false', '1', 'yes', '']) {
			const storage = memoryStorage({ [TECHNICAL_VIEW_STORAGE_KEY]: stored });
			expect(get(createTechnicalView({ storage: () => storage })), stored).toBe(false);
		}
	});

	it('remembers a toggle, and a later page load starts from it', () => {
		const storage = memoryStorage();
		const view = createTechnicalView({ storage: () => storage });

		view.toggle();
		expect(get(view)).toBe(true);
		expect(storage.values.get(TECHNICAL_VIEW_STORAGE_KEY)).toBe('true');
		expect(get(createTechnicalView({ storage: () => storage }))).toBe(true);

		view.toggle();
		expect(get(view)).toBe(false);
		expect(storage.values.get(TECHNICAL_VIEW_STORAGE_KEY)).toBe('false');
		expect(get(createTechnicalView({ storage: () => storage }))).toBe(false);
	});

	it('writes what set() was given', () => {
		const storage = memoryStorage();
		const view = createTechnicalView({ storage: () => storage });
		view.set(true);
		expect(storage.values.get(TECHNICAL_VIEW_STORAGE_KEY)).toBe('true');
		view.set(false);
		expect(get(view)).toBe(false);
		expect(storage.values.get(TECHNICAL_VIEW_STORAGE_KEY)).toBe('false');
	});

	it('keeps working for the session when storage throws', () => {
		const view = createTechnicalView({ storage: () => blocked });
		expect(get(view)).toBe(false);
		expect(() => view.toggle()).not.toThrow();
		expect(get(view)).toBe(true);
		expect(() => view.set(false)).not.toThrow();
		expect(get(view)).toBe(false);
	});

	it('keeps working when even asking for storage throws', () => {
		const view = createTechnicalView({
			storage: () => {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		});
		expect(get(view)).toBe(false);
		view.toggle();
		expect(get(view)).toBe(true);
	});

	it('keeps working without any storage', () => {
		const view = createTechnicalView({ storage: () => null });
		expect(get(view)).toBe(false);
		view.toggle();
		expect(get(view)).toBe(true);
	});

	it('uses the browser’s localStorage by default', () => {
		const view = createTechnicalView();
		view.set(true);
		expect(localStorage.getItem(TECHNICAL_VIEW_STORAGE_KEY)).toBe('true');
		expect(get(createTechnicalView())).toBe(true);
	});

	it('tells every subscriber, so header and consent dialog stay in step', () => {
		const storage = memoryStorage();
		const view = createTechnicalView({ storage: () => storage });
		/** @type {boolean[]} */
		const header = [];
		/** @type {boolean[]} */
		const dialog = [];
		const stopHeader = view.subscribe((value) => header.push(value));
		const stopDialog = view.subscribe((value) => dialog.push(value));
		view.toggle();
		view.toggle();
		stopHeader();
		stopDialog();
		expect(header).toEqual([false, true, false]);
		expect(dialog).toEqual([false, true, false]);
	});
});
