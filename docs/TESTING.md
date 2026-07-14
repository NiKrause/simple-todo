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

Run only consent-screen tests:

```bash
pnpm run test:consent
```

Run against a public relay/bootstrap setup:

```bash
pnpm run test:e2e:public-relay
```

Run the complete Sponsor Relay button scenario with a dedicated Aleph test wallet:

```bash
RELAY_BUTTON_E2E_PRIVATE_KEY=0x... pnpm exec playwright test e2e/relay-button-provisioning.spec.js --project=chromium --workers=1
```

The wallet must have enough Aleph credits to create a temporary VM. The test
signs the Sponsor Relay requests through an injected EIP-1193 provider, waits
for the relay health endpoint and browser multiaddresses, connects two browsers
through the custom-multiaddress UI, and verifies bidirectional replication with
the same mnemonic. It deletes the temporary relay during cleanup. CI reads the
key from the dedicated `RELAY_BUTTON_E2E_PRIVATE_KEY` repository secret; never
store the key in a tracked `.env` file.

Run the relay-pinning proof against a local `orbitdb-relay` checkout:

```bash
pnpm --dir /Users/nandi/orbitdb-relay run build
pnpm run test:e2e:local-relay-src
```

`E2E_RELAY_CLI_PATH` can point the local E2E server at another relay build.
`E2E_RELAY_HTTP_ORIGIN` is required when a pinning proof calls
`/pinning/sync` and `/pinning/databases`.

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
