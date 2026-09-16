import { page } from '@vitest/browser/context';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { locale } from '$lib/i18n/index.js';
import P2PStatusNav from './P2PStatusNav.svelte';
import { TECHNICAL_VIEW_STORAGE_KEY, technicalView } from './technical-view.js';

const STEP_KEYS = ['networkConfig', 'libp2p', 'helia', 'orbitdb', 'databaseSync', 'localTodos'];

/** Started, with no libp2p node handed in: no relay, no second browser. */
const started = {
	isInitializing: false,
	isInitialized: true,
	error: null,
	steps: STEP_KEYS.map((key) => ({ key, status: /** @type {const} */ ('complete') }))
};

/** What `p2p.js` leaves behind when the start throws. */
const failed = { isInitializing: false, isInitialized: false, error: 'boom', steps: [] };

/**
 * Stands in for the peer ID, multiaddrs and manual connect form the page puts in
 * the panel's slot. A snippet fills a `<slot />` only when `$$slots` says the
 * slot is filled, which is what the page's markup does for the component.
 */
const withPlumbing = {
	children: createRawSnippet(() => ({
		render: () => '<p data-testid="plumbing">12D3KooW…</p>'
	})),
	$$slots: { default: true }
};

const count = (/** @type {string} */ testid) =>
	document.querySelectorAll(`[data-testid="${testid}"]`).length;

beforeEach(() => {
	locale.set('en');
	technicalView.set(false);
});

afterEach(() => {
	technicalView.set(false);
	localStorage.removeItem(TECHNICAL_VIEW_STORAGE_KEY);
	locale.set('en');
});

describe('the P2P status panel', () => {
	it('says in the simple view whether the app is ready, without the plumbing behind it', async () => {
		render(P2PStatusNav, { initialization: started, ...withPlumbing });
		await tick();

		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('Ready. Connecting to a relay…');
		expect(count('p2p-status-spinner')).toBe(1);
		expect(count('p2p-status-step')).toBe(0);
		expect(count('network-details')).toBe(0);
		expect(count('plumbing')).toBe(0);
	});

	it('shows every step and the network details in the technical view', async () => {
		render(P2PStatusNav, { initialization: started, ...withPlumbing });
		technicalView.set(true);

		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('Connecting to relay');
		expect(count('p2p-status-step')).toBe(8);
		await expect.element(page.getByTestId('network-details')).toHaveTextContent('Network details');
		await expect.element(page.getByTestId('network-details')).toHaveTextContent('0 peers');
		expect(count('plumbing')).toBe(1);
	});

	it('speaks German, down to the names of the steps', async () => {
		render(P2PStatusNav, { initialization: started, ...withPlumbing });
		locale.set('de');
		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('Bereit. Verbindung zu einem Relay wird aufgebaut …');

		technicalView.set(true);
		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('Verbindung zum Relay wird aufgebaut');
		const steps = [...document.querySelectorAll('[data-testid="p2p-status-step"]')].map((step) =>
			step.textContent?.trim()
		);
		expect(steps).toContain('Netzwerkkonfiguration');
		expect(steps).toContain('Relay verbunden');
		await expect.element(page.getByTestId('network-details')).toHaveTextContent('Netzwerkdetails');
		await expect.element(page.getByTestId('network-details')).toHaveTextContent('0 Peers');
	});

	it('says plainly that the start failed, and stops spinning', async () => {
		render(P2PStatusNav, { initialization: failed });
		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('The app could not start.');
		expect(count('p2p-status-spinner')).toBe(0);

		locale.set('de');
		await expect
			.element(page.getByTestId('p2p-status-label'))
			.toHaveTextContent('Die App konnte nicht starten.');
	});
});
