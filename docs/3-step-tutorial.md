# 3-Step P2P Todo App Tutorial: Copy-Paste Your Way to Decentralization

Build a fully decentralized, peer-to-peer todo application in just **3 copy-paste steps** with **~990 lines of code**. No servers, no databases, no cloud providers - just browsers talking directly to each other!

## 🎯 What You'll Build

- **Serverless Todo App**: Runs entirely in browsers
- **Peer-to-Peer Sync**: Real-time synchronization between devices
- **Local-First**: Works offline, syncs when online
- **Decentralized**: No central authority or single point of failure
- **Modern Web3 Stack**: libp2p + IPFS + OrbitDB + Svelte

## 📋 Prerequisites

- Node.js 22+
- Basic JavaScript/Svelte knowledge
- 2 browser windows/devices for testing
- 15 minutes of your time

## 🤖 Automated Setup

**Quick Start**: Use the automation script to build the entire app:

## 🛠️ Quick Start

```bash
# Clone repository
git clone https://github.com/NiKrause/simple-todo.git

# checkout simple-todo branch
git checkout simple-todo

# run (like this you don't need to cut and past anything)
./tutorial-01.js 
```

This script will:
1. Create a SvelteKit project
2. Install all P2P dependencies
3. Copy all code files from this repository
4. Start the development server

Alternatively, you can do all of this with your own hands:



## 🚀 Step 1: Project Setup & Dependencies

### Create the project structure:

```bash
npx sv create p2p-todo-demo
cd p2p-todo-demo
```

### Required Files:

- **📦 Dependencies**: [`package.json`](./package.json) - P2P libraries and build tools
- **⚙️ Vite Config**: [`vite.config.js`](./vite.config.js) - Build configuration with Node.js polyfills
- **🎨 Tailwind Config**: [`tailwind.config.js`](./tailwind.config.js) - CSS framework setup (optional)
- **💅 Styles**: [`src/app.css`](./src/app.css) - Base Tailwind imports

### Install dependencies:

```bash
npm install
```

## 🔗 Step 2: Core P2P & Database Logic

Create the `src/lib/` directory and add these core files:

### Core P2P Files:

- **🌐 LibP2P Config**: [`src/lib/libp2p-config.js`](./src/lib/libp2p-config.js) (99 lines) - Network configuration with WebRTC, WebSockets, and relay support
- **🔄 P2P Manager**: [`src/lib/p2p.js`](./src/lib/p2p.js) (74 lines) - Initialize libp2p, Helia (IPFS), and OrbitDB
- **🗄️ Database Actions**: [`src/lib/db-actions.js`](./src/lib/db-actions.js) (299 lines) - CRUD operations for distributed todo storage
- **🛠️ Utilities**: [`src/lib/utils.js`](./src/lib/utils.js) (15 lines) - Helper functions for peer ID formatting

## 🎨 Step 3: UI Components

Create these Svelte components:

### Core Components:

- **🚪 Consent Modal**: [`src/lib/ConsentModal.svelte`](./src/lib/ConsentModal.svelte) (120 lines) - P2P connection consent with checkboxes
- **⏳ Loading Spinner**: [`src/lib/LoadingSpinner.svelte`](./src/lib/LoadingSpinner.svelte) (31 lines) - Network initialization feedback
- **❌ Error Alert**: [`src/lib/ErrorAlert.svelte`](./src/lib/ErrorAlert.svelte) (57 lines) - Error display with dismiss option
- **🔔 Toast Notifications**: [`src/lib/ToastNotification.svelte`](./src/lib/ToastNotification.svelte) (40 lines) - Success/error messages

### Todo Components:

- **➕ Add Todo Form**: [`src/lib/AddTodoForm.svelte`](./src/lib/AddTodoForm.svelte) (50 lines) - Input form with validation
- **📝 Todo Item**: [`src/lib/TodoItem.svelte`](./src/lib/TodoItem.svelte) (54 lines) - Individual todo with toggle/delete
- **📋 Todo List**: [`src/lib/TodoList.svelte`](./src/lib/TodoList.svelte) (40 lines) - Container for all todos

### P2P Status Components:

- **🏷️ Transport Badge**: [`src/lib/TransportBadge.svelte`](./src/lib/TransportBadge.svelte) (52 lines) - Connection type indicators
- **👥 Connected Peers**: [`src/lib/ConnectedPeers.svelte`](./src/lib/ConnectedPeers.svelte) (338 lines) - Live peer connection status

### Additional Components:

- **🆔 Peer ID Card**: [`src/lib/PeerIdCard.svelte`](./src/lib/PeerIdCard.svelte) - Display peer identity
- **🌐 Social Icons**: [`src/lib/SocialIcons.svelte`](./src/lib/SocialIcons.svelte) - Social media links

### App Structure:

- **🔗 Layout Data**: [`src/routes/+layout.js`](./src/routes/+layout.js) - Layout configuration
- **🏗️ Layout**: [`src/routes/+layout.svelte`](./src/routes/+layout.svelte) - Base HTML structure
- **🏠 Main App**: [`src/routes/+page.svelte`](./src/routes/+page.svelte) - Complete app with P2P initialization and UI orchestration

### Configuration Files:

- **📝 Svelte Config**: [`svelte.config.js`](./svelte.config.js) - SvelteKit configuration
- **🔧 ESLint Config**: [`eslint.config.js`](./eslint.config.js) - Code linting rules
- **🧪 Vitest Setup**: [`vitest-setup-client.js`](./vitest-setup-client.js) - Test environment setup

## 🚀 Run Your P2P Todo App

```bash
npm run dev
```

Open http://localhost:5173 in **two browser windows** and watch the magic happen!

## 🎯 What Just Happened?

You just built a **fully decentralized todo application** with:

- **~990 lines of code** (vs thousands for traditional apps)
- **No servers** - runs entirely in browsers
- **No databases** - uses OrbitDB for distributed storage
- **Real-time P2P sync** - changes appear instantly across devices
- **Works offline** - data persists locally, syncs when reconnected

## 🎪 Live Demo Tips

### For Presentations:

1. **Pre-setup**: Have the code ready in VS Code
2. **Two devices**: Use laptop + phone/tablet for dramatic effect
3. **Audience participation**: Share QR code for live testing
4. **Offline demo**: Disconnect internet, show it still works locally
5. **Reconnect**: Show sync when connection restored

### Key Talking Points:

- "No backend servers needed"
- "Data lives in your browser, syncs peer-to-peer"
- "Works offline, syncs online"
- "Built with modern Web3 stack"
- "~990 lines = full decentralized app"

## 🔧 Next Steps

- **Deploy your own Signaling/Node or Pinning-Relay** with libp2p
- **Add authentication** with libp2p keypairs
- **Implement private rooms** with access control
- **Add file attachments** using IPFS
- **Deploy to IPFS** for truly decentralized hosting
- **Create mobile app** with React Native

## 🌟 The Future is Decentralized

You've just experienced the future of web applications - no servers, no cloud providers, no single points of failure. Just pure peer-to-peer magic!

**Welcome to the decentralized web! 🎉**
