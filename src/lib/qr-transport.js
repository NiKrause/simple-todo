import { QRSession, webRTCQR } from '@le-space/libp2p-webrtc-qr';

/**
 * Reaching a peer with a scanned code and nothing else.
 *
 * This app normally finds peers through a relay: bootstrap, pubsub discovery,
 * circuit reservations, pinning. `?transport=qr` removes all of it and leaves
 * one transport whose signalling is a QR code someone held up.
 *
 * That is not a smaller version of the same thing. It is the opposite of it,
 * which is what makes it worth having as a second consumer of the transport
 * package - it asks where the seams actually are rather than confirming that
 * the ones already drawn happen to fit.
 *
 * Two peers still open the *same* OrbitDB database, because on `main` every
 * peer opens `simple-todos` with `write: ['*']` and that manifest is content
 * addressed - the same name and access controller produce the same address for
 * everyone. So Alice and Bob writing while unable to see each other are not
 * building two lists that later merge. They are writing to one log that has not
 * replicated yet, and connecting is what lets it.
 */

/** @type {QRSession | null} */
let session = null;

export function isQrTransportMode() {
	if (typeof window === 'undefined') {
		return false;
	}

	return new URLSearchParams(window.location.search).get('transport') === 'qr';
}

export function getQrSession() {
	return session;
}

/**
 * The transport on its own. `main` carries it next to the relay transports so an
 * invite works without reloading the page into a different mode, which is what
 * makes "Scan Connect SDP" a second way to meet a peer rather than a replacement
 * for the relay.
 */
export function webRTCQRTransport() {
	return webRTCQR({ getOutboundSession: (peerId) => session?.getOutboundSession(peerId) ?? null });
}

/**
 * The transport list for QR-only mode: exactly one entry, and nothing that could
 * find a peer by itself. If a test connects two of these, the code is the only
 * thing that could have introduced them — which is why `?transport=qr` still
 * builds a stripped node even though the transport now ships on `main` too.
 */
export function qrTransports() {
	return [webRTCQRTransport()];
}

/**
 * @param {import('libp2p').Libp2p} node
 * @param {{ exposeDebugHandle?: boolean }} [options]
 */
export function attachQrSession(node, options = {}) {
	// Isolation is the claim invite-only mode makes, so a test has to be able to
	// check it rather than take it on trust.
	//
	// The caller decides whether to expose it, because that mode is reachable two
	// ways — `?transport=qr` or the consent checkbox — and a handle tied to only
	// one of them would let an isolation assertion pass *vacuously*: reading zero
	// connections because the node is invisible to the test rather than because
	// the peers are apart. Off on a relay-connected page, where a global pointer
	// to the libp2p node serves nobody.
	if (typeof window !== 'undefined' && options.exposeDebugHandle === true) {
		/** @type {any} */ (window).__libp2p = node;
	}

	session = new QRSession(node, {
		rtcConfiguration: {
			iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]
		}
	});

	return session;
}

export function resetQrSession() {
	session?.close();
	session = null;
}
