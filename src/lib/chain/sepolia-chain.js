/**
 * Everything escrow01 does on Sepolia, in one adapter: reads through a public
 * RPC, user operations through Openfort, a Calibur account per passkey, and
 * Zama's SDK for amounts.
 *
 * The budget service (`budget-service-zama.js`) decides what to do and in
 * which order; this module only knows how. Tests replace it as a whole.
 */

import { getP256CredentialDescriptor } from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';
import {
	createCaliburPasskeySetup,
	getCaliburKeyState,
	getDelegateForUserDecryptionCalls,
	getKeyHash,
	toCaliburPasskeyAccount,
	toWebAuthnP256Key
} from '@le-space/passkey-wallet';
import { encodeFunctionData, getAddress, isAddressEqual } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ESCROW_STATUS, escrowAbi, tokenAbi, underlyingAbi } from './abis.js';
import { createOpenfortBundler, createSepoliaClient } from './clients.js';
import {
	CHAIN_ID,
	ESCROW_ADDRESS,
	ESCROW_DEPLOY_BLOCK,
	TOKEN_ADDRESS,
	UNDERLYING_ADDRESS
} from './config.js';
import { p256KeyFromDid } from './did-key.js';
import { createZamaClient } from './zama-client.js';

/** @typedef {`0x${string}`} Hex */
/** @typedef {{ to: Hex, value?: bigint, data: Hex }} Call */
/**
 * @typedef {{
 *   beneficiary: Hex
 *   deadline: bigint
 *   status: 'none' | 'locked' | 'released' | 'refunded'
 *   amount: Hex
 * }} EscrowState
 */

const RECEIPT_TIMEOUT_MS = 5 * 60_000;
const SETTLE_TRIES = 15;
const SETTLE_INTERVAL_MS = 2_000;

/**
 * Ask again until `done`, for about half a minute. The public RPCs sit behind
 * load balancers, and right after the bundler's receipt the node that answers
 * can be a block behind: the account is not delegated yet, the escrow not
 * there. Errors count as "not yet" until the last try.
 *
 * @template T
 * @param {() => Promise<T>} read
 * @param {(value: T) => boolean} done
 * @returns {Promise<T>}
 */
async function settle(read, done) {
	for (let attempt = 1; ; attempt += 1) {
		try {
			const value = await read();
			if (done(value) || attempt === SETTLE_TRIES) return value;
		} catch (error) {
			if (attempt === SETTLE_TRIES) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
	}
}

/**
 * @param {{ endpoints: import('./config.js').ChainEndpoints }} options
 */
export function createSepoliaChain({ endpoints }) {
	const client = createSepoliaClient(endpoints.rpcUrls);
	const bundler = createOpenfortBundler({ client, endpoints });
	/** @type {Map<string, Promise<import('./zama-client.js').ZamaClient>>} */
	const zamaBySession = new Map();

	/** @param {{ address: Hex, privateKey: Hex }} session */
	function zamaFor(session) {
		let zama = zamaBySession.get(session.address);
		if (!zama) {
			zama = createZamaClient({
				publicClient: client,
				rpcUrl: endpoints.rpcUrls[0],
				sessionAccount: privateKeyToAccount(session.privateKey)
			});
			zama.catch(() => zamaBySession.delete(session.address));
			zamaBySession.set(session.address, zama);
		}
		return zama;
	}

	/** @param {Hex} hash */
	async function receiptOf(hash) {
		const receipt = await bundler.waitForUserOperationReceipt({
			hash,
			timeout: RECEIPT_TIMEOUT_MS,
			pollingInterval: 2_000
		});
		return {
			success: Boolean(receipt.success),
			txHash: /** @type {Hex} */ (receipt.receipt.transactionHash),
			blockNumber: receipt.receipt.blockNumber
		};
	}

	return {
		chainId: CHAIN_ID,

		/**
		 * The passkey's P-256 key as Calibur stores it, or null for a passkey
		 * that is not P-256 (or a credential the provider cannot read).
		 *
		 * @param {any} credential the session's WebAuthn credential
		 */
		descriptorFor(credential) {
			return getP256CredentialDescriptor(credential);
		},

		async blockTimestamp() {
			const block = await client.getBlock();
			return block.timestamp;
		},

		/** @param {bigint} blocks */
		async waitBlocks(blocks) {
			const start = await client.getBlockNumber();
			for (let i = 0; i < 60; i += 1) {
				if ((await client.getBlockNumber()) >= start + blocks) return;
				await new Promise((resolve) => setTimeout(resolve, 4_000));
			}
		},

		/**
		 * The escrow as the latest block has it, or as `blockNumber` left it: a
		 * read right after a write passes the receipt's block, and a node that
		 * has not seen that block yet is asked again.
		 *
		 * @param {Hex} creator
		 * @param {Hex} todoRef
		 * @param {{ blockNumber?: bigint }} [at]
		 * @returns {Promise<EscrowState>}
		 */
		async readEscrow(creator, todoRef, { blockNumber } = {}) {
			const read = () =>
				client.readContract({
					address: ESCROW_ADDRESS,
					abi: escrowAbi,
					functionName: 'escrowOf',
					args: [creator, todoRef],
					blockNumber
				});
			const [beneficiary, deadline, status, amount] =
				blockNumber === undefined ? await read() : await settle(read, () => true);
			return {
				beneficiary: getAddress(beneficiary),
				deadline,
				status: ESCROW_STATUS[status] ?? 'none',
				amount
			};
		},

		/** @param {Hex} account */
		async balanceHandle(account) {
			return client.readContract({
				address: TOKEN_ADDRESS,
				abi: tokenAbi,
				functionName: 'confidentialBalanceOf',
				args: [account]
			});
		},

		/**
		 * Whether `address` is a Calibur account with this DID's passkey as an
		 * admin key. The key comes from the DID: that is all Alice has of Bob's
		 * passkey.
		 *
		 * @param {{ address: Hex, did: string }} input
		 */
		async isPasskeyAccount({ address, did }) {
			const key = p256KeyFromDid(did);
			if (!key) return false;
			const state = await getCaliburKeyState({
				client,
				address,
				keyHash: getKeyHash(toWebAuthnP256Key(key))
			});
			return state.isCalibur && state.isRegistered && Boolean(state.settings?.isAdmin);
		},

		/**
		 * A new Calibur account with the passkey as its admin key, and Zama user
		 * decryption for the escrow and the token delegated to `sessionAddress`.
		 * One sponsored user operation, signed by a setup key that is discarded
		 * once the passkey is registered. No passkey prompt.
		 *
		 * @param {{ descriptor: any, sessionAddress: Hex, readUntil: bigint }} input
		 */
		async createAccount({ descriptor, sessionAddress, readUntil }) {
			const setup = createCaliburPasskeySetup({
				descriptor,
				calls: getDelegateForUserDecryptionCalls({
					chainId: CHAIN_ID,
					delegate: sessionAddress,
					contractAddresses: [ESCROW_ADDRESS, TOKEN_ADDRESS],
					expirationDate: readUntil
				})
			});
			try {
				const hash = await setup.sendUserOperation(bundler);
				const receipt = await receiptOf(hash);
				if (!receipt.success || !(await settle(() => setup.isActive(client), Boolean))) {
					throw new Error('The account setup did not register the passkey.');
				}
				return { address: setup.address, setupTx: receipt.txHash };
			} finally {
				setup.discard();
			}
		},

		/**
		 * Send `calls` from the account as one user operation the passkey signs:
		 * one WebAuthn prompt, gas sponsored.
		 *
		 * @param {{ address: Hex, descriptor: any, calls: Call[], onPrompt?: () => void, onSigned?: () => void }} input
		 */
		async sendWithPasskey({ address, descriptor, calls, onPrompt, onSigned }) {
			const account = await toCaliburPasskeyAccount({ client, address, descriptor });
			const sign = account.signUserOperation.bind(account);
			account.signUserOperation = async (parameters) => {
				onPrompt?.();
				const signature = await sign(parameters);
				onSigned?.();
				return signature;
			};
			const hash = await bundler.sendUserOperation({
				account,
				calls: calls.map((call) => ({ value: 0n, ...call }))
			});
			return receiptOf(hash);
		},

		/**
		 * @param {{ amount: bigint, account: Hex, session: { address: Hex, privateKey: Hex } }} input
		 */
		async encryptAmount({ amount, account, session }) {
			const zama = await zamaFor(session);
			return zama.encrypt({ amount, contractAddress: ESCROW_ADDRESS, userAddress: account });
		},

		/**
		 * @param {{
		 *   handles: Hex[]
		 *   contractAddress: Hex
		 *   account: Hex
		 *   session: { address: Hex, privateKey: Hex }
		 * }} input
		 */
		async decrypt({ handles, contractAddress, account, session }) {
			const zama = await zamaFor(session);
			return zama.delegatedDecrypt({ handles, contractAddress, delegator: account });
		},

		/**
		 * Every `Locked` event, newest first, with the block time it was locked
		 * at.
		 */
		async lockedEvents() {
			// Typed loosely: the event comes out of the ABI array, which loses viem's
			// per-event argument types.
			const logs = /** @type {any[]} */ (
				await client.getLogs({
					address: ESCROW_ADDRESS,
					event: escrowAbi.find((item) => item.type === 'event' && item.name === 'Locked'),
					fromBlock: ESCROW_DEPLOY_BLOCK,
					toBlock: 'latest'
				})
			);
			/** @type {Map<bigint, bigint>} */
			const times = new Map();
			for (const blockNumber of new Set(logs.map((log) => log.blockNumber))) {
				const block = await client.getBlock({ blockNumber });
				times.set(blockNumber, block.timestamp);
			}
			return logs
				.map((log) => ({
					creator: getAddress(log.args.creator),
					todoRef: /** @type {Hex} */ (log.args.todoRef),
					beneficiary: getAddress(log.args.beneficiary),
					deadline: log.args.deadline,
					lockedAt: times.get(log.blockNumber) ?? 0n,
					txHash: log.transactionHash
				}))
				.reverse();
		},

		calls: {
			/**
			 * Test money for a new account: the underlying token's public mint,
			 * wrapped into the confidential token.
			 *
			 * @param {Hex} account @param {bigint} amount
			 * @returns {Call[]}
			 */
			funding(account, amount) {
				return [
					{
						to: UNDERLYING_ADDRESS,
						data: encodeFunctionData({
							abi: underlyingAbi,
							functionName: 'mint',
							args: [account, amount]
						})
					},
					{
						to: UNDERLYING_ADDRESS,
						data: encodeFunctionData({
							abi: underlyingAbi,
							functionName: 'approve',
							args: [TOKEN_ADDRESS, amount]
						})
					},
					{
						to: TOKEN_ADDRESS,
						data: encodeFunctionData({
							abi: tokenAbi,
							functionName: 'wrap',
							args: [account, amount]
						})
					}
				];
			},

			/**
			 * Let the escrow take the amount, and lock it: both in the same user
			 * operation, as the app's confirmation text says.
			 *
			 * @param {{ todoRef: Hex, beneficiary: Hex, handle: Hex, inputProof: Hex, deadline: bigint, operatorUntil: bigint }} input
			 * @returns {Call[]}
			 */
			lock({ todoRef, beneficiary, handle, inputProof, deadline, operatorUntil }) {
				return [
					{
						to: TOKEN_ADDRESS,
						data: encodeFunctionData({
							abi: tokenAbi,
							functionName: 'setOperator',
							args: [ESCROW_ADDRESS, Number(operatorUntil)]
						})
					},
					{
						to: ESCROW_ADDRESS,
						data: encodeFunctionData({
							abi: escrowAbi,
							functionName: 'lock',
							args: [todoRef, beneficiary, handle, inputProof, deadline]
						})
					}
				];
			},

			/** @param {Hex} todoRef @returns {Call[]} */
			release(todoRef) {
				return [
					{
						to: ESCROW_ADDRESS,
						data: encodeFunctionData({ abi: escrowAbi, functionName: 'release', args: [todoRef] })
					}
				];
			},

			/**
			 * @param {{ account: Hex, sessionAddress: Hex, readUntil: bigint }} input
			 * @returns {Call[]}
			 */
			readKey({ account, sessionAddress, readUntil }) {
				return getDelegateForUserDecryptionCalls({
					chainId: CHAIN_ID,
					account,
					delegate: sessionAddress,
					contractAddresses: [ESCROW_ADDRESS, TOKEN_ADDRESS],
					expirationDate: readUntil
				});
			}
		},

		/** @param {string} a @param {string} b */
		sameAddress(a, b) {
			return isAddressEqual(/** @type {Hex} */ (a), /** @type {Hex} */ (b));
		}
	};
}

/** @typedef {ReturnType<typeof createSepoliaChain>} SepoliaChain */
