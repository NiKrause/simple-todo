/**
 * The relay this build ships with, chosen at deploy time.
 *
 * Until now nothing was baked in: `VITE_RELAY_BOOTSTRAP_ADDR_PROD` was never
 * set for this branch, so `bakedRelayBootstrapAddrs()` returned an empty list
 * and the first person to tick the relay box paid for an Aleph round trip
 * before anything could be tried. Worse, that made a public directory a
 * dependency of the app working at all: `crns-list.aleph.sh` is itself an Aleph
 * program, and when it answers 502 there is no relay to be had even though one
 * is running.
 *
 * Asking at build time moves that question to a machine that can fail loudly,
 * once, in front of somebody who can read the log. What ships is an address
 * that answered minutes ago rather than a name that might.
 *
 * It never fails the build. An address is an optimisation - the app discovers
 * one at runtime exactly as it does today when this finds nothing - and a deploy
 * that stops because a directory is briefly down would be trading a small
 * problem for a large one.
 */
import { connect } from 'node:tls';
import process from 'node:process';

import { discoverScopedBootstrapMultiaddrs } from '../src/lib/aleph-bootstrap-discovery.js';
import { selectValidBrowserBootstrapMultiaddrs } from '../src/lib/bootstrap-multiaddrs.js';

const PROFILE = process.env.VITE_RELAY_BOOTSTRAP_PROFILE || 'orbitdb-relay';
const REGISTRATION_ID =
	process.env.VITE_RELAY_BOOTSTRAP_REGISTRATION_ID || 'relay:orbitdb-relay:orbitdb-relay';
const REACH_TIMEOUT_MS = Number(process.env.RELAY_REACH_TIMEOUT_MS || 8000);

/** The host and port a browser would open, out of `/dns4/<host>/tcp/<port>/tls/ws/...`. */
function endpointOf(address) {
	const parts = address.split('/').filter(Boolean);
	const host = parts[parts.indexOf('dns4') + 1] ?? parts[parts.indexOf('dns6') + 1];
	const portIndex = parts.indexOf('tcp');
	const port = portIndex >= 0 ? Number(parts[portIndex + 1]) : NaN;
	return host && Number.isFinite(port) ? { host, port } : null;
}

/**
 * Whether something is listening, and whether it will speak TLS.
 *
 * Deliberately not a libp2p handshake. That would prove more and cost a node,
 * a transport stack and a minute of CI; this proves the thing a browser fails
 * on first - a name that no longer resolves, a port nothing answers, a
 * certificate that has lapsed - which is what a stale registration looks like.
 * The comment matters more than the check: this says "reachable", not "healthy".
 */
function reachable({ host, port }) {
	return new Promise((resolve) => {
		const socket = connect({ host, port, servername: host, timeout: REACH_TIMEOUT_MS }, () => {
			socket.destroy();
			resolve(true);
		});
		const fail = () => {
			socket.destroy();
			resolve(false);
		};
		socket.once('error', fail);
		socket.once('timeout', fail);
	});
}

const discovered = await discoverScopedBootstrapMultiaddrs({
	profile: PROFILE,
	registrationId: REGISTRATION_ID
}).catch((error) => {
	process.stderr.write(`relay discovery failed: ${error?.message ?? error}\n`);
	return [];
});

// Ranked the way the app ranks them, so what is baked in is what it would have
// picked: `/tcp/443/tls/ws` first, the rest behind.
const candidates = selectValidBrowserBootstrapMultiaddrs(discovered);
process.stderr.write(`relay candidates: ${candidates.length}\n`);

for (const address of candidates) {
	const endpoint = endpointOf(address);
	if (!endpoint) continue;
	if (await reachable(endpoint)) {
		process.stderr.write(`relay reachable: ${endpoint.host}:${endpoint.port}\n`);
		process.stdout.write(address);
		process.exit(0);
	}
	process.stderr.write(`relay unreachable: ${endpoint.host}:${endpoint.port}\n`);
}

process.stderr.write('no relay answered; the build ships without one\n');
process.stdout.write('');
