import { writable, get } from 'svelte/store';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

/**
 * What travels over the connection a scanned code built.
 *
 * One protocol carrying versioned, typed JSON envelopes, modelled on the
 * webrtc-qr demo's chat (`examples/demo/index.js`): it registers a single
 * protocol and dispatches on `message.kind`, so plain messages and file
 * announcements share one stream rather than each earning a protocol of its
 * own. The same shape leaves room for milestone 2's receipt and milestone 3's
 * relay offer without inventing a channel each time.
 *
 * `v` is the envelope version, not the app's. It exists so a later kind can be
 * added without an older peer mistaking it for something it understands.
 *
 * Framing is the stream's own: a libp2p 3 stream is async-iterable and has
 * `send()`, so messages arrive whole and no length-prefix layer is involved.
 */

export const HANDOVER_PROTOCOL = '/simple-todo/qr01/1.0.0';
export const ENVELOPE_VERSION = 1;

/** @typedef {{ v: number, kind: 'list-offer', address: string, name: string, ownerDid: string }} ListOffer */

/**
 * A list somebody has offered over the connection, waiting for a yes or no.
 *
 * Held as state rather than acted on directly: replicating somebody else's
 * database is not something to do merely because bytes arrived, and the person
 * on this end is the one who decides.
 *
 * @type {import('svelte/store').Writable<ListOffer | null>}
 */
export const incomingListOffer = writable(/** @type {ListOffer | null} */ (null));

/**
 * @param {unknown} value
 * @returns {value is ListOffer}
 */
export function isListOffer(value) {
	if (!value || typeof value !== 'object') return false;
	const envelope = /** @type {any} */ (value);
	return (
		envelope.v === ENVELOPE_VERSION &&
		envelope.kind === 'list-offer' &&
		typeof envelope.address === 'string' &&
		envelope.address.startsWith('/orbitdb/') &&
		typeof envelope.name === 'string' &&
		typeof envelope.ownerDid === 'string'
	);
}

/** @param {any} payload */
function envelope(payload) {
	return uint8ArrayFromString(JSON.stringify({ v: ENVELOPE_VERSION, ...payload }));
}

/**
 * Read envelopes until the stream ends.
 *
 * @param {any} stream
 */
async function readEnvelopes(stream) {
	for await (const data of stream) {
		let message;
		try {
			message = JSON.parse(uint8ArrayToString(data.subarray()));
		} catch {
			// A peer we cannot parse is not a peer worth throwing over.
			continue;
		}
		if (isListOffer(message)) incomingListOffer.set(message);
	}
}

/**
 * Listen for envelopes on connections the QR handshake builds.
 *
 * Registered once at startup rather than when a screen opens: the offer can
 * arrive before anybody on this side has navigated anywhere — Bob scans a code
 * and the list is simply there to accept.
 *
 * @param {any} node
 */
export function registerHandoverProtocol(node) {
	// Positional arguments, not a single object: libp2p 3 changed this, and
	// destructuring `{ stream }` here yields undefined and a silent dead stream.
	node.handle(HANDOVER_PROTOCOL, (/** @type {any} */ stream) => {
		readEnvelopes(stream).catch((error) => {
			console.warn('handover stream closed:', error);
		});
	});
}

/**
 * Offer a list to the peer on the other end of the scanned connection.
 *
 * Dialled through the QR session rather than the node: the session holds the
 * peer connection the handshake negotiated, and this peer has no address
 * anybody could dial without it.
 *
 * @param {any} session a QRSession
 * @param {string} peerId
 * @param {{ address: string, name: string, ownerDid: string }} list
 * @returns {Promise<ListOffer>}
 */
export async function sendListOffer(session, peerId, { address, name, ownerDid }) {
	const stream = await session.dialProtocol(peerId, HANDOVER_PROTOCOL);
	await stream.send(envelope({ kind: 'list-offer', address, name, ownerDid }));
	return { v: ENVELOPE_VERSION, kind: 'list-offer', address, name, ownerDid };
}

/** Forget a pending offer without acting on it. */
export function declineListOffer() {
	incomingListOffer.set(null);
}

/** The offer currently awaiting a decision, if any. */
export function pendingListOffer() {
	return get(incomingListOffer);
}
