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
RELAY_BUTTON_E2E_PRIVATE_KEY=0x... RELAY_BUTTON_E2E_SSH_PUBLIC_KEY="ssh-ed25519 ..." pnpm exec playwright test e2e/relay-button-provisioning.spec.js --project=chromium --workers=1
```

The wallet must have enough Aleph credits to create a temporary VM. The test
signs the Sponsor Relay requests through an injected EIP-1193 provider, waits
for the relay health endpoint and browser multiaddresses, connects two browsers
through the custom-multiaddress UI, and verifies bidirectional replication in
the main app's default OrbitDB database. It deletes the temporary relay during
cleanup. CI reads the private key from the dedicated
`RELAY_BUTTON_E2E_PRIVATE_KEY` repository secret and the public SSH key from the
`RELAY_BUTTON_E2E_SSH_PUBLIC_KEY` repository variable; never store the private
key in a tracked `.env` file.

Run the relay-pinning proof against a local `orbitdb-relay` checkout:

```bash
pnpm --dir /Users/nandi/orbitdb-relay run build
pnpm run test:e2e:local-relay-src
```

`E2E_RELAY_CLI_PATH` can point the local E2E server at another relay build.
`E2E_RELAY_HTTP_ORIGIN` is required when a pinning proof calls
`/pinning/sync` and `/pinning/databases`.

## Remote browser replication providers

`remote-replication.yml` keeps browser A on the GitHub runner and supports three
providers for browser B: `aleph` (default), `local`, and the temporary legacy
`testingbot` adapter. The Aleph provider deploys a uniquely named VM
(`simple-todo-<run_id>-<run_attempt>`), installs Playwright 1.61.1 through SSH,
and connects through a per-run Bearer-authenticated WSS endpoint. It accepts only
`https://api2.aleph.im` followed by `https://api.aleph.im`; caller-provided api3
or unrelated hosts are removed.

Normal teardown erases the runtime, sends an owner-signed FORGET for the exact
INSTANCE hash, verifies the forgotten state on api2 and api, and waits for
scheduler deallocation. The guest also powers itself off after 45 minutes. This
TTL limits browser exposure but cannot sign a FORGET after a cancelled GitHub
job. Phase B still needs an external janitor that records INSTANCE hashes before
cancellation and repeats erase/FORGET/deallocation verification for orphans.

The workflow requires a funded `ALEPH_PLAYWRIGHT_PRIVATE_KEY` repository secret,
falling back temporarily to `RELAY_BUTTON_E2E_PRIVATE_KEY`. The SSH key and WSS
credential are generated per run; the credential is masked and is not uploaded
with evidence. Do not run this paid live job concurrently with another Aleph VM
provisioning test. Use `provider=local` for free development runs.

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
