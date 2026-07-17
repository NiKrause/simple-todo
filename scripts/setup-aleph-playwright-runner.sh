#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
	echo 'Guest setup must run as root.' >&2
	exit 1
fi

test -s /etc/aleph-playwright-runner.secret
test -s /tmp/aleph-playwright-runner.crt
test -s /tmp/aleph-playwright-runner.key
install -d -m 0755 /opt/aleph-playwright-runner
install -m 0644 /tmp/aleph-guest-proxy.mjs /opt/aleph-playwright-runner/proxy.mjs
install -m 0644 /tmp/aleph-playwright-runner.crt /etc/aleph-playwright-runner.crt
install -m 0600 /tmp/aleph-playwright-runner.key /etc/aleph-playwright-runner.key

stop_rootfs_web_services() {
	for service in \
		orbitdb-relay-pinner.service \
		orbitdb-relay-setup.service \
		nginx.service \
		apache2.service \
		lighttpd.service; do
		systemctl disable --now "$service" 2>/dev/null || true
	done
}

stop_rootfs_web_services
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs
npm install --prefix /opt/aleph-playwright-runner --omit=dev --no-audit --no-fund \
	playwright@1.61.1 http-proxy@1.18.1
/opt/aleph-playwright-runner/node_modules/.bin/playwright install --with-deps chromium

# Phase A intentionally reuses the relay RootFS. Stop its application services,
# but preserve Caddy as the TLS terminator. A per-run certificate avoids relying
# on a CRN's optional 2n6-to-guest IPv6 route.
stop_rootfs_web_services
if ! command -v caddy >/dev/null; then
	echo 'The Phase A RootFS does not provide the Caddy TLS terminator.' >&2
	exit 1
fi

install -d -m 0755 /etc/caddy
if [[ -f /etc/caddy/Caddyfile ]]; then
	cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-playwright
fi
cat >/etc/caddy/Caddyfile <<'CADDY'
https://:443 {
	tls /etc/aleph-playwright-runner.crt /etc/aleph-playwright-runner.key
	reverse_proxy 127.0.0.1:3100
}
CADDY
caddy validate --config /etc/caddy/Caddyfile

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
systemctl enable caddy.service
systemctl restart caddy.service
systemctl enable --now aleph-playwright-runner-ttl.timer

for _ in {1..60}; do
	if curl -fsS -H "Authorization: Bearer $(cat /etc/aleph-playwright-runner.secret)" \
		http://127.0.0.1:3100/version | grep -q '"playwrightVersion":"1.61.1"'; then
		exit 0
	fi
	sleep 2
done

journalctl -u aleph-playwright-server -u aleph-playwright-auth-proxy -u caddy --no-pager -n 150 >&2
exit 1
