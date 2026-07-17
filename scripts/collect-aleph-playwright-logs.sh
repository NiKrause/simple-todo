#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/remote-main
if [[ -z ${ALEPH_PLAYWRIGHT_HOST:-} || -z ${ALEPH_PLAYWRIGHT_SSH_PORT:-} || -z ${ALEPH_PLAYWRIGHT_SSH_KEY:-} ]]; then
	echo 'Guest log collection skipped: SSH runtime details unavailable.' >test-results/remote-main/aleph-guest.log
	exit 0
fi
ssh -i "$ALEPH_PLAYWRIGHT_SSH_KEY" -p "$ALEPH_PLAYWRIGHT_SSH_PORT" \
	-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@"$ALEPH_PLAYWRIGHT_HOST" \
	'journalctl -u aleph-playwright-server -u aleph-playwright-auth-proxy -u aleph-playwright-runner-ttl --no-pager -n 400' \
	>test-results/remote-main/aleph-guest.log 2>&1 || true
