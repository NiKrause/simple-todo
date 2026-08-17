/**
 * Carrying the list registry across an identity change.
 *
 * The registry's database *name* is derived from a signature by the current
 * identity, so adopting a passkey does not extend it — it addresses a different
 * database. The entries therefore have to be copied, and the copy spans a gap
 * where neither database exists: the old one can only be read while the old
 * identity is alive, the new one can only be written once the new identity is,
 * and the whole stack is torn down and rebuilt in between.
 *
 * So they are staged here first, on disk, before anything is destroyed. Held in
 * a variable instead, a failed restart — or a reload, or a closed tab — would
 * lose them while the old registry has already been dropped, taking both copies
 * at once. Staged, an interrupted migration simply finishes on the next start.
 *
 * The buffer is cleared only after the entries are in the new registry, so it
 * is written before the risk and removed after it. Everything is best-effort
 * against storage errors: a browser that refuses localStorage still gets a
 * working app, just without the migration.
 */

const HANDOFF_KEY = 'qr01.registryHandoff';

/** @typedef {import('./list-registry.js').ListEntry} ListEntry */

/**
 * Put the entries somewhere that survives the restart.
 *
 * @param {ListEntry[]} entries
 */
export function stageRegistryHandoff(entries) {
	if (!Array.isArray(entries) || entries.length === 0) return;
	try {
		localStorage.setItem(HANDOFF_KEY, JSON.stringify(entries));
	} catch {
		// Storage unavailable. The migration is skipped, which loses the lists
		// from the switcher — the same place they are today without any of this.
	}
}

/**
 * What a previous session staged, if anything.
 *
 * @returns {ListEntry[]}
 */
export function readRegistryHandoff() {
	let raw = null;
	try {
		raw = localStorage.getItem(HANDOFF_KEY);
	} catch {
		return [];
	}
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		// Filtered rather than trusted: this is parsed from storage, which any
		// extension or an older build of this app could have written.
		return parsed.filter((entry) => entry && typeof entry.address === 'string' && entry.address);
	} catch {
		// Corrupt buffer. Dropping it is right — retrying a parse that has already
		// failed would leave it stuck across every future start.
		clearRegistryHandoff();
		return [];
	}
}

/** Only ever called once the entries are safely in the new registry. */
export function clearRegistryHandoff() {
	try {
		localStorage.removeItem(HANDOFF_KEY);
	} catch {
		// Nothing to do: a buffer that cannot be removed is re-applied on the next
		// start, and `rememberList` skips writes that change nothing.
	}
}

export { HANDOFF_KEY as REGISTRY_HANDOFF_KEY };
