import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import httpProxy from 'http-proxy';

const require = createRequire(import.meta.url);
const { version: playwrightVersion } = require('playwright/package.json');

const secret = (await readFile('/etc/aleph-playwright-runner.secret', 'utf8')).trim();
const proxy = httpProxy.createProxyServer({ target: 'ws://127.0.0.1:3000', ws: true });

function authorized(request) {
	const supplied = request.headers.authorization ?? '';
	const expected = `Bearer ${secret}`;
	return (
		supplied.length === expected.length &&
		timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
	);
}

const server = http.createServer((request, response) => {
	if (!authorized(request)) {
		response.writeHead(401, { 'content-type': 'application/json' });
		response.end('{"error":"unauthorized"}\n');
		return;
	}
	if (request.url === '/version' || request.url === '/health') {
		response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		response.end(`${JSON.stringify({ ok: true, playwrightVersion })}\n`);
		return;
	}
	response.writeHead(404).end();
});

server.on('upgrade', (request, socket, head) => {
	if (!authorized(request)) {
		socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
		socket.destroy();
		return;
	}
	proxy.ws(request, socket, head);
});

server.listen(3100, '127.0.0.1');
