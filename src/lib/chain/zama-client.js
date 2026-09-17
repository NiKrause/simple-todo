/**
 * Zama's SDK in the browser (escrow01): encrypt an amount for the escrow, and
 * read amounts back through a session key the account delegated to.
 *
 * Loaded on first use, never with the page: the SDK carries WebAssembly for
 * the ZK proof and the key material, megabytes nobody needs to see a todo.
 *
 * The session key signs Zama's EIP-712 decryption request. It cannot move
 * money: the account only delegated user decryption to it, per contract and
 * until a date (ACL `delegateForUserDecryption`). Zama on Sepolia (protocol
 * v0.13) accepts ECDSA signatures only, which is why the passkey cannot sign
 * this itself.
 */

import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';

/**
 * @typedef {{
 *   encrypt: (input: { amount: bigint, contractAddress: `0x${string}`, userAddress: `0x${string}` }) =>
 *     Promise<{ handle: `0x${string}`, inputProof: `0x${string}` }>
 *   delegatedDecrypt: (input: { handles: `0x${string}`[], contractAddress: `0x${string}`, delegator: `0x${string}` }) =>
 *     Promise<Map<string, bigint>>
 *   terminate: () => void
 * }} ZamaClient
 */

/**
 * @param {{
 *   publicClient: any
 *   rpcUrl: string
 *   sessionAccount: import('viem').LocalAccount
 *   timeoutMs?: number
 * }} options
 * @returns {Promise<ZamaClient>}
 */
export async function createZamaClient({
	publicClient,
	rpcUrl,
	sessionAccount,
	timeoutMs = 5 * 60_000
}) {
	const [{ ZamaSDK, MemoryStorage }, { createConfig }, { web }, fheChains] = await Promise.all([
		import('@zama-fhe/sdk'),
		import('@zama-fhe/sdk/viem'),
		import('@zama-fhe/sdk/web'),
		import('@zama-fhe/sdk/chains')
	]);
	const chain = fheChains.sepolia;
	const walletClient = createWalletClient({
		account: sessionAccount,
		chain: sepolia,
		transport: http(rpcUrl)
	});
	const sdk = new ZamaSDK(
		createConfig({
			chains: [chain],
			publicClient,
			walletClient,
			// Encrypting with its proof takes seconds of CPU: on the page's thread a
			// lock froze the page for 9 to 11 s, in the SDK's worker not at all.
			// Built pages only: Vite's dev server (the one place with
			// `import.meta.hot`) pre-bundles the SDK away from its worker file. Not
			// `env.PROD`: the e2e build runs with NODE_ENV=development.
			relayers: {
				[chain.id]: web({ timeout: timeoutMs, offloadEncrypt: !import.meta.hot })
			},
			storage: new MemoryStorage()
		})
	);

	return {
		async encrypt({ amount, contractAddress, userAddress }) {
			const out = await sdk.encrypt({
				values: [{ type: 'euint64', value: amount }],
				contractAddress,
				userAddress
			});
			return {
				handle: toHex(out.encryptedValues[0]),
				inputProof: toHex(out.inputProof)
			};
		},

		async delegatedDecrypt({ handles, contractAddress, delegator }) {
			const out = await sdk.decryption.delegatedDecryptValues(
				handles.map((encryptedValue) => ({ encryptedValue, contractAddress })),
				delegator
			);
			/** @type {Map<string, bigint>} */
			const values = new Map();
			for (const [handle, value] of Object.entries(out)) {
				if (value === undefined || value === null) continue;
				values.set(
					handle.toLowerCase(),
					BigInt(/** @type {string | number | bigint | boolean} */ (value))
				);
			}
			return values;
		},

		terminate() {
			try {
				sdk.terminate?.();
			} catch {
				// Nothing to clean up that matters.
			}
		}
	};
}

/**
 * The SDK hands back handles and proofs as `Uint8Array` or hex, depending on
 * the path; the chain wants hex.
 *
 * @param {Uint8Array | string} value
 * @returns {`0x${string}`}
 */
export function toHex(value) {
	if (typeof value === 'string') {
		return /** @type {`0x${string}`} */ (value.startsWith('0x') ? value : `0x${value}`);
	}
	return /** @type {`0x${string}`} */ (
		`0x${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
	);
}
