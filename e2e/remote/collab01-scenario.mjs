import { mkdir, writeFile } from 'node:fs/promises';
import { setDefaultResultOrder } from 'node:dns';
import { TodoBrowserAgent } from './agent.mjs';

setDefaultResultOrder('ipv4first');

function serializeError(error) {
	if (!error || typeof error !== 'object') return { message: String(error) };
	return {
		name: error.name ?? null,
		message: error.message ?? String(error),
		code: error.code ?? null,
		syscall: error.syscall ?? null,
		address: error.address ?? null,
		port: error.port ?? null,
		cause: error.cause ? serializeError(error.cause) : null
	};
}

function hasPublicRelayConnection(diagnostics) {
	return diagnostics.connections.some(({ remoteAddr }) =>
		/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
	);
}

function findWebRTCPeerConnection(diagnostics, expectedPeerId) {
	return diagnostics.connections.find(
		({ remotePeer, remoteAddr }) =>
			remotePeer === expectedPeerId && remoteAddr?.toLowerCase().includes('/webrtc')
	);
}

function hasActiveOrbitDBSync(diagnostics, databaseAddress) {
	return (
		diagnostics.pubsubTopics.includes(databaseAddress) &&
		diagnostics.protocols.includes(`/orbitdb/heads/orbitdb/${databaseAddress.slice('/orbitdb/'.length)}`)
	);
}

function relayApiCandidates(diagnostics) {
	const candidates = new Map();
	for (const { remotePeer, remoteAddr } of diagnostics.connections) {
		const match = remoteAddr?.match(/\/dns[46]\/([^/]+)\/tcp\/(\d+)\/(?:tls\/)?(?:ws|wss)(?:\/|$)/i);
		if (!match || !remotePeer) continue;
		const [, host, port] = match;
		const origin = `https://${host}${port === '443' ? '' : `:${port}`}`;
		candidates.set(`${remotePeer}:${origin}`, { peerId: remotePeer, origin, multiaddr: remoteAddr });
	}
	return [...candidates.values()];
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		...options,
		signal: options.signal ?? AbortSignal.timeout(150_000)
	});
	const text = await response.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = { raw: text };
	}
	return { ok: response.ok, status: response.status, body };
}

function recordContainsTodo(record, expectedTodo) {
	return (
		typeof record?.payloadPreview === 'string' &&
		record.payloadPreview.includes(`text: '${expectedTodo}'`)
	);
}

function confirmsExpectedTodo(snapshot, expectedTodo) {
	return (
		Number(snapshot?.entryCount ?? 0) >= 1 ||
		(snapshot?.receivedUpdate === true && recordContainsTodo(snapshot.lastRecord, expectedTodo))
	);
}

async function syncDatabaseThroughRelay(diagnostics, databaseAddress, expectedTodo) {
	const attempts = [];
	for (const candidate of relayApiCandidates(diagnostics)) {
		try {
			const health = await fetchJson(`${candidate.origin}/health`, {
				signal: AbortSignal.timeout(20_000)
			});
			if (!health.ok || health.body?.peerId !== candidate.peerId) {
				attempts.push({ ...candidate, health });
				continue;
			}

			const sync = await fetchJson(`${candidate.origin}/pinning/sync`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dbAddress: databaseAddress })
			});
			if (!sync.ok || sync.body?.ok !== true || !confirmsExpectedTodo(sync.body, expectedTodo)) {
				attempts.push({ ...candidate, health, sync });
				continue;
			}

			const databases = await fetchJson(
				`${candidate.origin}/pinning/databases?address=${encodeURIComponent(databaseAddress)}`,
				{ signal: AbortSignal.timeout(20_000) }
			);
			const databaseFound = databases.body?.databases?.some(
				(database) =>
					database.address === databaseAddress &&
					(Number(database.entryCount ?? 0) >= 1 || recordContainsTodo(database.lastRecord, expectedTodo))
			);
			if (!databases.ok || !databaseFound) {
				attempts.push({ ...candidate, health, sync, databases });
				continue;
			}

			return { ...candidate, health: health.body, sync: sync.body, databases: databases.body };
		} catch (error) {
			attempts.push({
				...candidate,
				error: serializeError(error)
			});
		}
	}

	throw Object.assign(new Error('No connected public relay synchronized Alice\'s OrbitDB database.'), {
		relaySyncAttempts: attempts
	});
}

async function waitForWebRTCPeerConnection(agentA, agentB, peerIdA, peerIdB, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const [diagnosticsA, diagnosticsB] = await Promise.all([
			agentA.diagnostics(),
			agentB.diagnostics()
		]);
		const observedByA = findWebRTCPeerConnection(diagnosticsA, peerIdB);
		const observedByB = findWebRTCPeerConnection(diagnosticsB, peerIdA);

		if (observedByA || observedByB) {
			return {
				observedBy: observedByA ? 'agent-a' : 'agent-b',
				connection: observedByA ?? observedByB,
				diagnosticsA,
				diagnosticsB
			};
		}

		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}

	throw new Error(
		`Timed out waiting for a direct WebRTC connection between ${peerIdA} and ${peerIdB}.`
	);
}

export async function runCollab01RemoteScenario({
	browserA,
	browserB,
	appUrl,
	outputDir,
	remoteProvider = 'local'
}) {
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const existingTodoFromA = `remote-${runId}-existing-from-a`;
	const liveTodoFromA = `remote-${runId}-live-from-a`;
	const todoFromB = `remote-${runId}-from-b`;
	const agentA = new TodoBrowserAgent('github-local', browserA, appUrl);
	const agentB = new TodoBrowserAgent('testingbot-remote', browserB, appUrl);
	const result = { runId, appUrl, agents: {}, replication: {}, evidence: {}, passed: false };

	await mkdir(outputDir, { recursive: true });

	try {
		await Promise.all([agentA.open(), agentB.open()]);
		if (process.env.REQUIRE_PUBLIC_RELAY === 'true') {
			await Promise.all([
				agentA.waitForPublicRelayConnection(),
				agentB.waitForPublicRelayConnection()
			]);
		}
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();

		if (!result.agents.a.databaseAddress || !result.agents.b.databaseAddress) {
			throw new Error('At least one collab01 agent did not expose its initial database address.');
		}
		if (result.agents.a.databaseAddress === result.agents.b.databaseAddress) {
			throw new Error(
				`collab01 agents unexpectedly opened the same initial database: ${result.agents.a.databaseAddress}`
			);
		}

		if (process.env.REQUIRE_PUBLIC_RELAY === 'true') {
			if (
				!hasPublicRelayConnection(result.agents.a) ||
				!hasPublicRelayConnection(result.agents.b)
			) {
				throw new Error('At least one browser has no observable public relay connection.');
			}
		}

		await agentA.createTodo(existingTodoFromA);
		result.preexistingEntry = {
			createdBy: 'agent-a',
			text: existingTodoFromA,
			databaseAddress: result.agents.a.databaseAddress
		};
		result.relaySync = await syncDatabaseThroughRelay(
			result.agents.a,
			result.agents.a.databaseAddress,
			existingTodoFromA
		);

		const webRTCObservation = await waitForWebRTCPeerConnection(
			agentA,
			agentB,
			result.agents.a.peerId,
			result.agents.b.peerId
		);
		result.directConnection = {
			transport: 'webrtc',
			observedBy: webRTCObservation.observedBy,
			...webRTCObservation.connection
		};
		result.agents.a = webRTCObservation.diagnosticsA;
		result.agents.b = webRTCObservation.diagnosticsB;

		result.databaseExchange = {
			source: 'agent-a',
			address: result.agents.a.databaseAddress,
			target: 'agent-b'
		};
		await agentB.openDatabase(result.agents.a.databaseAddress);
		result.agents.b = await agentB.diagnostics();
		if (result.agents.b.databaseAddress !== result.agents.a.databaseAddress) {
			throw new Error("Agent B did not open Agent A's database through the collab01 UI.");
		}
		await agentB.waitForTodo(existingTodoFromA);
		result.replication.preexistingAToB = true;

		result.orbitdbSync = {
			agentA: result.agents.a,
			agentB: result.agents.b
		};

		const peerObservations = await Promise.allSettled([
			agentA.waitForDatabasePeer(result.agents.b.peerId, 15_000),
			agentB.waitForDatabasePeer(result.agents.a.peerId, 15_000)
		]);
		[result.agents.a, result.agents.b] = await Promise.all([
			agentA.diagnostics(),
			agentB.diagnostics()
		]);
		result.orbitdbPeers = {
			agentARecognizedAgentB: peerObservations[0].status === 'fulfilled',
			agentBRecognizedAgentA: peerObservations[1].status === 'fulfilled',
			agentA: result.agents.a,
			agentB: result.agents.b
		};
		if (!hasActiveOrbitDBSync(result.agents.a, result.agents.a.databaseAddress)) {
			throw new Error("Agent A's active OrbitDB topic or heads protocol does not match its database.");
		}
		if (!hasActiveOrbitDBSync(result.agents.b, result.agents.a.databaseAddress)) {
			throw new Error("Agent B's active OrbitDB topic or heads protocol does not match Agent A's database.");
		}

		const bToAStarted = Date.now();
		await agentB.createTodo(todoFromB);
		await agentA.waitForTodo(todoFromB);
		result.replication.bToAMs = Date.now() - bToAStarted;

		const aToBStarted = Date.now();
		await agentA.createTodo(liveTodoFromA);
		await agentB.waitForTodo(liveTodoFromA);
		result.replication.aToBMs = Date.now() - aToBStarted;
		result.passed = true;
		if (remoteProvider === 'testingbot') {
			await agentB.setTestingBotStatus(
				true,
				'collab01 address exchange and bidirectional OrbitDB replication passed.'
			);
			result.evidence.testingBot = await agentB.getTestingBotSessionDetails();
		}
		await Promise.all([
			agentA.screenshot(`${outputDir}/agent-a-success.png`),
			agentB.screenshot(`${outputDir}/agent-b-success.png`)
		]);
		result.evidence.screenshots = ['agent-a-success.png', 'agent-b-success.png'];
		return result;
	} catch (error) {
		if (error && typeof error === 'object' && 'relaySyncAttempts' in error) {
			result.relaySyncAttempts = error.relaySyncAttempts;
		}
		const [diagnosticsA, diagnosticsB] = await Promise.allSettled([
			agentA.diagnostics(),
			agentB.diagnostics()
		]);
		if (diagnosticsA.status === 'fulfilled') result.agents.a = diagnosticsA.value;
		if (diagnosticsB.status === 'fulfilled') result.agents.b = diagnosticsB.value;
		result.error = error instanceof Error ? error.message : String(error);
		if (remoteProvider === 'testingbot') {
			await agentB.setTestingBotStatus(false, result.error).catch(() => {});
		}
		await Promise.allSettled([
			agentA.screenshot(`${outputDir}/agent-a-failure.png`),
			agentB.screenshot(`${outputDir}/agent-b-failure.png`)
		]);
		throw Object.assign(error instanceof Error ? error : new Error(result.error), { result });
	} finally {
		await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
		await Promise.allSettled([agentA.close(), agentB.close()]);
	}
}
