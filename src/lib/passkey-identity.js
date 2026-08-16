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
	createDidLargeBlobPayload,
	parseDidLargeBlobPayload,
	writeLargeBlobMetadata,
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

	// Best effort: put the metadata into the authenticator's largeBlob so the
	// identity survives a cleared browser profile. Costs one extra WebAuthn
	// prompt right after registration; not every authenticator supports it.
	try {
		// The package's own `types/index.d.ts` is wrong for these three, checked
		// against `src/webauthn/large-blob-metadata.js` in 0.5.0: it declares
		// `createDidLargeBlobPayload(credentialInfo)` and
		// `writeLargeBlobMetadata(credentialId, payload, options?)`, while the
		// implementations take `(credential, did)` and a single destructured object.
		// `readLargeBlobMetadata` is declared as returning `unknown`, so reading
		// `.blob` off it fails too.
		//
		// The calls below match the *implementation*. Changing them to satisfy the
		// declarations would break working code — `writeLargeBlobMetadata` would
		// receive the whole options object as `credentialId` and `undefined` as the
		// payload, and fail silently into the catch below, looking like an
		// authenticator that does not support largeBlob.
		//
		// `@ts-expect-error` rather than a cast, deliberately: it turns into an
		// error of its own once the package ships correct types, which is the
		// signal to delete these lines.
		// @ts-expect-error package types disagree with its implementation (0.5.0)
		const payload = createDidLargeBlobPayload(credential, credential.did);
		// @ts-expect-error package types disagree with its implementation (0.5.0)
		await writeLargeBlobMetadata({
			credentialId: credential.rawCredentialId,
			payload
		});
	} catch (error) {
		console.warn('largeBlob write skipped (falling back to localStorage only):', error);
	}

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
