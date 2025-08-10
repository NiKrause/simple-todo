import { writable } from 'svelte/store'

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createLibp2pConfig } from './libp2p-config.js'
import { formatPeerId } from './utils.js'
import { initializeDatabase } from './db-actions.js'

export const discoveredPeersStore = writable([]) 
let currentPeers = []
discoveredPeersStore.subscribe(peers => {
  currentPeers = peers
})
      
export const peerIdStore = writable(null)

// Add initialization state store
export const initializationStore = writable({ 
  isInitializing: false, 
  isInitialized: false, 
  error: null 
})

let libp2p = null
let helia = null
let orbitdb = null

let peerId = null 
let todoDB = null

let discoveredPeersInfo = new Map()

// Track transports by peer and connection
// Map<peerId, Map<connectionId, Set<transport>>>
let peerConnectionTransports = new Map()

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 */
export async function initializeP2P() {
  console.log('🚀 Starting P2P initialization after user consent...')
  
  try {
    // Set initialization state
    initializationStore.set({ isInitializing: true, isInitialized: false, error: null })
    
    // Create libp2p configuration and node
    const config = await createLibp2pConfig()
    libp2p = await createLibp2p(config)
    console.log(`✅ libp2p node created`)
    
    // Set up peer discovery handlers
    setupPeerDiscoveryHandlers(libp2p)
    
    // Get and set peer ID
    peerId = libp2p.peerId.toString()
    console.log(`✅ peerId is ${peerId}`)
    peerIdStore.set(peerId)
    
    // Create Helia (IPFS) instance
    helia = await createHelia({libp2p})
    console.log(`✅ Helia created`)
    
    // Create OrbitDB instance
    console.log('🛬 Creating OrbitDB instance...')
    orbitdb = await createOrbitDB({ ipfs: helia, id: 'simple-todo-app'})
    todoDB = await orbitdb.open('simple-todos', {
        type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
        create: true, // Allows the database to be created if it doesn't exist
        sync: true, // Enables automatic synchronization with other peers
        AccessController: IPFSAccessController({write: ["*"]}) //defines who can write to the database, ["*"] is a wildcard that allows all peers to write to the database, This creates a fully collaborative environment where any peer can add/edit TODOs
    });
      
    console.log('✅ Database opened successfully with OrbitDBAccessController:', {
            address: todoDB.address,
            type: todoDB.type,
            accessController: todoDB.access
    });
    
    // Initialize database stores and actions
    await initializeDatabase(orbitdb, todoDB)
    
    // Mark initialization as complete
    initializationStore.set({ isInitializing: false, isInitialized: true, error: null })
    console.log('🎉 P2P initialization completed successfully!')
    
  } catch (error) {
    console.error('❌ Failed to initialize P2P:', error)
    initializationStore.set({ 
      isInitializing: false, 
      isInitialized: false, 
      error: error.message 
    })
    throw error
  }
}



/**
 * Set up peer discovery event handlers and auto-dialing
 */
export function setupPeerDiscoveryHandlers(node) {
    console.log('🔍 Setting up peer discovery event handlers...')
    
    // Handle peer discovery events
    node.addEventListener('peer:discovery', async (event) => {
      const { id: peerId, multiaddrs } = event.detail
      const peerIdStr = peerId?.toString()
      
      console.log(' Peer discovered:', formatPeerId(peerIdStr), 'Addresses:', multiaddrs.map(ma => ma.toString()))
      
      // Skip if we've already discovered this peer recently
      if (currentPeers.some(peer => peer.peerId === peerIdStr)) {
        console.log('⏭️ Peer already discovered, skipping:', formatPeerId(peerIdStr))
        return
      }
      
      // Skip if we're already connected to this peer
      const existingConnections = node.getConnections(peerId)
      if (existingConnections && existingConnections.length > 0) {
        console.log('🔗 Already connected to peer:', formatPeerId(peerIdStr))
        return
      }
      
      // Extract transport protocols from multiaddrs
      const detectedTransports = extractTransportsFromMultiaddrs(multiaddrs)
      console.log('🚀 Detected transports for peer:', formatPeerId(peerIdStr), 'Transports:', detectedTransports)
      
        // Store the peer info for later use when connection succeeds
        discoveredPeersInfo.set(peerIdStr, {
            peerId: peerIdStr,
            transports: detectedTransports,
            multiaddrs: multiaddrs
        })
      
      // Only attempt to dial the discovered peer (don't add to store yet)
      try {
        console.log(' Attempting to dial discovered peer:', formatPeerId(peerIdStr))
        const connection = await node.dial(peerId)
        if (connection) {
          console.log('✅ Successfully connected to peer:', formatPeerId(peerIdStr))
          // Connection will be handled by the peer:connect event
        }
        
      } catch (error) {
        console.warn('❌ Failed to connect to discovered peer:', formatPeerId(peerIdStr), 'Error:', error.message)
        // Remove from temporary storage if connection failed
        discoveredPeersInfo.delete(peerIdStr)
      }
    })

    // Handle successful peer connections
    node.addEventListener('peer:connect', (event) => {
      console.log(' Peer connect event received:', event.detail)
      
      // The event.detail is the actual peer ID object
      const peerId = event.detail
      const peerIdStr = peerId?.toString()
      
      console.log('🔗 Peer connected:', formatPeerId(peerIdStr), 'Raw event detail:', event.detail)
      
      if (!peerIdStr) {
        console.warn('❌ Could not extract peer ID from connect event')
        return
      }
      
      // Only add to store when successfully connected
      const existingPeer = currentPeers.find(peer => peer.peerId === peerIdStr)
      if (!existingPeer) {
        // Get the stored peer info from discovery
        const storedPeerInfo = discoveredPeersInfo.get(peerIdStr)
        
        if (storedPeerInfo) {
          const peerObject = createPeerObject(peerIdStr, storedPeerInfo.transports)
          discoveredPeersStore.update(peers => [...peers, peerObject])
          console.log('📝 Added connected peer to store:', formatPeerId(peerIdStr), 'with transports:', storedPeerInfo.transports)
          
          // Clean up the temporary storage
          discoveredPeersInfo.delete(peerIdStr)
        } else {
          // Fallback: create peer object with default transports if no stored info
          const peerObject = createPeerObject(peerIdStr, ['webrtc'])
          discoveredPeersStore.update(peers => [...peers, peerObject])
          console.log('📝 Added connected peer to store (fallback):', formatPeerId(peerIdStr))
        }
      }
    })

    // Handle peer disconnect events
    node.addEventListener('peer:disconnect', (event) => {
      // Handle both old and new event formats
      const peerId = event.detail.id || event.detail
      const peerIdStr = peerId?.toString()
      
      console.log('🔌 Peer disconnected:', formatPeerId(peerIdStr))
      
      // Remove the peer from the discovered peers store
      discoveredPeersStore.update(peers => 
        peers.filter(peer => peer.peerId !== peerIdStr)
      )
      
      // Also clean up temporary storage
      discoveredPeersInfo.delete(peerIdStr)
      
      console.log('📊 Updated peer list after disconnect')
    })
    
    // Handle individual connection open events to track transport upgrades
    node.addEventListener('connection:open', (event) => {
      const connection = event.detail
      const peerIdStr = connection.remotePeer?.toString()
      
      if (!peerIdStr) {
        console.warn('❌ Could not extract peer ID from connection:open event')
        return
      }
      
      const connectionId = connection.id
      const remoteAddr = connection.remoteAddr?.toString() || 'unknown'
      
      console.log('🔗 Connection opened:', formatPeerId(peerIdStr), 'Remote multiaddr:', remoteAddr, 'Connection ID:', connectionId)
      
      // Extract transports from this specific connection
      const connectionTransports = extractTransportsFromConnection(connection)
      
      if (connectionTransports.length > 0) {
        // Track transports for this specific connection
        if (!peerConnectionTransports.has(peerIdStr)) {
          peerConnectionTransports.set(peerIdStr, new Map())
        }
        peerConnectionTransports.get(peerIdStr).set(connectionId, new Set(connectionTransports))
        
        // Update the peer's transport list in the store
        updatePeerTransports(peerIdStr)
        
        console.log('🔄 Added connection transports:', formatPeerId(peerIdStr), 'Connection:', connectionId, 'Transports:', connectionTransports)
      }
    })
    
    // Handle individual connection close events
    node.addEventListener('connection:close', (event) => {
      const connection = event.detail
      const peerIdStr = connection.remotePeer?.toString()
      
      if (!peerIdStr) return
      
      const connectionId = connection.id
      const remoteAddr = connection.remoteAddr?.toString() || 'unknown'
      
      console.log('🔌 Connection closed:', formatPeerId(peerIdStr), 'Remote multiaddr:', remoteAddr, 'Connection ID:', connectionId)
      
      // Remove transports for this specific connection
      if (peerConnectionTransports.has(peerIdStr)) {
        const peerConnections = peerConnectionTransports.get(peerIdStr)
        if (peerConnections.has(connectionId)) {
          const removedTransports = Array.from(peerConnections.get(connectionId))
          peerConnections.delete(connectionId)
          
          console.log('🗑️ Removed connection transports:', formatPeerId(peerIdStr), 'Connection:', connectionId, 'Transports:', removedTransports)
          
          // Update the peer's transport list in the store
          updatePeerTransports(peerIdStr)
          
          // Clean up if no more connections for this peer
          if (peerConnections.size === 0) {
            peerConnectionTransports.delete(peerIdStr)
          }
        }
      }
      
      // Check if this peer still has other connections
      const remainingConnections = node.getConnections(connection.remotePeer)
      if (remainingConnections.length === 0) {
        console.log('🔌 No more connections to peer:', formatPeerId(peerIdStr))
      }
    })
}

// Define the peer object type
const createPeerObject = (peerId, transports = ['webrtc']) => ({
  peerId,
  transports
})

// Helper function to extract transport protocols from multiaddrs
/**
 * @param {any[]} multiaddrs - Array of multiaddr objects
 * @returns {string[]} Array of transport protocol names
 */
const extractTransportsFromMultiaddrs = (multiaddrs) => {
  const transports = new Set()
  
  multiaddrs.forEach((multiaddr) => {
    const addrStr = multiaddr.toString()
    
    // Extract transport protocols from multiaddr string
    if (addrStr.includes('/webrtc')) {
      transports.add('webrtc')
    }
    if (addrStr.includes('/ws') || addrStr.includes('/wss')) {
      transports.add('websocket')
    }
    if (addrStr.includes('/webtransport')) {
      transports.add('webtransport')
    }
    if (addrStr.includes('/p2p-circuit')) {
      transports.add('circuit-relay')
    }
    if (addrStr.includes('/tcp/') && (addrStr.includes('/ws') || addrStr.includes('/wss'))) {
      transports.add('websocket')
    }
  })
  
  return Array.from(transports)
}

// Helper function to update peer transports based on active connections
/**
 * @param {string} peerIdStr - The peer ID string
 */
const updatePeerTransports = (peerIdStr) => {
  const peerIndex = currentPeers.findIndex(peer => peer.peerId === peerIdStr)
  if (peerIndex === -1) {
    return // Peer not in store yet
  }
  
  // Collect all active transports from all connections for this peer
  const allTransports = new Set()
  
  if (peerConnectionTransports.has(peerIdStr)) {
    const peerConnections = peerConnectionTransports.get(peerIdStr)
    for (const [connectionId, connectionTransports] of peerConnections) {
      for (const transport of connectionTransports) {
        allTransports.add(transport)
      }
    }
  }
  
  const finalTransports = Array.from(allTransports)
  
  // Update the store with current active transports
  discoveredPeersStore.update(peers => {
    const updatedPeers = [...peers]
    updatedPeers[peerIndex] = {
      ...updatedPeers[peerIndex],
      transports: finalTransports
    }
    return updatedPeers
  })
  
  console.log('🔄 Updated peer transports:', formatPeerId(peerIdStr), 'Active transports:', finalTransports)
}

// Helper function to extract transport protocols from a connection object
/**
 * @param {Connection} connection - libp2p Connection object
 * @returns {string[]} Array of transport protocol names
 */
const extractTransportsFromConnection = (connection) => {
  const transports = new Set()
  
  if (!connection.remoteAddr) {
    return []
  }
  
  const addrStr = connection.remoteAddr.toString()
  
  // Extract transport protocols from the connection's remote address
  // Priority order: most specific first
  
  // Direct WebRTC connection
  if (addrStr.includes('/webrtc') && !addrStr.includes('/p2p-circuit')) {
    transports.add('webrtc')
  }
  // Circuit relay connection  
  else if (addrStr.includes('/p2p-circuit')) {
    transports.add('circuit-relay')
  }
  // WebTransport
  else if (addrStr.includes('/webtransport')) {
    transports.add('webtransport')
  }
  // WebSocket - only for direct WS connections, not relay paths
  else if ((addrStr.includes('/ws') || addrStr.includes('/wss')) && !addrStr.includes('/p2p-circuit')) {
    transports.add('websocket')
  }
  // TCP (fallback)
  else if (addrStr.includes('/tcp/')) {
    transports.add('tcp')
  }
  
  return Array.from(transports)
}
