import { WebAuthnDIDProvider } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { getP256CredentialDescriptor } from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';
import { getKeyHash, toWebAuthnP256Key } from '@le-space/passkey-wallet';
import { varint } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import { describe, expect, it } from 'vitest';
import { p256KeyFromDid } from './did-key.js';

/** @param {string} value */
function fromBase64url(value) {
	const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** @param {Uint8Array} bytes */
function toBigInt(bytes) {
	return BigInt(`0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`);
}

async function passkeyLikeKey() {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign'
	]);
	const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
	return {
		x: fromBase64url(/** @type {string} */ (jwk.x)),
		y: fromBase64url(/** @type {string} */ (jwk.y))
	};
}

/**
 * @param {number} codec
 * @param {Uint8Array} key
 */
function didKey(codec, key) {
	const prefix = new Uint8Array(varint.encodingLength(codec));
	varint.encodeTo(codec, prefix, 0);
	const bytes = new Uint8Array(prefix.length + key.length);
	bytes.set(prefix);
	bytes.set(key, prefix.length);
	return `did:key:${base58btc.encode(bytes)}`;
}

describe('p256KeyFromDid', () => {
	it('reads the key from a DID the identity provider made', async () => {
		const { x, y } = await passkeyLikeKey();
		const did = await WebAuthnDIDProvider.createDID(/** @type {any} */ ({ publicKey: { x, y } }));

		expect(p256KeyFromDid(did)).toEqual({ x: toBigInt(x), y: toBigInt(y) });
	});

	it('gives the key hash account setup registers for that passkey', async () => {
		const { x, y } = await passkeyLikeKey();
		const did = await WebAuthnDIDProvider.createDID(/** @type {any} */ ({ publicKey: { x, y } }));
		const descriptor = getP256CredentialDescriptor({
			rawCredentialId: new Uint8Array([1, 2, 3, 4]),
			publicKey: { x, y },
			rpId: 'localhost'
		});

		const fromDid = p256KeyFromDid(did);
		expect(fromDid).not.toBeNull();
		expect(descriptor).not.toBeNull();
		expect(getKeyHash(toWebAuthnP256Key(/** @type {any} */ (fromDid)))).toBe(
			getKeyHash(toWebAuthnP256Key(/** @type {any} */ (descriptor)))
		);
	});

	it('reads a compressed key as the same point', async () => {
		const { x, y } = await passkeyLikeKey();
		const compressed = new Uint8Array(33);
		compressed[0] = 0x02 | (y[31] & 1);
		compressed.set(x, 1);

		expect(p256KeyFromDid(didKey(0x1200, compressed))).toEqual({ x: toBigInt(x), y: toBigInt(y) });
	});

	it('refuses anything that is not a P-256 point', async () => {
		const { x, y } = await passkeyLikeKey();
		const offCurve = new Uint8Array(65);
		offCurve[0] = 0x04;
		offCurve.set(x, 1);
		offCurve.set(y, 33);
		offCurve[64] ^= 1;

		expect(p256KeyFromDid(didKey(0x1200, offCurve))).toBeNull();
		expect(p256KeyFromDid(didKey(0xed, x))).toBeNull();
		expect(p256KeyFromDid('did:web:example.com')).toBeNull();
		expect(p256KeyFromDid('did:key:z0OIl')).toBeNull();
		expect(p256KeyFromDid(/** @type {any} */ (undefined))).toBeNull();
	});
});
