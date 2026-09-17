import { readable } from 'svelte/store';

/**
 * The parts of the page (escrow01), and which one is on screen.
 *
 * The page used to show everything at once, so on a phone the todos began
 * three screens down, under the network panel and four cards about lists. Now
 * the todos come first, and the rest sits behind four tabs.
 *
 * Sections, not routes: this page owns the consent dialog and the P2P start,
 * and a navigation to another route would unmount it and start both over.
 * Every section stays mounted and is only hidden, so a half-filled form or an
 * open connection survives a switch.
 *
 * The section is the URL's fragment, which is what makes reload, the back
 * button and a link to one section work without code of their own. The names
 * are German because `#pruefstelle`, the auditor view's, already was.
 */

/** @typedef {'aufgaben' | 'listen' | 'konto' | 'netzwerk' | 'pruefstelle'} Section */

/** The sections with a tab, in the order the tab bar shows them. */
export const TAB_SECTIONS = /** @type {const} */ (['aufgaben', 'listen', 'konto', 'netzwerk']);

/** The auditor view: reached from the account tab, and without a tab of its own. */
export const AUDITOR_SECTION = 'pruefstelle';

/** Where the page opens without a fragment, or with one it does not know. */
export const DEFAULT_SECTION = 'aufgaben';

/**
 * @param {string | null | undefined} hash `location.hash`, with or without the `#`
 * @returns {Section}
 */
export function sectionFromHash(hash) {
	const id = String(hash ?? '').replace(/^#/, '');
	if (id === AUDITOR_SECTION) return AUDITOR_SECTION;
	return /** @type {readonly string[]} */ (TAB_SECTIONS).includes(id)
		? /** @type {Section} */ (id)
		: DEFAULT_SECTION;
}

/**
 * @param {Pick<Window, 'addEventListener' | 'removeEventListener'> & { location: { hash: string } } | null} [target]
 *   the window; a test hands in its own
 */
export function createSectionStore(target = typeof window === 'undefined' ? null : window) {
	return readable(
		/** @type {Section} */ (target ? sectionFromHash(target.location.hash) : DEFAULT_SECTION),
		(set) => {
			if (!target) return;
			const update = () => set(sectionFromHash(target.location.hash));
			update();
			// Fired for a click on a tab, for the back and forward buttons, and for a
			// fragment typed into the address bar alike.
			target.addEventListener('hashchange', update);
			return () => target.removeEventListener('hashchange', update);
		}
	);
}

export const currentSection = createSectionStore();
