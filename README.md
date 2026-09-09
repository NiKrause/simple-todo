# Simple Todo - A Local-First Peer-to-Peer PWA Tutorial

[![Main E2E](https://github.com/NiKrause/simple-todo/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/NiKrause/simple-todo/actions/workflows/deploy.yml?query=branch%3Amain)
[![Remote browser replication](https://github.com/NiKrause/simple-todo/actions/workflows/remote-replication.yml/badge.svg?branch=main)](https://github.com/NiKrause/simple-todo/actions/workflows/remote-replication.yml)

A basic decentralized, local-first, peer-to-peer todo application built with **libp2p**, **IPFS**, and **OrbitDB**. This app demonstrates how modern Web3 technologies can create truly decentralized applications that work entirely in the browser.

> 📚 **This repository is a tutorial.** Its branches — `main`, `collab01`, `passkey01`, `acl01`, `privacy01`, `delegation01` — are chapters that build the app up step by step, so they are kept separate rather than merged into one another. This is the `delegation01` chapter (per-todo delegation, built on `acl01` via `privacy01`).

## 🚀 Live Demo

- **This chapter (delegation01)**: https://delegation01.le-space.de
- **Previous chapter (acl01)**: https://acl01.le-space.de
- **Main app**: https://simple-todo.le-space.de

The custom-domain links track the current deployment of each branch.

## 🤝 This Chapter: Per-Todo Delegation (`delegation01`)

Built on `acl01`. A private list is still owner-only — but the owner can now
hand **one todo** to another DID. That delegate may complete or rename
exactly that todo, and nothing else, until the owner revokes it or the
delegation expires. This is the delegation half of
[de2do](https://github.com/NiKrause/de2do) (the escrow half, where the todo
is backed by funds in a smart contract, is a later chapter), ported onto the
`acl01` foundation: sharing is still by address, permissions still live in
the panel, and the mnemonic list stays public.

- **A delegation is a field on the todo.** The owner writes
  `delegation: { delegateDid, grantedAt, expiresAt, revokedAt }` into the
  todo's own entry — on creation, or later from the row's **Delegate**
  button. Only the owner can, because only the write set may rewrite that
  entry. **Revoke** sets `revokedAt` the same way.
- **A delegate never rewrites the todo.** Their change goes in as a separate
  *delegation action*, keyed `delegation-action/<todoKey>/<delegateDid>/…`,
  signed by the delegate: either `set-completed` or `patch-fields`
  (`text`/`description`). Readers fold these into the todo they name
  (`src/lib/delegation.js`).
- **The access controller admits exactly those.** Private lists now open on
  [`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo),
  the same package de2do and `orbitdb-relay` use. It wraps the `acl01`
  controller — the write set, grant/revoke and the permissions panel are
  unchanged — and additionally lets an entry through when it is a
  well-formed delegation action whose *signer* is the DID in its key.
  Anything else from a non-writer is refused, as before.
- **Revoke and expiry are decided on read, not in the controller.** The
  controller checks the action's shape and signature; it does not look the
  todo up. Whether the todo *currently* delegates to that signer is decided
  by the reader: an action is ignored unless the todo's delegation names its
  signer, is not revoked, and has not expired. So revoking also takes back
  what the delegate already did, and a revoked delegate's later actions are
  accepted into the log but change nothing. This is a client-side rule — a
  peer running different code could keep applying them. Say so in your own
  app; de2do makes the same trade.
- **The owner's later write wins.** An action older than the todo's own
  `updatedAt` is dropped, so an owner can re-open a todo a delegate
  completed. (de2do re-applied every action forever; this is the one place
  the port departs from it.)
- **Every delegated write asks for the passkey again.** The identity's
  signing key is unlocked once per session; a delegate changing someone
  else's todo is the one thing this identity may do on a list it does not
  own, and it should not happen by accident. The header badge shows the
  prompt happen (`src/lib/delegated-write-auth.js`).

### The controller's type is not part of the address

The delegated controller reports `type: 'todo-delegation'`, but the address
it writes into the list's manifest is its wrapped base controller's,
`/orbitdb/<hash>`. OrbitDB picks the controller for a list opened **by
address** from that prefix — so a guest who opens a shared list by address,
which is how every list in this tutorial is shared, would get the plain
`orbitdb` controller, and a delegate's write would be refused on their own
machine before it was ever signed.

de2do sidesteps this by opening every list **by name** with the controller
passed explicitly, which works because its names are derivable
(`<ownerDid>_projects`). Here, lists are shared by address, so this chapter
takes the other route: the delegated controller is registered **as the
`orbitdb` type** (`src/lib/delegated-access.js`). Every `/orbitdb/…`
controller this build opens then checks the delegation rules, and the
manifest stays one that other builds and the relay can still open.

### ⚠️ What the relay makes of a delegate's entries

`orbitdb-relay` registers `todo-delegation` — but for the reason above it
never sees that type in a manifest, so it opens these lists with its built-in
`orbitdb` controller and **rejects delegation actions when it replicates**.
Alice and Bob exchange them directly (that is what the E2E test proves); the
relay pins the owner's entries only. If Alice is offline while Bob
completes, and they only ever meet through the relay, Bob's completion waits
until they are online together. A relay that accepts these entries needs a
controller whose *address* carries its type — a change to the controller
package, and a good follow-up exercise.

### From `privacy01`, switched off

This branch is cut from `privacy01`, so it also carries the per-entry
sealing machinery from that chapter (`src/lib/db-encryption.js`,
`entry-encryption.js`, `database-keys.js`, with their unit tests). Nothing
imports it; lists here are as unencrypted as on `acl01`.

### Alice ↔ Bob ↔ Mallory walkthrough

1. Alice creates a private list, adds a todo and ticks **Delegate this todo
   to another DID**, pasting Bob's DID (optionally with an expiry). She
   copies the list's `/orbitdb/…` address.
2. Bob and Mallory open that address. Both see the todo; both are refused
   when they try to add one. Bob's row is marked *delegate* and its checkbox
   is enabled; Mallory's is not.
3. Bob ticks the todo. His passkey asks for confirmation, the header badge
   shows *Delegated write signed*, and Alice's row shows *completed* with
   *Last changed by delegate*. Bob may also **Rename** it. Anything else on
   the list is still Alice's alone.
4. Alice clicks **Revoke**. Bob's completion disappears on both sides — the
   action still sits in the log, but no reader applies it — and his checkbox
   is disabled again. From the row she can **Re-delegate**, with or without
   an expiry.

## 🔑 Per-DID Write Permissions (from `acl01`)

Built on `passkey01`. Passkey identities become *meaningful*: you can grant
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
  rejected inside OrbitDB's `canAppend` gate *before* anything is appended,
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
`orbitdb-deferred` and `todo-delegation`; `acl01` used the built-in
`orbitdb` type, so no extra relay configuration was needed. `delegation01`
switches to
[`@le-space/orbitdb-access-controller-delegated-todo`](https://www.npmjs.com/package/@le-space/orbitdb-access-controller-delegated-todo)
— see the chapter section above for what that does and does not change
about replication through the relay.

## 🔐 Passkey Identities (from `passkey01`)

The previous chapter (`collab01`) gave every browser a random throwaway
OrbitDB identity: entries were attributable to *a* peer, but not to *you*.
This chapter replaces that with an opt-in **passkey-backed identity**:

- **Onboarding choice** before the P2P stack starts: *create a passkey*
  (one name, and it is only a label), *use an existing passkey* (recovery),
  or *continue without one* (exactly the previous chapter's behaviour).
- **Keystore-based DID provider** from
  [`@le-space/orbitdb-identity-provider-webauthn-did`](https://github.com/Le-Space/orbitdb-identity-provider-webauthn-did)
  with `encryptKeystore`: an Ed25519 OrbitDB signing key is encrypted at
  rest and unlocked with **one WebAuthn prompt per session**. (The stricter
  *varsig* variant — a passkey prompt for every single write — exists in the
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
  about *who you are*, not yet about *who may write*. That is the next
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

### Try this chapter (per-todo delegation)

You need three passkeys — three browsers, or three profiles of one:

1. In browser A (Alice), pick **Create a passkey** during onboarding, click
   **Create private list**, type a todo, tick **Delegate this todo to
   another DID** and paste browser B's **Passkey DID** (its header badge).
   Add it, then copy the `/orbitdb/…` address.
2. In browsers B (Bob) and C (Mallory), each with its own passkey, paste the
   address into **Open a shared list by address**. Both see the todo and
   both are refused when adding one. Only B's checkbox is enabled.
3. In B, tick the todo: the passkey prompt appears, the header shows
   *Delegated write signed*, and A's row updates. Click **Rename** on the
   row in B and watch the new name arrive in A and C.
4. In A, click **Revoke** on the row. The tick disappears in A and B, and
   B's checkbox is disabled. **Re-delegate** from the row to hand it back,
   this time with an expiry a minute ahead, and watch it turn *expired*.

`pnpm exec playwright test e2e/delegation.spec.js` runs this with three
virtual authenticators.

### Try the previous chapter (per-DID write permissions)

The mnemonic list above stays public. To exercise access control, create a
**private list** and share it by address:

1. In browser A (owner), pick **Create a passkey** during onboarding, then
   click **Create private list**. Add a todo and copy the shown
   `/orbitdb/…` address.
2. In browser B (guest), create a *different* passkey, paste the address into
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
