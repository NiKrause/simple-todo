/**
 * The P-256 key inside a passkey's DID (escrow01).
 *
 * Before a lock, Alice's app checks that the account Bob published is his
 * passkey's: that the key his DID names is an admin key there. Alice has
 * Bob's DID and nothing else of his passkey, so the key comes out of the DID.
 *
 * The identity provider writes the key uncompressed (`0x04‖x‖y`), which the
 * did:key spec does not; other P-256 did:keys carry it compressed. Both are
 * read.
 */

import { varint } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';

const DID_KEY_PREFIX = 'did:key:';
const P256_PUB = 0x1200;
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;

/**
 * @param {string} did
 * @returns {{ x: bigint, y: bigint } | null} null for anything but a P-256
 *   did:key whose point is on the curve
 */
export function p256KeyFromDid(did) {
	if (typeof did !== 'string' || !did.startsWith(`${DID_KEY_PREFIX}z`)) return null;
	try {
		const bytes = base58btc.decode(did.slice(DID_KEY_PREFIX.length));
		const [codec, length] = varint.decode(bytes);
		if (codec !== P256_PUB) return null;
		return pointFromSec1(bytes.subarray(length));
	} catch {
		return null;
	}
}

/** @param {Uint8Array} bytes */
function pointFromSec1(bytes) {
	if (bytes.length === 65 && bytes[0] === 0x04) {
		const x = toBigInt(bytes.subarray(1, 33));
		const y = toBigInt(bytes.subarray(33));
		return x < P256_P && y < P256_P && mod(y * y) === curve(x) ? { x, y } : null;
	}
	if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) return null;

	const x = toBigInt(bytes.subarray(1));
	if (x >= P256_P) return null;
	const ySquared = curve(x);
	// p ≡ 3 (mod 4), so a square root is a single power.
	let y = pow(ySquared, (P256_P + 1n) / 4n);
	if (mod(y * y) !== ySquared) return null;
	if ((y & 1n) !== BigInt(bytes[0] & 1)) y = mod(P256_P - y);
	return { x, y };
}

/**
 * y² = x³ − 3x + b
 * @param {bigint} x
 */
function curve(x) {
	return mod(x * x * x - 3n * x + P256_B);
}

/** @param {bigint} value */
function mod(value) {
	const result = value % P256_P;
	return result < 0n ? result + P256_P : result;
}

/**
 * @param {bigint} base
 * @param {bigint} exponent
 */
function pow(base, exponent) {
	let result = 1n;
	for (let b = mod(base), e = exponent; e > 0n; e >>= 1n) {
		if (e & 1n) result = mod(result * b);
		b = mod(b * b);
	}
	return result;
}

/** @param {Uint8Array} bytes */
function toBigInt(bytes) {
	let result = 0n;
	for (const byte of bytes) result = (result << 8n) | BigInt(byte);
	return result;
}
