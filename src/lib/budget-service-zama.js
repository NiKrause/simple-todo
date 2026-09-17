/**
 * The budget service on Sepolia (escrow01): Zama's confidential token, the
 * `ConfidentialTodoEscrow`, and a Calibur account per passkey. Same interface
 * as the fake (`budget-service.js`), so no component knows which one runs.
 *
 * - The account. A passkey session gets a Calibur account on first use, in
 *   one sponsored user operation that needs no prompt: a setup key registers
 *   the passkey as admin and is discarded (sepolia-chain.js). The account is
 *   published under the DID (chain/account-directory.js), so others can pay
 *   it.
 * - Sending. Every lock, release and read-key renewal is one user operation
 *   the passkey signs: one WebAuthn prompt, gas paid by Openfort's paymaster.
 * - Amounts. Encrypted in the browser for the escrow and this account, read
 *   back through a session key the account delegated Zama user decryption
 *   to. The chain and OrbitDB never see a plain amount.
 * - Money. The test token has a public mint; an account is funded with
 *   1,000.00 in the same user operation as its first lock, as the fake
 *   credits it on the first lock too.
 */

import { BudgetError } from './budget.js';
import { createAccountStore } from './chain/account-store.js';
import {
	AUDITOR_ADDRESS,
	CHAIN_ID,
	DEFAULT_LOCK_SECONDS,
	ESCROW_ADDRESS,
	MAX_LOCK_SECONDS,
	OPERATOR_TTL_SECONDS,
	READ_KEY_TTL_SECONDS,
	STARTING_FUNDS,
	TOKEN_ADDRESS,
	TOKEN_DECIMALS,
	TOKEN_SYMBOL
} from './chain/config.js';
import { ZERO_HANDLE } from './chain/abis.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const UINT64_MAX = (1n << 64n) - 1n;

/**
 * @typedef {'none' | 'creating' | 'ready' | 'failed'} AccountPhase
 * @typedef {{ phase: AccountPhase, address: string | null, error: string | null }} AccountStatus
 */

/**
 * @param {{
 *   identity: () => string | null | undefined
 *   credential: () => any
 *   chain: import('./chain/sepolia-chain.js').SepoliaChain
 *   directory: ReturnType<typeof import('./chain/account-directory.js').createAccountDirectory>
 *   accounts?: ReturnType<typeof createAccountStore>
 *   prompt?: (action: string, run: (hooks: { onPrompt: () => void, onSigned: () => void }) => Promise<any>) => Promise<any>
 *   onAccount?: (status: AccountStatus) => void
 *   lookupTimeoutMs?: number
 * }} options
 *   `prompt` wraps a passkey-signed operation so the UI can show the prompt;
 *   `onAccount` hears the account's phase for the account tab.
 */
export function createZamaBudgetService({
	identity,
	credential,
	chain,
	directory,
	accounts = createAccountStore(),
	prompt = (_action, run) => run({ onPrompt: () => {}, onSigned: () => {} }),
	onAccount = () => {},
	lookupTimeoutMs = 20_000
}) {
	/** @type {import('./budget-service.js').BudgetServiceInfo} */
	const info = {
		kind: 'zama',
		network: 'sepolia',
		chainId: CHAIN_ID,
		confidential: true,
		requiresPasskey: true,
		token: { symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, address: TOKEN_ADDRESS },
		escrow: ESCROW_ADDRESS,
		auditor: AUDITOR_ADDRESS
	};

	/** One account creation per DID at a time. @type {Map<string, Promise<import('./chain/account-store.js').ChainAccountRecord>>} */
	const creating = new Map();

	function me() {
		const did = identity();
		if (!did || !did.startsWith('did:')) {
			throw new BudgetError('not-allowed', 'Budgets need a passkey identity.');
		}
		return did;
	}

	function descriptor() {
		const found = chain.descriptorFor(credential());
		if (!found) {
			throw new BudgetError('not-allowed', 'This session has no P-256 passkey to sign with.');
		}
		return found;
	}

	/** @param {string} did @param {string} message */
	function reportFailure(did, message) {
		onAccount({
			phase: 'failed',
			address: accounts.load(did, CHAIN_ID)?.address ?? null,
			error: message
		});
	}

	/**
	 * This session's account: remembered, found in its own published profile,
	 * or created. Creation needs no prompt.
	 *
	 * @returns {Promise<import('./chain/account-store.js').ChainAccountRecord>}
	 */
	async function ensureAccount() {
		const did = me();
		const known = accounts.load(did, CHAIN_ID);
		if (known) {
			onAccount({ phase: 'ready', address: known.address, error: null });
			return known;
		}
		let running = creating.get(did);
		if (!running) {
			running = (async () => {
				onAccount({ phase: 'creating', address: null, error: null });
				// Another device with the same passkey may have created it already.
				const published = await directory.lookup(did, { chainId: CHAIN_ID, timeoutMs: 3_000 });
				if (published && (await chain.isPasskeyAccount({ address: published.address, did }))) {
					/** @type {import('./chain/account-store.js').ChainAccountRecord} */
					const record = {
						chainId: CHAIN_ID,
						address: published.address,
						session: null,
						readKeyExpiresAt: null,
						setupTx: null,
						createdAt: new Date().toISOString()
					};
					accounts.save(did, record);
					return record;
				}
				const sessionKey = /** @type {`0x${string}`} */ (generatePrivateKey());
				const sessionAccount = privateKeyToAccount(sessionKey);
				const readUntil = (await chain.blockTimestamp()) + READ_KEY_TTL_SECONDS;
				const { address, setupTx } = await chain.createAccount({
					descriptor: descriptor(),
					sessionAddress: sessionAccount.address,
					readUntil
				});
				/** @type {import('./chain/account-store.js').ChainAccountRecord} */
				const record = {
					chainId: CHAIN_ID,
					address,
					session: { address: sessionAccount.address, privateKey: sessionKey },
					readKeyExpiresAt: Number(readUntil),
					setupTx,
					createdAt: new Date().toISOString()
				};
				accounts.save(did, record);
				return record;
			})();
			creating.set(did, running);
			running.then(
				() => creating.delete(did),
				() => creating.delete(did)
			);
		}
		try {
			const record = await running;
			onAccount({ phase: 'ready', address: record.address, error: null });
			// Published after every start, not only after creation: a profile that
			// did not replicate the first time gets another chance.
			void directory
				.publish(did, { address: record.address, chainId: CHAIN_ID })
				.catch((error) => console.warn('Publishing the account failed:', error));
			return record;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			reportFailure(did, message);
			throw error instanceof BudgetError ? error : new BudgetError('unavailable', message);
		}
	}

	/**
	 * The account `did` published, if its passkey is registered there.
	 *
	 * @param {string} did
	 * @param {'beneficiary-without-account' | 'escrow-not-found'} code what to throw when there is none
	 */
	async function accountOf(did, code) {
		const published = await directory.lookup(did, {
			chainId: CHAIN_ID,
			timeoutMs: lookupTimeoutMs
		});
		if (!published) {
			throw new BudgetError(code, 'This DID has published no account yet.');
		}
		if (!(await chain.isPasskeyAccount({ address: published.address, did }))) {
			throw new BudgetError(
				code,
				"The account this DID published does not hold the DID's passkey."
			);
		}
		return published.address;
	}

	/** @param {import('./chain/account-store.js').ChainAccountRecord} record */
	function readKeyState(record) {
		if (!record.session || record.readKeyExpiresAt === null) return 'missing';
		return Date.now() / 1000 < record.readKeyExpiresAt ? 'valid' : 'expired';
	}

	/** @param {import('./chain/account-store.js').ChainAccountRecord} record */
	function requireReadKey(record) {
		const state = readKeyState(record);
		if (state !== 'valid' || !record.session) {
			throw new BudgetError('read-access-expired', 'The read key has expired or is missing.');
		}
		return record.session;
	}

	/**
	 * One user operation the passkey signs.
	 *
	 * @param {'budget-lock' | 'budget-release' | 'budget-read-key'} action
	 * @param {import('./chain/account-store.js').ChainAccountRecord} record
	 * @param {import('./chain/sepolia-chain.js').Call[]} calls
	 */
	async function send(action, record, calls) {
		try {
			return await prompt(action, ({ onPrompt, onSigned }) =>
				chain.sendWithPasskey({
					address: record.address,
					descriptor: descriptor(),
					calls,
					onPrompt,
					onSigned
				})
			);
		} catch (error) {
			if (error instanceof BudgetError) throw error;
			if (wasCancelled(error)) {
				throw new BudgetError('passkey-cancelled', 'The passkey confirmation was cancelled.');
			}
			throw new BudgetError('unavailable', describe(error));
		}
	}

	/**
	 * @param {import('./chain/account-store.js').ChainAccountRecord} record
	 * @param {`0x${string}`[]} handles
	 * @param {`0x${string}`} contractAddress
	 */
	async function decrypt(record, handles, contractAddress) {
		const session = requireReadKey(record);
		try {
			return await chain.decrypt({ handles, contractAddress, account: record.address, session });
		} catch (error) {
			throw new BudgetError('unavailable', describe(error));
		}
	}

	/** @type {import('./budget-service.js').BudgetService & { prepareAccount: () => Promise<void> }} */
	const service = {
		info,

		// The same derivation as the fake's, and as docs/escrow.md describes.
		async createTodoRef({ todoKey }) {
			const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
			const digest = await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(`${todoKey}:${salt}`)
			);
			return `0x${hex(new Uint8Array(digest))}`;
		},

		async lock({ todoRef, beneficiaryDid, amount, deadline }) {
			const did = me();
			if (!/^0x[0-9a-f]{64}$/i.test(todoRef) || /^0x0+$/.test(todoRef)) {
				throw new BudgetError('unknown', 'A todoRef is 32 bytes and not zero.');
			}
			if (!beneficiaryDid || beneficiaryDid === did) {
				throw new BudgetError('invalid-beneficiary', 'The budget needs someone else to pay.');
			}
			if (typeof amount !== 'bigint' || amount <= 0n || amount > UINT64_MAX) {
				throw new BudgetError('invalid-amount', 'The amount must be positive and fit a uint64.');
			}
			const record = await ensureAccount();
			const beneficiary = await accountOf(beneficiaryDid, 'beneficiary-without-account');
			const hex = /** @type {`0x${string}`} */ (todoRef);

			const now = await chain.blockTimestamp();
			const deadlineAt =
				deadline === null
					? now + DEFAULT_LOCK_SECONDS
					: BigInt(Math.floor(Date.parse(deadline) / 1000));
			if (deadlineAt <= now || deadlineAt > now + MAX_LOCK_SECONDS) {
				throw new BudgetError('invalid-deadline', 'The deadline must lie within the next year.');
			}
			if ((await chain.readEscrow(record.address, hex)).status !== 'none') {
				throw new BudgetError('escrow-exists', 'This todoRef already has an escrow.');
			}

			// Encrypted here, for this escrow and this account only: the proof is
			// bound to both, so nobody can replay it elsewhere.
			const session = requireReadKey(record);
			let input;
			try {
				input = await chain.encryptAmount({ amount, account: record.address, session });
			} catch (error) {
				throw new BudgetError('unavailable', describe(error));
			}

			const calls = [
				...((await chain.balanceHandle(record.address)) === ZERO_HANDLE
					? chain.calls.funding(record.address, STARTING_FUNDS)
					: []),
				...chain.calls.lock({
					todoRef: hex,
					beneficiary,
					handle: input.handle,
					inputProof: input.inputProof,
					deadline: deadlineAt,
					operatorUntil: now + OPERATOR_TTL_SECONDS
				})
			];
			const receipt = await send('budget-lock', record, calls);
			if (!receipt.success) {
				throw new BudgetError('unknown', 'The lock was mined but reverted.', {
					lockTx: receipt.txHash,
					todoRef
				});
			}

			// Read at the receipt's block: a node that lags would show no escrow,
			// and its zero handle would look like an empty lock.
			const escrow = await chain.readEscrow(record.address, hex, {
				blockNumber: receipt.blockNumber
			});
			if (escrow.status !== 'locked') {
				throw new BudgetError('unknown', 'The lock was mined, but the chain shows no escrow.', {
					lockTx: receipt.txHash,
					todoRef
				});
			}
			// A confidential transfer from too small a balance moves an encrypted
			// 0 and does not revert. Only reading what arrived tells.
			await chain.waitBlocks(2n);
			const values = await decrypt(record, [escrow.amount], ESCROW_ADDRESS);
			if ((values.get(escrow.amount.toLowerCase()) ?? 0n) === 0n) {
				throw new BudgetError(
					'insufficient-balance',
					'The escrow received an encrypted 0: the balance was too low.',
					{ lockTx: receipt.txHash, todoRef }
				);
			}
			return { todoRef, lockTx: receipt.txHash };
		},

		async release({ todoRef }) {
			me();
			const record = await ensureAccount();
			const hex = /** @type {`0x${string}`} */ (todoRef);
			const escrow = await chain.readEscrow(record.address, hex);
			if (escrow.status === 'none') {
				throw new BudgetError('escrow-not-found', 'No escrow of yours has this todoRef.');
			}
			if (escrow.status !== 'locked') {
				throw new BudgetError('escrow-closed', `The escrow is already ${escrow.status}.`);
			}
			const receipt = await send('budget-release', record, chain.calls.release(hex));
			if (!receipt.success) throw new BudgetError('unknown', 'The release was mined but reverted.');
			return { releaseTx: receipt.txHash };
		},

		async decryptAmount({ todoRef, creatorDid }) {
			const did = me();
			const record = await ensureAccount();
			requireReadKey(record);
			const creator =
				creatorDid === did ? record.address : await accountOf(creatorDid, 'escrow-not-found');
			const escrow = await chain.readEscrow(creator, /** @type {`0x${string}`} */ (todoRef));
			if (escrow.status === 'none') {
				throw new BudgetError('escrow-not-found', 'The chain holds no such escrow.');
			}
			const parties = [creator, escrow.beneficiary, AUDITOR_ADDRESS];
			if (!parties.some((party) => chain.sameAddress(party, record.address))) {
				throw new BudgetError(
					'not-allowed',
					'Only the creator, the beneficiary and the auditor may read this.'
				);
			}
			const values = await decrypt(record, [escrow.amount], ESCROW_ADDRESS);
			const value = values.get(escrow.amount.toLowerCase());
			if (value === undefined) throw new BudgetError('unavailable', 'Zama returned no value.');
			return value;
		},

		async balance() {
			me();
			const record = await ensureAccount();
			requireReadKey(record);
			const handle = await chain.balanceHandle(record.address);
			if (handle === ZERO_HANDLE) return 0n;
			const values = await decrypt(record, [handle], TOKEN_ADDRESS);
			const value = values.get(handle.toLowerCase());
			if (value === undefined) throw new BudgetError('unavailable', 'Zama returned no value.');
			return value;
		},

		async listEscrowsForAuditor() {
			me();
			const record = await ensureAccount();
			const auditor = chain.sameAddress(record.address, AUDITOR_ADDRESS);
			const events = await chain.lockedEvents();
			const rows = [];
			for (const event of events.slice(0, 50)) {
				const escrow = await chain.readEscrow(event.creator, event.todoRef);
				let amount = null;
				if (auditor) {
					const values = await decrypt(record, [escrow.amount], ESCROW_ADDRESS);
					amount = values.get(escrow.amount.toLowerCase()) ?? null;
				}
				rows.push({
					todoRef: event.todoRef,
					creator: { did: null, account: event.creator, label: null },
					beneficiary: { did: null, account: event.beneficiary, label: null },
					amount,
					status: /** @type {'locked' | 'released' | 'refunded'} */ (
						escrow.status === 'none' ? 'locked' : escrow.status
					),
					lockedAt: new Date(Number(event.lockedAt) * 1000).toISOString(),
					deadline: new Date(Number(escrow.deadline) * 1000).toISOString()
				});
			}
			return /** @type {any} */ (rows);
		},

		async readKeyStatus() {
			// Asked on every start, also before the passkey session exists.
			const did = identity();
			if (!did || !did.startsWith('did:')) return { state: 'missing', expiresAt: null };
			const record = accounts.load(did, CHAIN_ID);
			if (!record) return { state: 'missing', expiresAt: null };
			return {
				state: readKeyState(record),
				expiresAt:
					record.readKeyExpiresAt === null
						? null
						: new Date(record.readKeyExpiresAt * 1000).toISOString()
			};
		},

		async renewReadKey() {
			const did = me();
			const record = await ensureAccount();
			// A new session key each time: the ACL refuses the same delegation
			// twice in one block, and an old key should not outlive its renewal.
			const sessionKey = /** @type {`0x${string}`} */ (generatePrivateKey());
			const sessionAccount = privateKeyToAccount(sessionKey);
			const readUntil = (await chain.blockTimestamp()) + READ_KEY_TTL_SECONDS;
			const receipt = await send(
				'budget-read-key',
				record,
				chain.calls.readKey({
					account: record.address,
					sessionAddress: sessionAccount.address,
					readUntil
				})
			);
			if (!receipt.success) throw new BudgetError('unknown', 'The read key renewal reverted.');
			const next = {
				...record,
				session: { address: sessionAccount.address, privateKey: sessionKey },
				readKeyExpiresAt: Number(readUntil)
			};
			accounts.save(did, next);
			return { state: 'valid', expiresAt: new Date(Number(readUntil) * 1000).toISOString() };
		},

		/** Create or find the account in the background, for a passkey session. */
		async prepareAccount() {
			await ensureAccount();
		}
	};

	return service;
}

/**
 * Whether an error somewhere down viem's cause chain is a cancelled WebAuthn
 * prompt.
 *
 * @param {unknown} error
 */
export function wasCancelled(error) {
	/** @type {any} */
	let current = error;
	for (let depth = 0; current && depth < 10; depth += 1) {
		if (current.name === 'NotAllowedError') return true;
		if (typeof current.message === 'string' && /cancelled or not allowed/i.test(current.message)) {
			return true;
		}
		current = current.cause;
	}
	return false;
}

/** @param {Uint8Array} bytes */
function hex(bytes) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {unknown} error */
function describe(error) {
	/** @type {any} */
	const any = error;
	return String(any?.shortMessage ?? any?.message ?? error).slice(0, 300);
}
