// Create-or-recover flow for the WebAuthn passkey identity.
//
// TODO(upstream): this flow only exists as demo code in
// @le-space/orbitdb-identity-provider-webauthn-did (examples/). Once it is
// exported there as an official helper, replace this module with that import.
//
// Recovery order (mirrors the provider's documented layers):
//   1. largeBlob — identity metadata stored inside the passkey itself,
//      readable through a discoverable WebAuthn assertion.
//   2. localStorage — the serialized credential stored at registration time.
//
// The passkey is bound to the page origin (rpId). A credential created on
// localhost cannot be used on simple-todo.le-space.de or an IPFS gateway —
// see the chapter README.
import {
	WebAuthnDIDProvider,
	parseDidLargeBlobPayload,
	readLargeBlobMetadata,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const CREDENTIAL_STORAGE_KEY = 'simpleTodo.webauthnCredential';

/**
 * Register a brand-new passkey and persist its identity metadata for later
 * recovery (largeBlob first, localStorage always).
 *
 * @param {{ userId: string, displayName: string }} options
 * @returns {Promise<any>} the WebAuthn credential for the identity provider
 */
export async function createPasskeyCredential({ userId, displayName }) {
	const credential = await WebAuthnDIDProvider.createCredential({
		userId,
		displayName
	});

	// localStorage fallback first — it never fails for platform reasons.
	storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);

	// The largeBlob write used to sit here, and it cost a WebAuthn prompt to do
	// nothing at all.
	//
	// Measured by wrapping `navigator.credentials`: the write assertion returns
	// `largeBlob: { written: false }`, every time. `WebAuthnDIDProvider.
	// createCredential` never requests the extension at registration — PRF and
	// hmac-secret get theirs, largeBlob is left with a comment saying the write
	// happens later — and the WebAuthn spec only permits writing a blob to a
	// credential registered with `largeBlob: { support: ... }`. So there was
	// nothing to write to.
	//
	// It also *looked* like it worked, because the return value was discarded:
	// `writeLargeBlobMetadata` reports the outcome in `extensionResults`, and
	// only an exception would have been noticed. Nothing threw.
	//
	// So this is removed rather than moved behind a button. A button offering to
	// back the passkey up would fail in exactly the same way, and an action that
	// asks for a fingerprint and silently achieves nothing is worse than no
	// action. Registering with the extension is an upstream change; when it
	// lands, the explicit backup step is worth adding.
	//
	// Creating a passkey now costs three WebAuthn prompts instead of four:
	// `create` (prf), `get` (prf, keystore), `get` (signIdentity).

	return credential;
}

/**
 * Recover a previously registered passkey identity.
 *
 * @returns {Promise<any | null>} the credential, or null when nothing found
 */
export async function recoverPasskeyCredential() {
	try {
		// @ts-expect-error declared as returning `unknown`; it resolves to { blob }
		const { blob } = await readLargeBlobMetadata({ discoverableCredentials: true });
		if (blob?.length) {
			const payload = parseDidLargeBlobPayload(blob);
			const credential = /** @type {any} */ (payload)?.credential ?? payload;
			if (credential?.did) {
				// Refresh the local fallback so the next recovery works offline of largeBlob.
				storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
				return credential;
			}
		}
	} catch (error) {
		console.warn('largeBlob recovery unavailable, trying localStorage:', error);
	}

	return loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
}

/** True when a serialized credential exists in this browser profile. */
export function hasStoredPasskeyCredential() {
	try {
		return Boolean(loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY));
	} catch {
		return false;
	}
}

/** Remove the locally stored credential (the passkey itself stays on the authenticator). */
export function forgetStoredPasskeyCredential() {
	clearWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
}
