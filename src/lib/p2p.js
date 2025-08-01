import { writable } from 'svelte/store'

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import { createLibp2pConfig } from './libp2p-config.js'
import { formatPeerId } from './utils.js'
import { initializeDatabase } from './db-actions.js'

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

export const discoveredPeersStore = writable([]) 
let currentPeers = []
discoveredPeersStore.subscribe(peers => {
  currentPeers = peers
})
      
export const peerIdStore = writable(null)

let libp2p = null
let helia = null
let orbitdb = null

let peerId = null 
let todoDB = null

let discoveredPeersInfo = new Map()

const config = await createLibp2pConfig()
libp2p = await createLibp2p(config)
console.log(`✅ libp2p node created`)
setupPeerDiscoveryHandlers(libp2p)
peerId = libp2p.peerId.toString()
console.log(`✅ peerId is ${peerId}`)
peerIdStore.set(peerId)

helia = await createHelia({libp2p})
console.log(`✅ Helia created`)

console.log('🛬 Creating OrbitDB instance...')
orbitdb = await createOrbitDB({ ipfs: helia, id: 'simple-todo-app'})
todoDB = await orbitdb.open('todos', {
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
      const { id: peerId } = event.detail
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
}