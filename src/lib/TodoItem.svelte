<script>
	import { createEventDispatcher } from 'svelte';
	import { formatPeerId } from './utils.js';
	import { hybridMode } from './hybrid-mode.js';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	export let text;
	export let completed = false;
	export let assignee = null;
	export let createdBy;
	export let todoKey;

	const dispatch = createEventDispatcher();
	
	// Track current mode
	let currentMode = 'server';
	
	if (browser) {
		hybridMode.subscribe(state => {
			currentMode = state.mode;
		});
	}

	function handleToggleComplete() {
		// In client mode, use event dispatcher
		if (currentMode === 'client') {
			dispatch('toggleComplete', { key: todoKey });
		}
		// In server mode, the form submission will handle it
	}

	function handleDelete() {
		// In client mode, use event dispatcher  
		if (currentMode === 'client') {
			dispatch('delete', { key: todoKey });
		}
		// In server mode, the form submission will handle it
	}
	
	// Progressive enhancement for server mode forms
	const enhanceToggle = ({ formData, cancel }) => {
		if (currentMode !== 'server') {
			cancel(); // Don't submit if not in server mode
			return;
		}
		
		console.log('🖥️ Enhancing toggle form submission (no page reload)');
		
		return async ({ result }) => {
			if (result.type === 'success') {
				// Try to use the global refresh function, fallback to invalidateAll
				if (typeof window !== 'undefined' && window.refreshTodosFromServer) {
					await window.refreshTodosFromServer();
				} else {
					// Fallback to invalidateAll
					await invalidateAll();
				}
				console.log('✅ Todo toggled via enhanced form (no reload)');
			} else {
				console.error('❌ Form submission failed:', result);
			}
		};
	};
	
	const enhanceDelete = ({ formData, cancel }) => {
		if (currentMode !== 'server') {
			cancel(); // Don't submit if not in server mode
			return;
		}
		
		console.log('🖥️ Enhancing delete form submission (no page reload)');
		
		return async ({ result }) => {
			if (result.type === 'success') {
				// Try to use the global refresh function, fallback to invalidateAll
				if (typeof window !== 'undefined' && window.refreshTodosFromServer) {
					await window.refreshTodosFromServer();
				} else {
					// Fallback to invalidateAll
					await invalidateAll();
				}
				console.log('✅ Todo deleted via enhanced form (no reload)');
			} else {
				console.error('❌ Form submission failed:', result);
			}
		};
	};
</script>

<div
	class="flex items-center justify-between rounded-md border border-gray-200 p-3 hover:bg-gray-50"
>
	<div class="flex flex-1 items-center space-x-3">
		{#if currentMode === 'server'}
			<!-- Server mode: Use enhanced form submission (no page reload) -->
			<form method="POST" action="?/toggleTodo" class="inline" use:enhance={enhanceToggle}>
				<input type="hidden" name="id" value={todoKey} />
				<input
					type="checkbox"
					checked={completed}
					on:change={(e) => e.target.form.requestSubmit()}
					class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
				/>
			</form>
		{:else}
			<!-- Client mode: Use event dispatcher -->
			<input
				type="checkbox"
				checked={completed}
				on:change={handleToggleComplete}
				class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
			/>
		{/if}
		<div class="flex-1">
			<span class={completed ? 'text-gray-500 line-through' : 'text-gray-800'}>
				{text}
			</span>
			<div class="mt-1 text-sm text-gray-500">
				{#if assignee}
					Assigned to: <code class="rounded bg-gray-100 px-1">{formatPeerId(assignee)}</code>
				{:else}
					<span class="text-orange-600">Unassigned</span>
				{/if}
				• Created by: <code class="rounded bg-gray-100 px-1">{formatPeerId(createdBy)}</code>
			</div>
		</div>
	</div>
	<div class="flex space-x-2">
		{#if currentMode === 'server'}
			<!-- Server mode: Use enhanced form submission (no page reload) -->
			<form method="POST" action="?/deleteTodo" class="inline" use:enhance={enhanceDelete}>
				<input type="hidden" name="id" value={todoKey} />
				<button
					type="submit"
					class="rounded-md px-3 py-1 text-red-500 transition-colors hover:text-red-700"
				>
					Delete
				</button>
			</form>
		{:else}
			<!-- Client mode: Use event dispatcher -->
			<button
				on:click={handleDelete}
				class="rounded-md px-3 py-1 text-red-500 transition-colors hover:text-red-700"
			>
				Delete
			</button>
		{/if}
	</div>
</div>
