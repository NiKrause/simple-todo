// libp2p-config.js
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify, identifyPush } from '@libp2p/identify';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@libp2p/gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { bootstrap } from '@libp2p/bootstrap';
import { ping } from '@libp2p/ping';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { getWebRTCEnabled } from './webrtc-settings.js';
import {
	parseBootstrapMultiaddrs,
	selectValidBrowserBootstrapMultiaddrs
} from './bootstrap-multiaddrs.js';
import { qrTransports, webRTCQRTransport } from './qr-transport.js';
import { isRelayNetworkMode } from './network-mode.js';

// Environment variables
const RELAY_BOOTSTRAP_ADDR_DEV =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
	'/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
const RELAY_BOOTSTRAP_ADDR_PROD = import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD || '';
const PUBSUB_TOPICS = (import.meta.env.VITE_PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
	.split(',')
	.map((/** @type {string} */ t) => t.trim());
const WEBRTC_ICE_SERVERS = [
	{
		urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
	}
];

// Determine which relay address to use based on environment
const isDevelopment =
	import.meta.env.DEV ||
	import.meta.env.VITE_NODE_ENV === 'development' ||
	import.meta.env.MODE === 'test' ||
	import.meta.env.MODE === 'e2e';
console.log('isDevelopment', isDevelopment);
const RELAY_BOOTSTRAP_ADDR = (isDevelopment ? RELAY_BOOTSTRAP_ADDR_DEV : RELAY_BOOTSTRAP_ADDR_PROD)
	.split(',')
	.map((/** @type {string} */ addr) => addr.trim());
console.log('RELAY_BOOTSTRAP_ADDR', RELAY_BOOTSTRAP_ADDR);

/**
 * True when dialing this multiaddr would open an insecure WebSocket from a
 * page that the browser serves over HTTPS — which Chrome blocks as mixed
 * content. A multiaddr counts as secure when it carries `/tls/` (covers both
 * `/tls/ws` and the AutoTLS `/tls/sni/<host>/ws` form) or `/wss`.
 *
 * On an http:// origin (local dev, the Playwright E2E suite) mixed content
 * does not apply, so plain `/ws` stays dialable there.
 *
 * @param {{ toString: () => string }} multiaddr
 * @param {string} [pageProtocol] defaults to the current page protocol
 * @returns {boolean}
 */
export function isInsecureWebSocketDial(
	multiaddr,
	pageProtocol = typeof location === 'undefined' ? '' : location.protocol
) {
	if (pageProtocol !== 'https:') return false;

	const address = String(multiaddr).toLowerCase();
	const isWebSocket = /\/wss?(\/|$)/.test(address);
	if (!isWebSocket) return false;

	return !address.includes('/tls/') && !/\/wss(\/|$)/.test(address);
}

/**
 * @param {unknown | null} [privateKey=null]
 * @returns {Promise<any>}
 */
export async function createLibp2pConfig(privateKey = null) {
	// Get fixed peer ID from environment variable
	const testPeerId = import.meta.env.VITE_TEST_PEER_ID;

	if (testPeerId && !privateKey) {
		try {
			privateKey = privateKeyFromProtobuf(uint8ArrayFromString(testPeerId, 'hex'));
		} catch (error) {
			console.warn('Invalid test peer ID, generating random key:', error);
		}
	}

	// Invite-only mode reaches peers with a scanned code and nothing else, so it
	// needs no relay to bootstrap from - and demanding one would fail before it
	// started. Chosen on the consent screen, or forced by `?transport=qr`.
	if (!isRelayNetworkMode()) {
		return qrOnlyConfig(privateKey);
	}

	// A plain-text relay is allowed only where we start one ourselves: local dev
	// and the e2e suite, both on http://localhost. A deployed build runs on
	// https, where such an address is blocked as mixed content anyway - so
	// letting it through there would only trade a clear failure for a silent one.
	const relayBootstrapAddrs = selectValidBrowserBootstrapMultiaddrs(
		parseBootstrapMultiaddrs(RELAY_BOOTSTRAP_ADDR.join(',')),
		{ allowInsecure: isDevelopment }
	);
	if (relayBootstrapAddrs.length === 0) {
		throw new Error('No valid browser-dialable relay bootstrap multiaddresses are configured.');
	}
	const alephBootstrap = bootstrap({ list: relayBootstrapAddrs });
	const webRTCEnabled = getWebRTCEnabled();

	/** @type {any} */
	const config = {
		addresses: {
			listen: webRTCEnabled ? ['/p2p-circuit', '/webrtc'] : ['/p2p-circuit']
		},
		transports: [
			webSockets(),
			...(webRTCEnabled
				? [
						webRTCDirect({
							rtcConfiguration: {
								iceServers: WEBRTC_ICE_SERVERS
							}
						}),
						webRTC({
							rtcConfiguration: {
								iceServers: WEBRTC_ICE_SERVERS
							}
						})
					]
				: []),
			circuitRelayTransport(
				/** @type {any} */ ({
					discoverRelays: 1,
					reservationCompletionTimeout: 20_000
				})
			),
			// The invite path rides alongside the relay path rather than replacing
			// it: the relay is how strangers find you, an invite is how two people
			// who are already talking connect directly. Without this transport here
			// the "Scan Connect SDP" button could only work after reloading into
			// `?transport=qr`, which is a different node with no relay at all.
			webRTCQRTransport()
		],
		connectionEncrypters: [noise()],
		connectionGater: {
			// Chrome blocks ws:// from an https:// page as mixed content, so a plain
			// WebSocket dial from a deployed chapter can never succeed — it only burns
			// a dial attempt and floods the console. These dials do not come from our
			// bootstrap list (that only carries wss/2n6 addresses) but from peers
			// discovered over pubsub/identify, which announce their internal ws ports.
			//
			// libp2p used to filter this inside the transport, but @libp2p/websockets
			// removed the browser dial filter (9.1.1, libp2p/js-libp2p#2838) and then
			// the ws filters entirely (9.2.1, #2983) — both explicitly "in favour of
			// the connection gater", i.e. this hook. Ours stubbed every check to
			// `() => false`, so nothing was gated at all.
			//
			// Gate on the page protocol instead of banning /ws outright: local dev and
			// the E2E suite serve the app over http://localhost and dial a plain-ws
			// relay, where mixed content does not apply.
			denyDialMultiaddr: (/** @type {{ toString: () => string }} */ multiaddr) =>
				isInsecureWebSocketDial(multiaddr),
			denyDialPeer: () => false,
			denyInboundConnection: () => false,
			denyOutboundConnection: () => false,
			denyInboundEncryptedConnection: () => false,
			denyOutboundEncryptedConnection: () => false,
			denyInboundUpgradedConnection: () => false,
			denyOutboundUpgradedConnection: () => false
		},
		streamMuxers: [yamux()],
		peerDiscovery: [
			pubsubPeerDiscovery(
				/** @type {any} */ ({
					interval: 5000, // More frequent broadcasting
					topics: PUBSUB_TOPICS, // Configurable topics
					listenOnly: false,
					emitSelf: true // Enable even when no peers are present initially
				})
			)
		],
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
			ping: ping({ timeout: 10_000 }),
			bootstrap: alephBootstrap,
			autonat: autoNAT(),
			...(webRTCEnabled ? { dcutr: dcutr() } : {}),
			pubsub: gossipsub({
				emitSelf: false,
				allowPublishToZeroTopicPeers: true,
				// Browser peers commonly meet over circuit-relay connections, which
				// libp2p marks as limited. OrbitDB sync depends on gossipsub running
				// on those connections so it can exchange topic subscriptions/heads.
				runOnLimitedConnection: true
			})
		}
	};

	if (privateKey) {
		config.privateKey = privateKey;
	}

	return config;
}

/**
 * One transport, no discovery, no relay.
 *
 * Everything removed here is a way for two peers to find each other without
 * being introduced: bootstrap, pubsub discovery, autonat, dcutr, circuit relay,
 * websockets. What is left cannot meet anybody by itself, which is the point -
 * if two of these connect, the scanned code is the only thing that could have
 * done it.
 *
 * Gossipsub stays, because it is not discovery here. OrbitDB exchanges heads
 * over it, and without it two peers connect and then sit there with a database
 * that never syncs.
 *
 * @param {any} privateKey
 */
function qrOnlyConfig(privateKey) {
	return {
		...(privateKey ? { privateKey } : {}),
		addresses: { listen: [] },
		transports: qrTransports(),
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [],
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
			ping: ping({ timeout: 10_000 }),
			pubsub: gossipsub({
				emitSelf: false,
				allowPublishToZeroTopicPeers: true,
				canRelayMessage: true
			})
		}
	};
}

// Usage example:
// const config = await createLibp2pConfig()
// const libp2p = await createLibp2p(config)
