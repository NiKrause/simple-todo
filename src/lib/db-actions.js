import { writable, derived, get } from 'svelte/store';
import { pipe } from 'it-pipe';
import { libp2pStore, peerIdStore } from './p2p.js';

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

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

const observedDatabases = new WeakSet();
const TODO_ENTRY_EXCHANGE_TOPIC = 'simple-todo.orbitdb-todo-entries';
const TODO_ENTRY_EXCHANGE_PROTOCOL = '/simple-todo/orbitdb-entries/1.0.0';
let todoEntryBridgePubsub = /** @type {any} */ (null);
let todoEntryBridgeLibp2p = /** @type {any} */ (null);

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

// Initialize database and load existing todos
/**
 * @param {any} orbitdb
 * @param {TodoDatabase} todoDB
 */
export async function initializeDatabase(orbitdb, todoDB) {
	orbitdbStore.set(orbitdb);
	setActiveTodoDatabase(todoDB);
	await setupTodoEntryBridge();

	// Load existing todos
	await loadTodos();

	// Set up event listeners for database changes
	setupDatabaseListeners(todoDB);
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
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const allTodos = await todoDB.all();
		console.log('🔍 Raw database entries:', allTodos); // Add this debug log

		// Handle both array and object structures
		/** @type {TodoItem[]} */
		let todosArray;
		todosArray = allTodos.map((/** @type {TodoRecord} */ todo) => {
			return {
				id: todo.hash,
				key: todo.key,
				...todo.value // Access the nested value property
			};
		});

		// Sort by createdAt descending (newest first)
		const sortedTodos = todosArray.sort((/** @type {TodoItem} */ a, /** @type {TodoItem} */ b) => {
			const dateA = new Date(a.createdAt || 0).getTime();
			const dateB = new Date(b.createdAt || 0).getTime();
			return dateB - dateA;
		});

		todosStore.set(sortedTodos);
		console.log('todos', sortedTodos);
		console.log('📋 Loaded todos:', sortedTodos.length);
	} catch (error) {
		console.error('❌ Error loading todos:', error);
	}
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
	todoDB.events.on('join', async (_peerId, heads) => {
		console.log('📝 Database peer joined:', heads);
		await announceTodoDatabaseEntries(todoDB);
		await loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', async (_address, entry) => {
		console.log('🔄 Entry updated:', entry);
		await loadTodos();
	});
}

/**
 * Republish the current log entries on the OrbitDB sync topic.
 * This helps late-joining browser peers receive the current TODO set after
 * they have opened an existing database address.
 *
 * @param {TodoDatabase | null} [database]
 * @returns {Promise<number>}
 */
export async function announceTodoDatabaseEntries(database = get(todoDBStore)) {
	if (!database?.sync?.add) return 0;

	const entries =
		(await database.log?.values?.().catch(() => null)) ??
		(await database.log?.heads?.().catch(() => null)) ??
		[];

	for (const entry of entries) {
		await database.sync.add(entry);
	}

	await publishTodoDatabaseEntries(database, entries);

	return entries.length;
}

async function setupTodoEntryBridge() {
	const libp2p = get(libp2pStore);
	const pubsub = libp2p?.services?.pubsub;
	if (!libp2p || !pubsub || pubsub === todoEntryBridgePubsub) return;

	if (todoEntryBridgePubsub) {
		todoEntryBridgePubsub.removeEventListener?.('message', handleTodoEntryBridgeMessage);
		try {
			await todoEntryBridgePubsub.unsubscribe?.(TODO_ENTRY_EXCHANGE_TOPIC);
		} catch {
			// ignore cleanup failures when switching libp2p instances
		}
	}

	if (todoEntryBridgeLibp2p) {
		try {
			await todoEntryBridgeLibp2p.unhandle?.(TODO_ENTRY_EXCHANGE_PROTOCOL);
		} catch {
			// ignore cleanup failures when switching libp2p instances
		}
	}

	todoEntryBridgeLibp2p = libp2p;
	await todoEntryBridgeLibp2p.handle(TODO_ENTRY_EXCHANGE_PROTOCOL, handleTodoEntryBridgeStream);

	todoEntryBridgePubsub = pubsub;
	todoEntryBridgePubsub.addEventListener('message', handleTodoEntryBridgeMessage);
	await todoEntryBridgePubsub.subscribe(TODO_ENTRY_EXCHANGE_TOPIC);
}

/**
 * @param {TodoDatabase} database
 * @param {any[]} entries
 */
async function publishTodoDatabaseEntries(database, entries) {
	const libp2p = get(libp2pStore);
	const pubsub = libp2p?.services?.pubsub;
	const payload = await exportTodoDatabaseEntries(database, entries);

	if (!libp2p || !pubsub || !payload) {
		return false;
	}

	const bytes = new TextEncoder().encode(JSON.stringify(payload));

	await pubsub.publish(TODO_ENTRY_EXCHANGE_TOPIC, bytes);
	await sendTodoDatabaseEntriesToConnectedPeers(libp2p, bytes);
	return true;
}

/**
 * @param {TodoDatabase | null} [database]
 * @param {any[] | null} [entries]
 */
export async function exportTodoDatabaseEntries(
	database = get(todoDBStore),
	entries = /** @type {any[] | null} */ (null)
) {
	if (!database) return null;

	const dbAddress = getDatabaseAddress(database);
	const logEntries =
		entries ??
		(await database.log?.values?.().catch(() => null)) ??
		(await database.log?.heads?.().catch(() => null)) ??
		[];
	const records = await database.all().catch(() => []);

	if (!dbAddress || (logEntries.length === 0 && records.length === 0)) {
		return null;
	}

	return {
		dbAddress,
		entries: logEntries,
		records: records.map((record) => ({
			key: record.key,
			value: record.value
		}))
	};
}

/**
 * @param {any} libp2p
 * @param {Uint8Array} bytes
 */
async function sendTodoDatabaseEntriesToConnectedPeers(libp2p, bytes) {
	const remotePeers = new Set(
		(libp2p.getConnections?.() ?? [])
			.map((/** @type {any} */ connection) => connection.remotePeer?.toString())
			.filter(Boolean)
	);

	await Promise.allSettled(
		Array.from(remotePeers).map(async (remotePeer) => {
			const stream = await libp2p.dialProtocol(remotePeer, TODO_ENTRY_EXCHANGE_PROTOCOL, {
				signal:
					typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
						? AbortSignal.timeout(10_000)
						: undefined
			});
			await pipe([bytes], stream);
		})
	);
}

/**
 * @param {CustomEvent<{ topic?: string, data?: Uint8Array }>} event
 */
async function handleTodoEntryBridgeMessage(event) {
	if (event.detail?.topic !== TODO_ENTRY_EXCHANGE_TOPIC || !event.detail.data) return;

	try {
		const payload = JSON.parse(new TextDecoder().decode(event.detail.data));
		await importTodoDatabaseEntries(payload);
	} catch (error) {
		console.warn(
			'Failed to import bridged OrbitDB todo entries:',
			error instanceof Error ? error.message : String(error)
		);
	}
}

/**
 * @param {{ stream: { source: AsyncIterable<Uint8Array | { subarray: () => Uint8Array }>, sink: (source: AsyncIterable<Uint8Array>) => Promise<void> } }} event
 */
async function handleTodoEntryBridgeStream({ stream }) {
	try {
		await pipe(stream, async (source) => {
			const bytes = await readStreamBytes(source);
			const payload = JSON.parse(new TextDecoder().decode(bytes));
			await importTodoDatabaseEntries(payload);
		});
	} catch (error) {
		console.warn(
			'Failed to import streamed OrbitDB todo entries:',
			error instanceof Error ? error.message : String(error)
		);
	}
}

/**
 * @param {AsyncIterable<Uint8Array | { subarray: () => Uint8Array }>} source
 * @returns {Promise<Uint8Array>}
 */
async function readStreamBytes(source) {
	/** @type {Uint8Array[]} */
	const chunks = [];
	let length = 0;

	for await (const chunk of source) {
		const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
		chunks.push(bytes);
		length += bytes.length;
	}

	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
}

/**
 * @param {{ dbAddress?: unknown, entries?: unknown, records?: unknown }} payload
 */
export async function importTodoDatabaseEntries(payload) {
	const todoDB = get(todoDBStore);
	const entries = Array.isArray(payload.entries) ? payload.entries : [];
	const records = Array.isArray(payload.records) ? payload.records : [];

	if (
		!todoDB ||
		typeof payload.dbAddress !== 'string' ||
		payload.dbAddress !== getDatabaseAddress(todoDB) ||
		(entries.length === 0 && records.length === 0)
	) {
		return false;
	}

	let updated = false;
	if (todoDB.log?.joinEntry) {
		for (const entry of entries) {
			if (!entry?.hash) continue;
			try {
				const result = await todoDB.log.joinEntry(entry);
				updated = Boolean(result) || updated;
			} catch {
				// If another browser's identity block is not fetchable yet, fall back to record import below.
			}
		}
	}

	for (const record of records) {
		if (!record?.key || !record?.value) continue;
		const existing = await todoDB.get(record.key);
		if (existing) continue;

		await todoDB.put(record.key, record.value);
		updated = true;
	}

	if (updated || entries.length > 0 || records.length > 0) {
		await loadTodos();
	}

	return updated;
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

		await todoDB.put(todoId, todo);
		await announceTodoDatabaseEntries(todoDB);
		console.log('✅ Todo added:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error adding todo:', error);
		return false;
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
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(String(todoId), 10)];
				if (todo && todo.key) {
					actualTodoId = todo.key; // Use the key, not the hash
					console.log('🔍 Converted array index', todoId, 'to key:', actualTodoId);
				}
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(String(actualTodoId));
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		// Force a reload to ensure the UI is updated
		await loadTodos();

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
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(String(todoId), 10)];
				if (todo && todo.key) {
					actualTodoId = todo.key;
					console.log('🔍 Converted array index', todoId, 'to key:', actualTodoId);
				}
			}
		}

		const existingTodo = await todoDB.get(String(actualTodoId));
		console.log('🔍 Retrieved todo from database:', existingTodo); // Add this debug log

		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId, 'actual ID:', actualTodoId);
			// Let's also log all available todos to see what's in the database
			const allTodos = await todoDB.all();
			console.log('🔍 All available todos in database:', allTodos);
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

		await todoDB.put(String(actualTodoId), updatedTodo);
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

		await todoDB.put(todoId, updatedTodo);
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
	 *   announceTodoDatabaseEntries?: typeof announceTodoDatabaseEntries,
	 *   exportTodoDatabaseEntries?: typeof exportTodoDatabaseEntries,
	 *   importTodoDatabaseEntries?: typeof importTodoDatabaseEntries,
	 *   getTodoDatabaseAddress?: () => string,
	 *   getTodoDatabasePeerCount?: () => number,
	 *   getTodoCount?: () => number
	 * }} */ (window);

	browserWindow.deleteCurrentDatabase = deleteCurrentDatabase;
	browserWindow.forceReloadTodos = loadTodos;
	browserWindow.loadTodoDatabase = loadTodoDatabase;
	browserWindow.announceTodoDatabaseEntries = announceTodoDatabaseEntries;
	browserWindow.exportTodoDatabaseEntries = exportTodoDatabaseEntries;
	browserWindow.importTodoDatabaseEntries = importTodoDatabaseEntries;
	browserWindow.getTodoDatabaseAddress = () => getDatabaseAddress(get(todoDBStore));
	browserWindow.getTodoDatabasePeerCount = () => get(todoDBStore)?.peers?.size ?? 0;
	browserWindow.getTodoCount = () => get(todosCountStore);
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
