/**
 * The budget service (escrow01): every budget operation goes through this
 * interface, so the chain can be swapped in without touching a component.
 *
 * Today there is one implementation, an in-memory fake
 * (`budget-service-fake.js`). The real one — Zama's confidential token and
 * `ConfidentialTodoEscrow` (contracts/), signed through a Calibur account the
 * passkey controls — implements the same shape. Until it exists,
 * `VITE_BUDGET_SERVICE=zama` warns and still gets the fake, and the header says
 * "demo without a chain" so nobody mistakes it for money.
 *
 * Who "I" am is not a parameter: a service acts for the session's identity
 * (`identity()`), the way a wallet signs for its own account. Every operation
 * that sends something asks the passkey first (`confirm(action)`), and throws a
 * `BudgetError` with `passkey-cancelled` when that is declined.
 *
 * Amounts are `bigint` base units of the token (`info.token.decimals`).
 *
 * @typedef {'valid' | 'expired' | 'missing'} ReadKeyState
 *
 * @typedef {{ state: ReadKeyState, expiresAt: string | null }} ReadKeyStatus
 *   The read key decrypts amounts on this device. The passkey authorises it,
 *   it may only decrypt, and it expires (Zama's user decryption works this
 *   way today). An expired key makes every read throw `read-access-expired`
 *   until `renewReadKey()`.
 *
 * @typedef {{ did: string | null, account: string | null, label?: string | null }} BudgetParty
 *   The chain knows accounts; the app knows DIDs. Either may be missing.
 *
 * @typedef {{
 *   todoRef: string
 *   creator: BudgetParty
 *   beneficiary: BudgetParty
 *   amount: bigint
 *   status: 'locked' | 'released' | 'refunded'
 *   lockedAt: string
 *   deadline: string
 * }} AuditorEscrow
 *
 * @typedef {{
 *   kind: 'fake' | 'zama'
 *   network: 'demo' | 'sepolia'
 *   chainId: number | null
 *   confidential: boolean
 *   requiresPasskey: boolean
 *   token: { symbol: string, decimals: number, address: string }
 *   escrow: string
 *   auditor: string
 * }} BudgetServiceInfo
 *   `confidential` is whether amounts really are encrypted; the fake's are not.
 *   `requiresPasskey` is whether an anonymous session can use budgets at all.
 *
 * @typedef {{
 *   info: BudgetServiceInfo
 *   createTodoRef: (input: { todoKey: string }) => Promise<string>
 *   lock: (input: {
 *     todoRef: string
 *     beneficiaryDid: string
 *     amount: bigint
 *     deadline: string | null
 *   }) => Promise<{ todoRef: string, lockTx: string }>
 *   release: (input: { todoRef: string }) => Promise<{ releaseTx: string }>
 *   decryptAmount: (input: { todoRef: string, creatorDid: string }) => Promise<bigint>
 *   balance: () => Promise<bigint>
 *   listEscrowsForAuditor: () => Promise<AuditorEscrow[]>
 *   readKeyStatus: () => Promise<ReadKeyStatus>
 *   renewReadKey: () => Promise<ReadKeyStatus>
 * }} BudgetService
 *
 * - `createTodoRef` — the escrow's public reference for a todo: a salted hash,
 *   so the todo's own key cannot be used to find its escrow.
 * - `lock` — pull `amount` from my balance into the escrow for
 *   `beneficiaryDid`, refundable after `deadline` (null: the service's
 *   default). Throws `insufficient-balance` with `details.lockTx` when the
 *   transfer went through as an encrypted 0, which is how a confidential token
 *   answers a balance that is too low.
 * - `release` — pay the amount locked under my `todoRef` to its beneficiary.
 * - `decryptAmount` — the amount of `creatorDid`'s escrow `todoRef`, for its
 *   creator, its beneficiary or the auditor.
 * - `balance` — my confidential balance, decrypted; `unavailable` when this
 *   service cannot know it.
 * - `listEscrowsForAuditor` — every escrow with its amount, for the auditor.
 * - `readKeyStatus` / `renewReadKey` — the read key above.
 */

import { createFakeBudgetService } from './budget-service-fake.js';

/**
 * @param {unknown} value
 * @returns {'fake' | 'zama'}
 */
export function budgetServiceKind(value) {
	return value === 'zama' ? 'zama' : 'fake';
}

/**
 * @param {{
 *   kind?: unknown
 *   identity: () => string | null | undefined
 *   confirm: (action: string) => Promise<boolean>
 *   fake?: Omit<Parameters<typeof createFakeBudgetService>[0], 'identity' | 'confirm'>
 * }} options
 * @returns {ReturnType<typeof createFakeBudgetService>}
 */
export function createBudgetService({ kind, identity, confirm, fake = {} }) {
	if (budgetServiceKind(kind) === 'zama') {
		console.warn(
			'VITE_BUDGET_SERVICE=zama, but this build has no Zama implementation yet: budgets use the in-memory fake.'
		);
	}
	return createFakeBudgetService({ ...fake, identity, confirm });
}
