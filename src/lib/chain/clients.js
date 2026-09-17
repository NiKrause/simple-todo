/**
 * The chain clients escrow01 talks through: a public Sepolia client for reads,
 * and Openfort's bundler with its paymaster for user operations.
 *
 * Openfort answers `pm_getPaymasterStubData` and `pm_getPaymasterData`
 * (ERC-7677) on the same URL as the bundler, with the same publishable key,
 * and prices user operations itself (`openfort_getUserOperationGasPrice`).
 * viem's default fee estimate comes from the public RPC instead, which
 * Openfort may undercut or refuse.
 */

import { createPublicClient, fallback, http } from 'viem';
import { createBundlerClient, createPaymasterClient } from 'viem/account-abstraction';
import { sepolia } from 'viem/chains';

/** @param {string[]} rpcUrls */
export function createSepoliaClient(rpcUrls) {
	return createPublicClient({
		chain: sepolia,
		transport: fallback(
			rpcUrls.map((url) => http(url, { retryCount: 2, timeout: 30_000 })),
			{ rank: false }
		),
		pollingInterval: 2_000
	});
}

/**
 * @param {{ client: any, endpoints: import('./config.js').ChainEndpoints }} options
 */
export function createOpenfortBundler({ client, endpoints }) {
	const transport = http(endpoints.bundlerUrl, {
		fetchOptions: { headers: { Authorization: endpoints.authorization } },
		retryCount: 1,
		timeout: 60_000
	});
	return createBundlerClient({
		client,
		chain: sepolia,
		transport,
		pollingInterval: 2_000,
		paymaster: createPaymasterClient({ transport }),
		// The fee sponsorship to charge. Without it Openfort looks for a matching
		// project-scoped sponsorship itself, which also works.
		...(endpoints.policyId ? { paymasterContext: { policyId: endpoints.policyId } } : {}),
		userOperation: {
			async estimateFeesPerGas({ bundlerClient }) {
				const { fast } = /** @type {any} */ (
					await bundlerClient.request(
						/** @type {any} */ ({ method: 'openfort_getUserOperationGasPrice', params: [] })
					)
				);
				return {
					maxFeePerGas: BigInt(fast.maxFeePerGas),
					maxPriorityFeePerGas: BigInt(fast.maxPriorityFeePerGas)
				};
			}
		}
	});
}
