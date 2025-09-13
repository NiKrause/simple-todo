# Simple Todo - A Local-First Peer-to-Peer Demo App (in Svelte)

<div align="center">
  <img src="static/libp2p.png" alt="libp2p" height="30">
  <img src="static/ipfs.png" alt="IPFS" height="30">
  <img src="static/helia.svg" alt="Helia" height="30">
  <img src="static/orbitdb.png" alt="OrbitDB" height="30">
  <img src="static/filecoin.svg" alt="Filecoin" height="30">
  <img src="static/storacha-logo.jpeg" alt="Storacha" height="30">
</div>

A decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

- **Direct P2P Connections**: WebRTC connections between all devices (Alice, Bob, Peter)
- **Relay/Signaling Network**: Relay nodes for NAT traversal, peer discovery, and IPFS pinning 
- **Local OrbitDB Storage**: Each device maintains offline-capable via the browsers indexdb
- **Multi-Transport Support**: WebSocket, WebTransport, and WebRTC protocols
- **Storacha/Filecoin Integration with UCAN-Auth:** Backup & restore todo lists via Storacha gateway to Filecoin decentralized storage

## 🚀 Live Demo

- **HTTP**: https://simple-todo.le-space.de
- **IPFS (dweb.link)**: https://dweb.link/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs
- **IPFS (le-space)**: https://ipfs.le-space.de/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs

## 🏗️ Network Architecture

![Local-First P2P Network Architecture](docs/p2p-network-diagram.svg)



## 🎯 What is this?

This is a **browser only** local-first peer-to-peer todo application that operates without any traditional server infrastructure. It connects directly to other browsers and mobile devices through peer-to-peer connections, creating a truly decentralized experience.

### Key Features
- ✅ **No Server Required** - Runs entirely in your browser
- ✅ **Local Data** - data is stored in your browsers level storage and replicated via OrbitBB and IPFS
- ✅ **Peer-to-Peer Communication** - Browsers connect directly via WebRTC (with help of signaling nodes)
- ✅ **Real-time Synchronization** - Changes appear instantly across all peers
- ✅ **Dynamic Identity** - Fresh peer ID generated on each load

## 🎯 How to Test

1. **Open Two Browser Windows** - You need at least two browser instances, a mobile or ask another distant person to open the app
2. **Load the Same URL** - all app users should load the same app URL
3. **Accept Consent** - Check all consent boxes in both browsers
4. **Wait for Connection** - The app will automatically discover and connect peers
5. **Add Todos** - Create todos in one browser and watch them appear in the other

## 📚 Documentation

For comprehensive guides on how this app works, implementation details, and reusable components:

**[📖 Tutorial](./docs/TUTORIAL.md)**

The tutorial covers:

- Step-by-Step implementation guide
- Architecture overview
- Testing procedures
- Troubleshooting guide
- Security considerations

**[🔧 AI-Friendly Component Reference](./docs/)**

This codebase contains production-ready, reusable components for building decentralized P2P applications. Key components for AI analysis and reuse:

- **[ConsentModal.svelte](./src/lib/ConsentModal.svelte)** - A comprehensive privacy consent component that manages user preferences for data storage (persistent vs session), network connectivity, and P2P connections. Features configurable checkboxes, storage toggles, and handles GDPR-style consent flow for decentralized applications.

- **[StorachaIntegration.svelte](./src/lib/StorachaIntegration.svelte)** - Complete Web3 storage integration component providing UCAN-based authentication, space management, and backup/restore functionality for OrbitDB databases to Storacha/Filecoin. Includes progress tracking, error handling, and space usage monitoring.

- **[storacha-backup.js](./src/lib/storacha-backup.js)** - Core backup/restore utility module that bridges OrbitDB with Storacha cloud storage. Provides functions for client initialization, space management, database backup/restore operations, and UCAN delegation handling for decentralized storage workflows.

- **[p2p.js](./src/lib/p2p.js)** - Core P2P network initialization module that handles libp2p node creation, Helia (IPFS) setup, and OrbitDB database initialization. Manages user consent preferences for storage persistence, network connectivity, and peer connections. Includes comprehensive error handling, mobile-aware storage fallbacks, and initialization state management.

- **[db-actions.js](./src/lib/db-actions.js)** - Database operations module providing CRUD functionality for OrbitDB-based todo management. Features reactive Svelte stores, real-time database synchronization, event listeners for database changes, and comprehensive todo lifecycle management (add, delete, toggle completion, assignment).

- **[libp2p-config.js](./src/lib/libp2p-config.js)** - LibP2P network configuration module with environment-aware relay selection, multi-transport support (WebRTC, WebSockets, Circuit Relay), peer discovery via gossipsub, and configurable network preferences. Supports both development and production relay configurations with comprehensive connection management.

These components demonstrate patterns for: P2P consent management, Web3 storage integration, OrbitDB backup strategies, UCAN authentication flows, libp2p network configuration, decentralized database operations, and privacy-compliant P2P initialization.

## 🛠️ Quick Start

```bash
# Clone repository
git clone https://github.com/NiKrause/simple-todo.git
# checkout simple-todo branch
git checkout simple-todo

# run (like this you don't need to cut and past anything)
./tutorial-01.js
```

## 🔧 Technologies Used

- **libp2p** - Peer-to-peer networking stack
- **IPFS** - Distributed file system (via Helia)
- **OrbitDB** - Decentralized database
- **Svelte** - Frontend framework
- **WebRTC** - Direct browser-to-browser communication

## ⚠️ Important Notes

- This is a **demo application** for educational purposes
- Data is stored in a **global unencrypted database** visible to all users
- **No privacy protection** - all data is publicly visible
- **Not suitable for production use** without additional security measures

## 📄 License

This project is open source and available under the [LICENSE](./LICENSE) file.

---
