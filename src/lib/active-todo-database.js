export const ACTIVE_TODO_DATABASE_STORAGE_KEY = 'simpleTodo.activeTodoDatabaseAddress';

export function getStoredActiveTodoDatabaseAddress() {
	if (typeof localStorage === 'undefined') return '';

	try {
		const address = localStorage.getItem(ACTIVE_TODO_DATABASE_STORAGE_KEY)?.trim() ?? '';
		return address.startsWith('/orbitdb/') ? address : '';
	} catch {
		return '';
	}
}

/** @param {string} address */
export function storeActiveTodoDatabaseAddress(address) {
	if (typeof localStorage === 'undefined' || !address.startsWith('/orbitdb/')) return;

	try {
		localStorage.setItem(ACTIVE_TODO_DATABASE_STORAGE_KEY, address);
	} catch {
		// Ignore browsers or modes where localStorage is unavailable.
	}
}
