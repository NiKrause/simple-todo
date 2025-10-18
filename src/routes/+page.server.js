import { getOrbitDBServer } from '../lib/server/orbitdb-server.js';

const orbitServer = getOrbitDBServer();

// Initialize server on first page load
let initPromise = null;

async function ensureInitialized() {
	if (!initPromise) {
		console.log('🚀 Initializing server-side OrbitDB for SSR...');
		initPromise = orbitServer.initialize({
			enableMDNS: false, // Disabled for browser compatibility
			port: 3000,
			serviceName: 'simple-todo'
		});
	}
	await initPromise;
}

export async function load({ url, request }) {
	try {
		await ensureInitialized();
		
		// Get todos from server-side OrbitDB
		const todos = await orbitServer.getTodos();
		const status = orbitServer.getStatus();
		
		console.log(`📋 SSR: Loaded ${todos.length} todos from server OrbitDB`);
		
		return {
			todos,
			serverStatus: status,
			mode: 'server',
			serverAvailable: true
		};
	} catch (error) {
		console.error('❌ SSR: Server OrbitDB initialization failed:', error);
		
		// Return empty state, let client handle fallback
		return {
			todos: [],
			serverStatus: null,
			mode: 'client-fallback',
			serverAvailable: false,
			error: error.message
		};
	}
}

// Form actions for server-side todo operations
export const actions = {
	addTodo: async ({ request }) => {
		try {
			await ensureInitialized();
			
			const data = await request.formData();
			const text = data.get('text');
			const assignee = data.get('assignee') || null;
			
			if (!text || text.trim() === '') {
				return {
					success: false,
					error: 'Todo text is required'
				};
			}
			
			const newTodo = await orbitServer.addTodo(text.trim(), assignee, 'server-user');
			console.log('✅ SSR: Todo added via form action:', newTodo.id);
			
			return {
				success: true,
				todo: newTodo
			};
		} catch (error) {
			console.error('❌ SSR: Add todo failed:', error);
			return {
				success: false,
				error: error.message
			};
		}
	},
	
	toggleTodo: async ({ request }) => {
		try {
			await ensureInitialized();
			
			const data = await request.formData();
			const todoId = data.get('id');
			
			if (!todoId) {
				return {
					success: false,
					error: 'Todo ID is required'
				};
			}
			
			const updatedTodo = await orbitServer.toggleTodo(todoId);
			console.log('✅ SSR: Todo toggled via form action:', todoId);
			
			return {
				success: true,
				todo: updatedTodo
			};
		} catch (error) {
			console.error('❌ SSR: Toggle todo failed:', error);
			return {
				success: false,
				error: error.message
			};
		}
	},
	
	deleteTodo: async ({ request }) => {
		try {
			await ensureInitialized();
			
			const data = await request.formData();
			const todoId = data.get('id');
			
			if (!todoId) {
				return {
					success: false,
					error: 'Todo ID is required'
				};
			}
			
			await orbitServer.deleteTodo(todoId);
			console.log('✅ SSR: Todo deleted via form action:', todoId);
			
			return {
				success: true
			};
		} catch (error) {
			console.error('❌ SSR: Delete todo failed:', error);
			return {
				success: false,
				error: error.message
			};
		}
	}
};
