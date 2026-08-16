import { writable } from 'svelte/store';

/**
 * Simple by default, technical on request.
 *
 * The chapter has one story — prepare a list, hand it to the person next to
 * you — and everything else on the page serves a different reader: someone
 * verifying that libp2p came up, or a feature inherited from `acl01`. Both are
 * worth keeping and neither is worth putting in front of a first-time user.
 *
 * So this is a switch, not a deletion: nothing is removed, it is moved behind
 * one door. The default is `true` because the person who needs the diagnostics
 * knows to go looking, and the person who does not would never have known what
 * `Helia` or `12D3KooW…` meant.
 */
// Exported so tests pin the mode through storage rather than repeating the
// string — a literal in a spec drifts silently when this one changes.
export const VIEW_MODE_STORAGE_KEY = 'qr01.simpleView';
const STORAGE_KEY = VIEW_MODE_STORAGE_KEY;

function readStored() {
	try {
		return localStorage.getItem(STORAGE_KEY) !== 'false';
	} catch {
		return true;
	}
}

export const simpleView = writable(true);

/** Called once on mount: `localStorage` does not exist while prerendering. */
export function hydrateViewMode() {
	simpleView.set(readStored());
}

export function toggleView() {
	simpleView.update((current) => {
		const next = !current;
		try {
			localStorage.setItem(STORAGE_KEY, String(next));
		} catch {
			// Storage blocked: the choice holds for this session only.
		}
		return next;
	});
}
