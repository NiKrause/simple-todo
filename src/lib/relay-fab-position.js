/**
 * Where the relay button starts on a phone (escrow01).
 *
 * The widget (`@le-space/ui` 0.9.6) puts its launcher 22 px from the bottom
 * right corner and has no way to be told about anything else down there. On a
 * phone that corner is the tab bar's now, so the launcher sat on top of the
 * account and network tabs and took their taps.
 *
 * The widget does read a stored position before it falls back to its corner:
 * the one a drag leaves behind. So on a narrow screen this writes one above
 * the tab bar, marked `seeded` so it can tell its own from a person's. A
 * position somebody dragged to is never touched; a seeded one is written anew
 * for the screen of the day, and removed on a wide one, where there is no tab
 * bar at the foot and the widget's corner is right.
 */

export const RELAY_FAB_POSITION_KEY = 'simpleTodo.relayFabPosition';

/** Tailwind's `sm`: below it the tab bar sits at the foot of the screen. */
export const NARROW_SCREEN = '(max-width: 639.98px)';

/** The widget's own distance from the edges (`FAB_EDGE_MARGIN`). */
const EDGE = 22;
/** The launcher's size in 0.9.6, which the widget measures only once it is on screen. */
const LAUNCHER = { width: 166, height: 44 };
/** Between the launcher and the top of the tab bar. */
const GAP = 16;

/**
 * @param {{
 *   storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
 *   width: number,
 *   height: number,
 *   narrow: boolean,
 *   tabBarHeight: number
 * }} screen
 * @returns {'kept' | 'seeded' | 'removed' | 'none'} what it did, for the tests
 */
export function placeRelayButtonAboveTabBar({ storage, width, height, narrow, tabBarHeight }) {
	let stored = null;
	try {
		stored = JSON.parse(storage.getItem(RELAY_FAB_POSITION_KEY) ?? 'null');
	} catch {
		// Unreadable: treated like nothing stored, and overwritten below if narrow.
	}
	if (stored && !stored.seeded) return 'kept';

	if (!narrow) {
		if (!stored) return 'none';
		storage.removeItem(RELAY_FAB_POSITION_KEY);
		return 'removed';
	}

	storage.setItem(
		RELAY_FAB_POSITION_KEY,
		JSON.stringify({
			left: Math.max(EDGE, width - LAUNCHER.width - EDGE),
			top: Math.max(EDGE, height - tabBarHeight - GAP - LAUNCHER.height),
			seeded: true
		})
	);
	return 'seeded';
}

/** The same, for this browser window. Storage that throws leaves the widget's corner. */
export function placeRelayButtonForThisScreen() {
	try {
		const tabBar = document.querySelector('[data-testid="section-tabs"]');
		placeRelayButtonAboveTabBar({
			storage: localStorage,
			width: window.innerWidth,
			height: window.innerHeight,
			narrow: window.matchMedia(NARROW_SCREEN).matches,
			tabBarHeight: tabBar?.getBoundingClientRect().height ?? 64
		});
	} catch {
		// No storage: the launcher starts in the widget's corner.
	}
}
