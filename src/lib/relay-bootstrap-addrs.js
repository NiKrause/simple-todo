/**
 * The relay addresses this build was configured with.
 *
 * Split out of `libp2p-config.js` because that module imports libp2p,
 * gossipsub and the transports, while this is a list of strings from
 * `import.meta.env`. `P2PStatusNav` needs the list to look up the relay's HTTP
 * origin per peer; importing it from the config module tied the status bar to
 * the whole networking stack and kept it in the eager bundle.
 *
 * The defaults below are this chapter's own, carried over unchanged.
 */

// Environment variables
// Both default to empty, in dev as well as production.
//
// The other chapters bake in a local relay for development, which would quietly
// defeat this one: a configured relay switches on pubsub discovery and circuit
// reservations, so a test could pass *through a relay* while claiming to prove
// two devices met by nothing but a scanned code. Set the variable explicitly
// when you want a relay — milestone 3 does exactly that.
const RELAY_BOOTSTRAP_ADDR_DEV = import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV || '';
const RELAY_BOOTSTRAP_ADDR_PROD = import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD || '';

export const isDevelopment =
	import.meta.env.DEV ||
	import.meta.env.VITE_NODE_ENV === 'development' ||
	import.meta.env.MODE === 'test' ||
	import.meta.env.MODE === 'e2e';

export const RELAY_BOOTSTRAP_ADDR = (
	isDevelopment ? RELAY_BOOTSTRAP_ADDR_DEV : RELAY_BOOTSTRAP_ADDR_PROD
)
	.split(',')
	.map((/** @type {string} */ addr) => addr.trim());

/** @returns {string[]} */
export function getRelayBootstrapAddrs() {
	return [...RELAY_BOOTSTRAP_ADDR];
}
