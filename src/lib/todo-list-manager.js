import { writable, get } from 'svelte/store';
import { orbitDBStore } from './p2p.js';
import { openTodoList, getCurrentIdentityId } from './p2p.js';
import { showToast } from './toast-store.js';
import { OrbitDBAccessController } from '@orbitdb/core';

// Store for current todo list name (display name, without ID prefix)
export const currentTodoListNameStore = writable('projects');

// Store for list of available todo lists
export const availableTodoListsStore = writable([]);

// Store for encryption settings
export const encryptionStore = writable({
	enabled: false,
	password: ''
});

// Store for list of unique user IDs/DIDs
export const uniqueUsersStore = writable([]);

// Store for todo list hierarchy (breadcrumb trail)
export const todoListHierarchyStore = writable([]);

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
			await new Promise(resolve => setTimeout(resolve, 100));
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
		if (!todoLists.some(list => list.displayName === 'projects')) {
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
			if (!todoLists.some(list => list.displayName === parentName)) {
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
		
		console.log(`📋 Found ${organizedLists.length} todo lists from registry:`, organizedLists.map(l => l.displayName).join(', '));
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
async function buildHierarchyPath(todoListName) {
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
async function addTodoListToRegistry(displayName, dbName, address = null, parent = null) {
	const identityId = getCurrentIdentityId();
	if (!identityId) return;

	try {
		const registryDb = await openRegistryDatabase(identityId);
		
		// Validate dbName matches expected pattern: identityId_displayName
		const expectedDbName = `${identityId}_${displayName}`;
		if (dbName !== expectedDbName) {
			console.warn(`⚠️ dbName mismatch: expected ${expectedDbName}, got ${dbName}. Using expected value.`);
			dbName = expectedDbName;
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
		console.log(`💾 Added to registry: ${displayName} (${dbName})${address ? ` [${address}]` : ''}${parentInfo}`);
	} catch (error) {
		console.error('❌ Error adding todo list to registry:', error);
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
export async function switchToTodoList(todoListName, preferences = {}, enableEncryption = false, encryptionPassword = '', parentListName = null) {
	if (!todoListName || todoListName.trim() === '') {
		console.error('❌ Todo list name cannot be empty');
		return false;
	}

	const trimmedName = todoListName.trim();

	try {
		const identityId = getCurrentIdentityId();
		const dbName = identityId ? `${identityId}_${trimmedName}` : trimmedName;
		
		const openedDB = await openTodoList(trimmedName, preferences, enableEncryption, encryptionPassword);
		currentTodoListNameStore.set(trimmedName);
		
		// Get database address if available
		const dbAddress = openedDB?.address || null;
		
		// Determine parent from parameter or registry
		let actualParent = parentListName;
		if (!actualParent && identityId) {
			// Look up parent from registry
			try {
				const registryDb = await openRegistryDatabase(identityId);
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
				todoListHierarchyStore.set([...currentHierarchy.slice(0, parentIndex + 1), { name: trimmedName, parent: actualParent }]);
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
		if (identityId) {
			await addTodoListToRegistry(trimmedName, dbName, dbAddress, actualParent);
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
export async function createSubList(todoText, parentListName, preferences = {}, enableEncryption = false, encryptionPassword = '') {
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

	return await switchToTodoList(slug, preferences, enableEncryption, encryptionPassword, parentListName);
}

/**
 * Navigate up the hierarchy (to parent list)
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function navigateUp(preferences = {}, enableEncryption = false, encryptionPassword = '') {
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
		return await switchToTodoList(parent.name, preferences, enableEncryption, encryptionPassword, parent.parent);
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
export async function createTodoList(todoListName, preferences = {}, enableEncryption = false, encryptionPassword = '') {
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
		
		// Add current identity
		const currentIdentityId = getCurrentIdentityId();
		if (currentIdentityId) {
			uniqueIds.add(currentIdentityId);
		}
		
		// Note: In a fully decentralized system, we'd discover other identities
		// through network interactions (peers, pubsub, etc.)
		// For now, we only know about the current identity
		
		const uniqueUsersArray = Array.from(uniqueIds).sort();
		uniqueUsersStore.set(uniqueUsersArray);
		return uniqueUsersArray;
	} catch (error) {
		console.error('❌ Error listing unique users:', error);
		return [];
	}
}

