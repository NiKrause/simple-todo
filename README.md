# Simple Todo - A Local-First Peer-to-Peer Demo App

A decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

## 🏗️ Network Architecture

![Local-First P2P Network Architecture](docs/p2p-network-diagram.svg)

**Architecture Highlights:**
- **Direct P2P Connections**: WebRTC connections between all devices (Alice, Bob, Peter)
- **Relay/Signaling Network**: Distributed relay nodes for NAT traversal, peer discovery, and IPFS pinning
- **Local OrbitDB Storage**: Each device maintains offline-capable local storage
- **Multi-Transport Support**: WebSocket, WebTransport, and WebRTC protocols

*For detailed network architecture documentation, see [docs/p2p-network-diagram.md](docs/p2p-network-diagram.md)*

## 🚀 Live Demo

- **HTTP**: https://simple-todo.le-space.de
- **IPFS (dweb.link)**: https://dweb.link/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs
- **IPFS (le-space)**: https://ipfs.le-space.de/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs

## 🎯 What is this?

This is a **browser-only** local-first peer-to-peer todo application that operates without any traditional server infrastructure. It connects directly to other browsers and mobile devices through peer-to-peer connections, creating a truly decentralized experience. So far, a LibP2P signaling node is necessary to connect the peers, and in this version it also stores the todos since this browser version works with MemoryStorage only instead of local IPFSStorage (e.g. LevelBlockstore).

### Key Features

- ✅ **No Server Required** - Runs entirely in your browser 
- ✅ **Local Data** - Data is stored in your browser's level storage and replicated via OrbitDB and IPFS
- ✅ **Peer-to-Peer Communication** - Browsers connect directly via WebRTC (with help of signaling nodes)
- ✅ **Real-time Synchronization** - Changes appear instantly across all peers
- ✅ **Dynamic Identity** - Fresh peer ID generated on each load

## 🎯 How to Test

1. **Open Two Browser Windows** - You need at least two browser instances, a mobile device, or ask another distant person to open the app
2. **Load the Same URL** - All app users should load the same app URL
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

**[🔧 Reusable Components](./docs/)**

See the docs folder for detailed implementation guides and component documentation.

## 🛠️ Quick Start

```bash
# Clone repository
git clone https://github.com/NiKrause/simple-todo.git
# checkout simple-todo branch
git checkout simple-todo

# run (like this you don't need to cut and paste anything)
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

