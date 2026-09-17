/**
 * The budget service (escrow01): every budget operation goes through this
 * interface, so the chain can be swapped in without touching a component.
 *
 * Two implementations: an in-memory fake (`budget-service-fake.js`), the
 * default, and Sepolia (`budget-service-zama.js`) — Zama's confidential token
 * and `ConfidentialTodoEscrow` (contracts/), signed through a Calibur account
 * the passkey controls. `VITE_BUDGET_SERVICE=zama` picks Sepolia when
 * `.env.local` names Openfort's bundler; without it the page warns and keeps
 * the fake, and the account tab says "demo without a chain" so nobody mistakes
 * it for money.
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
import {
	AUDITOR_ADDRESS,
	CHAIN_ID,
	ESCROW_ADDRESS,
	TOKEN_ADDRESS,
	TOKEN_DECIMALS,
	TOKEN_SYMBOL,
	readChainEndpoints
} from './chain/config.js';

/**
 * @param {unknown} value
 * @returns {'fake' | 'zama'}
 */
export function budgetServiceKind(value) {
	return value === 'zama' ? 'zama' : 'fake';
}

/**
 * @typedef {{
 *   env: Record<string, string | undefined>
 *   credential: () => any
 *   orbitdb: () => any
 *   prompt: (action: string, run: (hooks: { onPrompt: () => void, onSigned: () => void }) => Promise<any>) => Promise<any>
 *   onAccount: (status: { phase: 'none' | 'creating' | 'ready' | 'failed', address: string | null, error: string | null }) => void
 * }} ZamaOptions
 */

/**
 * @param {{
 *   kind?: unknown
 *   identity: () => string | null | undefined
 *   confirm: (action: string) => Promise<boolean>
 *   fake?: Omit<Parameters<typeof createFakeBudgetService>[0], 'identity' | 'confirm'>
 *   zama?: ZamaOptions
 * }} options
 * @returns {BudgetService & { prepareAccount?: () => Promise<void>, demo?: any }}
 */
export function createBudgetService({ kind, identity, confirm, fake = {}, zama }) {
	if (budgetServiceKind(kind) === 'zama') {
		const endpoints = zama ? readChainEndpoints(zama.env) : null;
		if (zama && endpoints?.ok) {
			return createLazyZamaService({ identity, endpoints: endpoints.endpoints, ...zama });
		}
		console.warn(
			`VITE_BUDGET_SERVICE=zama, but Sepolia is not configured (${
				endpoints && !endpoints.ok ? endpoints.reason : 'no chain options'
			}): budgets use the in-memory fake.`
		);
	}
	return createFakeBudgetService({ ...fake, identity, confirm });
}

/**
 * The Sepolia service, loaded on first use. Its info is known without loading
 * anything, so the page can say "Sepolia" before viem, Zama's SDK and the
 * wallet code arrive.
 *
 * @param {ZamaOptions & { identity: () => string | null | undefined, endpoints: import('./chain/config.js').ChainEndpoints }} options
 * @returns {BudgetService & { prepareAccount: () => Promise<void> }}
 */
function createLazyZamaService({ identity, endpoints, credential, orbitdb, prompt, onAccount }) {
	/** @type {Promise<any> | null} */
	let loading = null;
	function load() {
		loading ??= (async () => {
			const [{ createZamaBudgetService }, { createSepoliaChain }, { createAccountDirectory }] =
				await Promise.all([
					import('./budget-service-zama.js'),
					import('./chain/sepolia-chain.js'),
					import('./chain/account-directory.js')
				]);
			return createZamaBudgetService({
				identity,
				credential,
				chain: createSepoliaChain({ endpoints }),
				directory: createAccountDirectory(orbitdb),
				prompt,
				onAccount
			});
		})();
		loading.catch(() => {
			loading = null;
		});
		return loading;
	}
	/**
	 * @param {string} method
	 * @returns {(...args: any[]) => Promise<any>}
	 */
	const call =
		(method) =>
		async (...args) =>
			(await load())[method](...args);

	return {
		info: {
			kind: 'zama',
			network: 'sepolia',
			chainId: CHAIN_ID,
			confidential: true,
			requiresPasskey: true,
			token: { symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, address: TOKEN_ADDRESS },
			escrow: ESCROW_ADDRESS,
			auditor: AUDITOR_ADDRESS
		},
		createTodoRef: call('createTodoRef'),
		lock: call('lock'),
		release: call('release'),
		decryptAmount: call('decryptAmount'),
		balance: call('balance'),
		listEscrowsForAuditor: call('listEscrowsForAuditor'),
		readKeyStatus: call('readKeyStatus'),
		renewReadKey: call('renewReadKey'),
		prepareAccount: call('prepareAccount')
	};
}
