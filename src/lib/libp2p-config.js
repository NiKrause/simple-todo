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
import { readStoredRelayOptIn } from './relay-availability.js';
import { ping } from '@libp2p/ping';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { getWebRTCEnabled } from './webrtc-settings.js';
import {
	parseBootstrapMultiaddrs,
	selectValidBrowserBootstrapMultiaddrs
} from './bootstrap-multiaddrs.js';
import { webRTCQRTransport } from './qr-transport.js';
import { rtcConfiguration } from './ice-mode.js';

// Environment variables
// Both default to empty, in dev as well as production.
//
// The other chapters bake in a local relay for development, which would quietly
// defeat this one: a configured relay switches on pubsub discovery and circuit
// reservations, so a test could pass *through a relay* while claiming to prove
// two devices met by nothing but a scanned code. Set the variable explicitly
// when you want a relay — milestone 3 does exactly that.
// Both meeting places, because a meeting place is not a property of having a
// relay - it is a property of the relay's own subscriptions. `orbitdb-relay`
// carries the first, `uc-go-peer` the second, and Aleph discovery hands out
// whichever answered. Calling out on one of them means two browsers can both
// report a healthy connection to the same relay and never hear each other,
// which is exactly what was reported from a phone and a laptop.
//
// `Le-Space/ablage` carries both for this reason and measured the difference:
// 60 seconds of silence on a topic the relay does not carry, against 10 to
// meet on one it does.
const DEFAULT_PUBSUB_TOPICS = [
	'todo._peer-discovery._p2p._pubsub',
	'universal-connectivity-browser-peer-discovery'
].join(',');

export const PUBSUB_TOPICS = (import.meta.env.VITE_PUBSUB_TOPICS || DEFAULT_PUBSUB_TOPICS)
	.split(',')
	.map((/** @type {string} */ t) => t.trim());
// Determine which relay address to use based on environment
const isDevelopment =
	import.meta.env.DEV ||
	import.meta.env.VITE_NODE_ENV === 'development' ||
	import.meta.env.MODE === 'test' ||
	import.meta.env.MODE === 'e2e';
console.log('isDevelopment', isDevelopment);
console.log('RELAY_BOOTSTRAP_ADDR', RELAY_BOOTSTRAP_ADDR);

/**
 * The relay addresses this build shipped with, filtered to what a browser can
 * actually dial.
 *
 * Exported so the startup check probes exactly the list the node would use —
 * re-deriving it from the environment somewhere else would be a second place
 * for the dev/prod switch above to be got wrong, and a check that probed an
 * address the node cannot dial would be worse than no check.
 *
 * @returns {string[]}
 */
/**
 * Which of the shipped relay addresses the node may bootstrap from.
 *
 * Pure and separate from the two lookups it combines, so the rule itself can be
 * tested with fixture addresses — a build without a relay configured would make
 * a test of the wiring pass for the wrong reason.
 *
 * @param {readonly string[]} baked
 * @param {boolean} optIn
 * @returns {string[]}
 */
export function selectRelayBootstrapAddrs(baked, optIn) {
	return optIn ? [...baked] : [];
}

export function bakedRelayBootstrapAddrs() {
	return selectValidBrowserBootstrapMultiaddrs(
		parseBootstrapMultiaddrs(RELAY_BOOTSTRAP_ADDR.join(','))
	);
}

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

	// No relay is an ordinary state here, not an error.
	//
	// Every earlier chapter treats a missing bootstrap address as fatal, because
	// without a relay those chapters cannot meet anyone. This one meets people by
	// having a code scanned, so it starts with nothing configured and stays
	// perfectly usable. What it must *not* do is become incapable of a relay:
	// milestone 3 adds one, and the two paths coexist rather than replace each
	// other. So the transports stay, and only the configuration is empty.
	// ...and a relay this build ships with is still not one this person asked
	// for. Without the gate the checkbox would be decorative: a production build
	// carries `VITE_RELAY_BOOTSTRAP_ADDR_PROD`, so the node dialled that relay on
	// every start and announced `/p2p-circuit` to it, box ticked or not. The
	// promise is that an untouched start talks to nobody, and that has to be true
	// in the code, not only in the copy.
	//
	// Read straight from storage rather than through the store: this runs while
	// the node is being built, before any component has mounted to hydrate it.
	const relayBootstrapAddrs = selectRelayBootstrapAddrs(
		bakedRelayBootstrapAddrs(),
		readStoredRelayOptIn()
	);
	const hasRelay = relayBootstrapAddrs.length > 0;
	// Wanting a relay and having one baked in are different questions, and
	// conflating them is what made this branch look connected and stay blind.
	// This build ships no relay address at all, so `hasRelay` was false however
	// the box was set - and the node came up without peer discovery. Ticking the
	// box then found a relay through Aleph and dialled it, which worked, and the
	// two browsers still never saw each other: the machinery that would have
	// introduced them was never configured.
	//
	// `bootstrap` stays on `hasRelay` - with no addresses there is nothing to
	// bootstrap from. Discovery and `/p2p-circuit` follow the choice, because a
	// relay found at runtime needs both and neither reaches out on its own: with
	// nothing connected, a topic nobody shares carries no traffic.
	const relayWanted = readStoredRelayOptIn();
	const webRTCEnabled = getWebRTCEnabled();

	/** @type {any} */
	const config = {
		addresses: {
			// `/p2p-circuit` only means something with a relay to reserve on, so it
			// is announced only when one is configured. `/webrtc` stays either way.
			listen: [...(relayWanted ? ['/p2p-circuit'] : []), ...(webRTCEnabled ? ['/webrtc'] : [])]
		},
		transports: [
			// The chapter's own transport, always present: it is how two devices
			// meet here, not a fallback for when something else failed.
			webRTCQRTransport(),
			webSockets(),
			...(webRTCEnabled
				? [
						webRTCDirect({ rtcConfiguration: rtcConfiguration() }),
						webRTC({ rtcConfiguration: rtcConfiguration() })
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
			denyDialMultiaddr: (/** @type {any} */ multiaddr) => isInsecureWebSocketDial(multiaddr),
			denyDialPeer: () => false,
			denyInboundConnection: () => false,
			denyOutboundConnection: () => false,
			denyInboundEncryptedConnection: () => false,
			denyOutboundEncryptedConnection: () => false,
			denyInboundUpgradedConnection: () => false,
			denyOutboundUpgradedConnection: () => false
		},
		streamMuxers: [yamux()],
		// Discovery needs somewhere to discover *from*. With no relay there is no
		// shared pubsub network to announce on, so this is configured only when a
		// relay is — and comes back on its own in milestone 3.
		peerDiscovery: relayWanted
			? [
					pubsubPeerDiscovery(
						/** @type {any} */ ({
							interval: 5000,
							topics: PUBSUB_TOPICS,
							listenOnly: false,
							emitSelf: true
						})
					)
				]
			: [],
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
			ping: ping({ timeout: 10_000 }),
			...(hasRelay ? { bootstrap: bootstrap({ list: relayBootstrapAddrs }) } : {}),
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
