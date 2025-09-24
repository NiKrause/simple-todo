# GitHub Workflows

This directory contains GitHub Actions workflows for automated testing and continuous integration.

## Workflows

### 🔄 CI Workflow (`ci.yml`)

**Triggers**: Push/PR to `main`, `develop`, `master` branches  
**Purpose**: Basic continuous integration checks  
**Duration**: ~5-10 minutes

**Jobs**:

- ✅ **Lint Code** - ESLint checks (continues on error)
- ✅ **Unit Tests** - Vitest unit tests (continues on error)
- ✅ **Relay Setup Test** - Validates P2P relay server setup
- ✅ **Build App** - Ensures application builds successfully
- ✅ **Security Check** - npm audit for vulnerabilities

### 🧪 E2E Tests Workflow (`e2e-tests.yml`)

**Triggers**: Push/PR to `main`, `develop` branches + manual dispatch  
**Purpose**: End-to-end testing with Playwright  
**Duration**: ~15-20 minutes

**Jobs**:

1. **E2E Tests** (Always runs)
   - ✅ Starts P2P relay server automatically
   - ✅ Runs Playwright tests in Chromium
   - ✅ Uploads test reports and screenshots on failure

2. **Cross-Browser Tests** (PR/Manual only)
   - ✅ Tests across Chromium, Firefox, and WebKit
   - ✅ Matrix strategy for parallel execution
   - ✅ Individual reports for each browser

3. **Health Check** (Always runs)
   - ✅ Relay server health validation
   - ✅ Build verification
   - ✅ Security audit

## Test Features

### 🔗 P2P Relay Integration

- **Automatic startup**: Relay server starts before tests
- **Health validation**: Endpoints tested for connectivity
- **Clean shutdown**: Proper cleanup after tests
- **Environment setup**: Test-specific relay configuration

### 📊 Test Reporting

- **Artifacts**: Test reports, screenshots, videos retained for 30 days
- **Failure Screenshots**: Captured on test failures (7 days retention)
- **Browser Matrix**: Separate reports for each browser in cross-browser tests

### 🛡️ Security & Quality

- **npm audit**: Vulnerability scanning
- **Lint checks**: Code quality validation
- **Build verification**: Ensures deployment readiness

## Running Locally

```bash
# Quick health check (matches CI workflow)
npm run test:relay-setup
npm run build

# Run e2e tests (matches e2e workflow)
npm run test:e2e

# Cross-browser testing
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Manual Workflow Trigger

The E2E workflow can be manually triggered:

1. Go to **Actions** tab in GitHub
2. Select **E2E Tests** workflow
3. Click **Run workflow**
4. Choose branch and click **Run workflow**

This will run both standard e2e tests and cross-browser tests.

## Workflow Status

Add workflow status badges to your main README:

```markdown
[![CI](https://github.com/USERNAME/REPO/workflows/CI/badge.svg)](https://github.com/USERNAME/REPO/actions/workflows/ci.yml)
[![E2E Tests](https://github.com/USERNAME/REPO/workflows/E2E%20Tests/badge.svg)](https://github.com/USERNAME/REPO/actions/workflows/e2e-tests.yml)
```
