/**
 * Where escrow01's budgets live on Sepolia, and how the app reaches them.
 *
 * Addresses are the deployment of contracts/ (contracts/README.md, "Sepolia")
 * and Zama's cUSDTMock with its underlying USDTMock. The bundler and
 * paymaster are Openfort's, configured through `.env.local`, which stays out
 * of git: `VITE_BUNDLER_URL`, `VITE_BUNDLER_AUTH_HEADER` (a publishable
 * `pk_test_…` key) and `VITE_OPENFORT_POLICY_ID` (the fee sponsorship).
 */

// No imports: the page loads this with its first chunk, before viem is needed.

export const CHAIN_ID = 11155111;

export const ESCROW_ADDRESS = /** @type {`0x${string}`} */ (
	'0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429'
);
/** The block the escrow was deployed in; its events start there. */
export const ESCROW_DEPLOY_BLOCK = 11716748n;
export const AUDITOR_ADDRESS = /** @type {`0x${string}`} */ (
	'0xd81Ad65eF9DdBC6Cf1A81FF2EF21B372EFBf4621'
);
export const TOKEN_ADDRESS = /** @type {`0x${string}`} */ (
	'0x4E7B06D78965594eB5EF5414c357ca21E1554491'
);
export const UNDERLYING_ADDRESS = /** @type {`0x${string}`} */ (
	'0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0'
);
export const TOKEN_SYMBOL = 'cUSDT';
export const TOKEN_DECIMALS = 6;

/** What a new account gets from the test token's public mint: 1,000.00. */
export const STARTING_FUNDS = 1000n * 10n ** BigInt(TOKEN_DECIMALS);
/** How long the session key may read amounts before the passkey renews it. */
export const READ_KEY_TTL_SECONDS = 24n * 3600n;
/** How long the escrow may pull from the token after a lock was confirmed. */
export const OPERATOR_TTL_SECONDS = 3600n;
export const DEFAULT_LOCK_SECONDS = 30n * 24n * 3600n;
export const MAX_LOCK_SECONDS = 365n * 24n * 3600n;

export const PUBLIC_RPC_URLS = [
	'https://ethereum-sepolia-rpc.publicnode.com',
	'https://sepolia.drpc.org',
	'https://1rpc.io/sepolia'
];

export const ETHERSCAN = 'https://sepolia.etherscan.io';

/**
 * @typedef {{
 *   bundlerUrl: string
 *   authorization: string
 *   policyId: string | null
 *   rpcUrls: string[]
 * }} ChainEndpoints
 */

/**
 * The endpoints from the build's environment, or the reason there are none.
 *
 * A secret key (`sk_…`) is refused: everything `VITE_` ends up in the page, and
 * a secret key in a page belongs to whoever opens it.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, endpoints: ChainEndpoints } | { ok: false, reason: string }}
 */
export function readChainEndpoints(env) {
	const bundlerUrl = env.VITE_BUNDLER_URL?.trim();
	const rawAuth = env.VITE_BUNDLER_AUTH_HEADER?.trim();
	if (!bundlerUrl) return { ok: false, reason: 'VITE_BUNDLER_URL is not set.' };
	if (!rawAuth) return { ok: false, reason: 'VITE_BUNDLER_AUTH_HEADER is not set.' };

	const token = rawAuth
		.replace(/^authorization\s*:\s*/i, '')
		.replace(/^bearer\s+/i, '')
		.trim();
	if (/^sk_/i.test(token)) {
		return {
			ok: false,
			reason: 'The bundler key is a secret key; a page may only carry a publishable one.'
		};
	}
	let parsed;
	try {
		parsed = new URL(bundlerUrl);
	} catch {
		return { ok: false, reason: 'VITE_BUNDLER_URL is not a URL.' };
	}
	if (parsed.protocol !== 'https:') {
		return { ok: false, reason: 'VITE_BUNDLER_URL must use https.' };
	}

	const rpcOverride = env.VITE_SEPOLIA_RPC_URL?.trim();
	return {
		ok: true,
		endpoints: {
			bundlerUrl,
			authorization: `Bearer ${token}`,
			policyId: env.VITE_OPENFORT_POLICY_ID?.trim() || null,
			rpcUrls: rpcOverride ? [rpcOverride, ...PUBLIC_RPC_URLS] : [...PUBLIC_RPC_URLS]
		}
	};
}

/** @param {string} hash */
export const etherscanTx = (hash) => `${ETHERSCAN}/tx/${hash}`;
/** @param {string} address */
export const etherscanAddress = (address) => `${ETHERSCAN}/address/${address}`;
