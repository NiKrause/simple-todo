<script>
    import { discoveredPeersStore, peerIdStore, initializeP2P, initializationStore } from '$lib/p2p.js'
    import { todosStore, addTodo, deleteTodo, toggleTodoComplete } from '$lib/db-actions.js'
    import { formatPeerId } from '$lib/utils'
    import ConsentModal from '$lib/ConsentModal.svelte'
    import SocialIcons from '$lib/SocialIcons.svelte'

    let toastMessage = null
    // let __APP_VERSION__
    let error = null
    let inputText = ''
    let myPeerId = null
    
    // Modal state
    let showModal = true
    let checkboxes = {
        relayConnection: {
            label: "I understand that this todo application is a demo app and will connect to a relay node",
            checked: false
        },
        dataVisibility: {
            label: "I understand that the relay may store the entered data, making it visible to other users for demo purposes",
            checked: false
        },
        globalDatabase: {
            label: "I understand that this todo application works with one global unencrypted database for all users which is visible to others testing this app simultaneously",
            checked: false
        },
        replicationTesting: {
            label: "I understand that I need to open a second browser or mobile device with the same web address to test the replication functionality",
            checked: false
        }
    }
    
    const handleModalClose = async () => {
        showModal = false
        // Initialize P2P after user consent
        try {
            await initializeP2P()
        } catch (err) {
            error = `Failed to initialize P2P: ${err.message}`
            console.error('P2P initialization failed:', err)
        }
    }
  
    const handleAddTodo = async () => {
        if (!inputText || inputText.trim() === '') return
        
        const success = await addTodo(inputText.trim())
        if (success) {
            inputText = ''
            toastMessage = '✅ Todo added successfully!'
            setTimeout(() => toastMessage = null, 3000)
        } else {
            toastMessage = '❌ Failed to add todo'
            setTimeout(() => toastMessage = null, 3000)
        }
    }
    
    const handleDelete = async (todoId) => {
        const success = await deleteTodo(todoId)
        if (success) {
            toastMessage = '🗑️ Todo deleted successfully!'
            setTimeout(() => toastMessage = null, 3000)
        } else {
            toastMessage = '❌ Failed to delete todo'
            setTimeout(() => toastMessage = null, 3000)
        }
    }

    const handleToggleComplete = async (todoId) => {
        const success = await toggleTodoComplete(todoId)
        if (success) {
            toastMessage = '✅ Todo status updated!'
            setTimeout(() => toastMessage = null, 3000)
        } else {
            toastMessage = '❌ Failed to update todo'
            setTimeout(() => toastMessage = null, 3000)
        }
    }

    // Subscribe to the peerIdStore
    $: myPeerId = $peerIdStore

  </script>
  
  {#if toastMessage}
    <div class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300">
      {toastMessage}
    </div>
  {/if}
  
  <svelte:head>
    <title>Simple TODO Example {__APP_VERSION__}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p">
  </svelte:head>
  
  <!-- Welcome Modal -->
  <ConsentModal 
    bind:show={showModal}
    title="Simple TODO Example"
    description="This is a web application that:"
    features={[
        "Does not store any cookies or perform any tracking",
        "Does not store any data in your browser's storage",
        "Stores data temporarily in your browser's memory only",
        "Does not use any application or database server for entered or personal data",
        "Connects to at least one relay server (in this demo, only 1 relay server)",
        "The relay server may cache your entered data, making it visible to other users",
        "For decentralization purposes, this web app is hosted on the IPFS network"
    ]}
    bind:checkboxes
    proceedButtonText="Proceed to Test the App"
    disabledButtonText="Please check all boxes to continue"
    on:proceed={handleModalClose}
  />
  
  <main class="container mx-auto p-6 max-w-4xl">
    <!-- Header with title and social icons -->
    <header class="flex items-center justify-between mb-6">
      <div class="flex-1">
        <h1 class="text-3xl font-bold text-gray-800">Simple TODO Example</h1>
        <p class="text-sm text-gray-500 mt-1">v{__APP_VERSION__} • Decentralized P2P Todo App</p>
      </div>
      <div class="flex-shrink-0">
        <SocialIcons size="w-5 h-5" className="" />
      </div>
    </header>
  
    {#if $initializationStore.isInitializing}
      <div class="text-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p class="mt-4 text-gray-600">Initializing P2P connection...</p>
        <p class="mt-2 text-xs text-gray-400">Please wait while we set up the network...</p>
        <p class="mt-2 text-xs text-gray-400">v{__APP_VERSION__}</p>
      </div>
    {:else if error || $initializationStore.error}
      <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
        Error: {error || $initializationStore.error}
      </div>
    {:else}
      <!-- Add TODO Form -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4">Add New TODO</h2>
        <div class="space-y-4">
          <input
            type="text"
            bind:value={inputText}
            placeholder="What needs to be done?"
            class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            on:keydown={(e) => e.key === 'Enter' && handleAddTodo()}
          />
          <div class="flex gap-2">
            <button 
              on:click={handleAddTodo} 
              class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
            >
              Add TODO
            </button>
          </div>
        </div>
      </div>
  
      <!-- TODO List -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4">TODO Items ({$todosStore.length})</h2>
        {#if $todosStore.length > 0}
          <div class="space-y-3">
            {#each $todosStore as { id, text, completed, assignee, createdBy, key }}
              <div class="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50">
                <div class="flex items-center space-x-3 flex-1">
                  <input 
                    type="checkbox" 
                    checked={completed} 
                    on:change={() => handleToggleComplete(key)} 
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
                    on:click={() => handleDelete(key)} 
                    class="text-red-500 hover:text-red-700 px-3 py-1 rounded-md transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-gray-500 text-center py-8">No TODOs yet. Add one above!</p>
        {/if}
      </div>
  
      <!-- P2P Status -->
      <div class="grid md:grid-cols-2 gap-6">
        <!-- Connected Peers -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">Connected Peers ({$discoveredPeersStore.length})</h2>
          {#if $discoveredPeersStore.length > 0}
            <div class="space-y-2">
              {#each $discoveredPeersStore as peer}
                <div class="flex items-center space-x-2">
                  <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                  <code class="text-sm bg-gray-100 px-2 py-1 rounded">{formatPeerId(peer.peerId)}</code>
                  {#each peer.transports as type}
                    {#if type === 'webrtc'}
                      <span class="badge bg-green-200 text-green-800">WebRTC</span>
                    {:else if type === 'circuit-relay'}
                      <span class="badge bg-blue-200 text-blue-800">Relay</span>
                    {:else if type === 'websocket'}
                      <span class="badge bg-purple-200 text-purple-800">WS</span>
                    {:else}
                      <span class="badge bg-gray-200 text-gray-800">{type}</span>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-gray-500">No peers connected yet.</p>
          {/if}
        </div>
  
        <!-- My Identity -->
        <div class="bg-white rounded-lg shadow-md p-6">
          <h2 class="text-xl font-semibold mb-4">My Peer ID</h2>
          {#if myPeerId}
            <div class="bg-blue-50 p-3 rounded-md">
              <code class="text-sm font-mono break-all">{formatPeerId(myPeerId)}</code>
            </div>
            <p class="text-sm text-gray-600 mt-2">Share this ID with others to assign TODOs to you.</p>
          {:else}
            <p class="text-gray-500">Loading...</p>
          {/if}
        </div>
      </div>
  
      {/if}
    </main>
  

  