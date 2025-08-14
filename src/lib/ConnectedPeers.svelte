<script>
  import { formatPeerId } from './utils.js'
  import TransportBadge from './TransportBadge.svelte'
  
  export let peers = []
  export let title = 'Connected Peers'
  export let emptyMessage = 'No peers connected yet.'
  export let showOnlineIndicator = true
</script>

<div class="bg-white rounded-lg shadow-md p-6">
  <h2 class="text-xl font-semibold mb-4">{title} ({peers.length})</h2>
  {#if peers.length > 0}
    <div class="space-y-2">
      {#each peers as peer}
        <div class="flex items-center space-x-2">
          {#if showOnlineIndicator}
            <div class="w-2 h-2 bg-green-500 rounded-full" title="Online"></div>
          {/if}
          <code class="text-sm bg-gray-100 px-2 py-1 rounded">{formatPeerId(peer.peerId)}</code>
          {#each peer.transports as transport}
            <TransportBadge {transport} />
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-gray-500">{emptyMessage}</p>
  {/if}
</div>
