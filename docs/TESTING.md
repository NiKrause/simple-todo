# Testing Guide

The test suite runs locally with Playwright's Chromium project. The configured
web server starts the app and its local relay automatically.

## Setup

Install dependencies and Chromium:

```bash
pnpm install
pnpm exec playwright install chromium
```

## Commands

Run unit tests:

```bash
pnpm run test:unit
```

Run all end-to-end tests:

```bash
pnpm run test:e2e
```

Run the mnemonic-specific isolation and two-browser replication scenario:

```bash
pnpm exec playwright test e2e/shared-list-mnemonic.spec.js --project=chromium
```

This test copies Alice's visible three-word Spanish share code into Bob's startup form, proves both derive the same OrbitDB address, verifies bidirectional replication, and confirms a third browser using another mnemonic remains isolated.

Run only consent-screen tests:

```bash
pnpm run test:consent
```

Run against a public relay/bootstrap setup:

```bash
pnpm run test:e2e:public-relay
```

Run the relay-pinning proof against a local `orbitdb-relay` checkout:

```bash
pnpm --dir /Users/nandi/orbitdb-relay run build
pnpm run test:e2e:local-relay-src
```

`E2E_RELAY_CLI_PATH` can point the local E2E server at another relay build.
`E2E_RELAY_HTTP_ORIGIN` is required when a pinning proof calls
`/pinning/sync` and `/pinning/databases`.

## Per-todo delegation (`delegation01`)

The chapter's rules — who may act on a delegated todo, and how revoke and
expiry fold a delegate's actions back out — are pure functions in
`src/lib/delegation.js`, covered by `src/lib/delegation.spec.js`
(`pnpm run test:unit`, runs in a headless Chromium through vitest).

The browser proof is `e2e/delegation.spec.js`: three passkey identities
(Alice, Bob, Mallory) in separate contexts with virtual authenticators. It
checks that only the delegate's row is writable, that a delegated completion
and rename replicate to the owner, that the passkey prompt happened (the
`delegated-auth-state` badge), and the revoke and expiry paths.

```bash
pnpm exec playwright test e2e/delegation.spec.js --project=chromium
```

## Debugging

Open Playwright UI mode:

```bash
pnpm exec playwright test --ui --project=chromium
```

Run headed with the Playwright Inspector:

```bash
PWDEBUG=1 pnpm exec playwright test --project=chromium --headed
```

Show the last HTML report:

```bash
pnpm exec playwright show-report
```

Screenshots are captured on failure, videos are retained on failure, and a
trace is collected on the first retry.
