import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const relayMode = (process.env.E2E_RELAY_MODE || 'local').trim().toLowerCase();
const relayPorts = {
	http: process.env.E2E_RELAY_HTTP_PORT || '49100',
	tcp: process.env.E2E_RELAY_TCP_PORT || '49101',
	ws: process.env.E2E_RELAY_WS_PORT || '49102',
	webrtc: process.env.E2E_RELAY_WEBRTC_PORT || '49103',
	webrtcDirect: process.env.E2E_RELAY_WEBRTC_DIRECT_PORT || '49106'
};
const previewPort = process.env.E2E_PREVIEW_PORT || '4173';
const relayDatastorePath = path.join(rootDir, 'relay', 'e2e-relay-datastore');
const relayInfoPath = path.join(rootDir, 'e2e', 'relay-info.json');
const relayLogPath = path.join(rootDir, 'e2e', 'relay.log');
const relayCliPath =
	process.env.E2E_RELAY_CLI_PATH ||
	path.join(rootDir, 'node_modules', 'orbitdb-relay', 'dist', 'cli.js');
const publicRelayBootstrapAddr =
	process.env.E2E_PUBLIC_RELAY_BOOTSTRAP_ADDR || process.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD || '';
const publicRelayHttpOrigin =
	trimTrailingSlash(process.env.E2E_RELAY_HTTP_ORIGIN || '') ||
	inferHttpOriginFromMultiaddr(publicRelayBootstrapAddr);

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let relayProcess = null;
/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let previewProcess = null;
let stopping = false;

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('exit', () => {
	killChild(previewProcess);
	killChild(relayProcess);
});

await main();

async function main() {
	if (relayMode !== 'local' && relayMode !== 'public') {
		throw new Error(`Unsupported E2E_RELAY_MODE "${relayMode}". Use "local" or "public".`);
	}

	if (relayMode === 'public') {
		await startPreview({
			env: createPreviewEnv(),
			relayInfo: {
				mode: 'public',
				multiaddr: publicRelayBootstrapAddr || null,
				httpOrigin: publicRelayHttpOrigin || null
			}
		});
		return;
	}

	if (!existsSync(relayCliPath)) {
		throw new Error('orbitdb-relay is not installed. Run `pnpm install` first.');
	}

	cleanRelayDatastore();
	relayProcess = startRelay();
	const relayMultiaddr = await waitForRelayMultiaddr();
	console.log(`✅ E2E relay ready: ${relayMultiaddr}`);
	await startPreview({
		env: createPreviewEnv(relayMultiaddr),
		relayInfo: {
			mode: 'local',
			pid: relayProcess?.pid ?? null,
			multiaddr: relayMultiaddr,
			httpOrigin: `http://127.0.0.1:${relayPorts.http}`,
			httpPort: relayPorts.http,
			wsPort: relayPorts.ws
		}
	});
}

/**
 * @param {{ env: NodeJS.ProcessEnv, relayInfo: Record<string, unknown> }} options
 */
async function startPreview({ env, relayInfo }) {
	writeRelayInfo(relayInfo);
	console.log(
		`✅ E2E app using ${relayInfo.mode} relay` +
			(relayInfo.httpOrigin ? ` (${relayInfo.httpOrigin})` : '')
	);
	await runCommand('pnpm', ['run', 'build'], { env });
	previewProcess = spawn(
		'pnpm',
		['run', 'preview', '--', '--host', '127.0.0.1', '--port', previewPort],
		{
			cwd: rootDir,
			env,
			stdio: ['ignore', 'inherit', 'inherit']
		}
	);

	previewProcess.on('exit', (code, signal) => {
		if (!stopping) {
			console.log(`Preview exited (${signal ?? code ?? 0}); stopping relay.`);
			stop(code ?? 0);
		}
	});
}

/**
 * @param {string | null} [relayMultiaddr=null]
 * @returns {NodeJS.ProcessEnv}
 */
function createPreviewEnv(relayMultiaddr = null) {
	const env = {
		...process.env,
		NODE_ENV: 'development',
		VITE_NODE_ENV: relayMode === 'public' ? 'production' : 'development',
		VITE_E2E: 'true',
		VITE_ALEPH_BOOTSTRAP_DISCOVERY: relayMode === 'local' ? 'false' : 'true',
		VITE_RELAY_HTTP_ORIGIN:
			relayMode === 'local' ? `http://127.0.0.1:${relayPorts.http}` : publicRelayHttpOrigin,
		VITE_PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub'
	};

	if (relayMode === 'local' && relayMultiaddr) {
		env.VITE_RELAY_BOOTSTRAP_ADDR_DEV = relayMultiaddr;
	}

	if (relayMode === 'public' && publicRelayBootstrapAddr) {
		env.VITE_RELAY_BOOTSTRAP_ADDR_PROD = publicRelayBootstrapAddr;
	}

	return env;
}

function cleanRelayDatastore() {
	rmSync(relayDatastorePath, { recursive: true, force: true });
	mkdirSync(relayDatastorePath, { recursive: true });
	writeFileSync(relayLogPath, '');
}

function startRelay() {
	const child = spawn('node', [relayCliPath, '--test'], {
		cwd: rootDir,
		env: {
			...process.env,
			NODE_ENV: 'development',
			RELAY_TCP_PORT: relayPorts.tcp,
			RELAY_WS_PORT: relayPorts.ws,
			RELAY_WEBRTC_PORT: relayPorts.webrtc,
			RELAY_WEBRTC_DIRECT_PORT: relayPorts.webrtcDirect,
			HTTP_PORT: relayPorts.http,
			METRICS_PORT: relayPorts.http,
			DATASTORE_PATH: relayDatastorePath,
			PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
			RELAY_LISTEN_IPV4: '127.0.0.1',
			RELAY_DISABLE_IPV6: 'true',
			RELAY_DISABLE_QUIC: 'true',
			RELAY_DISABLE_WEBRTC: 'true',
			RELAY_DISABLE_BOOTSTRAP: 'true',
			RELAY_DISABLE_DHT: 'true',
			RELAY_DISABLE_AUTONAT: 'true',
			STRUCTURED_LOGS: 'false',
			ENABLE_GENERAL_LOGS: process.env.ENABLE_GENERAL_LOGS || 'false',
			ENABLE_SYNC_LOGS: process.env.ENABLE_SYNC_LOGS || 'true',
			LOG_LEVEL_DATABASE: process.env.LOG_LEVEL_DATABASE || 'true'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});

	child.stdout.on('data', (data) => {
		const text = data.toString();
		process.stdout.write(`[relay] ${text}`);
		appendRelayLog(text);
	});
	child.stderr.on('data', (data) => {
		const text = data.toString();
		process.stderr.write(`[relay] ${text}`);
		appendRelayLog(text);
	});
	child.on('exit', (code, signal) => {
		if (!stopping) {
			console.error(`Relay exited before preview shutdown (${signal ?? code ?? 0}).`);
			stop(code ?? 1);
		}
	});

	return child;
}

async function waitForRelayMultiaddr() {
	const deadline = Date.now() + 60_000;
	let lastError = /** @type {unknown} */ (null);

	while (Date.now() < deadline) {
		try {
			const payload = await fetchJson(`http://127.0.0.1:${relayPorts.http}/multiaddrs`);
			const websocket =
				payload?.best?.websocket ||
				payload?.byTransport?.websocket?.find((addr) => addr.includes('/ip4/127.0.0.1/')) ||
				payload?.byTransport?.websocket?.[0];

			if (typeof websocket === 'string' && websocket.includes('/p2p/')) {
				return websocket;
			}
		} catch (error) {
			lastError = error;
		}

		await sleep(500);
	}

	throw new Error(`Timed out waiting for relay multiaddr: ${String(lastError)}`);
}

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const req = http.get(url, (res) => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				if (res.statusCode !== 200) {
					reject(new Error(`GET ${url} returned ${res.statusCode}: ${body}`));
					return;
				}

				try {
					resolve(JSON.parse(body));
				} catch (error) {
					reject(error);
				}
			});
		});
		req.on('error', reject);
		req.end();
	});
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv }} options
 */
function runCommand(command, args, options) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: rootDir,
			env: options.env,
			stdio: ['ignore', 'inherit', 'inherit']
		});
		child.on('exit', (code) => {
			if (code === 0) {
				resolve(undefined);
				return;
			}
			reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
		});
		child.on('error', reject);
	});
}

/**
 * @param {Record<string, unknown>} relayInfo
 */
function writeRelayInfo(relayInfo) {
	writeFileSync(relayInfoPath, JSON.stringify(relayInfo, null, 2));
}

/**
 * @param {string} text
 */
function appendRelayLog(text) {
	try {
		writeFileSync(relayLogPath, text, { flag: 'a' });
	} catch {
		// ignore logging errors
	}
}

/**
 * @param {number} code
 */
function stop(code) {
	if (stopping) return;
	stopping = true;
	killChild(previewProcess);
	killChild(relayProcess);
	setTimeout(() => process.exit(code), 250);
}

/**
 * @param {import('node:child_process').ChildProcess | null} child
 */
function killChild(child) {
	if (!child?.pid || child.killed) return;
	try {
		child.kill('SIGTERM');
	} catch {
		// ignore
	}
}

/**
 * @param {string} value
 */
function trimTrailingSlash(value) {
	return value.trim().replace(/\/+$/, '');
}

/**
 * @param {string} multiaddrs
 */
function inferHttpOriginFromMultiaddr(multiaddrs) {
	for (const addr of multiaddrs
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)) {
		const parts = addr.split('/').filter(Boolean);
		const host =
			getMultiaddrValue(parts, 'dns4') ||
			getMultiaddrValue(parts, 'dns6') ||
			getMultiaddrValue(parts, 'ip4') ||
			getMultiaddrValue(parts, 'ip6');
		const port = getMultiaddrValue(parts, 'tcp');

		if (!host) continue;

		const scheme = parts.includes('tls') || port === '443' ? 'https' : 'http';
		const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
		const includePort =
			port && !((scheme === 'https' && port === '443') || (scheme === 'http' && port === '80'));

		return `${scheme}://${formattedHost}${includePort ? `:${port}` : ''}`;
	}

	return '';
}

/**
 * @param {string[]} parts
 * @param {string} protocol
 */
function getMultiaddrValue(parts, protocol) {
	const index = parts.indexOf(protocol);
	return index >= 0 ? parts[index + 1] || '' : '';
}

/**
 * @param {number} ms
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
