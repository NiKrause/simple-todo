#!/usr/bin/env bash
set -euo pipefail

: "${ALEPH_PLAYWRIGHT_HOST:?missing host}"
: "${ALEPH_PLAYWRIGHT_SSH_PORT:?missing SSH port}"
: "${ALEPH_PLAYWRIGHT_SSH_KEY:?missing SSH key}"
: "${ALEPH_PLAYWRIGHT_SECRET:?missing per-run secret}"
: "${ALEPH_PLAYWRIGHT_TLS_CERT:?missing per-run TLS certificate}"
: "${ALEPH_PLAYWRIGHT_TLS_KEY:?missing per-run TLS key}"

ssh_opts=(-i "$ALEPH_PLAYWRIGHT_SSH_KEY" -p "$ALEPH_PLAYWRIGHT_SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
scp_opts=(-i "$ALEPH_PLAYWRIGHT_SSH_KEY" -P "$ALEPH_PLAYWRIGHT_SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
for _ in {1..30}; do
	if ssh "${ssh_opts[@]}" root@"$ALEPH_PLAYWRIGHT_HOST" true 2>/dev/null; then break; fi
	sleep 5
done

printf '%s' "$ALEPH_PLAYWRIGHT_SECRET" | ssh "${ssh_opts[@]}" root@"$ALEPH_PLAYWRIGHT_HOST" \
	'umask 077; cat >/etc/aleph-playwright-runner.secret'
scp "${scp_opts[@]}" e2e/remote/aleph-guest-proxy.mjs \
	root@"$ALEPH_PLAYWRIGHT_HOST":/tmp/aleph-guest-proxy.mjs
scp "${scp_opts[@]}" scripts/setup-aleph-playwright-runner.sh \
	root@"$ALEPH_PLAYWRIGHT_HOST":/tmp/setup-aleph-playwright-runner.sh
scp "${scp_opts[@]}" "$ALEPH_PLAYWRIGHT_TLS_CERT" \
	root@"$ALEPH_PLAYWRIGHT_HOST":/tmp/aleph-playwright-runner.crt
scp "${scp_opts[@]}" "$ALEPH_PLAYWRIGHT_TLS_KEY" \
	root@"$ALEPH_PLAYWRIGHT_HOST":/tmp/aleph-playwright-runner.key
ssh "${ssh_opts[@]}" root@"$ALEPH_PLAYWRIGHT_HOST" 'bash /tmp/setup-aleph-playwright-runner.sh'
