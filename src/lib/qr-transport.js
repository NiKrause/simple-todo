import { QRSession, webRTCQR } from '@le-space/libp2p-webrtc-qr';
import { rtcConfiguration } from './ice-mode.js';

/**
 * Meeting a peer with nothing but a scanned code.
 *
 * On `main` this transport is an alternative to the relay, reached with
 * `?transport=qr`. Here it is not an alternative — it is how the chapter
 * works, so it is always in the node's transport list rather than behind a
 * flag. A relay is still dialable when one is configured (milestone 3), and
 * the two do not compete: libp2p carries several transports at once, and
 * adding WebSocket or circuit-relay takes nothing away from this one.
 *
 * The session is module state because a QR handshake spans two user actions
 * separated by a person walking across a building site — the offer is created
 * in one interaction and the answer accepted in another, and the outbound
 * context built by the first has to survive until the second.
 */

/** @type {QRSession | null} */
let session = null;

export function getQrSession() {
	return session;
}

/**
 * The transport itself.
 *
 * `getOutboundSession` is what lets a dial reuse the peer connection this
 * session already negotiated, instead of trying to open a fresh one to a peer
 * that has no address anybody could dial.
 */
export function webRTCQRTransport() {
	return webRTCQR({ getOutboundSession: (peerId) => session?.getOutboundSession(peerId) ?? null });
}

/**
 * @param {import('libp2p').Libp2p} node
 * @returns {QRSession}
 */
export function attachQrSession(node) {
	session = new QRSession(node, { rtcConfiguration: rtcConfiguration() });
	return session;
}

export function resetQrSession() {
	session?.close();
	session = null;
}
