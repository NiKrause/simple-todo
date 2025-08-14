/**
 * Storacha Backup Utilities for Simple-Todo OrbitDB
 * 
 * Adapted from orbitdb-storacha-bridge for browser environment
 */

import * as Client from '@web3-storage/w3up-client'
import { StoreMemory } from '@web3-storage/w3up-client/stores/memory'
import * as Proof from '@web3-storage/w3up-client/proof'
import { Signer } from '@web3-storage/w3up-client/principal/ed25519'
import { CID } from 'multiformats/cid'
import * as Block from 'multiformats/block'
import * as dagCbor from '@ipld/dag-cbor'
import { sha256 } from 'multiformats/hashes/sha2'
import { bases } from 'multiformats/basics'
import { get } from 'svelte/store'
import { orbitdbStore, todoDBStore } from './db-actions.js'

/**
 * Convert Storacha CID format to OrbitDB CID format
 */
export function convertStorachaCIDToOrbitDB(storachaCID) {
  const storachaParsed = CID.parse(storachaCID)
  const orbitdbCID = CID.createV1(0x71, storachaParsed.multihash) // 0x71 = dag-cbor
  return orbitdbCID.toString(bases.base58btc)
}

/**
 * Extract all blocks from the current OrbitDB database
 */
export async function extractDatabaseBlocks() {
  console.log('🔍 Extracting all blocks from current todo database...')
  
  const todoDB = get(todoDBStore)
  if (!todoDB) {
    throw new Error('No todo database available')
  }
  
  const blocks = new Map()
  const blockSources = new Map()
  
  // 1. Get all log entries
  const entries = await todoDB.log.values()
  console.log(`   Found ${entries.length} log entries`)
  
  for (const entry of entries) {
    try {
      const entryBytes = await todoDB.log.storage.get(entry.hash)
      if (entryBytes) {
        const entryCid = CID.parse(entry.hash)
        blocks.set(entry.hash, { cid: entryCid, bytes: entryBytes })
        blockSources.set(entry.hash, 'log_entry')
        console.log(`   ✓ Entry block: ${entry.hash}`)
      }
    } catch (error) {
      console.warn(`   ⚠️ Failed to get entry ${entry.hash}: ${error.message}`)
    }
  }
  
  // 2. Get database manifest
  const addressParts = todoDB.address.split('/')
  const manifestCID = addressParts[addressParts.length - 1]
  
  try {
    const manifestBytes = await todoDB.log.storage.get(manifestCID)
    if (manifestBytes) {
      const manifestParsedCid = CID.parse(manifestCID)
      blocks.set(manifestCID, { cid: manifestParsedCid, bytes: manifestBytes })
      blockSources.set(manifestCID, 'manifest')
      console.log(`   ✓ Manifest block: ${manifestCID}`)
      
      // Try to get access controller
      try {
        const manifestBlock = await Block.decode({
          cid: manifestParsedCid,
          bytes: manifestBytes,
          codec: dagCbor,
          hasher: sha256
        })
        
        if (manifestBlock.value.accessController) {
          const accessControllerCID = manifestBlock.value.accessController.replace('/ipfs/', '')
          try {
            const accessBytes = await todoDB.log.storage.get(accessControllerCID)
            if (accessBytes) {
              const accessParsedCid = CID.parse(accessControllerCID)
              blocks.set(accessControllerCID, { cid: accessParsedCid, bytes: accessBytes })
              blockSources.set(accessControllerCID, 'access_controller')
              console.log(`   ✓ Access controller: ${accessControllerCID}`)
            }
          } catch (error) {
            console.warn(`   ⚠️ Could not get access controller: ${error.message}`)
          }
        }
      } catch (error) {
        console.warn(`   ⚠️ Could not decode manifest: ${error.message}`)
      }
    }
  } catch (error) {
    console.warn(`   ⚠️ Could not get manifest: ${error.message}`)
  }
  
  // 3. Get identity blocks
  console.log(`   🔍 Extracting identity blocks...`)
  const identityBlocks = new Set()
  
  for (const entry of entries) {
    if (entry.identity) {
      identityBlocks.add(entry.identity)
    }
  }
  
  for (const identityHash of identityBlocks) {
    try {
      const identityBytes = await todoDB.log.storage.get(identityHash)
      if (identityBytes) {
        const identityParsedCid = CID.parse(identityHash)
        blocks.set(identityHash, { cid: identityParsedCid, bytes: identityBytes })
        blockSources.set(identityHash, 'identity')
        console.log(`   ✓ Identity block: ${identityHash}`)
      }
    } catch (error) {
      console.warn(`   ⚠️ Could not get identity ${identityHash}: ${error.message}`)
    }
  }
  
  console.log(`   📊 Extracted ${blocks.size} total blocks`)
  return { blocks, blockSources, manifestCID }
}

/**
 * Initialize Storacha client with credentials
 */
export async function initializeStorachaClient(storachaKey, storachaProof) {
  try {
    console.log('🔐 Initializing Storacha client with provided credentials...')
    
    const principal = Signer.parse(storachaKey)
    const store = new StoreMemory()
    const client = await Client.create({ principal, store })
    
    console.log('✅ Client created with principal:', principal.did())
    
    const proof = await Proof.parse(storachaProof)
    console.log('✅ Proof parsed successfully')
    
    const space = await client.addSpace(proof)
    console.log('✅ Space added:', space.did())
    
    await client.setCurrentSpace(space.did())
    console.log('✅ Current space set')
    
    return client
  } catch (error) {
    console.error('❌ Failed to initialize Storacha client:', error)
    throw error
  }
}

/**
 * Create new Storacha account with email
 */
export async function createStorachaAccount(email) {
  try {
    console.log('🌟 Creating new Storacha account with email:', email)
    
    const client = await Client.create()
    
    // Generate login with email
    const account = await client.login(email)
    
    console.log('✅ Account created successfully!')
    console.log('📧 Please check your email for verification link')
    
    return {
      success: true,
      message: 'Please check your email and click the verification link. Then come back and use the "Login with existing credentials" option.',
      client,
      account
    }
  } catch (error) {
    console.error('❌ Failed to create account:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * List spaces for authenticated client
 */
export async function listSpaces(client) {
  try {
    console.log('📋 Listing available spaces...')
    
    // Check if client has a current space (which means it was initialized with credentials)
    const currentSpace = client.currentSpace()
    if (currentSpace) {
      console.log('✅ Using current space from credentials:', currentSpace.did())
      
      // Handle different space object types - currentSpace might not have registered() method
      let registered = false
      try {
        registered = typeof currentSpace.registered === 'function' ? currentSpace.registered() : false
      } catch (err) {
        console.log('🔍 currentSpace.registered() not available, defaulting to false')
        registered = false
      }
      
      return [{
        did: currentSpace.did(),
        name: currentSpace.name || 'Current Space',
        registered: registered,
        current: true
      }]
    }
    
    // Otherwise try to get accounts (for email-based login)
    const accounts = client.accounts()
    if (accounts.length === 0) {
      console.warn('⚠️ No accounts found - this might be expected for credential-based login')
      return []
    }
    
    // List spaces from first account
    const account = accounts[0]
    const spaces = []
    for (const space of account.spaces()) {
      spaces.push({
        did: space.did(),
        name: space.name || 'Unnamed Space',
        registered: space.registered()
      })
    }
    
    console.log(`✅ Found ${spaces.length} spaces`)
    return spaces
  } catch (error) {
    console.error('❌ Failed to list spaces:', error)
    throw error
  }
}

/**
 * Create a new space
 */
export async function createSpace(client, spaceName) {
  try {
    console.log(`🌟 Creating new space: ${spaceName}`)
    
    const space = await client.createSpace(spaceName)
    console.log('✅ Space created:', space.did())
    
    return {
      success: true,
      space: {
        did: space.did(),
        name: spaceName,
        registered: space.registered()
      }
    }
  } catch (error) {
    console.error('❌ Failed to create space:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Upload blocks to Storacha
 */
export async function uploadBlocksToStoracha(blocks, client) {
  console.log(`📤 Uploading ${blocks.size} blocks to Storacha...`)
  
  const uploadResults = []
  const cidMappings = new Map()
  
  for (const [hash, blockData] of blocks) {
    try {
      const blockFile = new File([blockData.bytes], hash, {
        type: 'application/octet-stream'
      })
      
      console.log(`   📤 Uploading block ${hash} (${blockData.bytes.length} bytes)...`)
      
      const result = await client.uploadFile(blockFile)
      const uploadedCID = result.toString()
      
      console.log(`   ✅ Uploaded: ${hash} → ${uploadedCID}`)
      
      cidMappings.set(hash, uploadedCID)
      
      uploadResults.push({
        originalHash: hash,
        uploadedCID,
        size: blockData.bytes.length
      })
      
    } catch (error) {
      console.error(`   ❌ Failed to upload block ${hash}: ${error.message}`)
      uploadResults.push({
        originalHash: hash,
        error: error.message,
        size: blockData.bytes.length
      })
    }
  }
  
  const successful = uploadResults.filter(r => r.uploadedCID)
  const failed = uploadResults.filter(r => r.error)
  
  console.log(`   📊 Upload summary:`)
  console.log(`      Successful: ${successful.length}`)
  console.log(`      Failed: ${failed.length}`)
  
  return { uploadResults, successful, failed, cidMappings }
}

/**
 * Create backup metadata file
 */
export async function createBackupMetadata(manifestCID, databaseAddress, databaseName, blockSummary, cidMappings) {
  const metadata = {
    backupVersion: '1.0',
    timestamp: new Date().toISOString(),
    databaseInfo: {
      manifestCID,
      address: databaseAddress,
      name: databaseName,
      type: 'keyvalue'
    },
    blockSummary,
    cidMappings: Object.fromEntries(cidMappings),
    appInfo: {
      name: 'simple-todo',
      version: '0.1.11',
      orbitdbVersion: '3.0.2'
    }
  }
  
  const metadataJson = JSON.stringify(metadata, null, 2)
  const metadataFile = new File([metadataJson], 'backup-metadata.json', {
    type: 'application/json'
  })
  
  return { metadata, metadataFile }
}

/**
 * Backup the current todo database to Storacha
 */
export async function backupTodoDatabase(client) {
  console.log('🚀 Starting Todo Database Backup to Storacha')
  
  try {
    const todoDB = get(todoDBStore)
    if (!todoDB) {
      throw new Error('No todo database available')
    }
    
    // Extract all blocks
    const { blocks, blockSources, manifestCID } = await extractDatabaseBlocks()
    
    // Upload blocks to Storacha
    const { successful, cidMappings } = await uploadBlocksToStoracha(blocks, client)
    
    if (successful.length === 0) {
      throw new Error('No blocks were successfully uploaded')
    }
    
    // Create block summary
    const blockSummary = {}
    for (const [_hash, source] of blockSources) {
      blockSummary[source] = (blockSummary[source] || 0) + 1
    }
    
    // Create and upload metadata file
    const { metadata, metadataFile } = await createBackupMetadata(
      manifestCID,
      todoDB.address,
      todoDB.name,
      blockSummary,
      cidMappings
    )
    
    console.log('📋 Uploading backup metadata...')
    const metadataResult = await client.uploadFile(metadataFile)
    console.log('✅ Metadata uploaded:', metadataResult.toString())
    
    console.log('✅ Backup completed successfully!')
    
    return {
      success: true,
      manifestCID,
      metadataCID: metadataResult.toString(),
      databaseAddress: todoDB.address,
      databaseName: todoDB.name,
      blocksTotal: blocks.size,
      blocksUploaded: successful.length,
      blockSummary,
      timestamp: new Date().toISOString()
    }
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Download backup metadata from Storacha
 */
export async function downloadBackupMetadata(metadataCID) {
  try {
    console.log('📥 Downloading backup metadata:', metadataCID)
    
    const response = await fetch(`https://w3s.link/ipfs/${metadataCID}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const metadata = await response.json()
    console.log('✅ Metadata downloaded successfully')
    
    return metadata
  } catch (error) {
    console.error('❌ Failed to download metadata:', error)
    throw error
  }
}

/**
 * List all backup metadata files in the current space
 */
export async function listBackups(client) {
  try {
    console.log('📋 Listing backups in current space...')
    
    const result = await client.capability.upload.list({ size: 1000 })
    const backups = []
    
    // Filter for backup metadata files by trying to download and parse them
    for (const upload of result.results) {
      const cid = upload.root.toString()
      try {
        // Try to download as JSON to see if it's a backup metadata file
        const response = await fetch(`https://w3s.link/ipfs/${cid}`)
        if (response.ok) {
          const data = await response.json()
          if (data.backupVersion && data.databaseInfo && data.appInfo?.name === 'simple-todo') {
            backups.push({
              cid,
              timestamp: data.timestamp,
              databaseName: data.databaseInfo.name,
              manifestCID: data.databaseInfo.manifestCID,
              blockCount: Object.values(data.blockSummary || {}).reduce((a, b) => a + b, 0),
              uploaded: upload.insertedAt
            })
          }
        }
      } catch (error) {
        // Not a backup metadata file, skip
        continue
      }
    }
    
    // Sort by timestamp descending
    backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    
    console.log(`✅ Found ${backups.length} backup(s)`)
    return backups
  } catch (error) {
    console.error('❌ Failed to list backups:', error)
    return []
  }
}
