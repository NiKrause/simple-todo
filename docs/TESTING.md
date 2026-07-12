# Testing Guide

This document explains how to run the Playwright tests for the Simple Todo consent screen functionality both locally and on BrowserStack.

## Overview

The test suite includes comprehensive cross-browser testing for the consent screen modal functionality, including:

- Modal display and visibility
- Checkbox interactions and validation
- Proceed button state management
- Consent persistence functionality
- Feature information display

## Test Structure

### Files

- `e2e/consent-screen.spec.js` - Main consent screen test suite
- `playwright.config.js` - Configuration for local and BrowserStack testing
- `scripts/browserstack-local.js` - BrowserStack Local tunnel management
- `.github/workflows/browserstack-tests.yml` - CI/CD automation

### Test Cases

1. **Consent Modal Display** - Verifies the modal appears and contains required elements
2. **Checkbox Validation** - Tests that all checkboxes must be checked to proceed
3. **Consent Persistence** - Validates the "Don't show again" functionality
4. **Feature Information** - Ensures all required consent information is displayed

## Local Testing

### Prerequisites

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Install Playwright browsers:
   ```bash
   pnpm exec playwright install --with-deps
   ```

### Running Tests

Run all tests locally:

```bash
pnpm run test:e2e
```

Run only consent screen tests:

```bash
pnpm run test:consent
```

Run collaboration tests against a public relay/bootstrap setup:

```bash
E2E_RELAY_HTTP_ORIGIN=https://your-relay.example pnpm run test:e2e:public-relay
```

Run the relay-pinned proof against the local `orbitdb-relay` checkout:

```bash
pnpm --dir /Users/nandi/orbitdb-relay run build
pnpm run test:e2e:local-relay-src
```

`E2E_RELAY_MODE=public` makes the app use production bootstrap discovery through
`@le-space/aleph-bootstrap`. Set `E2E_PUBLIC_RELAY_BOOTSTRAP_ADDR` when you want
to force a specific public relay multiaddr instead of relying on Aleph discovery.
`E2E_RELAY_HTTP_ORIGIN` is required for the relay pinning proof because the tests
call `/pinning/sync` and `/pinning/databases`. The relay-pinned proof tests are
opt-in through `E2E_RELAY_PINNING_PROOF=true`; the public-relay script sets that
flag automatically.

`E2E_RELAY_CLI_PATH` can point the local e2e server at a relay build outside this
project; `test:e2e:local-relay-src` uses `/Users/nandi/orbitdb-relay/dist/cli.js`.

## Cross-network TestingBot replication

The `collab01` remote workflow controls two browsers in one GitHub job:

- Agent A runs in local Chromium on the GitHub-hosted runner.
- Agent B runs in TestingBot Chrome on a separate provider network.
- Both load the deployed `https://collab01.le-space.de` PWA.
- The coordinator exchanges control state only. OrbitDB/libp2p carries application data.

The deployment workflow triggers the remote workflow only after publication and custom-domain linking succeed. It can also be started manually:

```bash
gh workflow run remote-replication.yml \
  --repo NiKrause/simple-todo \
  --ref collab01 \
  -f app_url=https://collab01.le-space.de \
  -f provider=testingbot
```

Required repository secrets:

- `TESTINGBOT_KEY`
- `TESTINGBOT_SECRET`
- `RELAY_BOOTSTRAP_ADDR_PROD`

The summary distinguishes passive replication from a pass that required explicit relay recovery. A recovery pass is valuable store-and-forward evidence, but must not be described as fully passive convergence. See [the milestone report](./REMOTE_REPLICATION_MILESTONE.md) for a successful run, screenshots, video, exact record proof, and remaining work.

Run with UI mode for debugging:

```bash
pnpm exec playwright test --ui
```

## BrowserStack Testing

### Setup

1. Sign up for a [BrowserStack](https://www.browserstack.com/) account
2. Get your username and access key from Account Settings
3. Copy the environment template:
   ```bash
   cp .env.browserstack.example .env.local
   ```
4. Fill in your credentials in `.env.local`

### Local BrowserStack Testing

Test on BrowserStack while running the app locally:

```bash
pnpm run test:consent:browserstack
```

### GitHub Actions Integration

The project includes automated BrowserStack testing via GitHub Actions.

#### Secrets Required

Add these secrets to your GitHub repository:

- `BROWSERSTACK_USERNAME` - Your BrowserStack username
- `BROWSERSTACK_ACCESS_KEY` - Your BrowserStack access key

#### Workflow Triggers

The workflow runs on:

- Push to `main` or `develop` branches
- Pull requests to `main`
- Manual trigger via GitHub UI

## Supported Browsers & Platforms

### Desktop Browsers

| Browser | Windows 11 | macOS Monterey | Linux Ubuntu 20.04 |
| ------- | ---------- | -------------- | ------------------ |
| Chrome  | ✅         | ✅             | ✅                 |
| Firefox | ✅         | ✅             | ❌                 |
| Edge    | ✅         | ❌             | ❌                 |
| Safari  | ❌         | ✅             | ❌                 |
| Opera   | ✅         | ❌             | ❌                 |

### Mobile Browsers

| Browser | iOS 16 | Android 12 |
| ------- | ------ | ---------- |
| Safari  | ✅     | ❌         |
| Chrome  | ❌     | ✅         |

### Browser Notes

- **Brave**: Not available on standard BrowserStack plans. For Brave testing, install locally and use `channel: 'brave'` in local configuration
- **Opera**: Available on Windows only through BrowserStack
- **Mobile Safari**: Tested on iPhone 14
- **Mobile Chrome**: Tested on Samsung Galaxy S22

## Test Configuration

### BrowserStack Capabilities

The tests use these BrowserStack-specific configurations:

```javascript
{
  'browserstack.local': 'true',        // Enable local testing
  'browserstack.debug': 'true',        // Enable debugging
  'browserstack.console': 'verbose',   // Verbose console logs
  'browserstack.networkLogs': 'true'   // Network logging
}
```

### Timeouts

- Test timeout: 60 seconds
- Expect timeout: 30 seconds
- Server startup timeout: 60 seconds

## Troubleshooting

### Common Issues

1. **BrowserStack tunnel fails to connect**
   - Check your access key is correct
   - Ensure firewall allows BrowserStack Local connections
   - Try restarting the tunnel: `pnpm run test:browserstack:local`

2. **Tests timeout on mobile devices**
   - Mobile devices may be slower to load
   - Consider increasing timeouts for mobile-specific tests

3. **Consent modal not found**
   - Ensure localStorage is cleared between tests
   - Check that the app is properly built and served

4. **GitHub Actions failing**
   - Verify BrowserStack secrets are properly set
   - Check if BrowserStack account has sufficient parallel testing slots

### Debug Mode

Enable debug mode for detailed logs:

```bash
DEBUG=playwright:* pnpm run test:consent
```

### Local Development

For faster iteration during development:

1. Start the dev server:

   ```bash
   pnpm run dev
   ```

2. Update `playwright.config.js` to use `http://localhost:5173`

3. Run tests against the dev server

## Reporting

### Local Reports

Playwright generates HTML reports after test runs:

```bash
pnpm exec playwright show-report
```

### CI Reports

GitHub Actions uploads:

- Test results as artifacts
- Playwright HTML reports
- Screenshots and videos on failure

Reports are available in the Actions tab and retained for 30 days.

## Best Practices

1. **Test Isolation**: Each test starts with a clean browser context
2. **Explicit Waits**: Use Playwright's built-in waiting mechanisms
3. **Stable Selectors**: Use data-testid attributes when possible
4. **Error Handling**: Tests handle both success and failure scenarios
5. **Resource Cleanup**: Tests clean up localStorage and other state

## Contributing

When adding new tests:

1. Follow the existing test structure
2. Add appropriate browser coverage
3. Update this documentation
4. Ensure tests work both locally and on BrowserStack

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [BrowserStack Automate Documentation](https://www.browserstack.com/docs/automate)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
