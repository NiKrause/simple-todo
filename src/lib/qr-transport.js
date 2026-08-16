import { writable } from 'svelte/store';
import { QRSession, webRTCQR } from '@le-space/libp2p-webrtc-qr';
import { rtcConfiguration } from './ice-mode.js';

/**
 * True while a code is on screen waiting to be scanned.
 *
 * Read by the page to get the floating Relay Button out of the way. That button
 * is `position: fixed` with `z-index: 10000`, so it cannot be moved by putting
 * a container around it — and it was sitting on top of the QR code someone is
 * holding up to a camera, which is the one interaction this chapter exists for.
 * Overriding its positioning with `!important` would fight the component; not
 * drawing it for those few seconds is smaller and says what it means.
 */
export const qrCodeOnScreen = writable(false);

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
	return webRTCQR({
		getOutboundSession: (/** @type {any} */ peerId) => session?.getOutboundSession(peerId) ?? null
	});
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
