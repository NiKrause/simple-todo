/**
 * The relay addresses this build was configured with.
 *
 * Split out of `libp2p-config.js` because that module imports libp2p,
 * gossipsub and the transports — 13 heavy imports — while this is a list of
 * strings from `import.meta.env`. `P2PStatusNav` needs the list to look up the
 * relay's HTTP origin per peer; importing it from the config module tied the
 * status bar to the whole networking stack and kept it in the eager bundle.
 */

const RELAY_BOOTSTRAP_ADDR_DEV =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
	'/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
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
