/**
 * An in-memory stand-in for the chain (escrow01), behind the budget service
 * interface (`budget-service.js`).
 *
 * It follows `ConfidentialTodoEscrow` where the difference would show in the
 * UI: escrows are keyed by creator and `todoRef`, only the creator releases,
 * a `todoRef` is used once, and a lock from a balance that is too low goes
 * through as a transfer of 0 and is only noticed by decrypting what arrived.
 *
 * What it is not: encrypted, shared, or durable. Amounts sit in plain `bigint`s
 * in this tab's memory, so a second browser — the delegate's — cannot read an
 * amount locked here, and a reload forgets every escrow while the todos in
 * OrbitDB still carry their metadata. The service reports that as
 * `escrow-not-found`, and the UI shows the amount as hidden. For the same
 * reason it knows no balance for an account that has neither locked nor been
 * paid in this tab (`unavailable`): whatever it said would be a guess, and the
 * delegate's browser would show a balance the payout never reached.
 */

import { BudgetError } from './budget.js';

const TOKEN_DECIMALS = 6;
const UNIT = 10n ** BigInt(TOKEN_DECIMALS);
const UINT64_MAX = (1n << 64n) - 1n;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOCK_DURATION_MS = 365 * DAY_MS;
const DEFAULT_LOCK_DURATION_MS = 30 * DAY_MS;

/**
 * Addresses that cannot be mistaken for real ones: they all start `0xfa4e`.
 * @param {string} suffix
 */
const fakeAddress = (suffix) => `0xfa4e${suffix.padStart(36, '0')}`;

export const FAKE_TOKEN_ADDRESS = fakeAddress('c05d7');
export const FAKE_ESCROW_ADDRESS = fakeAddress('e5c70');
export const FAKE_AUDITOR_ADDRESS = fakeAddress('a0d17');
export const FAKE_AUDITOR_DID = 'did:example:auditor';

/**
 * @typedef {{
 *   creator: string
 *   beneficiary: string
 *   todoRef: string
 *   amount: bigint
 *   status: 'locked' | 'released' | 'refunded'
 *   lockedAt: string
 *   deadline: string
 *   lockTx: string
 *   releaseTx: string | null
 *   labels?: { creator?: string, beneficiary?: string }
 * }} FakeEscrow
 *
 * @typedef {{
 *   balances: Map<string, bigint>
 *   escrows: Map<string, FakeEscrow>
 *   startingBalance: bigint
 * }} FakeLedger
 *   Shared by every service created over it, so a test can let Alice and Bob
 *   act on the same "chain".
 */

/**
 * @param {{ startingBalance?: bigint }} [options] credited to an account the
 *   first time it locks, never to one that has only been paid
 * @returns {FakeLedger}
 */
export function createFakeLedger({ startingBalance = 1000n * UNIT } = {}) {
	return { balances: new Map(), escrows: new Map(), startingBalance };
}

/** @param {number} bytes */
function randomHex(bytes) {
	return [...crypto.getRandomValues(new Uint8Array(bytes))]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/** @param {string} text */
async function sha256Hex(text) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** @param {number} ms */
const wait = (ms) =>
	ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** @param {string} creator @param {string} todoRef */
const escrowKey = (creator, todoRef) => `${creator}\n${todoRef.toLowerCase()}`;

/**
 * @param {{
 *   identity: () => string | null | undefined
 *   confirm?: (action: string) => Promise<boolean>
 *   ledger?: FakeLedger
 *   now?: () => number
 *   delayMs?: number
 *   decryptDelayMs?: number
 *   readKeyTtlMs?: number
 *   auditorDid?: string
 * }} options
 *   `delayMs` stands in for a transaction, `decryptDelayMs` for a decryption
 *   round trip; both default to 0 for tests.
 */
export function createFakeBudgetService({
	identity,
	confirm = async () => true,
	ledger = createFakeLedger(),
	now = () => Date.now(),
	delayMs = 0,
	decryptDelayMs = 0,
	readKeyTtlMs = 60 * 60 * 1000,
	auditorDid = FAKE_AUDITOR_DID
}) {
	let readKeyExpiresAt = now() + readKeyTtlMs;

	/** @type {import('./budget-service.js').BudgetServiceInfo} */
	const info = {
		kind: 'fake',
		network: 'demo',
		chainId: null,
		confidential: false,
		requiresPasskey: false,
		token: { symbol: 'cUSDT', decimals: TOKEN_DECIMALS, address: FAKE_TOKEN_ADDRESS },
		escrow: FAKE_ESCROW_ADDRESS,
		auditor: FAKE_AUDITOR_ADDRESS
	};

	function me() {
		const id = identity();
		if (!id) throw new BudgetError('not-allowed', 'There is no identity to act as.');
		return id;
	}

	/** @param {string} account */
	function openAccount(account) {
		if (!ledger.balances.has(account)) ledger.balances.set(account, ledger.startingBalance);
	}

	/** @param {string} account @param {bigint} amount */
	function credit(account, amount) {
		ledger.balances.set(account, (ledger.balances.get(account) ?? 0n) + amount);
	}

	function requireReadKey() {
		if (now() >= readKeyExpiresAt) {
			throw new BudgetError('read-access-expired', 'The read key has expired.');
		}
	}

	/** @param {string} action */
	async function confirmed(action) {
		if (!(await confirm(action))) {
			throw new BudgetError('passkey-cancelled', 'The passkey confirmation was cancelled.');
		}
	}

	/** @returns {import('./budget-service.js').ReadKeyStatus} */
	function readKey() {
		return {
			state: now() < readKeyExpiresAt ? 'valid' : 'expired',
			expiresAt: new Date(readKeyExpiresAt).toISOString()
		};
	}

	/** @type {import('./budget-service.js').BudgetService} */
	const service = {
		info,

		async createTodoRef({ todoKey }) {
			return `0x${await sha256Hex(`${todoKey}:${randomHex(32)}`)}`;
		},

		async lock({ todoRef, beneficiaryDid, amount, deadline }) {
			const creator = me();
			if (!/^0x[0-9a-f]{64}$/i.test(todoRef) || /^0x0+$/.test(todoRef)) {
				throw new BudgetError('unknown', 'A todoRef is 32 bytes and not zero.');
			}
			if (!beneficiaryDid || beneficiaryDid === creator) {
				throw new BudgetError('invalid-beneficiary', 'The budget needs someone else to pay.');
			}
			if (typeof amount !== 'bigint' || amount <= 0n || amount > UINT64_MAX) {
				throw new BudgetError('invalid-amount', 'The amount must be positive and fit a uint64.');
			}
			const lockedAt = now();
			const deadlineAt =
				deadline === null ? lockedAt + DEFAULT_LOCK_DURATION_MS : Date.parse(deadline);
			if (
				Number.isNaN(deadlineAt) ||
				deadlineAt <= lockedAt ||
				deadlineAt > lockedAt + MAX_LOCK_DURATION_MS
			) {
				throw new BudgetError('invalid-deadline', 'The deadline must lie within the next year.');
			}
			const key = escrowKey(creator, todoRef);
			if (ledger.escrows.has(key)) {
				throw new BudgetError('escrow-exists', 'This todoRef already has an escrow.');
			}

			await confirmed('budget-lock');
			await wait(delayMs);
			if (ledger.escrows.has(key)) {
				throw new BudgetError('escrow-exists', 'This todoRef already has an escrow.');
			}

			// A confidential transfer from too small a balance does not revert; it
			// moves 0. The escrow keeps what arrived, and the lock "succeeds".
			openAccount(creator);
			const balance = ledger.balances.get(creator) ?? 0n;
			const transferred = balance >= amount ? amount : 0n;
			ledger.balances.set(creator, balance - transferred);
			const lockTx = `0x${randomHex(32)}`;
			ledger.escrows.set(key, {
				creator,
				beneficiary: beneficiaryDid,
				todoRef,
				amount: transferred,
				status: 'locked',
				lockedAt: new Date(lockedAt).toISOString(),
				deadline: new Date(deadlineAt).toISOString(),
				lockTx,
				releaseTx: null
			});

			// So the client decrypts what the escrow holds before calling it funded.
			await wait(decryptDelayMs);
			if (transferred === 0n) {
				throw new BudgetError(
					'insufficient-balance',
					'The escrow received an encrypted 0: the balance was too low.',
					{ lockTx, todoRef }
				);
			}
			return { todoRef, lockTx };
		},

		async release({ todoRef }) {
			const creator = me();
			// Looked up under the caller, as the contract does: that is what makes
			// releasing creator-only.
			const escrow = ledger.escrows.get(escrowKey(creator, todoRef));
			if (!escrow)
				throw new BudgetError('escrow-not-found', 'No escrow of yours has this todoRef.');
			if (escrow.status !== 'locked') {
				throw new BudgetError('escrow-closed', `The escrow is already ${escrow.status}.`);
			}

			await confirmed('budget-release');
			await wait(delayMs);

			if (escrow.status !== 'locked') {
				throw new BudgetError('escrow-closed', `The escrow is already ${escrow.status}.`);
			}
			escrow.status = 'released';
			escrow.releaseTx = `0x${randomHex(32)}`;
			credit(escrow.beneficiary, escrow.amount);
			return { releaseTx: escrow.releaseTx };
		},

		async decryptAmount({ todoRef, creatorDid }) {
			const reader = me();
			requireReadKey();
			const escrow = ledger.escrows.get(escrowKey(creatorDid, todoRef));
			if (!escrow) throw new BudgetError('escrow-not-found', 'This browser knows no such escrow.');
			if (![escrow.creator, escrow.beneficiary, auditorDid].includes(reader)) {
				throw new BudgetError(
					'not-allowed',
					'Only the creator, the beneficiary and the auditor may read this.'
				);
			}
			await wait(decryptDelayMs);
			return escrow.amount;
		},

		async balance() {
			const account = me();
			requireReadKey();
			await wait(decryptDelayMs);
			const balance = ledger.balances.get(account);
			if (balance === undefined) {
				throw new BudgetError('unavailable', 'This browser has seen no balance for this account.');
			}
			return balance;
		},

		async listEscrowsForAuditor() {
			// The real service answers only the auditor fixed at deployment. The
			// fake answers whoever asks, so the view can be looked at at all.
			requireReadKey();
			await wait(decryptDelayMs);
			return [...ledger.escrows.values()]
				.sort((a, b) => Date.parse(b.lockedAt) - Date.parse(a.lockedAt))
				.map((escrow) => ({
					todoRef: escrow.todoRef,
					creator: { did: escrow.creator, account: null, label: escrow.labels?.creator ?? null },
					beneficiary: {
						did: escrow.beneficiary,
						account: null,
						label: escrow.labels?.beneficiary ?? null
					},
					amount: escrow.amount,
					status: escrow.status,
					lockedAt: escrow.lockedAt,
					deadline: escrow.deadline
				}));
		},

		async readKeyStatus() {
			return readKey();
		},

		async renewReadKey() {
			await confirmed('budget-read-key');
			readKeyExpiresAt = now() + readKeyTtlMs;
			return readKey();
		}
	};

	/**
	 * Levers for showing the states the storyboard has, without waiting an hour
	 * for a read key to run out. Not part of the service interface.
	 */
	const demo = {
		expireReadKey() {
			readKeyExpiresAt = now() - 1;
		},

		/** The example rows of the auditor screen. */
		seedExamples() {
			const at = now();
			/** @type {Array<[string, string, string, string, bigint, 'locked' | 'released', number]>} */
			const examples = [
				['alice', 'Alice', 'bob', 'Bob', 500n * UNIT, 'released', 3],
				['alice', 'Alice', 'carol', 'Carol', 1200n * UNIT, 'locked', 2],
				['dave', 'Dave', 'bob', 'Bob', 80n * UNIT, 'locked', 1]
			];
			for (const [from, fromLabel, to, toLabel, amount, status, daysAgo] of examples) {
				const todoRef = `0x${randomHex(32)}`;
				const creator = `did:example:${from}`;
				ledger.escrows.set(escrowKey(creator, todoRef), {
					creator,
					beneficiary: `did:example:${to}`,
					todoRef,
					amount,
					status,
					lockedAt: new Date(at - daysAgo * DAY_MS).toISOString(),
					deadline: new Date(at + DEFAULT_LOCK_DURATION_MS).toISOString(),
					lockTx: `0x${randomHex(32)}`,
					releaseTx: status === 'released' ? `0x${randomHex(32)}` : null,
					labels: { creator: fromLabel, beneficiary: toLabel }
				});
			}
		}
	};

	return { ...service, demo };
}
