# Simple Todo - A Local-First Peer-to-Peer PWA Tutorial

[![Main E2E](https://github.com/NiKrause/simple-todo/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/NiKrause/simple-todo/actions/workflows/deploy.yml?query=branch%3Amain)
[![Remote browser replication](https://github.com/NiKrause/simple-todo/actions/workflows/remote-replication.yml/badge.svg?branch=main)](https://github.com/NiKrause/simple-todo/actions/workflows/remote-replication.yml)

A basic decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

> 📚 **This repository is a tutorial.** Its branches — `main`, `collab01`, `passkey01`, `acl01`, `privacy01` — are chapters that build the app up step by step, so they are kept separate rather than merged into one another. This is the `privacy01` chapter (encrypted private lists, built on `acl01`).

## 🚀 Live Demo

- **This chapter (privacy01)**: https://privacy01.le-space.de
- **Previous chapter (acl01)**: https://acl01.le-space.de
- **Main app**: https://simple-todo.le-space.de
- **IPFS snapshot (Aleph gateway)**: https://ipfs.aleph.im/ipfs/bafybeigo5dip5jl5q6tzyp7xqtnzml25lbbw4y34kvkukgsa7au6qie37y/
- **IPFS snapshot (dweb.link)**: https://dweb.link/ipfs/bafybeigo5dip5jl5q6tzyp7xqtnzml25lbbw4y34kvkukgsa7au6qie37y/

The custom-domain link tracks the current deployment. The immutable CID links above are a snapshot
of the deployment published on July 11, 2026.

## 🔐 This Chapter: Encrypted Private Lists (`privacy01`)

`acl01` answers _who may write_. It cannot answer _who may read_, and that is not
an oversight in this app — **OrbitDB has no read permission at all.** Whoever holds
a database address and reaches a peer that has it reads everything in it, forever.
The address _is_ the permission.

This chapter fixes that where it can be fixed: in the data. A private list is
**sealed**, so holding the address buys replication and nothing else.

### What is encrypted, and what is not

|                                                    | Sealed?                                |
| -------------------------------------------------- | -------------------------------------- |
| A **private list** you create                      | yes — AES-GCM, a fresh nonce per entry |
| The **shared mnemonic list** (`luna-camino-verde`) | **no**, deliberately                   |
| Somebody else's list you open by address           | no — you have no key for it            |

The shared list stays in the clear on purpose. It is `write: ['*']` and several
browsers collaborate on it; a key that never leaves one browser would break the
collaboration the earlier chapters teach rather than protect it.

### How a second person gets in

Every identity generates an **ECDH P-256 key pair** on first use and publishes the
public half in a small, public directory. When you grant a DID write access, the
app also seals a copy of that list's key to that DID's published key — an
_envelope_. The wrapped copies replicate in the open, because each one opens only
for its recipient.

```
your list key K ──AES-GCM──▶ the todos
       │
       └──wrapped to Bob's public key──▶ published; only Bob can open it
```

Two details that are easy to get wrong and are handled here:

- **The directory verifies who wrote an entry.** Anyone may publish into it, so
  without that check Eve could put _her_ key under Bob's DID and read everything
  Alice ever grants him. An entry counts only when the identity that signed it is
  the DID it claims.
- **A key that arrives is picked up by reopening the list.** `orbitdb.open`
  returns a database it already has open and ignores the options, so a list you
  opened before you were admitted has to be closed first — otherwise the
  decryptor is passed and silently dropped.

### What this does _not_ do

Stated plainly, because encryption invites more confidence than it earns:

- **No revocation.** A key handed over cannot be taken back. Removing a reader
  means a new key and re-wrapping for everyone else, and everything written under
  the old key stays readable to whoever kept it. That is what a shared secret is.
- **The keys sit in local storage in the clear** — the list keys and the device's
  private half alike, no better protected than anything else in the browser.
  Binding them to the passkey is the next step (#277 phase 1.5).
- **Metadata is not hidden.** Who wrote, how often and when stays visible to
  anyone replicating the list, including a relay. Only the contents are sealed.
- **Nothing survives a reload yet.** This chapter runs Helia in memory
  (`createHeliaLight` with no blockstore), so a list created only in this browser
  does not come back — which is a property of the chapter, not of the encryption.
- **A relay cannot replicate a sealed list properly.** That needs a _second_ key,
  for replication rather than content, and it is the subject of `privacy02`
  (#277 phase 2.5).

### Try it

1. Create a private list and add a todo.
2. Open the same address in a second browser with its own passkey — the list
   replicates and the todo is **not** readable.
3. Grant that browser's DID write access in the permissions panel.
4. Open the list by address again in the second browser: the todo is there.

## 🔑 Inherited from `acl01`: Per-DID Write Permissions

Built on `passkey01`. Passkey identities become _meaningful_: you can grant
specific DIDs write access to a list of yours.

- **Public list stays public.** The mnemonic shared list from `collab01`
  keeps `write: ['*']` — open collaboration is unchanged.
- **Private lists are owner-only.** "Create private list" opens a new
  database on OrbitDB's mutable `OrbitDBAccessController` with
  `write: [your identity]`. Only you can write until you grant others.
- **Grant / revoke at runtime.** The permissions panel lists the write DIDs
  and lets the list admin add or remove them. The access controller is a
  replicated OrbitDB store, so grants propagate to peers **without changing
  the list's address**.
- **Sharing is by address.** A private list is shared via its full
  `/orbitdb/…` address (the "Open a shared list by address" form). Readers
  can replicate immediately; writing needs a grant.
- **Denied writes fail loudly.** A write from an unauthorized identity is
  rejected inside OrbitDB's `canAppend` gate _before_ anything is appended,
  so nothing ever looks saved — the UI shows a clear "no write permission,
  ask the owner to add your DID" message instead of crashing.

### Alice ↔ Bob walkthrough

1. Alice creates a private list `alice-todos` and adds a todo. She copies its
   `/orbitdb/…` address.
2. Bob opens that address, sees Alice's todo (read/replication works), but
   his own write is **denied** with a visible error.
3. Alice pastes Bob's DID into the permissions panel and grants write.
4. Bob writes again → success; both see both todos. The reverse (Bob owner,
   Alice guest) works identically.

### ⚠️ Relay / access-controller version compatibility

The chosen access-controller type must be known to the relay/pinner that
replicates the list. `orbitdb-relay` registers `orbitdb`,
`orbitdb-deferred` and `todo-delegation`; this chapter uses the built-in
`orbitdb` type, so no extra relay configuration is needed. If you switch to
a custom controller such as
[`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo)
(a token-delegation controller, a good follow-up exercise), keep its
version in sync between the app and the relay, or replication of the
controller's own store will fail.

## 🔐 Passkey Identities (from `passkey01`)

The previous chapter (`collab01`) gave every browser a random throwaway
OrbitDB identity: entries were attributable to _a_ peer, but not to _you_.
This chapter replaces that with an opt-in **passkey-backed identity**:

- **Onboarding choice** before the P2P stack starts: _create a passkey_
  (one name, and it is only a label), _use an existing passkey_ (recovery),
  or _continue without one_ (exactly the previous chapter's behaviour).
- **Keystore-based DID provider** from
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did)
  with `encryptKeystore`: an Ed25519 OrbitDB signing key is encrypted at
  rest and unlocked with **one WebAuthn prompt per session**. (The stricter
  _varsig_ variant — a passkey prompt for every single write — exists in the
  same package and is a good follow-up exercise, but is not used here.)
- **Create-or-recover flow** (`src/lib/passkey-identity.js`): identity
  metadata is written to the authenticator's `largeBlob` when supported and
  always to `localStorage` as fallback; recovery tries `largeBlob` first.
  This flow currently lives here — upstreaming it into the provider package
  is an open TODO.
- **Visible identity**: your DID appears in the header (shortened, with a
  copy button), and every todo shows its author resolved from
  `entry.identity` — the field OrbitDB signs itself, so it cannot be faked
  by writing a different name into the todo payload.
- **Access control is unchanged** (`write: ['*']`): this chapter is only
  about _who you are_, not yet about _who may write_. That is the next
  chapter (`acl01`).

### The name you type is a label, not your identity

The onboarding form asks for one name, and nothing depends on it. A passkey
carries two human-readable fields (`user.name` and `displayName`) that exist
only so the browser's passkey picker has something to show. What identifies
the credential is the **user handle**, 64 random bytes the identity provider
generates — and your DID comes from the credential's public key, not from
either of them. Two people on the same device may type the same name and
still get two separate identities.

That is worth stating because it was not always true. While the handle was
derived from the typed name, an authenticator — which keeps one credential
per (origin, handle) — silently **replaced** the earlier passkey when a
second person used the same name, taking the DID and everything signed under
it with it
([provider #45](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did/issues/45)).
The WebAuthn spec says the handle must not contain personal data such as a
username or e-mail address, and should be random, for exactly this reason.

### ⚠️ Passkeys are bound to the origin (rpId)

A WebAuthn credential is scoped to the domain that created it. A passkey
registered on `http://localhost:5173` does **not** exist on
`https://simple-todo.le-space.de`, and a passkey created on one IPFS
gateway (`dweb.link`) is invisible on another (`ipfs.aleph.im`) — even for
the identical app build. For a local-first app distributed through many
gateways this is a real constraint: your DID is only portable across
devices via passkey sync (iCloud Keychain, Google Password Manager, …), not
across origins. Pin one canonical domain if stable identities matter.

## 🎯 What is this?

This is a **browser-only** local-first peer-to-peer todo application that operates without any traditional server infrastructure. It connects directly to other browsers and mobile devices through peer-to-peer connections, creating a truly decentralized experience. So far, a LibP2P signaling node is necessary to connect the peers, and in this version it also stores the todos since this browser version works with MemoryStorage only instead of local IPFSStorage (e.g. LevelBlockstore).

### Main Branch Scope

This branch extends the basic `main` tutorial with a three-word Spanish shared-list mnemonic, for example `luna-camino-verde`. The normalized mnemonic is the OrbitDB database name: two browsers enter the same words to open and replicate the same list without exchanging a full OrbitDB address. The mnemonic is only a convenient public share code—not a password, recovery phrase, encryption key, or access-control mechanism. Anyone who knows or guesses it can discover and edit the public writable list.

> **Collaboration examples:** [`collab01`](https://github.com/NiKrause/simple-todo/tree/collab01) demonstrates mnemonic-based shared lists.

### Key Features

- ✅ **No Server Required** - PWA runs in browser, desktop or mobile.
- ✅ **Local Data** - Data is stored in your browser's level storage and replicated via OrbitDB and IPFS
- ✅ **Peer-to-Peer Communication** - Browsers connect directly via WebRTC (with help of libp2p signaling nodes)
- ✅ **Real-time Synchronization** - Changes appear instantly across all peers

## 🎯 How to Test

1. **Open Two Browser Windows** - You need at least two browser instances, a mobile device, or ask another distant person to open the app
2. **Load the Same URL** - All app users should load the same app URL
3. **Choose the Shared List** - Copy the three-word mnemonic from the first browser and paste it into the second
4. **Accept Consent and Open** - Check all consent boxes and select **Open shared list**
5. **Wait for Connection** - The app will automatically discover and connect peers
6. **Add Todos** - Create todos in one browser and watch them appear in the other

### Try this chapter (per-DID write permissions)

The mnemonic list above stays public. To exercise access control, create a
**private list** and share it by address:

1. In browser A (owner), pick **Create a passkey** during onboarding, then
   click **Create private list**. Add a todo and copy the shown
   `/orbitdb/…` address.
2. In browser B (guest), create a _different_ passkey, paste the address into
   **Open a shared list by address**, and open it. You see the owner's todo,
   but adding one is **denied** with a visible error.
3. In browser A, copy browser B's **Passkey DID** (its header badge) into the
   **Write permissions** panel and click **Add DID**.
4. In browser B, add the todo again → it succeeds and both browsers converge.
   Owner and guest roles are symmetric — try it the other way around too.

See the full [Alice ↔ Bob walkthrough](#alice--bob-walkthrough) above for the
same flow described step by step.

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
# checkout main branch
git checkout main

# install dependencies and start the development server
pnpm install
pnpm dev
```

## 🛰️ Local Relay

In development the app reads `VITE_RELAY_BOOTSTRAP_ADDR_DEV` from `.env`. If that variable is not set, it falls back to a hardcoded localhost relay address, so the safest local workflow is:

1. Start an `orbitdb-relay` process.
2. Copy its WebSocket multiaddr into `.env`.
3. Start or restart the Vite dev server.

Install and run the published npm package:

```bash
npm install -g orbitdb-relay

ENABLE_GENERAL_LOGS=1 \
RELAY_LISTEN_IPV4=127.0.0.1 \
RELAY_DISABLE_IPV6=true \
RELAY_DISABLE_QUIC=true \
RELAY_DISABLE_WEBRTC=true \
DATASTORE_PATH=/tmp/simple-todo-orbitdb-relay \
orbitdb-relay --test
```

The relay exposes helper routes on `http://127.0.0.1:9090`. In another terminal, fetch the browser-dialable WebSocket address:

```bash
curl -s http://127.0.0.1:9090/multiaddrs | node -e "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => { const j = JSON.parse(d); console.log(j.best.websocket || j.byTransport.websocket[0]); });"
```

Use exactly one printed `/ws` address. Do not paste the raw TCP address on port `9091`, and do not include quotes, commas, or multiple addresses in one value.

Put the printed address in `.env`. If you copied `.env.example`, replace the existing `VITE_RELAY_BOOTSTRAP_ADDR_DEV` value:

```bash
VITE_RELAY_BOOTSTRAP_ADDR_DEV=/ip4/127.0.0.1/tcp/9092/ws/p2p/<relay-peer-id>
```

Then start the app:

```bash
pnpm dev
```

If you change `.env` while Vite is already running, restart `pnpm dev` so the new relay address is loaded.

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
