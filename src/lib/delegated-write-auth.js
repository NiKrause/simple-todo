/**
 * A passkey prompt before every delegated write (delegation01).
 *
 * The passkey identity unlocks its signing key once per session
 * (`encryptKeystore`), so a delegate's writes would otherwise go out with no
 * further interaction. de2do asks the authenticator again for each delegated
 * action — completing or renaming someone else's todo is the one thing this
 * identity may do on a list it does not own, and it should not happen by
 * accident. That is reproduced here: a fresh WebAuthn assertion, scoped to
 * the session's own credential, before the action is written.
 *
 * The assertion itself is not attached to the entry (the entry is signed by
 * the OrbitDB identity as usual); it is a presence check. The store exists so
 * the UI — and the E2E test — can see the prompt happen.
 */
import { writable, get } from 'svelte/store';
import { getWebAuthnConfig } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { passkeyCredentialStore } from './p2p-stores.js';

/** @typedef {'idle' | 'awaiting' | 'success' | 'error'} DelegatedAuthState */

export const delegatedWriteAuthStore = writable(
	/** @type {{ state: DelegatedAuthState, action: string | null, at: string | null, message: string }} */ ({
		state: 'idle',
		action: null,
		at: null,
		message: ''
	})
);

/** @type {ReturnType<typeof setTimeout> | null} */
let resetTimer = null;

/**
 * @param {DelegatedAuthState} state
 * @param {string | null} action
 * @param {string} [message]
 */
function setState(state, action, message = '') {
	delegatedWriteAuthStore.set({ state, action, at: new Date().toISOString(), message });
	if (resetTimer) clearTimeout(resetTimer);
	if (state === 'success' || state === 'error') {
		resetTimer = setTimeout(() => {
			delegatedWriteAuthStore.update((current) =>
				current.state === 'awaiting'
					? current
					: { state: 'idle', action: null, at: null, message: '' }
			);
		}, 8000);
	}
}

/**
 * Ask the authenticator to confirm the session's passkey. Resolves true when
 * the user confirmed, false when they cancelled or the prompt failed.
 *
 * An anonymous session has no passkey to confirm; it resolves true so the
 * access controller stays the only gate, exactly as in de2do.
 *
 * @param {string} actionName what is about to be written, for the status line
 */
export async function confirmDelegatedWrite(actionName) {
	const credential = get(passkeyCredentialStore);
	if (!credential?.rawCredentialId) return true;

	setState('awaiting', actionName, 'Confirm your passkey to sign this delegated write');
	const startedAt = Date.now();
	try {
		const rpId = /** @type {string | undefined} */ (getWebAuthnConfig().rpId);
		await navigator.credentials.get({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				...(rpId ? { rpId } : {}),
				userVerification: 'required',
				allowCredentials: [{ id: credential.rawCredentialId, type: 'public-key' }]
			}
		});
		// Let the "awaiting" state be visible for a beat, so a platform
		// authenticator that answers instantly still shows what happened.
		const elapsed = Date.now() - startedAt;
		if (elapsed < 250) await new Promise((resolve) => setTimeout(resolve, 250 - elapsed));
		setState('success', actionName, 'Delegated write confirmed');
		return true;
	} catch (error) {
		setState(
			'error',
			actionName,
			error instanceof Error ? error.message : 'Passkey confirmation failed'
		);
		return false;
	}
}
