# ConsentModal Component

A privacy-focused Svelte component that provides user consent management for P2P network initialization with configurable data storage and connection preferences.

## Overview

The `ConsentModal` component serves as the privacy gateway for the application, ensuring users understand and consent to data handling practices before initializing peer-to-peer connections. It provides granular control over storage preferences and network connectivity options.

## Features

### Privacy & Consent Management
- **Informed Consent**: Clear explanations of data storage and network implications
- **Granular Control**: Separate toggles for storage, network, and peer connections
- **Privacy Icons**: Visual indicators for different privacy features
- **Consent Persistence**: Optional "remember decision" functionality

### Storage Configuration
- **Browser Storage (Local-First)**: Enables persistent data storage in browser
- **Memory Only**: Disables local storage, relies on network synchronization
- **Storage Impact Warnings**: Clear explanations of each choice

### Network Configuration
- **Relay Connection**: Connects to relay nodes for P2P communication
- **Offline Mode**: Completely disconnected operation
- **Peer Discovery**: Optional direct peer-to-peer connections
- **Network Impact Warnings**: Explains data visibility implications

### User Experience
- **Responsive Design**: Works on desktop and mobile devices
- **Progressive Disclosure**: Peer connection options shown only when relevant
- **Validation**: Prevents proceeding without understanding confirmations
- **Error Prevention**: Warns when configuration leads to no data availability

## Component Structure

### Props
```javascript
// Display Configuration
export let show = true;
export let title = 'Simple-Todo-Example v...';
export let description = 'This local-first & peer-to-peer web application:';
export let features = [...]; // Privacy feature descriptions

// Preference Controls
export let enablePersistentStorage = true;
export let enableNetworkConnection = true;
export let enablePeerConnections = true;

// Consent Checkboxes
export let checkboxes = {
  storageUnderstanding: { label: '...', checked: false },
  networkUnderstanding: { label: '...', checked: false },
  globalDatabase: { label: '...', checked: false },
  replicationTesting: { label: '...', checked: false }
};

// UI Customization
export let proceedButtonText = 'Continue';
export let disabledButtonText = 'Please check all boxes to continue';
export let rememberLabel = "Don't show this again on this device";
export let rememberDecision = false;
```

### Events
```javascript
// Emitted when user proceeds with their preferences
dispatch('proceed', {
  enablePersistentStorage,
  enableNetworkConnection,
  enablePeerConnections
});
```

## Integration Points

### Core Files
- **`src/lib/ConsentModal.svelte`** (307 lines) - Main component implementation
- **`src/routes/+page.svelte`** - Integration and event handling
- **`src/lib/p2p.js`** - Receives preferences for P2P initialization
- **`src/lib/libp2p-config.js`** - Applies network preferences to libp2p configuration

### Dependencies
- **Svelte**: Component framework and reactivity
- **Lucide Svelte**: Privacy feature icons (Shield, Database, Globe, Server)
- **Tailwind CSS**: Styling and responsive design

## Usage Example

```svelte
<script>
  import ConsentModal from '$lib/ConsentModal.svelte';
  
  let showModal = true;
  let rememberDecision = false;
  
  const handleModalClose = async (event) => {
    showModal = false;
    const preferences = event.detail;
    
    // Initialize P2P with user preferences
    await initializeP2P(preferences);
    
    // Optionally save consent decision
    if (rememberDecision) {
      localStorage.setItem('consentAccepted', 'true');
    }
  };
</script>

{#if showModal}
  <ConsentModal
    bind:show={showModal}
    bind:rememberDecision
    title="My P2P App"
    description="A decentralized application that:"
    on:proceed={handleModalClose}
  />
{/if}
```

## Configuration Scenarios

### 1. Full P2P Mode (Default)
```javascript
{
  enablePersistentStorage: true,
  enableNetworkConnection: true,
  enablePeerConnections: true
}
```
- Local data persistence
- Connects to relay servers
- Enables direct peer connections
- Full synchronization capabilities

### 2. Local-First Only
```javascript
{
  enablePersistentStorage: true,
  enableNetworkConnection: false,
  enablePeerConnections: false
}
```
- Local data persistence
- No network connections
- Offline-only operation
- Can sync later when network enabled

### 3. Network-Only Mode
```javascript
{
  enablePersistentStorage: false,
  enableNetworkConnection: true,
  enablePeerConnections: true
}
```
- No local data storage
- Relies entirely on network synchronization
- Data loaded from other peers
- Temporary session data only

### 4. Invalid Configuration (Prevented)
```javascript
{
  enablePersistentStorage: false,
  enableNetworkConnection: false,
  enablePeerConnections: false
}
```
- **Blocked by component**: Shows warning and disables proceed button
- No data storage or retrieval possible
- Application would be non-functional

## Privacy Features Explained

### 🛡️ No Tracking
- No cookies or analytics
- No user identification
- No behavioral tracking

### 🗄️ No External Database
- No application servers
- No centralized data storage
- All data stays local or peer-distributed

### 🔶 Relay Server Caching
- Relay servers may cache data temporarily
- Data visible to other users on same relay
- Required for peer discovery and communication

### 🌐 IPFS Network Distribution
- Web app available on IPFS
- Decentralized hosting
- Domain serves as proxy to IPFS

## Consent Validation

The component requires users to check all understanding boxes:

1. **Storage Understanding**: Acknowledges implications of storage choice
2. **Network Understanding**: Acknowledges implications of network choice  
3. **Global Database**: Understands unencrypted shared database nature
4. **Replication Testing**: Understands need for multiple devices to test sync

## Styling & Theming

Uses Tailwind CSS classes for:
- **Modal Overlay**: Fixed positioning with backdrop
- **Responsive Grid**: Two-column layout on larger screens
- **Feature Icons**: Circular icon containers with tooltips
- **Form Controls**: Consistent radio buttons and checkboxes
- **Warning States**: Red-bordered alerts for invalid configurations
- **Interactive Elements**: Hover states and transitions

## Error Handling

- **Invalid Configurations**: Prevents proceeding when no data available
- **Checkbox Validation**: Requires all understanding confirmations
- **Graceful Degradation**: Works without localStorage access
- **Type Safety**: Proper event handling and parameter validation

## Accessibility Features

- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Readers**: Proper labels and ARIA attributes
- **Focus Management**: Clear focus indicators
- **Color Contrast**: Meets WCAG guidelines
- **Responsive Design**: Works across device sizes

This component serves as a crucial privacy gateway, ensuring users make informed decisions about their data and network preferences before engaging with the P2P functionality of the application.
