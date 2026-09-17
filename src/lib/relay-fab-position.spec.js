import { describe, expect, it } from 'vitest';
import { RELAY_FAB_POSITION_KEY, placeRelayButtonAboveTabBar } from './relay-fab-position.js';

/** @param {Record<string, string>} [initial] */
function memoryStorage(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (/** @type {string} */ key) => values.get(key) ?? null,
		setItem: (/** @type {string} */ key, /** @type {string} */ value) =>
			void values.set(key, value),
		removeItem: (/** @type {string} */ key) => void values.delete(key),
		read: () => JSON.parse(values.get(RELAY_FAB_POSITION_KEY) ?? 'null')
	};
}

const phone = { width: 390, height: 844, narrow: true, tabBarHeight: 56 };
const desktop = { width: 1280, height: 900, narrow: false, tabBarHeight: 48 };

describe('where the relay button starts', () => {
	it('starts above the tab bar on a phone, not on it', () => {
		const storage = memoryStorage();
		expect(placeRelayButtonAboveTabBar({ storage, ...phone })).toBe('seeded');

		const { left, top, seeded } = storage.read();
		expect(seeded).toBe(true);
		// The launcher's bottom edge clears the bar's top edge.
		expect(top + 44).toBeLessThanOrEqual(844 - 56);
		expect(left + 166).toBeLessThanOrEqual(390);
	});

	it('never moves a button somebody dragged', () => {
		const dragged = JSON.stringify({ left: 12, top: 300, viewport: { width: 390, height: 844 } });
		const storage = memoryStorage({ [RELAY_FAB_POSITION_KEY]: dragged });

		expect(placeRelayButtonAboveTabBar({ storage, ...phone })).toBe('kept');
		expect(placeRelayButtonAboveTabBar({ storage, ...desktop })).toBe('kept');
		expect(storage.getItem(RELAY_FAB_POSITION_KEY)).toBe(dragged);
	});

	it("leaves the widget's own corner alone on a wide screen, and clears a start it wrote there", () => {
		const storage = memoryStorage();
		expect(placeRelayButtonAboveTabBar({ storage, ...desktop })).toBe('none');
		expect(storage.read()).toBeNull();

		placeRelayButtonAboveTabBar({ storage, ...phone });
		expect(placeRelayButtonAboveTabBar({ storage, ...desktop })).toBe('removed');
		expect(storage.read()).toBeNull();
	});

	it('writes its own start anew for the screen of the day', () => {
		const storage = memoryStorage();
		placeRelayButtonAboveTabBar({ storage, ...phone });
		placeRelayButtonAboveTabBar({ storage, ...phone, width: 360, height: 640 });
		expect(storage.read()).toMatchObject({ top: 640 - 56 - 16 - 44, seeded: true });
	});

	it('treats unreadable storage like none', () => {
		const storage = memoryStorage({ [RELAY_FAB_POSITION_KEY]: '{not json' });
		expect(placeRelayButtonAboveTabBar({ storage, ...phone })).toBe('seeded');
	});
});
