import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';

const host = process.env.ALEPH_DEPLOY_HOST?.trim();
const proxyUrl = process.env.ALEPH_DEPLOY_PROXY_URL?.trim().replace(/\/+$/u, '');
const instanceHash = process.env.ALEPH_DEPLOY_INSTANCE_HASH?.trim();
const mappedPorts = JSON.parse(process.env.ALEPH_DEPLOY_MAPPED_PORTS_JSON || '{}');
const sshPort = Number(mappedPorts['22']?.host);
const tlsPort = Number(mappedPorts['443']?.host);
if (
	!host ||
	!proxyUrl ||
	!instanceHash ||
	!Number.isInteger(sshPort) ||
	!Number.isInteger(tlsPort)
) {
	throw new Error(
		'Aleph deployment did not return host, proxy URL, exact INSTANCE hash, and SSH/TLS mappings.'
	);
}
const httpsOrigin = `https://${host}:${tlsPort}`;
const wssEndpoint = httpsOrigin.replace(/^https:/u, 'wss:');
let region = 'unknown';
try {
	const crnPayload = await fetch('https://crns-list.aleph.sh/crns.json').then((response) =>
		response.json()
	);
	const selectedCrn = (crnPayload.crns ?? []).find(
		(crn) => crn.hash === process.env.ALEPH_DEPLOY_CRN_HASH
	);
	const hostname = new URL(selectedCrn.address).hostname;
	const { address } = await lookup(hostname, { family: 4 });
	const location = await fetch(`https://api.country.is/${address}`).then((response) =>
		response.json()
	);
	region = location.country ?? 'unknown';
} catch {
	region = process.env.ALEPH_PLAYWRIGHT_REGION ?? 'unknown';
}
const envLines = [
	`ALEPH_PLAYWRIGHT_HOST=${host}`,
	`ALEPH_PLAYWRIGHT_SSH_PORT=${sshPort}`,
	`ALEPH_PLAYWRIGHT_TLS_PORT=${tlsPort}`,
	`ALEPH_PLAYWRIGHT_INSTANCE_HASH=${instanceHash}`,
	`ALEPH_PLAYWRIGHT_WS_ENDPOINT=${wssEndpoint}`,
	`ALEPH_PLAYWRIGHT_VERSION_URL=${httpsOrigin}/version`,
	`ALEPH_PLAYWRIGHT_REGION=${region}`
];
await appendFile(process.env.GITHUB_ENV, `${envLines.join('\n')}\n`);
await mkdir('test-results/remote-main', { recursive: true });
await writeFile(
	'test-results/remote-main/aleph-instance.json',
	`${JSON.stringify(
		{
			instanceHash,
			crnHash: process.env.ALEPH_DEPLOY_CRN_HASH || null,
			crnName: process.env.ALEPH_DEPLOY_CRN_NAME || null,
			region,
			hostIpv4: host,
			sshPort,
			tlsPort,
			proxyOrigin: httpsOrigin,
			reserved2n6Proxy: proxyUrl,
			playwrightVersion: '1.61.1'
		},
		null,
		2
	)}\n`
);
