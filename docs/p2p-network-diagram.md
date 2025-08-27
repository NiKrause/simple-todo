# Local-First Peer-To-Peer Web Application Network
## with Libp2p, Helia and OrbitDB

```mermaid
graph TB
    %% Define node styles
    classDef deviceClass fill:#4F46E5,stroke:#3730A3,stroke-width:2px,color:#fff
    classDef relayClass fill:#059669,stroke:#047857,stroke-width:2px,color:#fff
    classDef storageClass fill:#DC2626,stroke:#B91C1C,stroke-width:2px,color:#fff
    classDef cloudClass fill:#F0F9FF,stroke:#0369A1,stroke-width:3px,color:#0369A1,stroke-dasharray: 8 4
    
    %% Device nodes
    Alice[💻 Alice<br/>Browser]:::deviceClass
    Bob[💻 Bob<br/>Browser]:::deviceClass
    Peter[📱 Peter<br/>Mobile]:::deviceClass
    
    %% Local Storage nodes
    AliceStorage[Local Storage /<br/>Offline Storage]:::storageClass
    BobStorage[Local Storage /<br/>Offline Storage]:::storageClass
    PeterStorage[Local Storage /<br/>Offline Storage]:::storageClass
    
    %% Relay Network Cloud
    subgraph RelayNetwork ["🌐 Relay Network"]
        R1[R1]:::relayClass
        R2[R2]:::relayClass
        R3[R3]:::relayClass
        R4[R4]:::relayClass
        R5[R5]:::relayClass
    end
    
    %% Apply cloud styling to the subgraph
    RelayNetwork:::cloudClass
    
    %% P2P Connections (bidirectional - WebRTC)
    Alice <==> Bob
    Alice <==> Peter
    Bob <==> Peter
    
    %% Device to Storage connections
    Alice --- AliceStorage
    Bob --- BobStorage
    Peter --- PeterStorage
    
    %% Device to Relay connections (WebSocket/WebTransport/WebRTC)
    Alice -.-> R1
    Alice -.-> R4
    Bob -.-> R3
    Bob -.-> R5
    Peter -.-> R2
    Peter -.-> R4
    
    %% Inter-relay connections (TCP/IP, QUIC)
    R1 --- R2
    R2 --- R3
    R1 --- R4
    R2 --- R4
    R2 --- R5
    R3 --- R5
    R4 --- R5
```

## Legend

| Connection Type | Representation | Protocols |
|----------------|----------------|-----------|
| **P2P Connection** | `<===>` (solid bidirectional) | WebRTC |
| **Signaling/Relay Connection** | `-.->` (dotted arrow) | WebSocket, WebTransport, WebRTC |
| **Relay Network** | `---` (solid line) | TCP/IP, QUIC |
| **Local Storage** | `---` (solid line) | Direct connection |

## Connection Protocols

- **Direct P2P**: libp2p/WebRTC (browsers), WebRTC (mobile)
- **Relay connections**: WebRTC, WebTransport, WebSocket
- **Relay network**: TCP/IP, QUIC

## Data Flow

- Each device maintains local storage with OrbitDB
- OrbitDB changes replicate across connected peers in real-time
- Relay/Signaling nodes facilitate NAT traversal, peer discovery and IPFS pinning

## Network Architecture Features

### 🔗 **Peer-to-Peer Connectivity**
- **Alice ↔ Bob**: Direct WebRTC P2P connection
- **Alice ↔ Peter**: Direct WebRTC P2P connection  
- **Peter ↔ Bob**: Direct WebRTC P2P connection

### 🌐 **Relay Network Infrastructure**
- **5 interconnected relay nodes** (R1-R5)
- **Signaling support** for NAT traversal and connection discovery
- **IPFS/OrbitDB pinning capabilities** for data persistence
- **Multiple transport protocols** for device connectivity

### 💾 **Local-First Storage**
- **Each device** maintains complete local data replica
- **Offline-capable** operation with sync when reconnected  
- **Real-time synchronization** across all connected peers

### 📱 **Multi-Platform Support**
- **Browser clients** (Alice & Bob): Full WebRTC P2P + relay fallback
- **Mobile clients** (Peter): WebRTC P2P + multiple transport options

## Technology Stack

- **🔗 Libp2p**: Peer-to-peer networking foundation
- **🌍 Helia**: IPFS implementation for JavaScript  
- **📊 OrbitDB**: Distributed database built on IPFS
- **🔄 WebRTC**: Direct peer-to-peer communication
- **🌐 WebSocket/WebTransport**: Relay communication protocols
