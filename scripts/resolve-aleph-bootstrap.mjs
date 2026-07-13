import { appendFile } from 'node:fs/promises';
import { discoverAlephBootstrapMultiaddrs } from '@le-space/aleph-bootstrap';
import { resolveBootstrapMultiaddrs } from '../src/lib/bootstrap-multiaddrs.js';

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

const serialized = resolution.addresses.join(',');
if (process.env.GITHUB_ENV) {
	await appendFile(process.env.GITHUB_ENV, `VITE_RELAY_BOOTSTRAP_ADDR_PROD=${serialized}\n`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
	const addressList = resolution.addresses.map((address) => `- \`${address}\``).join('\n');
	await appendFile(
		process.env.GITHUB_STEP_SUMMARY,
		`## Production bootstrap snapshot\n\nSource: **${resolution.source}**\n\n${addressList}\n`
	);
}

console.log(
	`Resolved ${resolution.addresses.length} bootstrap multiaddress(es) from ${resolution.source}.`
);
