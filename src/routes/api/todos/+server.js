import { json } from '@sveltejs/kit';
import { getOrbitDBServer } from '../../../lib/server/orbitdb-server.js';

const orbitServer = getOrbitDBServer();

// Initialize server on first API call
let initPromise = null;

async function ensureInitialized() {
	if (!initPromise) {
		initPromise = orbitServer.initialize({
			enableMDNS: true,
			port: 3000,
			serviceName: 'simple-todo'
		});
	}
	await initPromise;
}

export async function GET() {
	try {
		await ensureInitialized();
		const todos = await orbitServer.getTodos();
		return json({ todos, success: true });
	} catch (error) {
		console.error('❌ API: Error getting todos:', error);
		return json({ error: error.message, success: false }, { status: 500 });
	}
}

export async function POST({ request }) {
	try {
		await ensureInitialized();
		const { text, assignee, createdBy } = await request.json();

		if (!text || text.trim() === '') {
			return json({ error: 'Todo text is required', success: false }, { status: 400 });
		}

		const newTodo = await orbitServer.addTodo(text, assignee, createdBy);
		return json({ todo: newTodo, success: true });
	} catch (error) {
		console.error('❌ API: Error adding todo:', error);
		return json({ error: error.message, success: false }, { status: 500 });
	}
}

export async function PATCH({ request }) {
	try {
		await ensureInitialized();
		const { id, action, assignee } = await request.json();

		if (!id) {
			return json({ error: 'Todo ID is required', success: false }, { status: 400 });
		}

		let updatedTodo;
		
		if (action === 'toggle') {
			updatedTodo = await orbitServer.toggleTodo(id);
		} else if (action === 'assignee') {
			updatedTodo = await orbitServer.updateTodoAssignee(id, assignee);
		} else {
			return json({ error: 'Invalid action', success: false }, { status: 400 });
		}

		return json({ todo: updatedTodo, success: true });
	} catch (error) {
		console.error('❌ API: Error updating todo:', error);
		return json({ error: error.message, success: false }, { status: 500 });
	}
}

export async function DELETE({ request }) {
	try {
		await ensureInitialized();
		const { id } = await request.json();

		if (!id) {
			return json({ error: 'Todo ID is required', success: false }, { status: 400 });
		}

		await orbitServer.deleteTodo(id);
		return json({ success: true });
	} catch (error) {
		console.error('❌ API: Error deleting todo:', error);
		return json({ error: error.message, success: false }, { status: 500 });
	}
}