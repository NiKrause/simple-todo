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
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { getWebRTCEnabled } from './webrtc-settings.js';
import {
	parseBootstrapMultiaddrs,
	selectValidBrowserBootstrapMultiaddrs
} from './bootstrap-multiaddrs.js';

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
