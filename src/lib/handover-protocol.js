import { writable, get } from 'svelte/store';
import { peerIdFromString } from '@libp2p/peer-id';
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
 * Open the handover stream, on the node rather than through the QR session.
 *
 * `QRSession.dialProtocol` resolves through the session's own address table -
 * "a peer whose answer was accepted", as the package puts it - so it reaches
 * only somebody whose code was scanned. A peer met through a relay is not in
 * there. The receiving half never had that limit: `registerHandoverProtocol`
 * sits on the bare node and accepts the protocol over any transport, which is
 * why the gap is invisible from that side.
 *
 * Dialing by PeerId reuses the connection that is already open - which is the
 * situation whenever the peer is one we are connected to, however we met. The
 * string has to be parsed first: libp2p reads a bare string as a multiaddr and
 * fails deep inside with "getComponents is not a function".
 *
 * The retry is the session's, kept rather than inherited. Right after a QR
 * handshake the connection is still settling, and the session dialled up to
 * `dialAttempts: 15` times for exactly that reason; dropping it here would have
 * made the scanned path flakier while fixing the relay one.
 *
 * @param {any} libp2p
 * @param {string} peerId
 */
async function dialHandover(libp2p, peerId, { attempts = 15, timeout = 30_000 } = {}) {
	const peer = peerIdFromString(peerId);
	let lastError;

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await libp2p.dialProtocol(peer, HANDOVER_PROTOCOL, {
				signal: AbortSignal.timeout(timeout)
			});
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	throw lastError;
}

/**
 * Offer a list to the peer on the other end of the scanned connection.
 *
 * Dialled through the QR session rather than the node: the session holds the
 * peer connection the handshake negotiated, and this peer has no address
 * anybody could dial without it.
 *
 * @param {any} libp2p the app's libp2p node
 * @param {string} peerId
 * @param {{ address: string, name: string, ownerDid: string }} list
 * @returns {Promise<ListOffer>}
 */
export async function sendListOffer(libp2p, peerId, { address, name, ownerDid }) {
	const stream = await dialHandover(libp2p, peerId);
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
