#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
	echo 'Guest setup must run as root.' >&2
	exit 1
fi

test -s /etc/aleph-playwright-runner.secret
install -d -m 0755 /opt/aleph-playwright-runner
install -m 0644 /tmp/aleph-guest-proxy.mjs /opt/aleph-playwright-runner/proxy.mjs

systemctl disable --now orbitdb-relay-pinner.service orbitdb-relay-setup.service caddy.service 2>/dev/null || true
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs
npm install --prefix /opt/aleph-playwright-runner --omit=dev --no-audit --no-fund \
	playwright@1.61.1 http-proxy@1.18.1
/opt/aleph-playwright-runner/node_modules/.bin/playwright install --with-deps chromium

cat >/etc/systemd/system/aleph-playwright-server.service <<'UNIT'
[Unit]
Description=Authenticated Aleph Playwright server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aleph-playwright-runner
ExecStart=/opt/aleph-playwright-runner/node_modules/.bin/playwright run-server --host 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/aleph-playwright-auth-proxy.service <<'UNIT'
[Unit]
Description=Authenticated HTTP/WebSocket proxy for Playwright
After=aleph-playwright-server.service
Requires=aleph-playwright-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aleph-playwright-runner
ExecStart=/usr/bin/node /opt/aleph-playwright-runner/proxy.mjs
Restart=on-failure
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/aleph-playwright-runner-ttl.service <<'UNIT'
[Unit]
Description=Stop an orphaned Phase A Playwright VM

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl poweroff
UNIT

cat >/etc/systemd/system/aleph-playwright-runner-ttl.timer <<'UNIT'
[Unit]
Description=Maximum 45 minute lifetime for Phase A Playwright VM

[Timer]
OnActiveSec=45min
AccuracySec=30s
Unit=aleph-playwright-runner-ttl.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now aleph-playwright-server.service aleph-playwright-auth-proxy.service
systemctl enable --now aleph-playwright-runner-ttl.timer

for _ in {1..60}; do
	if curl -fsS -H "Authorization: Bearer $(cat /etc/aleph-playwright-runner.secret)" \
		http://127.0.0.1/version | grep -q '"playwrightVersion":"1.61.1"'; then
		exit 0
	fi
	sleep 2
done

journalctl -u aleph-playwright-server -u aleph-playwright-auth-proxy --no-pager -n 100 >&2
exit 1
