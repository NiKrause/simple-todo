# Hybrid Web App: SSR + Local-First P2P

This branch implements a revolutionary **hybrid web application** architecture that combines:

- **Server-Side Rendering (SSR)** with OrbitDB running on the server
- **Local-First P2P** fallback when servers go down
- **Progressive Web App (PWA)** capabilities for offline functionality
- **Automatic failover** between server and client modes

## 🏗️ Architecture Overview

### Server Mode (Default)
- **Pure SSR**: No client-side JavaScript for OrbitDB
- **Server-side OrbitDB**: Database runs entirely on the Node.js server
- **Form-based interactions**: Uses SvelteKit form actions for todo operations
- **mDNS Discovery**: Servers find each other automatically in Docker containers

### Client Mode (Failover)
- **Client-side OrbitDB**: Database initializes in the browser when server is unavailable
- **P2P Connections**: Direct peer-to-peer connections between browser instances
- **Peer Storage**: Remembers connected peers for reconnection
- **PWA Offline**: Continues working completely offline

### Hybrid Features
1. **Automatic Detection**: Detects server availability on page load
2. **Seamless Fallback**: Switches to client mode when server goes down
3. **Peer Persistence**: Stores peer information for reconnection after restarts
4. **Cross-Mode Compatibility**: Data syncs between server and client modes

## 🚀 Quick Start

### Development Mode
```bash
# Install dependencies
pnpm install

# Start development server (SSR mode)
pnpm run dev
```

### Production Multi-Node Deployment
```bash
# Build and start both nodes
docker-compose -f docker-compose.hybrid.yml up --build

# Access the nodes
open http://localhost:3001  # Node A
open http://localhost:3002  # Node B
```

### Run Comprehensive Tests
```bash
./test-hybrid.sh
```

## 🔧 How It Works

### 1. Server Mode Operation
When a server is available:
- Page loads via SSR with todos pre-rendered
- Form submissions use SvelteKit actions
- OrbitDB runs server-side with persistent storage
- mDNS enables automatic peer discovery between nodes

### 2. Client Mode Failover
When server becomes unavailable:
- PWA detects server failure
- Initializes client-side OrbitDB in the browser
- Loads stored peer information for reconnection
- Continues P2P operation without any server

### 3. Multi-Node Setup
- **Node A**: Runs on port 3001 (container internal: 3000)
- **Node B**: Runs on port 3002 (container internal: 3000)
- **mDNS**: Nodes discover each other automatically
- **Shared Network**: Docker bridge network enables communication
- **Persistent Storage**: Each node has separate volumes for data

### 4. PWA Features
- **Service Worker**: Caches app for offline use
- **Manifest**: Installable as a native app
- **Offline First**: Works without internet connection
- **Background Sync**: Syncs data when connection returns

## 📊 Failover Scenarios

### Scenario 1: Node A Goes Down
1. Users on Node A: PWA switches to client mode
2. Users on Node B: Continue with server mode
3. PWA users can still connect to each other P2P
4. When Node A returns: Users can switch back to server mode

### Scenario 2: Both Nodes Go Down  
1. All PWA instances switch to client mode
2. P2P connections maintained between browser instances
3. Data persisted in browser storage
4. Peers reconnect using stored peer information

### Scenario 3: Network Partition
1. Nodes continue operating independently
2. PWA instances fall back to client mode if needed
3. Each partition maintains its own OrbitDB state
4. Data merges when network reconnects

## 🏃‍♂️ Testing Scenarios

The `test-hybrid.sh` script validates:

- ✅ **Build Process**: SSR build completes successfully
- ✅ **Docker Deployment**: Multi-node containers start properly
- ✅ **Health Checks**: Both nodes respond to API calls
- ✅ **mDNS Discovery**: Nodes discover each other
- ✅ **SSR Functionality**: Server-side rendering works
- ✅ **PWA Features**: Service worker and manifest available
- ✅ **Node Failover**: Graceful handling of node failures

## 🔧 Configuration

### Environment Variables
```bash
NODE_ENV=production
PORT=3000
ORBITDB_INSTANCE_NAME=node-a
MDNS_SERVICE_NAME=simple-todo
ENABLE_MDNS=true
```

### Docker Compose Networks
- **Network**: `todo-network` (172.20.0.0/16)
- **mDNS**: Enabled for service discovery
- **Volumes**: Persistent storage per node

### Client Storage
- **Peer Information**: Stored in localStorage
- **User Preferences**: Cached for reconnection
- **OrbitDB Data**: Browser-side persistent storage

## 🎯 Benefits

1. **Resilience**: Works even when all servers fail
2. **Performance**: SSR for initial load speed
3. **Scalability**: P2P reduces server load
4. **Offline**: Full functionality without internet
5. **Decentralization**: No single point of failure

## 🔮 Future Enhancements

- [ ] Automatic server mode restoration
- [ ] Advanced peer discovery algorithms
- [ ] Conflict resolution for multi-master scenarios
- [ ] WebRTC hole punching for NAT traversal
- [ ] End-to-end encryption for P2P data

## 📋 Architecture Components

```
┌─────────────────┐    ┌─────────────────┐
│   Browser A     │    │   Browser B     │
│   (PWA)         │    │   (PWA)         │
│ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Client      │ │    │ │ Client      │ │
│ │ OrbitDB     │ │◄──►│ │ OrbitDB     │ │
│ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘
         │                       │
         │ ┌─────────────────────┴──┐
         │ │                        │
         ▼ ▼                        ▼
┌─────────────────┐    ┌─────────────────┐
│   Node A        │    │   Node B        │
│   (SSR)         │    │   (SSR)         │
│ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Server      │ │◄──►│ │ Server      │ │
│ │ OrbitDB     │ │    │ │ OrbitDB     │ │
│ └─────────────┘ │    │ └─────────────┘ │
│   Port: 3001    │    │   Port: 3002    │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌─────────────┐
              │ mDNS Bridge │
              │  Network    │
              └─────────────┘
```

This architecture represents a new paradigm in web applications: **truly resilient, decentralized applications that gracefully degrade from server-side to peer-to-peer operation**.