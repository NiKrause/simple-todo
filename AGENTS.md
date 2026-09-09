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
| bitswap — sets it on `handle`, drops it on the dial, and never asks to hear about limited peers; the documented option reaches neither site, in any published version (ipfs/helia#1124 — `Le-Space/ablage` carries a two-line patch) | no |

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

**And the relay's budget is the other half.** `applyDefaultLimit` is `true` by
default in `@libp2p/circuit-relay-v2`, which grants **128 KiB and two minutes**
per circuit — and that budget covers everything on it. Measured in ablage: 256
KiB crosses a circuit whose relay grants 1 GiB and does not cross the same
circuit at library defaults. So the flag decides whether a protocol *may* use a
circuit; the relay's limits decide how much it can move.

**The relay-only case is measured, in `e2e/replication-without-webrtc.spec.js`.**
Every collaboration spec waits for the connection to become `/webrtc` before
asserting — they measure the path that works. That one holds two browsers on a
circuit, **refuses to proceed if any unlimited connection exists**
(`some(c => c.webrtc || c.limited === false)` must be false, or it is measuring
the wrong thing), and then asks what actually replicated — including whether
the relay was a *participant* rather than a route, since `orbitdb-relay` pins
what it sees and offers no switch to stop.

What crossed was a **live update over gossipsub**, which sets the flag. The
relay had not pinned it yet, so it did not come from the relay — and it did not
come by bitswap either. That distinction is the whole of the section above, and
it is the one that keeps getting argued about: data crossing a circuit is not
evidence that bitswap does.

`initializeWebRTCSetting()` is called at startup (`p2p.js:216`), so
`simpleTodo.webrtcEnabled` is read and the case can be set up. This paragraph
claimed the opposite until #309.
