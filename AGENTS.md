# Agent guidance — simple-todo

## This repo is a tutorial; branches are chapters

`simple-todo` is a **tutorial**. Its long-lived git branches are **tutorial
chapters**, not a trunk plus feature branches:

- `main` — base chapter (migrated to the shared `@le-space/playwright` testkit
  - relay-mediated remote-replication E2E).
- `collab01` — multi-database collaboration chapter (mnemonic shared lists,
  entry-protocol-v2, active-orbitdb switching, …).
- `collab02` — follow-on collaboration chapter.
- `fix/collab01-*`, `chore/collab01-*`, … — experiment branches for `collab01`.

These chapters are kept **deliberately separate**. Each teaches a different
stage/topic, so their divergence is intentional.

### Rules

- **Do not merge chapters into each other or into `main`.** No `main → collab01`
  merge, no `collab01 → main` PR. Keeping the chapters distinct is the point.
- **Port improvements surgically, per chapter.** To bring a capability from one
  chapter to another (e.g. the shared testkit or the remote-replication E2E from
  `main`), transplant just the relevant files and **adapt them to that chapter's
  own app code and assertions** — never drag in unrelated commits.
- Ordinary feature/fix work still uses short-lived branches off the relevant
  chapter and merges back into that same chapter.

## A circuit carries data. What stops a protocol is a flag, not the transport

**Read this before concluding that anything "does not work over a relay".** It
is the fact that cost the most time across this project and `Le-Space/ablage`,
and this app's arrangement hides it particularly well.

A circuit relay forwards bytes between two peers and stores nothing. Data
crosses it — measured in ablage over a circuit that was the only path two
browsers had: 1 MiB in 46 ms, 4 MiB in 179 ms, **16 MiB in 585 ms**.

What decides whether a protocol crosses is **`runOnLimitedConnection`**. libp2p
marks a relayed connection *limited* and refuses to open a protocol stream on
one unless the protocol says it may — and **both sides must say it**, on
`node.handle` and on `dialProtocol`. Either alone is still a refusal.

In this app:

| | crosses a circuit |
| --- | --- |
| gossipsub — `libp2p-config.js` sets `runOnLimitedConnection: true` | **yes** |
| OrbitDB's heads sync — `dialProtocol(headsSyncAddress)`, flag set **nowhere** in `@orbitdb/core` | no |
| bitswap — does not set it, and cannot be made to (ipfs/helia#1124) | no |

### Why replication appears to work anyway

Two reasons, and neither is the circuit:

**The relay holds the data.** `orbitdb-relay` runs OrbitDB and pins the
databases, and a browser reaches it over an ordinary `/tls/ws` connection that
is **not** limited. So a fresh database is filled *by the relay*, over a direct
connection — never through a circuit. `expectTodoRelayPinned` in
`default-database-collaboration.spec.js` is asserting exactly this.

**Live updates carry whole entries over pubsub.** `Sync.add()` publishes the
entry bytes (`pubsub.publish(address, bytes)`) and the receiver decodes them
directly — no blockstore, no bitswap. Since gossipsub does set the flag, new
entries reach a peer even across a circuit.

What does **not** work is the browser-to-browser case with no direct path and no
relay holding the data: OrbitDB's join-time heads exchange is refused, and older
entries fetched by CID go through bitswap, which is refused too.

### Two traps

**Tell relayed from direct by `connection.limits == null`, never by the
address.** Measured here, between Alice and Bob:

| address | encryption | muxer | |
| --- | --- | --- | --- |
| `…/p2p-circuit/p2p/<peer>` | `/noise` | `/yamux` | **limited** — the relay carries it |
| `…/p2p-circuit/webrtc/p2p/<peer>` | `native` | `/webrtc` | unlimited — outbound view |
| `/webrtc/p2p/<peer>` | `native` | `/webrtc` | unlimited — inbound view of the same |

The last two are **one connection seen from two ends**: the side that dialled
records the route it signalled over, the side that answered sees only that a
connection arrived. Both are real WebRTC, and the relay carries neither — the
`/p2p-circuit` in the address is a memory of the introduction, not the path in
use.

The e2e hook's `getConnections()` reports `limited`, `encryption`,
`multiplexer` and `direction` for exactly this reason. `/noise` + `/yamux` is
relayed; `native` + `/webrtc` is not.

**The relay's budget is a second thing that can stop a protocol — but not
here.** A circuit carries a data and duration allowance, and it covers
everything on that connection. `@libp2p/circuit-relay-v2` grants **128 KiB and
two minutes** by default, which is nothing: measured in ablage, 256 KiB does not
cross a circuit whose relay is left at library defaults.

`orbitdb-relay` is not left at them. `src/config/circuit-relay-env.ts` sets
**10 GiB and twenty minutes**, deliberately, and says so — *"Defaults are 10× the
previous hardcoded values"*. So for this project the budget has never been the
limit, and a reservation without limits (`applyDefaultLimit: false`) would buy
nothing.

Worth knowing all the same, because the two failures look identical from a
browser: a protocol refused for want of the flag, and a circuit that ran out of
allowance, both simply stop carrying. Check which relay is in play before
concluding either.

**Nothing here tests the relay-only case.** Every collaboration spec waits for
the connection to become `/webrtc` before asserting — it measures the path that
works. `initializeWebRTCSetting()` in `webrtc-settings.js` is never called, so
the stored `simpleTodo.webrtcEnabled` value is not read at startup and the case
cannot currently be set up at all.
