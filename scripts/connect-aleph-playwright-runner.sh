#!/usr/bin/env bash
set -euo pipefail

: "${ALEPH_PLAYWRIGHT_HOST:?missing host}"
: "${ALEPH_PLAYWRIGHT_SSH_PORT:?missing SSH port}"
: "${ALEPH_PLAYWRIGHT_SSH_KEY:?missing SSH key}"
: "${ALEPH_PLAYWRIGHT_SECRET:?missing per-run secret}"
: "${ALEPH_PLAYWRIGHT_VERSION_URL:?missing public version URL}"

public_hostname=$(node -e "process.stdout.write(new URL(process.argv[1]).hostname)" "$ALEPH_PLAYWRIGHT_VERSION_URL")
if [[ ! $public_hostname =~ ^[A-Za-z0-9.-]+$ ]]; then
	echo 'Aleph Playwright public hostname contains unsupported characters.' >&2
	exit 1
fi

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
ssh "${ssh_opts[@]}" root@"$ALEPH_PLAYWRIGHT_HOST" \
	"bash /tmp/setup-aleph-playwright-runner.sh '$public_hostname'"
