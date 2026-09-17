import { page } from '@vitest/browser/context';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { locale } from '$lib/i18n/index.js';
import NetworkStatusDot from './NetworkStatusDot.svelte';
import SectionTabs from './SectionTabs.svelte';
import { networkStateStore } from './network-status.js';
import {
	AUDITOR_SECTION,
	DEFAULT_SECTION,
	TAB_SECTIONS,
	createSectionStore,
	sectionFromHash
} from './sections.js';

/**
 * A window with just enough of one in it: a fragment, and the event that says
 * it changed.
 *
 * @param {string} [hash]
 */
function fakeWindow(hash = '') {
	const events = new EventTarget();
	return {
		location: { hash },
		addEventListener: events.addEventListener.bind(events),
		removeEventListener: events.removeEventListener.bind(events),
		/** @param {string} next */
		navigate(next) {
			this.location.hash = next;
			events.dispatchEvent(new Event('hashchange'));
		}
	};
}

afterEach(() => {
	locale.set('en');
	networkStateStore.set('starting');
	if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});

describe('which section a fragment opens', () => {
	it('opens on the todos when the address has no fragment', () => {
		expect(sectionFromHash('')).toBe('aufgaben');
		expect(sectionFromHash(undefined)).toBe('aufgaben');
	});

	it('knows every tab by its fragment, with or without the #', () => {
		for (const id of TAB_SECTIONS) {
			expect(sectionFromHash(`#${id}`)).toBe(id);
			expect(sectionFromHash(id)).toBe(id);
		}
	});

	it('still opens the auditor view from the fragment it always had', () => {
		expect(sectionFromHash('#pruefstelle')).toBe(AUDITOR_SECTION);
	});

	it('falls back to the todos for a fragment it does not know', () => {
		// A mistyped or outdated link must still open a page somebody can use.
		for (const hash of ['#settings', '#Konto', '#aufgaben/extra', '#/orbitdb/zdpu']) {
			expect(sectionFromHash(hash)).toBe(DEFAULT_SECTION);
		}
	});
});

describe('the section store', () => {
	it('starts on the section the address names', () => {
		const win = fakeWindow('#konto');
		expect(get(createSectionStore(/** @type {any} */ (win)))).toBe('konto');
	});

	it('follows the fragment while anybody listens, and stops listening after', () => {
		const win = fakeWindow();
		const store = createSectionStore(/** @type {any} */ (win));
		/** @type {string[]} */
		const seen = [];
		const stop = store.subscribe((section) => seen.push(section));

		win.navigate('#listen');
		win.navigate('#netzwerk');
		win.navigate('#pruefstelle');
		stop();
		win.navigate('#konto');

		expect(seen).toEqual(['aufgaben', 'listen', 'netzwerk', 'pruefstelle']);
	});
});

describe('the tab bar', () => {
	it('marks the open tab, and a click opens another', async () => {
		render(SectionTabs);

		await expect.element(page.getByTestId('tab-aufgaben')).toHaveAttribute('aria-current', 'page');
		expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

		await page.getByTestId('tab-konto').click();
		await expect.element(page.getByTestId('tab-konto')).toHaveAttribute('aria-current', 'page');
		await expect.element(page.getByTestId('tab-aufgaben')).not.toHaveAttribute('aria-current');
		expect(location.hash).toBe('#konto');
	});

	it('names its tabs in the language on screen', async () => {
		render(SectionTabs);
		const labels = () =>
			[...document.querySelectorAll('[data-testid^="tab-"]')].map((tab) => tab.textContent?.trim());

		await expect.poll(labels).toEqual(['Todos', 'Lists', 'Account', 'Network']);
		locale.set('de');
		await expect.poll(labels).toEqual(['Aufgaben', 'Listen', 'Konto', 'Netzwerk']);
	});

	it('marks no tab while the auditor view is open', async () => {
		history.replaceState(null, '', '#pruefstelle');
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		render(SectionTabs);

		await expect.poll(() => document.querySelectorAll('[aria-current="page"]').length).toBe(0);
	});
});

describe("the header's network dot", () => {
	it('says in a word what the status panel says in a sentence, and leads to it', async () => {
		render(NetworkStatusDot);
		const dot = page.getByTestId('network-status-dot');

		networkStateStore.set('direct');
		await expect.element(dot).toHaveAttribute('data-state', 'direct');
		await expect.element(dot).toHaveAttribute('href', '#netzwerk');
		// The word first, then the whole sentence for whoever cannot see the dot.
		await expect
			.element(dot)
			.toHaveAccessibleName(
				'Connected directly – Ready and connected directly to another browser. Details in the Network tab.'
			);

		networkStateStore.set('failed');
		locale.set('de');
		await expect.element(dot).toHaveTextContent('Startfehler');
		await expect.element(dot).toHaveAttribute('title', 'Die App konnte nicht starten');
	});
});
