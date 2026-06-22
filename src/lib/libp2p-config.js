// libp2p-config.js
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify, identifyPush } from '@libp2p/identify';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { bootstrap } from '@libp2p/bootstrap';
import { discoverAlephBootstrapMultiaddrs } from '@le-space/aleph-bootstrap';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { multiaddr } from '@multiformats/multiaddr';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import * as filters from '@libp2p/websockets/filters';
import { getWebRTCEnabled } from './webrtc-settings.js';

// Environment variables
const RELAY_BOOTSTRAP_ADDR_DEV =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
	'/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
const RELAY_BOOTSTRAP_ADDR_PROD =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD ||
	'/dns4/pill-execute-neither-suspect.2n6.me/tcp/443/tls/ws/p2p/12D3KooWSc3Sqr3Q7RGJAFBz5i7WTTC5kzunnm2tvXVcSwTEtUTP';
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
 * Prefer browser-safe transports that match the transports this app actually enables.
 *
 * @param {string} addr
 * @returns {boolean}
 */
function isSupportedBrowserBootstrapMultiaddr(addr) {
	const normalized = addr.toLowerCase();

	return (
		normalized.includes('/tls/ws') ||
		normalized.includes('/ws') ||
		normalized.includes('/wss') ||
		normalized.includes('/webrtc-direct')
	);
}

/**
 * @param {string} addr
 * @returns {number}
 */
function rankBrowserBootstrapMultiaddr(addr) {
	const normalized = addr.toLowerCase();

	if (normalized.includes('/tcp/443/') && normalized.includes('/tls/ws')) return 0;
	if (normalized.includes('/tls/ws')) return 1;
	if (normalized.includes('/wss')) return 2;
	if (normalized.includes('/ip4/127.0.0.1/') && normalized.includes('/ws')) return 3;
	if (normalized.includes('/ws')) return 4;
	if (normalized.includes('/webrtc-direct')) return 5;
	return 10;
}

/**
 * @param {string[]} addrs
 * @returns {string[]}
 */
function selectBrowserBootstrapMultiaddrs(addrs) {
	return [...new Set(addrs)]
		.filter(isSupportedBrowserBootstrapMultiaddr)
		.sort((a, b) => rankBrowserBootstrapMultiaddr(a) - rankBrowserBootstrapMultiaddr(b));
}

/**
 * Ensure bootstrap candidates are parseable multiaddrs and include a peer id,
 * which @libp2p/bootstrap requires up front.
 *
 * @param {string[]} addrs
 * @returns {string[]}
 */
function selectValidBootstrapPeerMultiaddrs(addrs) {
	return selectBrowserBootstrapMultiaddrs(addrs).filter((addr) => {
		try {
			return multiaddr(addr).getPeerId() != null;
		} catch (error) {
			console.warn('Ignoring invalid bootstrap multiaddr:', addr, error);
			return false;
		}
	});
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

	const discoveredBootstrapMultiaddrs = isDevelopment
		? []
		: await discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true }).catch((error) => {
				console.warn('Failed to discover Aleph bootstrap multiaddrs:', error);
				return [];
			});
	const preferredDiscoveredBootstrapMultiaddrs = selectValidBootstrapPeerMultiaddrs(
		discoveredBootstrapMultiaddrs
	);
	const preferredFallbackBootstrapMultiaddrs =
		selectValidBootstrapPeerMultiaddrs(RELAY_BOOTSTRAP_ADDR);
	const relayBootstrapAddrs =
		preferredDiscoveredBootstrapMultiaddrs.length > 0
			? preferredDiscoveredBootstrapMultiaddrs
			: preferredFallbackBootstrapMultiaddrs.length > 0
				? preferredFallbackBootstrapMultiaddrs
				: RELAY_BOOTSTRAP_ADDR;
	const alephBootstrap = bootstrap({ list: relayBootstrapAddrs });
	const webRTCEnabled = getWebRTCEnabled();

	/** @type {any} */
	const config = {
		addresses: {
			listen: webRTCEnabled ? ['/p2p-circuit', '/webrtc'] : ['/p2p-circuit']
		},
		transports: [
			webSockets({
				filter: filters.all
			}),
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
			denyDialMultiaddr: () => false,
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
			bootstrap: alephBootstrap,
			autonat: autoNAT(),
			//   ping: ping(),
			...(webRTCEnabled ? { dcutr: dcutr() } : {}),
			pubsub: gossipsub({
				emitSelf: false,
				allowPublishToZeroTopicPeers: true
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
