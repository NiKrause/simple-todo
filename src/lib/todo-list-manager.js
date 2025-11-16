import { writable, get } from 'svelte/store';
import { orbitDBStore } from './p2p.js';
import { openTodoList, getCurrentIdentityId } from './p2p.js';
import { showToast } from './toast-store.js';
import { OrbitDBAccessController } from '@orbitdb/core';

// Store for current todo list name (display name, without ID prefix)
export const currentTodoListNameStore = writable('projects');

// Store for current database name (full name with identity ID prefix)
export const currentDbNameStore = writable(null);

// Store for current database address (OrbitDB address, e.g., "/orbitdb/zdpuA...")
export const currentDbAddressStore = writable(null);

// Store for list of available todo lists
export const availableTodoListsStore = writable([]);

// Store for encryption settings
export const encryptionStore = writable({
	enabled: false,
	password: ''
});

// Store for list of unique user IDs/DIDs
export const uniqueUsersStore = writable([]);

// Store for manually tracked/added user identities
export const trackedUsersStore = writable([]);

// Store for todo list hierarchy (breadcrumb trail)
export const todoListHierarchyStore = writable([]);

// Store to track the selected user for filtering todo lists
export const selectedUserIdStore = writable(null); // null means show all users

// Cache for registry database instances (identityId -> database instance)
const registryDbCache = new Map();

// Track ongoing registry database opens to prevent concurrent opens
const registryDbOpening = new Set();

/**
 * Extract display name from database name (remove identity ID prefix)
 * @param {string} dbName - Full database name (identityId_todoListName)
 * @param {string} identityId - The identity ID to remove
 * @returns {string} Display name without ID prefix
 */
export function extractDisplayName(dbName, identityId) {
	if (!identityId || !dbName) return dbName;
	const prefix = `${identityId}_`;
	if (dbName.startsWith(prefix)) {
		return dbName.substring(prefix.length);
	}
	return dbName;
}

/**
 * Get the registry database name for an identity
 * The registry database stores the list of all todo lists for an identity
 * @param {string} identityId - The identity ID
 * @returns {string} Registry database name (just the identityId itself)
 */
function getRegistryDbName(identityId) {
	return identityId; // Use identityId as the registry DB name
}

/**
 * Open the registry database for an identity
 * This database stores metadata about all todo lists for this identity
 * Uses caching to prevent opening the same database multiple times
 * @param {string} identityId - The identity ID
 * @returns {Promise<Object>} The registry database
 */
async function openRegistryDatabase(identityId) {
	// Check if we already have this registry database open
	if (registryDbCache.has(identityId)) {
		const cachedDb = registryDbCache.get(identityId);
		// Check if it's still open
		try {
			if (cachedDb && cachedDb.opened) {
				return cachedDb;
			} else {
				// Database was closed, remove from cache
				registryDbCache.delete(identityId);
			}
		} catch {
			// Error checking, remove from cache and reopen
			registryDbCache.delete(identityId);
		}
	}

	// Check if this database is currently being opened
	if (registryDbOpening.has(identityId)) {
		// Wait for the ongoing open to complete
		// Poll until it's in cache or opening completes
		let attempts = 0;
		while (registryDbOpening.has(identityId) && attempts < 50) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			attempts++;
			// Check if it's now in cache
			if (registryDbCache.has(identityId)) {
				const cachedDb = registryDbCache.get(identityId);
				if (cachedDb && cachedDb.opened) {
					return cachedDb;
				}
			}
		}
		// If still opening after timeout, proceed anyway (might be stuck)
		if (registryDbOpening.has(identityId)) {
			console.warn(`⚠️ Registry database ${identityId} opening seems stuck, proceeding anyway`);
			registryDbOpening.delete(identityId);
		}
	}

	const orbitdb = get(orbitDBStore);
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized');
	}

	const registryDbName = getRegistryDbName(identityId);

	// Mark as opening
	registryDbOpening.add(identityId);

	try {
		// Set up access controller - only allow the current identity to write
		const accessController = OrbitDBAccessController({
			write: [identityId]
		});

		// Open registry database
		const registryDb = await orbitdb.open(registryDbName, {
			type: 'keyvalue',
			create: true,
			sync: true,
			AccessController: accessController
		});

		// Cache the database instance
		registryDbCache.set(identityId, registryDb);

		return registryDb;
	} catch (error) {
		// Remove from opening set on error
		registryDbOpening.delete(identityId);
		throw error;
	} finally {
		// Always remove from opening set when done
		registryDbOpening.delete(identityId);
	}
}

/**
 * List all available todo list databases from the registry database
 * Reads from the identity's registry database (identityId) which stores all todo list metadata
 * @returns {Promise<Array>} Array of todo list objects with dbName and displayName
 */
export async function listAvailableTodoLists() {
	const identityId = getCurrentIdentityId();

	if (!identityId) {
		console.warn('⚠️ Identity not available');
		return [];
	}

	try {
		// Open the registry database
		const registryDb = await openRegistryDatabase(identityId);

		// Read all entries from the registry
		const allEntries = await registryDb.all();
		const todoLists = [];

		// OrbitDB 3.0 all() returns an array, not an object
		if (Array.isArray(allEntries)) {
			// Iterate over array entries
			for (const entry of allEntries) {
				if (entry && entry.value) {
					const value = entry.value;
					const key = entry.key || entry.hash;

					if (value && typeof value === 'object') {
						// Entry format: { displayName, dbName, address, parent, ... }
						todoLists.push({
							dbName: value.dbName || `${identityId}_${value.displayName || key}`,
							displayName: value.displayName || key,
							address: value.address || null,
							parent: value.parent || null
						});
					} else if (typeof value === 'string') {
						// Simple format: just the display name
						todoLists.push({
							dbName: `${identityId}_${value}`,
							displayName: value,
							address: null,
							parent: null
						});
					}
				}
			}
		} else {
			// Fallback: if it's an object (older format or different structure)
			for (const [key, value] of Object.entries(allEntries)) {
				if (value && typeof value === 'object') {
					todoLists.push({
						dbName: value.dbName || `${identityId}_${value.displayName || key}`,
						displayName: value.displayName || key,
						address: value.address || null,
						parent: value.parent || null
					});
				} else if (typeof value === 'string') {
					todoLists.push({
						dbName: `${identityId}_${value}`,
						displayName: value,
						address: null,
						parent: null
					});
				}
			}
		}

		// Ensure 'projects' is in the list (default)
		if (!todoLists.some((list) => list.displayName === 'projects')) {
			todoLists.unshift({
				dbName: `${identityId}_projects`,
				displayName: 'projects',
				address: null,
				parent: null
			});
			// Also add it to registry
			await registryDb.put('projects', {
				displayName: 'projects',
				dbName: `${identityId}_projects`,
				parent: null
			});
		}

		// Organize hierarchically: root lists first, then sub-lists under their parents
		const organizedLists = [];
		const rootLists = [];
		const subListsByParent = new Map();

		// Separate root lists and sub-lists
		for (const list of todoLists) {
			if (list.parent) {
				if (!subListsByParent.has(list.parent)) {
					subListsByParent.set(list.parent, []);
				}
				subListsByParent.get(list.parent).push(list);
			} else {
				rootLists.push(list);
			}
		}

		// Sort root lists
		rootLists.sort((a, b) => a.displayName.localeCompare(b.displayName));

		// Build hierarchical list: root lists first, then their sub-lists
		for (const rootList of rootLists) {
			organizedLists.push(rootList);
			const subLists = subListsByParent.get(rootList.displayName) || [];
			subLists.sort((a, b) => a.displayName.localeCompare(b.displayName));
			organizedLists.push(...subLists);
		}

		// Add any orphaned sub-lists (parent doesn't exist) - these should still be shown
		for (const [parentName, subLists] of subListsByParent.entries()) {
			if (!todoLists.some((list) => list.displayName === parentName)) {
				subLists.sort((a, b) => a.displayName.localeCompare(b.displayName));
				organizedLists.push(...subLists);
			}
		}

		availableTodoListsStore.set(organizedLists);

		// Initialize hierarchy if empty and we have projects
		const hierarchy = get(todoListHierarchyStore);
		if (hierarchy.length === 0 && organizedLists.length > 0) {
			const currentList = get(currentTodoListNameStore);
			if (currentList) {
				todoListHierarchyStore.set([{ name: currentList, parent: null }]);
			}
		}

		console.log(
			`📋 Found ${organizedLists.length} todo lists from registry:`,
			organizedLists.map((l) => l.displayName).join(', ')
		);
		return organizedLists;
	} catch (error) {
		console.error('❌ Error listing todo lists from registry:', error);
		return [];
	}
}

/**
 * Build hierarchy path for a todo list by traversing up the parent chain
 * @param {string} todoListName - Display name of the todo list
 * @returns {Promise<Array<{name: string, parent: string|null}>>} Hierarchy path from root to the list
 */
export async function buildHierarchyPath(todoListName) {
	const identityId = getCurrentIdentityId();
	if (!identityId) {
		return [{ name: todoListName, parent: null }];
	}

	try {
		const registryDb = await openRegistryDatabase(identityId);
		const hierarchy = [];
		const visited = new Set(); // Prevent infinite loops
		let currentName = todoListName;

		// Traverse up the parent chain
		while (currentName && !visited.has(currentName)) {
			visited.add(currentName);

			const entry = await registryDb.get(currentName);
			if (entry) {
				// Add to beginning of hierarchy (root first)
				hierarchy.unshift({ name: currentName, parent: entry.parent || null });
				currentName = entry.parent;
			} else {
				// Entry not found, stop here
				if (hierarchy.length === 0) {
					// No entry found at all, return just this list as root
					hierarchy.push({ name: currentName, parent: null });
				}
				break;
			}
		}

		// If we didn't find the list in registry, add it as root
		if (hierarchy.length === 0) {
			hierarchy.push({ name: todoListName, parent: null });
		}

		return hierarchy;
	} catch (error) {
		console.error('❌ Error building hierarchy path:', error);
		// Fallback to root level
		return [{ name: todoListName, parent: null }];
	}
}

/**
 * Add a todo list to the registry database
 * @param {string} displayName - Display name of the todo list
 * @param {string} dbName - Full database name
 * @param {string|null} address - Database address
 * @param {string|null} parent - Parent todo list name (for sub-lists)
 */
export async function addTodoListToRegistry(displayName, dbName, address = null, parent = null) {
	const identityId = getCurrentIdentityId();
	if (!identityId) return;

	try {
		const registryDb = await openRegistryDatabase(identityId);

		// Extract identity from dbName (part before first underscore)
		let dbNameIdentity = null;
		if (dbName && dbName.includes('_')) {
			const underscoreIndex = dbName.indexOf('_');
			if (underscoreIndex > 0) {
				dbNameIdentity = dbName.substring(0, underscoreIndex);
			}
		}

		// Only validate/overwrite dbName if it belongs to the current identity
		// If it belongs to a different identity, preserve it as-is
		if (dbNameIdentity === identityId) {
			// Database belongs to current identity - validate pattern
			const expectedDbName = `${identityId}_${displayName}`;
			if (dbName !== expectedDbName) {
				console.warn(
					`⚠️ dbName mismatch: expected ${expectedDbName}, got ${dbName}. Using expected value.`
				);
				dbName = expectedDbName;
			}
		} else if (dbNameIdentity) {
			// Database belongs to a different identity - preserve dbName as-is
			console.log(
				`ℹ️  Preserving dbName from different identity: ${dbName} (identity: ${dbNameIdentity})`
			);
		} else {
			// No identity in dbName - use current identity pattern
			console.warn(`⚠️ dbName has no identity prefix, using current identity: ${identityId}`);
			dbName = `${identityId}_${displayName}`;
		}

		// Store in registry with displayName as key
		await registryDb.put(displayName, {
			displayName: displayName,
			dbName: dbName,
			address: address || null,
			parent: parent || null,
			createdAt: new Date().toISOString()
		});

		const parentInfo = parent ? ` (child of: ${parent})` : '';
		console.log(
			`💾 Added to registry: ${displayName} (${dbName})${address ? ` [${address}]` : ''}${parentInfo}`
		);
	} catch (error) {
		console.error('❌ Error adding todo list to registry:', error);
	}
}

/**
 * Remove a todo list from the registry database
 * @param {string} displayName - Display name of the todo list to remove
 * @returns {Promise<boolean>} Success status
 */
export async function removeTodoListFromRegistry(displayName) {
	const identityId = getCurrentIdentityId();
	if (!identityId) {
		console.warn('⚠️ Cannot remove todo list: no identity available');
		return false;
	}

	try {
		const registryDb = await openRegistryDatabase(identityId);

		// Delete from registry
		await registryDb.del(displayName);
		console.log(`🗑️ Removed from registry: ${displayName}`);

		// Refresh the available lists
		await listAvailableTodoLists();

		return true;
	} catch (error) {
		console.error('❌ Error removing todo list from registry:', error);
		return false;
	}
}

/**
 * Create or switch to a todo list
 * @param {string} todoListName - Display name of the todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @param {string} parentListName - Name of the parent todo list (for hierarchy)
 * @returns {Promise<boolean>} Success status
 */
export async function switchToTodoList(
	todoListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = '',
	parentListName = null
) {
	if (!todoListName || todoListName.trim() === '') {
		console.error('❌ Todo list name cannot be empty');
		return false;
	}

	const trimmedName = todoListName.trim();

	try {
		const currentUserIdentity = getCurrentIdentityId();
		let targetIdentityId = currentUserIdentity; // Default to current user
		
		// First, check if the target list exists in availableTodoListsStore
		// This tells us which identity it belongs to
		const availableLists = get(availableTodoListsStore);
		const targetListInStore = availableLists.find((list) => {
			const nameMatches = list.displayName === trimmedName;
			const parentMatches = parentListName 
				? list.parent === parentListName 
				: !list.parent; // If no parent specified, match lists without parent
			return nameMatches && parentMatches;
		});
		
		// If we found the list, use its identity
		if (targetListInStore && targetListInStore.dbName && targetListInStore.dbName.includes('_')) {
			const listIdentity = targetListInStore.dbName.split('_')[0];
			targetIdentityId = listIdentity;
			console.log(`🔍 Found target list in store. Using identity: ${targetIdentityId.slice(0, 16)}...`);
		} else if (parentListName) {
			// If we're navigating to a sublist (has parent), check if parent belongs to another user
			const currentDbName = get(currentDbNameStore);
			if (currentDbName && currentDbName.includes('_')) {
				const currentDbIdentity = currentDbName.split('_')[0];
				// Only use parent's identity if parent belongs to another user
				if (currentDbIdentity !== currentUserIdentity) {
					targetIdentityId = currentDbIdentity;
					console.log(`🔍 Navigating to sublist. Using parent's identity: ${targetIdentityId.slice(0, 16)}...`);
				}
			}
		}
		// Otherwise, use current user's identity (default)
		
		// Now try to find the exact list with the target identity
		const existingList = availableLists.find((list) => {
			const nameMatches = list.displayName === trimmedName;
			const parentMatches = parentListName 
				? list.parent === parentListName 
				: !list.parent;
			
			if (list.dbName && list.dbName.includes('_')) {
				const listIdentity = list.dbName.split('_')[0];
				return nameMatches && parentMatches && listIdentity === targetIdentityId;
			}
			return nameMatches && parentMatches;
		});
		
		// If we found the list with an address, open it by address
		if (existingList && existingList.address) {
			console.log(`✅ Found existing list in registry, opening by address: ${existingList.address.slice(0, 30)}...`);
			const { openDatabaseByAddress } = await import('./p2p.js');
			
			await openDatabaseByAddress(
				existingList.address,
				preferences,
				enableEncryption,
				encryptionPassword
			);
			
			currentTodoListNameStore.set(trimmedName);
			currentDbNameStore.set(existingList.dbName);
			currentDbAddressStore.set(existingList.address);
			
			// Update hierarchy
			const currentHierarchy = get(todoListHierarchyStore);
			if (parentListName) {
				const parentIndex = currentHierarchy.findIndex((item) => item.name === parentListName);
				if (parentIndex >= 0) {
					todoListHierarchyStore.set([
						...currentHierarchy.slice(0, parentIndex + 1),
						{ name: trimmedName, parent: parentListName }
					]);
				} else {
					const fullHierarchy = await buildHierarchyPath(trimmedName);
					todoListHierarchyStore.set(fullHierarchy);
				}
			} else {
				const fullHierarchy = await buildHierarchyPath(trimmedName);
				todoListHierarchyStore.set(fullHierarchy);
			}
			
			// Refresh available lists
			await listAvailableTodoLists();
			await listUniqueUsers();
			
			showToast(`Switched to todo list: ${trimmedName}`, 'success');
			return true;
		}
		
		// If not found, try to open by name using the target identity
		const dbName = targetIdentityId ? `${targetIdentityId}_${trimmedName}` : trimmedName;
		
		// If it's not our identity, use openDatabaseByName instead of openTodoList
		if (targetIdentityId !== currentUserIdentity) {
			console.log(`🔍 Opening list by name (different identity): ${dbName}`);
			const { openDatabaseByName } = await import('./p2p.js');
			
			const openedDB = await openDatabaseByName(
				dbName,
				preferences,
				enableEncryption,
				encryptionPassword
			);
			
			currentTodoListNameStore.set(trimmedName);
			currentDbNameStore.set(dbName);
			currentDbAddressStore.set(openedDB?.address || null);
			
			// Update hierarchy
			const currentHierarchy = get(todoListHierarchyStore);
			if (parentListName) {
				const parentIndex = currentHierarchy.findIndex((item) => item.name === parentListName);
				if (parentIndex >= 0) {
					todoListHierarchyStore.set([
						...currentHierarchy.slice(0, parentIndex + 1),
						{ name: trimmedName, parent: parentListName }
					]);
				} else {
					// For other user's sublists, we can't build hierarchy from their registry
					const newHierarchy = parentListName 
						? [...currentHierarchy, { name: trimmedName, parent: parentListName }]
						: [{ name: trimmedName, parent: null }];
					todoListHierarchyStore.set(newHierarchy);
				}
			} else {
				todoListHierarchyStore.set([{ name: trimmedName, parent: null }]);
			}
			
			// Add to registry so it's available for future navigation
			if (openedDB?.address) {
				await addTodoListToRegistry(trimmedName, dbName, openedDB.address, parentListName);
			}
			
			// Refresh available lists
			await listAvailableTodoLists();
			await listUniqueUsers();
			
			showToast(`Switched to todo list: ${trimmedName}`, 'success');
			return true;
		}
		
		// Original logic for our own databases
		const openedDB = await openTodoList(
			trimmedName,
			preferences,
			enableEncryption,
			encryptionPassword
		);
		currentTodoListNameStore.set(trimmedName);
		currentDbNameStore.set(dbName);
		currentDbAddressStore.set(openedDB?.address || null);

		// Determine parent from parameter or registry
		let actualParent = parentListName;
		if (!actualParent && currentUserIdentity) {
			// Look up parent from registry
			try {
				const registryDb = await openRegistryDatabase(currentUserIdentity);
				const entry = await registryDb.get(trimmedName);
				if (entry && entry.parent) {
					actualParent = entry.parent;
				}
			} catch (error) {
				console.warn('⚠️ Could not look up parent from registry:', error);
			}
		}

		// Update hierarchy
		const currentHierarchy = get(todoListHierarchyStore);
		if (actualParent) {
			// Find parent in current hierarchy and add as child
			const parentIndex = currentHierarchy.findIndex((item) => item.name === actualParent);
			if (parentIndex >= 0) {
				// Keep up to parent, then add new child
				todoListHierarchyStore.set([
					...currentHierarchy.slice(0, parentIndex + 1),
					{ name: trimmedName, parent: actualParent }
				]);
			} else {
				// Parent not in current hierarchy - build full path from registry
				const fullHierarchy = await buildHierarchyPath(trimmedName);
				todoListHierarchyStore.set(fullHierarchy);
			}
		} else {
			// Root level - build hierarchy from registry to ensure we have the full path
			const fullHierarchy = await buildHierarchyPath(trimmedName);
			todoListHierarchyStore.set(fullHierarchy);
		}

		// Add to registry database (not localStorage)
		if (currentUserIdentity) {
			await addTodoListToRegistry(trimmedName, dbName, openedDB?.address || null, actualParent);
		}

		// Refresh available todo lists and unique users
		await listAvailableTodoLists();
		await listUniqueUsers();

		// Note: URL hash is updated automatically by reactive statement in +page.svelte

		showToast(`Switched to todo list: ${trimmedName}`, 'success');
		return true;
	} catch (error) {
		console.error('❌ Error switching to todo list:', error);
		showToast(`Failed to switch to todo list: ${error.message}`, 'error');
		return false;
	}
}

/**
 * Create a sub-list from a todo item
 * @param {string} todoText - Text of the todo item (will become the sub-list name)
 * @param {string} parentListName - Name of the parent todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function createSubList(
	todoText,
	parentListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	// Create a slug from the todo text
	const slug = todoText
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '') // Remove special characters
		.replace(/\s+/g, '-') // Replace spaces with hyphens
		.replace(/-+/g, '-') // Replace multiple hyphens with single
		.replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

	if (!slug) {
		showToast('Cannot create sub-list: invalid name', 'error');
		return false;
	}

	return await switchToTodoList(
		slug,
		preferences,
		enableEncryption,
		encryptionPassword,
		parentListName
	);
}

/**
 * Navigate up the hierarchy (to parent list)
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function navigateUp(
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	const hierarchy = get(todoListHierarchyStore);
	if (hierarchy.length <= 1) {
		// Already at root or no hierarchy
		return false;
	}

	// Remove current level and get parent
	const newHierarchy = hierarchy.slice(0, -1);
	const parent = newHierarchy[newHierarchy.length - 1];

	if (parent) {
		todoListHierarchyStore.set(newHierarchy);
		return await switchToTodoList(
			parent.name,
			preferences,
			enableEncryption,
			encryptionPassword,
			parent.parent
		);
	}

	return false;
}

/**
 * Create a new todo list
 * @param {string} todoListName - Display name for the new todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function createTodoList(
	todoListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	return await switchToTodoList(todoListName, preferences, enableEncryption, encryptionPassword);
}

/**
 * List all unique user IDs/DIDs from registry databases
 * Since each identity has its own registry database (named after the identityId),
 * we can't easily enumerate all identities without knowing them in advance.
 * For now, we'll just return the current identity.
 * @returns {Promise<Array>} Array of unique user IDs/DIDs
 */
export async function listUniqueUsers() {
	try {
		const uniqueIds = new Set();

		// ALWAYS include the current user's identity, even if not in available lists
		const currentIdentityId = getCurrentIdentityId();
		if (currentIdentityId) {
			uniqueIds.add(currentIdentityId);
			console.log('  - Added current identity:', currentIdentityId);
		}

		// Extract identity IDs from database names (format: identityId_displayName)
		// Take only the part before the first underscore
		const availableLists = get(availableTodoListsStore);
		console.log('🔍 listUniqueUsers: Checking', availableLists.length, 'lists');

		for (const list of availableLists) {
			if (list.dbName && list.dbName.includes('_')) {
				const underscoreIndex = list.dbName.indexOf('_');
				if (underscoreIndex > 0) {
					const identityId = list.dbName.substring(0, underscoreIndex);
					if (identityId) {
						uniqueIds.add(identityId);
						console.log('  - Found identity:', identityId, 'from dbName:', list.dbName);
					}
				}
			} else {
				console.log('  - Skipping list (no dbName or no underscore):', list);
			}
		}

		const uniqueUsersArray = Array.from(uniqueIds).sort();
		console.log('👥 Unique users found:', uniqueUsersArray);
		uniqueUsersStore.set(uniqueUsersArray);
		return uniqueUsersArray;
	} catch (error) {
		console.error('❌ Error listing unique users:', error);
		// Even on error, ensure current identity is included
		const currentIdentityId = getCurrentIdentityId();
		if (currentIdentityId) {
			uniqueUsersStore.set([currentIdentityId]);
		}
		return [];
	}
}

// Function to add a tracked user and discover their projects database
export async function addTrackedUser(identityId) {
	if (!identityId || !identityId.trim()) {
		throw new Error('Identity ID is required');
	}

	const trimmedId = identityId.trim();
	const tracked = get(trackedUsersStore);

	// Check if already tracked
	if (tracked.includes(trimmedId)) {
		console.log(`ℹ️  Identity ${trimmedId} is already tracked`);
		return;
	}

	// Add to tracked users
	trackedUsersStore.set([...tracked, trimmedId]);

	// Try to discover and add their "projects" database
	try {
		const { openDatabaseByName } = await import('./p2p.js');
		const dbName = `${trimmedId}_projects`;

		console.log(`🔍 Attempting to discover projects database for identity: ${trimmedId}`);

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		// Try to open their projects database
		const projectsDb = await openDatabaseByName(dbName, preferences, false, '');

		if (projectsDb && projectsDb.address) {
			// Add to our registry
			await addTodoListToRegistry('projects', dbName, projectsDb.address, null);

			// Refresh available lists
			await listAvailableTodoLists();

			// Update unique users list
			await listUniqueUsers();

			console.log(`✅ Successfully discovered and added projects database for ${trimmedId}`);
			return true;
		}
	} catch (error) {
		console.warn(`⚠️ Could not discover projects database for ${trimmedId}:`, error);
		// Don't throw - user is still added to tracked list even if discovery fails
	}

	return false;
}

// Function to remove a tracked user
export function removeTrackedUser(identityId) {
	const tracked = get(trackedUsersStore);
	trackedUsersStore.set(tracked.filter((id) => id !== identityId));

	// Also remove from unique users if it was only there because we tracked it
	// (This is optional - you might want to keep discovered users even if untracked)
}
