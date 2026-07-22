import { writable, derived, get } from 'svelte/store';
import { peerIdStore } from './p2p.js';
import { relayHttpStatusStore } from './relay-status.js';

/**
 * @typedef {{
 *   text: string
 *   completed: boolean
 *   createdBy: string
 *   assignee: string | null
 *   createdAt: string
 *   updatedAt: string
 * }} TodoValue
 */

/**
 * @typedef {TodoValue & {
 *   id: string
 *   key: string
 * }} TodoItem
 */

/**
 * @typedef {{
 *   hash: string
 *   key: string
 *   value: TodoValue
 * }} TodoRecord
 */

/**
 * @typedef {{
 *   address: unknown
 *   all: () => Promise<TodoRecord[]>
 *   iterator?: (options?: { amount?: number }) => AsyncIterable<TodoRecord>
 *   get: (key: string) => Promise<TodoRecord | TodoValue | null | undefined>
 *   put: (key: string, value: TodoValue) => Promise<unknown>
 *   del: (key: string) => Promise<unknown>
 *   drop: () => Promise<unknown>
 *   log?: {
 *     values?: () => Promise<any[]>
 *     heads?: () => Promise<any[]>
 *     joinEntry?: (entry: any) => Promise<unknown>
 *   }
 *   peers?: Set<string>
 *   sync?: {
 *     add?: (entry: any) => Promise<unknown>
 *     start?: () => Promise<unknown>
 *     stop?: () => Promise<unknown>
 *   }
 *   events: {
 *     on: (event: string, handler: (...args: any[]) => void | Promise<void>) => void
 *   }
 * }} TodoDatabase
 */

/**
 * @param {TodoValue | TodoRecord} record
 * @returns {TodoValue}
 */
function unwrapTodoValue(record) {
	return 'value' in record ? record.value : record;
}

// Store for OrbitDB instances
export const orbitdbStore = writable(/** @type {any} */ (null));
export const todoDBStore = writable(/** @type {TodoDatabase | null} */ (null));
export const todoDBAddressStore = writable('');

// Store for todos
export const todosStore = writable(/** @type {TodoItem[]} */ ([]));
/** @typedef {'unknown' | 'pending' | 'pinned' | 'unavailable'} TodoReplicationStatus */
export const todoReplicationStatusStore = writable(
	/** @type {Record<string, TodoReplicationStatus>} */ ({})
);

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

const observedDatabases = new WeakSet();
const relayProofsInFlight = new Set();
/** @type {Promise<void> | null} */
let pendingTodosLoad = null;
let todosReloadRequested = false;
/** @type {any[]} */
let todoEntriesReceivedDuringLoad = [];
// This is a collaborative demo database with an append-only history. Reading an
// unlimited history can monopolize IndexedDB/IPFS long enough to delay live sync.
const INITIAL_TODO_LIMIT = 250;
const RELAY_PROOF_ATTEMPTS = 3;
/**
 * @param {TodoDatabase | null | undefined} todoDB
 * @returns {string}
 */
function getDatabaseAddress(todoDB) {
	if (!todoDB) return '';

	const address = todoDB.address;
	if (typeof address === 'string') return address;

	if (address && typeof address.toString === 'function') {
		return address.toString();
	}

	return '';
}

/**
 * @param {TodoDatabase | null} todoDB
 */
function setActiveTodoDatabase(todoDB) {
	todoDBStore.set(todoDB);
	todoDBAddressStore.set(getDatabaseAddress(todoDB));
}

/** Guards against re-asking the same relay for the same database. */
const relayDatabaseJoins = new Set();

/**
 * Ask the connected relay to open this database so it becomes an OrbitDB sync peer.
 *
 * Until now the relay only joined a database once a todo triggered
 * `verifyRelayReplication`. For a freshly created database that is a chicken-and-egg:
 * replicating the first todo needs a sync peer, but the relay only becomes one after
 * a todo exists. The sole remaining candidate is a direct browser-to-browser
 * connection, which is explicitly best-effort and routinely fails behind NAT — so two
 * browsers on a brand-new database can sit at `databasePeers: []` indefinitely.
 * Long-lived shared databases hide this because the relay joined them in an earlier
 * session.
 *
 * @param {string} origin
 * @param {string} dbAddress
 */
async function requestRelayDatabaseJoin(origin, dbAddress) {
	const key = `${origin}|${dbAddress}`;
	if (!origin || !dbAddress || relayDatabaseJoins.has(key)) return;
	relayDatabaseJoins.add(key);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		const responsePromise = fetch(`${origin}/pinning/sync`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dbAddress }),
			signal: controller.signal
		});

		// Same reason as in requestRelayReplicationProof: the relay may already be
		// subscribed for discovery before OrbitDB installs its heads handler, so
		// restart sync to force the native heads exchange once the relay is in.
		await new Promise((resolve) => setTimeout(resolve, 250));
		const todoDB = get(todoDBStore);
		if (getDatabaseAddress(todoDB) === dbAddress && todoDB?.sync?.stop && todoDB.sync.start) {
			await todoDB.sync.stop();
			await todoDB.sync.start();
		}

		const response = await responsePromise;
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		console.info('Relay joined database for sync:', { dbAddress });
	} catch (error) {
		// Let a later store update retry — the relay may simply not be reachable yet.
		relayDatabaseJoins.delete(key);
		console.warn('Relay database join failed:', {
			dbAddress,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		clearTimeout(timeout);
	}
}

// Both inputs arrive independently: the database may open before the relay
// connects, or the other way round. React to whichever completes the pair.
derived([relayHttpStatusStore, todoDBAddressStore], ([relay, dbAddress]) => ({
	origin: relay?.origin ?? '',
	dbAddress
})).subscribe(({ origin, dbAddress }) => {
	if (!origin || !dbAddress) return;
	void requestRelayDatabaseJoin(origin, dbAddress);
});

// Initialize database and load existing todos
/**
 * @param {any} orbitdb
 * @param {TodoDatabase} todoDB
 */
export async function initializeDatabase(orbitdb, todoDB) {
	orbitdbStore.set(orbitdb);
	setActiveTodoDatabase(todoDB);

	// OrbitDB's non-indexed keyvalue.all() traverses the complete append-only
	// history. Hydrate the UI in the background instead of blocking app startup.
	setupDatabaseListeners(todoDB);
	void loadTodos();
}

/**
 * Open an OrbitDB todo database by address and make it the active todo list.
 *
 * @param {string} address
 * @returns {Promise<{ address: string, count: number }>}
 */
export async function loadTodoDatabase(address) {
	const orbitdb = get(orbitdbStore);
	const normalizedAddress = address.trim();

	if (!orbitdb) {
		throw new Error('OrbitDB is not initialized yet.');
	}

	if (!normalizedAddress) {
		throw new Error('Enter an OrbitDB database address.');
	}

	if (!normalizedAddress.startsWith('/orbitdb/')) {
		throw new Error('The database address must start with "/orbitdb/".');
	}

	try {
		const loadedTodoDB = await orbitdb.open(normalizedAddress, {
			type: 'keyvalue',
			sync: true
		});

		setActiveTodoDatabase(loadedTodoDB);
		setupDatabaseListeners(loadedTodoDB);
		await loadTodos();

		return {
			address: getDatabaseAddress(loadedTodoDB) || normalizedAddress,
			count: get(todosCountStore)
		};
	} catch (error) {
		throw new Error(
			`Failed to load Todo DB: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

// Load all todos from the database
export async function loadTodos() {
	todosReloadRequested = true;
	if (pendingTodosLoad) return pendingTodosLoad;

	pendingTodosLoad = (async () => {
		do {
			todosReloadRequested = false;
			await loadTodosSnapshot();
		} while (todosReloadRequested);
	})().finally(() => {
		pendingTodosLoad = null;
	});

	return pendingTodosLoad;
}

async function loadTodosSnapshot() {
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const startedAt = performance.now();
		const allTodos = await readRecentTodos(todoDB);
		if (get(todoDBStore) !== todoDB) return;

		const todosArray = allTodos.map((/** @type {TodoRecord} */ todo) => ({
			id: todo.hash,
			key: todo.key,
			...todo.value
		}));

		todosStore.set(sortTodos(todosArray));
		const pendingEntries = todoEntriesReceivedDuringLoad;
		todoEntriesReceivedDuringLoad = [];
		for (const entry of pendingEntries) applyTodoEntry(entry, false);
		console.log(
			`📋 Loaded ${todosArray.length} todos from the OrbitDB history in ${Math.round(performance.now() - startedAt)}ms`
		);
	} catch (error) {
		console.error('❌ Error loading todos:', error);
	}
}

/**
 * Read a bounded current view when OrbitDB exposes its iterator. This keeps
 * startup and live replication responsive even after years of shared history.
 * Test doubles and older compatible stores can still fall back to `all()`.
 *
 * @param {TodoDatabase} todoDB
 * @returns {Promise<TodoRecord[]>}
 */
async function readRecentTodos(todoDB) {
	if (!todoDB.iterator) return todoDB.all();

	const todos = [];
	for await (const todo of todoDB.iterator({ amount: INITIAL_TODO_LIMIT })) {
		todos.push(todo);
	}
	return todos;
}

/** @param {TodoItem[]} todos */
function sortTodos(todos) {
	return todos.sort((a, b) => {
		const dateA = new Date(a.createdAt || 0).getTime();
		const dateB = new Date(b.createdAt || 0).getTime();
		return dateB - dateA;
	});
}

/**
 * @param {any} entry
 * @param {boolean} [trackDuringLoad=true]
 */
function applyTodoEntry(entry, trackDuringLoad = true) {
	const { op, key, value } = entry?.payload ?? {};
	if (!key || (op !== 'PUT' && op !== 'DEL')) return false;
	if (trackDuringLoad && pendingTodosLoad) todoEntriesReceivedDuringLoad.push(entry);

	todosStore.update((todos) => {
		const withoutPreviousValue = todos.filter((todo) => todo.key !== key);
		if (op === 'DEL') return withoutPreviousValue;

		return sortTodos([...withoutPreviousValue, { id: entry.hash, key, ...value }]);
	});
	return true;
}

// Set up database event listeners
/**
 * @param {TodoDatabase} todoDB
 */
function setupDatabaseListeners(todoDB) {
	if (!todoDB) return;
	if (observedDatabases.has(todoDB)) return;
	observedDatabases.add(todoDB);

	// Listen for new entries being added
	todoDB.events.on('join', (_peerId, heads) => {
		console.log('📝 Database peer joined:', heads);
		void loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', (...args) => {
		const entry = args.find((value) => value?.payload);
		console.log('🔄 Entry updated:', entry);
		if (!applyTodoEntry(entry)) {
			void loadTodos();
			return;
		}

		const { op, key } = entry?.payload ?? {};
		if (op === 'PUT' && key && entry?.hash) {
			scheduleRelayReplicationProof(key, String(entry.hash), getDatabaseAddress(todoDB));
		}
	});
}

// Add a new todo
/**
 * @param {string} text
 * @param {string | null} [assignee=null]
 */
export async function addTodo(text, assignee = null) {
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return false;
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return false;
	}

	try {
		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		/** @type {TodoValue} */
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy: myPeerId,
			assignee: assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const entryHash = String(await todoDB.put(todoId, todo));
		scheduleRelayReplicationProof(todoId, entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo added:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error adding todo:', error);
		return false;
	}
}

/** @param {string} todoKey @param {string} entryHash @param {string} dbAddress */
function scheduleRelayReplicationProof(todoKey, entryHash, dbAddress) {
	if (relayProofsInFlight.has(todoKey)) return;
	if (get(todoReplicationStatusStore)[todoKey] === 'pinned') return;

	relayProofsInFlight.add(todoKey);
	todoReplicationStatusStore.update((statuses) => ({ ...statuses, [todoKey]: 'pending' }));
	void verifyRelayReplication(todoKey, entryHash, dbAddress).finally(() => {
		relayProofsInFlight.delete(todoKey);
	});
}

/**
 * Ask the connected relay to perform a fresh database sync. A green state is only
 * assigned when the relay reports this exact OrbitDB entry as its last local record.
 * @param {string} todoKey
 * @param {string} entryHash
 * @param {string} dbAddress
 */
async function verifyRelayReplication(todoKey, entryHash, dbAddress) {
	const { origin } = get(relayHttpStatusStore);
	if (!origin || !entryHash || !dbAddress) {
		console.warn('Relay replication proof skipped:', {
			todoKey,
			reason: !origin
				? 'no connected relay HTTP origin'
				: !entryHash
					? 'missing OrbitDB entry hash'
					: 'missing OrbitDB database address'
		});
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
		return;
	}

	try {
		for (let attempt = 1; attempt <= RELAY_PROOF_ATTEMPTS; attempt++) {
			const proof = await requestRelayReplicationProof(origin, dbAddress, todoKey, attempt);
			const replicated = proof?.ok === true && proof?.lastRecord?.hash === entryHash;
			if (replicated) {
				console.info('Relay replication proof verified:', { todoKey, entryHash, attempt });
				todoReplicationStatusStore.update((statuses) => ({
					...statuses,
					[todoKey]: 'pinned'
				}));
				return;
			}

			console.warn('Relay replication proof did not include the expected entry:', {
				todoKey,
				attempt,
				expectedEntryHash: entryHash,
				reportedEntryHash: proof?.lastRecord?.hash ?? null,
				relayOk: proof?.ok ?? null,
				entryCount: proof?.entryCount ?? null,
				snapshotSource: proof?.snapshotSource ?? null
			});
		}
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	} catch (error) {
		console.warn('Relay pinning proof unavailable for todo:', todoKey, error);
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	}
}

/** @param {string} origin @param {string} dbAddress @param {string} todoKey @param {number} attempt */
async function requestRelayReplicationProof(origin, dbAddress, todoKey, attempt) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		console.info('Requesting relay replication proof:', {
			todoKey,
			attempt,
			dbAddress,
			endpoint: `${origin}/pinning/sync`
		});
		const responsePromise = fetch(`${origin}/pinning/sync`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dbAddress }),
			signal: controller.signal
		});

		// The relay may already be subscribed for discovery before OrbitDB installs
		// its heads handler. Re-subscribing here makes OrbitDB perform its native
		// heads exchange while the relay database is open.
		await new Promise((resolve) => setTimeout(resolve, 250));
		const todoDB = get(todoDBStore);
		if (getDatabaseAddress(todoDB) === dbAddress && todoDB?.sync?.stop && todoDB.sync.start) {
			await todoDB.sync.stop();
			await todoDB.sync.start();
		}

		const response = await responsePromise;
		const responseText = await response.text();
		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ''}`
			);
		}
		try {
			return JSON.parse(responseText);
		} catch {
			throw new Error(`Relay returned invalid JSON: ${responseText.slice(0, 500)}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}

// Delete a todo
/**
 * @param {string | number} todoId
 */
export async function deleteTodo(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		// If todoId is numeric (array index), we need to find the correct database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(String(todoId), 10))) {
			const todo = get(todosStore)[parseInt(String(todoId), 10)];
			if (todo?.key) {
				actualTodoId = todo.key;
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(String(actualTodoId));
		todoReplicationStatusStore.update((statuses) => {
			const next = { ...statuses };
			delete next[String(actualTodoId)];
			return next;
		});
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		return true;
	} catch (error) {
		console.error('❌ Error deleting todo:', error);
		return false;
	}
}

// Toggle todo completion status
/**
 * @param {string | number} todoId
 */
export async function toggleTodoComplete(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🔍 Attempting to toggle todo with ID:', todoId); // Add this debug log

		// If todoId is numeric (array index), we need to find the actual database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(String(todoId), 10))) {
			const todo = get(todosStore)[parseInt(String(todoId), 10)];
			if (todo?.key) {
				actualTodoId = todo.key;
			}
		}

		const existingTodo = await todoDB.get(String(actualTodoId));

		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId, 'actual ID:', actualTodoId);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = unwrapTodoValue(existingTodo);
		const currentCompleted = todoData.completed || false;

		const updatedTodo = {
			...todoData,
			completed: !currentCompleted,
			updatedAt: new Date().toISOString()
		};

		const entryHash = String(await todoDB.put(String(actualTodoId), updatedTodo));
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[String(actualTodoId)]: 'pending'
		}));
		void verifyRelayReplication(String(actualTodoId), entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo toggled:', todoId, updatedTodo.completed);
		return true;
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		return false;
	}
}

// Update todo assignee
/**
 * @param {string} todoId
 * @param {string | null} assignee
 */
export async function updateTodoAssignee(todoId, assignee) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		const existingTodo = await todoDB.get(todoId);
		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = unwrapTodoValue(existingTodo);

		const updatedTodo = {
			...todoData,
			assignee: assignee,
			updatedAt: new Date().toISOString()
		};

		const entryHash = String(await todoDB.put(todoId, updatedTodo));
		todoReplicationStatusStore.update((statuses) => ({ ...statuses, [todoId]: 'pending' }));
		void verifyRelayReplication(todoId, entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo assignee updated:', todoId, assignee);
		return true;
	} catch (error) {
		console.error('❌ Error updating todo assignee:', error);
		return false;
	}
}

// Get todos by assignee
/**
 * @param {string | null} assignee
 */
export function getTodosByAssignee(assignee) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.assignee === assignee));
}

// Get todos by completion status
/**
 * @param {boolean} completed
 */
export function getTodosByStatus(completed) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.completed === completed));
}

// Get todos created by a specific peer
/**
 * @param {string} creatorId
 */
export function getTodosByCreator(creatorId) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.createdBy === creatorId));
}

// Delete the current database
export async function deleteCurrentDatabase() {
	const todoDB = get(todoDBStore);
	const orbitdb = get(orbitdbStore);

	if (!todoDB || !orbitdb) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🗑️ Deleting current database...');

		// Close the current database
		await todoDB.drop();
		// console.log('✅ Database closed')

		// Drop the database from OrbitDB
		// await orbitdb.close('todos')
		console.log('✅ Database dropped from OrbitDB');

		// Clear the stores
		setActiveTodoDatabase(null);
		todosStore.set([]);

		console.log('✅ Database recreated successfully');
		return true;
	} catch (error) {
		console.error('❌ Error deleting database:', error);
		return false;
	}
}

// Make the function available globally for browser console access
if (typeof window !== 'undefined') {
	const browserWindow = /** @type {Window & typeof globalThis & {
	 *   deleteCurrentDatabase?: typeof deleteCurrentDatabase,
	 *   forceReloadTodos?: typeof loadTodos,
	 *   loadTodoDatabase?: typeof loadTodoDatabase,
	 *   getTodoDatabaseAddress?: () => string,
	 *   getTodoDatabasePeerCount?: () => number,
	 *   getTodoCount?: () => number
	 * }} */ (window);

	browserWindow.deleteCurrentDatabase = deleteCurrentDatabase;
	browserWindow.forceReloadTodos = loadTodos;
	browserWindow.loadTodoDatabase = loadTodoDatabase;
	browserWindow.getTodoDatabaseAddress = () => getDatabaseAddress(get(todoDBStore));
	browserWindow.getTodoDatabasePeerCount = () => get(todoDBStore)?.peers?.size ?? 0;
	browserWindow.getTodoCount = () => get(todosCountStore);
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
