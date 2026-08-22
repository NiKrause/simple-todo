// libp2p-config.js
import { noise } from '@chainsafe/libp2p-noise';
// Light module on purpose — see relay-bootstrap-addrs.js.
import { RELAY_BOOTSTRAP_ADDR, getRelayBootstrapAddrs } from './relay-bootstrap-addrs.js';
export { getRelayBootstrapAddrs };
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

// Environment variables
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

	const relayBootstrapAddrs = selectValidBrowserBootstrapMultiaddrs(
		parseBootstrapMultiaddrs(RELAY_BOOTSTRAP_ADDR.join(','))
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
			)
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
			denyDialMultiaddr: (multiaddr) => isInsecureWebSocketDial(multiaddr),
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

// Usage example:
// const config = await createLibp2pConfig()
// const libp2p = await createLibp2p(config)
