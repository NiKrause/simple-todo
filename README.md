# Simple Todo: Hybrid SSR + Local-First P2P

A web application that combines **Server-Side Rendering** with **local-first peer-to-peer** PWA, creating apps that never go down.

## 🚀 The Innovation

This app demonstrates a new paradigm: **hybrid web applications** that automatically failover from server-side to peer-to-peer mode when data centers go down, ensuring 100% uptime.

## 🏗️ Architectural Comparison

### 1. Traditional Web2 SvelteKit Architecture

```
User Browser ──────► Server (Single Point of Failure)
     │                   │
     │                   ▼
     └─── ❌ FAILS ──── ⚠️ Server Down = App Unusable
```

**Problem**: When the server fails, users lose access to their data and functionality entirely.

### 2. Pure Local-First P2P (Previous Version main branch)

```
Browser A ◄──── P2P Network ────► Browser B
    │                                  │
    ▼                                  ▼
OrbitDB                            OrbitDB
(Local Storage)                (Local Storage)
```

**Limitation**: No SEO, slower initial loads

### 3. Hybrid Architecture (This Innovation)

```
              🌐 Normal Operation (SSR Mode)
User Browser ──────► Server Node A ◄────► Server Node B
     │                    │                    │
     │                OrbitDB              OrbitDB
     │                    │                    │
     │              ⚠️ Server Failure          │
     │                    │                    │
     ▼               🔄 Automatic Failover     │
PWA Client ◄──── P2P Network ────────────────┘
     │
 OrbitDB (Browser)
```

**Benefits**: Fast SSR loads + SEO + automatic P2P failover = Never goes down!

### 4. Browser-to-Browser P2P Failover Scenario

```
🌐 Normal Operation (Both Browsers Connected to Server)
Browser A ──SSR──► Server Node ◄──SSR── Browser B
    │                   │                   │
    │               OrbitDB                 │
    │                   │                   │
    │              ⚠️ Server Failure         │
    │                   │                   │
    ▼               🔄 Automatic Failover   ▼
Browser A ◄──── WebRTC P2P ──────► Browser B
    │                                   │
    ▼                                   ▼
OrbitDB (Browser)              OrbitDB (Browser)
libp2p Node                    libp2p Node
```

**Scenario**: Two users (Browser A & B) both connect to the same server initially. When the server fails, they automatically discover each other via P2P and continue working together with their own OrbitDB instances running in the browser, connected via WebRTC.

## 🎯 Key Technologies

- **Frontend**: SvelteKit with SSR
- **Backend**: SvelteKit server + OrbitDB (server-side)
- **P2P Layer**: libp2p + WebRTC (peer-to-peer and local-first after failover)
- **Failover**: PWA + Service Worker + libp2p

## 🔄 How Failover Works

1. **Server Mode**: App loads via SSR, todos pre-rendered, forms use server actions
2. **Detection**: PWA detects server unavailability
3. **Automatic Switch**: OrbitDB initializes in browser
4. **P2P Mode**: Direct peer connections, data syncs browser-to-browser
5. **Recovery**: When servers return, can switch back to server mode

## Limitations/Todo`s:

Local-First behavior:

- when in classic ssr mode:
  - so far no local-first storage implemented (no OrbitDB in browser)
  - no direct peer-to-peer updates between devices
- only when in peer-to-peer mode, since OrbitDB stores all data, it is local-first
- resolution: Always enable peer-to-peer mode by default after loading app SSR from server ?

Peer-To-Peer Collaboration and instant updates

- available in classic ssr mode only via centralized websocket (no peer-to-peer)

Missing Abstraction Library which handles both classic mode and peer-to-peer mode

Initial Sync in peer-to-peer mode

When a browser orbit-db is spinning up, it connects to the libp2p network for initial sync. So far the relay (which could be decentralized network too!) runs basic OrbitDB pinning service and the browser db get's the initial sync from there.

- checkout OrbitDB-Storacha-Bridge which would allow allow to restore a db from a Storacha Space
- evaluate, if an OrbitDB could restore/initialize it's data directory from IPFS (via the /orbitdb/addresss) CID containing Manifest with Idenity, AccessController) What is missing are the HEADS (last block) which is unknown when spinning up the failover browser nodes. At this point it was not communicated. It is imaginable that Server SSR if is rendering a TodoList or adding a TODO is always delivering the last HEAD CID into a hidden field, which then could be used for the failover when restoring the complete history log from the latest HEAD by iterating down.

- create an abstraction library which allows writing hybrid ssr-p2p PWA's more easily.


- evaluate if a browser can optionally run an OrbitDB if - page was rendered in SSR mode
- when peer-to-peer failover is activated data is loaded at

## 🚀 Quick Start

```bash
# Development (SSR mode)
pnpm install && pnpm run dev

- Node A: http://localhost:3001
- Node B: http://localhost:3002

## 🧪 Test Scenarios

Tests validate:
- ✅ SSR performance and SEO
- ✅ Multi-node server discovery
- ✅ Automatic P2P failover
- ✅ PWA offline functionality
- ✅ Data synchronization across modes

## 💡 Why This Matters

Traditional web apps have a **single point of failure**. This hybrid architecture creates **unstoppable applications** that:

- **Load fast** (SSR) with **perfect SEO**
- **Never go offline** (P2P failover)
- **Scale peer-to-peer** (reduces server costs)
- **Work anywhere** (PWA + offline-first)
- **Resist censorship** (decentralized fallback)

## 📊 Architecture Benefits

| Feature | Traditional Web2 | Pure P2P | Hybrid (This) |
|---------|------------------|----------|---------------|
| SEO | ✅ | ❌ | ✅ |
| Fast Load | ✅ | ❌ | ✅ |
| Uptime | ❌ | ✅ | ✅ |
| Offline | ❌ | ✅ | ✅ |
| Scalability | Expensive | Free | Depends on Usecase |

---

**The future of web apps**: Server performance + P2P resilience = Never goes down.