import { appendFile } from 'node:fs/promises';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { discoverAlephBootstrapMultiaddrs } from '@le-space/aleph-bootstrap';
import { ping } from '@libp2p/ping';
import { webRTCDirect } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2p } from 'libp2p';
import { resolveBootstrapMultiaddrs } from '../src/lib/bootstrap-multiaddrs.js';

const PROBE_TIMEOUT_MS = Number(process.env.RELAY_BOOTSTRAP_PROBE_TIMEOUT_MS || 10_000);

async function probeBootstrapMultiaddr(address) {
	const node = await createLibp2p({
		transports: [webSockets(), webRTCDirect()],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		services: {
			ping: ping({ timeout: PROBE_TIMEOUT_MS })
		}
	});
	const target = multiaddr(address);

	try {
		try {
			const rtt = await node.services.ping.ping(target, {
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			return { address, reachable: true, method: 'ping', detail: `${rtt}ms` };
		} catch (pingError) {
			try {
				const connection = await node.dial(target, {
					signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
				});
				await connection.close();
				return {
					address,
					reachable: true,
					method: 'dial-fallback',
					detail: `ping failed: ${formatError(pingError)}`
				};
			} catch (dialError) {
				return {
					address,
					reachable: false,
					method: 'failed',
					detail: `ping: ${formatError(pingError)}; dial: ${formatError(dialError)}`
				};
			}
		}
	} finally {
		await node.stop();
	}
}

function formatError(error) {
	if (error instanceof Error) return error.message;
	if (error && typeof error === 'object') {
		if ('message' in error && error.message) return String(error.message);
		if ('error' in error && error.error instanceof Error) return error.error.message;
	}
	return String(error);
}

async function verifyBootstrapMultiaddrs(addresses) {
	const results = [];
	for (const address of addresses) {
		const result = await probeBootstrapMultiaddr(address);
		results.push(result);
		console.log(
			`${result.reachable ? '✓' : '✗'} ${address} (${result.method}${result.detail ? `: ${result.detail}` : ''})`
		);
	}
	return results;
}

const override = process.env.RELAY_BOOTSTRAP_OVERRIDE?.trim() || '';
const fallback = process.env.RELAY_BOOTSTRAP_FALLBACK?.trim() || '';

let resolution = resolveBootstrapMultiaddrs({ override, fallback });
if (resolution.source !== 'override') {
	const discovered = await discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true });
	resolution = resolveBootstrapMultiaddrs({ override, discovered, fallback });
}

if (resolution.addresses.length === 0) {
	throw new Error(
		'No valid browser-dialable Aleph bootstrap multiaddresses were discovered and no valid override or fallback was configured.'
	);
}

const probeResults = await verifyBootstrapMultiaddrs(resolution.addresses);
resolution = {
	...resolution,
	addresses: probeResults.filter((result) => result.reachable).map((result) => result.address)
};

if (resolution.addresses.length === 0) {
	throw new Error(
		`None of the ${probeResults.length} resolved bootstrap multiaddresses passed ping or the dial fallback.`
	);
}

const serialized = resolution.addresses.join(',');
if (process.env.GITHUB_ENV) {
	await appendFile(process.env.GITHUB_ENV, `VITE_RELAY_BOOTSTRAP_ADDR_PROD=${serialized}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
	const addressList = resolution.addresses.map((address) => `- \`${address}\``).join('\n');
	const probeTable = probeResults
		.map(
			(result) =>
				`| \`${result.address}\` | ${result.reachable ? '✅' : '❌'} | ${result.method} | ${result.detail || ''} |`
		)
		.join('\n');
	await appendFile(
		process.env.GITHUB_STEP_SUMMARY,
		`## Production bootstrap snapshot\n\nSource: **${resolution.source}**\n\n${addressList}\n\n### Reachability checks\n\n| Multiaddress | Reachable | Check | Detail |\n| --- | --- | --- | --- |\n${probeTable}\n`
	);
}

console.log(
	`Resolved ${resolution.addresses.length} bootstrap multiaddress(es) from ${resolution.source}.`
);
