/**
 * What this browser remembers about a passkey's account on Sepolia (escrow01):
 * the account's address and the session key that reads amounts for it.
 *
 * The address is public. The session key is not money: the account delegated
 * nothing to it but Zama user decryption for the escrow and the token, until a
 * date. It still decrypts those amounts until then, so it is only kept in this
 * browser's storage, the way the passkey identity keeps its metadata. The setup
 * key that created the account is never stored anywhere: it is discarded as
 * soon as the passkey is registered.
 */

import { getAddress, isAddress } from 'viem';

const PREFIX = 'simpleTodo.chainAccount.v1.';

/**
 * @typedef {{
 *   chainId: number
 *   address: `0x${string}`
 *   session: { address: `0x${string}`, privateKey: `0x${string}` } | null
 *   readKeyExpiresAt: number | null
 *   setupTx: string | null
 *   createdAt: string
 * }} ChainAccountRecord
 *   `readKeyExpiresAt` in unix seconds, as the ACL keeps it.
 */

/**
 * @param {() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 */
export function createAccountStore(storage = browserStorage) {
	return {
		/**
		 * @param {string} did
		 * @param {number} chainId
		 * @returns {ChainAccountRecord | null}
		 */
		load(did, chainId) {
			try {
				const raw = storage()?.getItem(PREFIX + did);
				if (!raw) return null;
				return parseRecord(JSON.parse(raw), chainId);
			} catch {
				return null;
			}
		},

		/** @param {string} did @param {ChainAccountRecord} record */
		save(did, record) {
			try {
				storage()?.setItem(PREFIX + did, JSON.stringify(record));
			} catch {
				// Blocked storage: the account still works for this page, and the
				// next page finds it again through the published profile.
			}
		},

		/** @param {string} did */
		forget(did) {
			try {
				storage()?.removeItem(PREFIX + did);
			} catch {
				// Nothing to forget.
			}
		}
	};
}

/**
 * A stored record, or null for anything that is not one for this chain.
 *
 * @param {any} value
 * @param {number} chainId
 * @returns {ChainAccountRecord | null}
 */
export function parseRecord(value, chainId) {
	if (!value || typeof value !== 'object' || value.chainId !== chainId) return null;
	if (typeof value.address !== 'string' || !isAddress(value.address)) return null;
	const session =
		value.session &&
		typeof value.session.address === 'string' &&
		isAddress(value.session.address) &&
		/^0x[0-9a-fA-F]{64}$/.test(value.session.privateKey ?? '')
			? { address: getAddress(value.session.address), privateKey: value.session.privateKey }
			: null;
	return {
		chainId,
		address: getAddress(value.address),
		session,
		readKeyExpiresAt:
			session && Number.isSafeInteger(value.readKeyExpiresAt) ? value.readKeyExpiresAt : null,
		setupTx: typeof value.setupTx === 'string' ? value.setupTx : null,
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString()
	};
}

function browserStorage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
