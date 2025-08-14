<script>
  import { createEventDispatcher } from 'svelte'
  import { formatPeerId } from './utils.js'
  
  export let id
  export let text
  export let completed = false
  export let assignee = null
  export let createdBy
  export let todoKey
  
  const dispatch = createEventDispatcher()
  
  function handleToggleComplete() {
    dispatch('toggleComplete', { key: todoKey })
  }
  
  function handleDelete() {
    dispatch('delete', { key: todoKey })
  }
</script>

<div class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
  <div class="flex items-center space-x-3 flex-1">
    <input 
      type="checkbox" 
      checked={completed} 
      on:change={handleToggleComplete}
      class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
    />
    <div class="flex-1">
      <span class={completed ? 'line-through text-gray-500' : 'text-gray-800'}>
        {text}
      </span>
      <div class="text-sm text-gray-500 mt-1">
        {#if assignee}
          Assigned to: <code class="bg-gray-100 px-1 rounded">{formatPeerId(assignee)}</code>
        {:else}
          <span class="text-orange-600">Unassigned</span>
        {/if}
        • Created by: <code class="bg-gray-100 px-1 rounded">{formatPeerId(createdBy)}</code>
      </div>
    </div>
  </div>
  <div class="flex space-x-2">
    <button 
      on:click={handleDelete}
      class="text-red-500 hover:text-red-700 px-3 py-1 rounded-md transition-colors"
    >
      Delete
    </button>
  </div>
</div>
