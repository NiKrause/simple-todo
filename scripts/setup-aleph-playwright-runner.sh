#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
	echo 'Guest setup must run as root.' >&2
	exit 1
fi

test -s /etc/aleph-playwright-runner.secret
install -d -m 0755 /opt/aleph-playwright-runner
install -m 0644 /tmp/aleph-guest-proxy.mjs /opt/aleph-playwright-runner/proxy.mjs

stop_rootfs_web_services() {
	for service in \
		orbitdb-relay-pinner.service \
		orbitdb-relay-setup.service \
		caddy.service \
		nginx.service \
		apache2.service \
		lighttpd.service; do
		systemctl disable --now "$service" 2>/dev/null || true
	done
}

stop_rootfs_web_services
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg psmisc
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs
npm install --prefix /opt/aleph-playwright-runner --omit=dev --no-audit --no-fund \
	playwright@1.61.1 http-proxy@1.18.1
/opt/aleph-playwright-runner/node_modules/.bin/playwright install --with-deps chromium

# Phase A intentionally reuses the relay RootFS. Record and release any remaining
# RootFS listener before assigning its public HTTP port to the authenticated proxy.
stop_rootfs_web_services
echo 'Port 80 listeners inherited from the Phase A RootFS:'
ss -ltnp 'sport = :80' || true
fuser -k 80/tcp 2>/dev/null || true
for _ in {1..10}; do
	if ! ss -H -ltn 'sport = :80' | grep -q .; then break; fi
	sleep 1
done
if ss -H -ltn 'sport = :80' | grep -q .; then
	echo 'Port 80 is still occupied after stopping inherited RootFS services:' >&2
	ss -ltnp 'sport = :80' >&2 || true
	exit 1
fi

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
