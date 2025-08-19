# Simple Todo - A Local-First Peer-to-Peer Demo App

A decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

## 🚀 Live Demo

- **HTTP**: https://simple-todo.le-space.de
- **IPFS (dweb.link)**: https://dweb.link/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs
- **IPFS (le-space)**: https://ipfs.le-space.de/ipns/k51qzi5uqu5dg7m2i3qftmdjl4t8jh74xzyz1ovsrkgdcdyn1ftaum3laom7qs

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

**[🔧 Reusable Components](./docs/)**

- **[StorachaIntegration](./docs/StorachaIntegration.md)** - Complete Storacha/Web3.Storage integration component for backing up OrbitDB databases to decentralized storage

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

