# StorachaIntegration Component

A reusable Svelte component that provides seamless integration with [Storacha](https://storacha.network/) (Web3.Storage) for backing up OrbitDB databases to decentralized storage.

## Overview

The `StorachaIntegration` component enables users to:

- Create new Storacha accounts via email
- Login with existing Storacha credentials (key + proof)
- Manage Storacha spaces
- Backup OrbitDB databases to decentralized storage
- List and view existing backups
- Auto-login with stored credentials
- Encrypt localstorage stored credentials with LitProtocol (roadmap)
- Restore a backup into a fresh OrbitDB (roadmap)
- Use a delegated UCAN to backup & restore (roadmap)
- Implement an OrbitDB custom storage - StorachaStorage (roadmap)

## Features

### Authentication

- **Email Account Creation**: Create new Storacha accounts using email verification
- **Credential Login**: Login using Storacha private key and delegation proof
- **Auto-Login**: Automatically login on subsequent visits using stored credentials
- **Persistent Sessions**: Credentials are stored in localStorage

### Space Management

- **List Spaces**: View all available Storacha spaces
- **Create Spaces**: Create new storage spaces
- **Switch Spaces**: Change active storage space
- **Current Space Display**: Shows currently selected space

### Database Backup

- **One-Click Backup**: Backup entire OrbitDB database to Storacha
- **Block-Level Backup**: Extracts and uploads individual database blocks
- **Metadata Generation**: Creates comprehensive backup metadata
- **Progress Tracking**: Real-time backup progress with block counts

### Backup Management

- **List Backups**: View all backups in current space
- **Backup Details**: View detailed backup information
- **Timestamp Sorting**: Backups sorted by creation date
- **Metadata Parsing**: Automatic backup metadata parsing

## Usage

### Basic Integration

```svelte
<script>
	import StorachaIntegration from '$lib/StorachaIntegration.svelte';
</script>

<StorachaIntegration />
```

### Dependencies

The component requires these external functions from `storacha-backup.js`:

- `initializeStorachaClient(key, proof)`
- `createStorachaAccount(email)`
- `listSpaces(client)`
- `createSpace(client, name)`
- `backupTodoDatabase(client)`
- `listBackups(client)`
- `downloadBackupMetadata(cid)`

### Required Stores

The component expects these Svelte stores to be available:

- `todosStore` - Contains current todos
- `initializationStore` - OrbitDB initialization status

## Component API

### Props

None - the component is self-contained.

### State Management

#### Authentication State

- `isLoggedIn` - Boolean indicating login status
- `client` - Storacha client instance
- `currentAccount` - Current account object
- `currentSpace` - Current space object

#### UI State

- `showStoracha` - Toggle component visibility
- `isLoading` - Loading state for operations
- `status` - Current operation status message
- `error` - Error message display
- `success` - Success message display

#### Form State

- `showLoginForm` - Email login form visibility
- `showCreateForm` - Account creation form visibility
- `showCredentialsForm` - Credentials login form visibility
- `email` - Email input value
- `storachaKey` - Private key input value
- `storachaProof` - Delegation proof input value
- `newSpaceName` - New space name input

#### Data State

- `spaces` - Array of available spaces
- `backups` - Array of backup metadata
- `showSpaces` - Spaces management panel visibility
- `showBackups` - Backups list panel visibility

## Key Functions

### Authentication

#### `handleEmailLogin()`

Creates a new Storacha account using email verification.

```javascript
async function handleEmailLogin() {
	// Validates email input
	// Calls createStorachaAccount(email)
	// Displays success/error messages
}
```

#### `handleCredentialsLogin(useStoredCredentials = false)`

Authenticates using private key and delegation proof.

```javascript
async function handleCredentialsLogin(useStoredCredentials = false) {
	// Loads credentials from form or localStorage
	// Initializes Storacha client
	// Saves credentials for auto-login
	// Sets up current space
}
```

#### `handleLogout()`

Logs out and clears stored credentials.

### Space Management

#### `loadSpaces()`

Fetches and displays available spaces.

#### `handleCreateSpace()`

Creates a new storage space.

#### `selectSpace(space)`

Switches to a different space.

### Backup Operations

#### `handleBackup()`

Backs up the current OrbitDB database to Storacha.

```javascript
async function handleBackup() {
	// Validates prerequisites (login, OrbitDB initialized, todos exist)
	// Calls backupTodoDatabase(client)
	// Updates UI with progress and results
	// Auto-refreshes backup list if visible
}
```

#### `loadBackups()`

Fetches and displays backup list.

#### `viewBackupDetails(backup)`

Downloads and displays detailed backup information.

### Credential Management

#### `saveCredentials(key, proof)`

Securely stores credentials in localStorage.

#### `loadCredentials()`

Retrieves stored credentials for auto-login.

#### `clearStoredCredentials()`

Removes stored credentials.

#### `hasStoredCredentials()`

Checks if valid credentials are stored.

## UI Components

### Header

- Collapsible component with show/hide toggle
- Cloud icon and title
- Status indicator

### Status Messages

- Error messages (red) with AlertCircle icon
- Success messages (green) with CheckCircle icon
- Loading status (blue) with spinning Loader2 icon
- Auto-hide after 5 seconds

### Authentication Panel

Two-column button layout:

- **Create New Account** - Email-based account creation
- **Login with Credentials** - Key + proof authentication

### Account Management

When logged in, displays:

- Connection status with green checkmark
- Current space information
- Logout button

### Action Buttons

Three-column grid:

- **Manage Spaces** - Space management panel
- **Backup Database** - One-click backup (disabled if no todos)
- **View Backups** - Backup list panel

### Spaces Panel

- List of available spaces with DID truncation
- Create new space input with plus button
- Select/Current space indicators
- Scrollable list with custom scrollbar styling

### Backups Panel

- Chronologically sorted backup list
- Backup metadata display (name, timestamp, block count)
- CID truncation for readability
- Details button for each backup
- Scrollable list with custom scrollbar styling

## Styling

The component uses Tailwind CSS with:

- Gradient backgrounds (blue/indigo theme)
- Dark mode support
- Responsive grid layouts
- Custom scrollbar styling
- Consistent spacing and typography
- Icon integration with Lucide Svelte

### Color Scheme

- **Primary**: Blue tones for main actions
- **Success**: Green for positive states
- **Error**: Red for error states
- **Info**: Blue for information
- **Secondary**: Purple for backup actions

## Auto-Login Behavior

The component automatically attempts login on mount:

1. Checks for stored credentials in localStorage
2. If found, attempts auto-login with stored key/proof
3. On failure, clears invalid credentials
4. Provides silent fallback for first-time users

## Error Handling

Comprehensive error handling for:

- Network connection failures
- Authentication errors
- Backup operation failures
- Invalid credentials
- Missing prerequisites
- Storage access issues

All errors are displayed in user-friendly format with auto-hide functionality.

## Prerequisites

### Required for Backup

- User must be logged in to Storacha
- OrbitDB must be initialized (`$initializationStore.isInitialized === true`)
- At least one todo must exist (`$todosStore.length > 0`)

### Browser Support

- Modern browsers with localStorage support
- JavaScript enabled
- Network access for Storacha API calls

## Integration Notes

### Database Compatibility

- Designed specifically for OrbitDB key-value databases
- Extracts log entries, manifest, access controller, and identity blocks
- Creates comprehensive backup metadata with block summaries

### Storage Format

Backups include:

- Original OrbitDB blocks uploaded to Storacha
- Metadata JSON file with:
  - Database information (name, address, manifest CID)
  - Block summary by type
  - CID mappings (OrbitDB → Storacha)
  - App version and timestamp
  - Backup format version

### Security Considerations

- Credentials stored in browser localStorage
- No credential encryption (browser security model)
- Public backup visibility (Storacha is public storage)
- No backup encryption (OrbitDB data uploaded as-is)

## Example Usage Patterns

### Minimal Setup

```svelte
<script>
	import StorachaIntegration from '$lib/StorachaIntegration.svelte';
</script>

<!-- Add to your main app layout -->
<StorachaIntegration />
```

### With Custom Wrapper

```svelte
<div class="backup-section">
	<h2>Data Backup</h2>
	<StorachaIntegration />
</div>
```

### Conditional Display

```svelte
<script>
	let showBackup = false;
</script>

{#if showBackup}
	<StorachaIntegration />
{/if}

<button on:click={() => (showBackup = !showBackup)}> Toggle Backup Panel </button>
```

## Customization

The component is designed to be self-contained but can be customized by:

- Modifying the CSS classes for different styling
- Extending the backup metadata format
- Adding custom validation logic
- Implementing different credential storage methods
- Adding additional backup destinations

## Related Files

- `src/lib/storacha-backup.js` - Core backup functionality
- `src/lib/db-actions.js` - Database operations and stores
- `src/lib/p2p.js` - P2P initialization store

This component provides a complete, production-ready solution for integrating Storacha backup functionality into any OrbitDB-based application.
