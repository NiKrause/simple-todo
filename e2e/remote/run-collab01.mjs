import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createLocalBrowser, createTestingBotBrowser } from './providers.mjs';
import { runCollab01RemoteScenario } from './collab01-scenario.mjs';

const appUrl = process.env.REMOTE_APP_URL || 'https://collab01.le-space.de';
const provider = process.env.REMOTE_PROVIDER || 'local';
const outputDir = process.env.REMOTE_OUTPUT_DIR || 'test-results/remote-collab01';
const buildName = process.env.GITHUB_RUN_ID
	? `simple-todo-collab01-${process.env.GITHUB_RUN_ID}`
	: `simple-todo-collab01-${Date.now()}`;

const browserA = await createLocalBrowser();
const browserB =
	provider === 'testingbot'
		? await createTestingBotBrowser({
				key: process.env.TESTINGBOT_KEY,
				secret: process.env.TESTINGBOT_SECRET,
				buildName,
				testName: 'collab01 cross-network OrbitDB replication'
			})
		: await createLocalBrowser();

try {
	const result = await runCollab01RemoteScenario({
		browserA,
		browserB,
		appUrl,
		outputDir,
		remoteProvider: provider
	});
	const githubRunUrl = process.env.GITHUB_RUN_ID
		? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
		: null;
	const githubArtifactsUrl = githubRunUrl ? `${githubRunUrl}#artifacts` : null;
	const testingBotSessionId = result.evidence.testingBot?.sessionId ?? null;
	const testingBotShareUrl =
		testingBotSessionId && process.env.TESTINGBOT_KEY && process.env.TESTINGBOT_SECRET
			? `https://testingbot.com/tests/${testingBotSessionId}?auth=${createHash('md5')
					.update(
						`${process.env.TESTINGBOT_KEY}:${process.env.TESTINGBOT_SECRET}:${testingBotSessionId}`
					)
					.digest('hex')}`
			: null;
	result.evidence.githubRunUrl = githubRunUrl;
	result.evidence.githubArtifactsUrl = githubArtifactsUrl;
	result.evidence.testingBotShareUrl = testingBotShareUrl;
	console.log(JSON.stringify(result, null, 2));
	if (process.env.GITHUB_STEP_SUMMARY) {
		const usedRelayRecovery = result.replication.mode === 'relay-recovery';
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — collab01\n\n` +
				`**Result:** ${usedRelayRecovery ? '⚠️ passed with explicit relay recovery' : '✅ passed with passive replication'}\n\n` +
				`| Evidence | Agent A | Agent B |\n| --- | --- | --- |\n` +
				`| Provider | GitHub/local Playwright | ${provider} |\n` +
				`| Peer ID | \`${result.agents.a.peerId}\` | \`${result.agents.b.peerId}\` |\n` +
				`| Initial OrbitDB address | \`${result.databaseExchange.address}\` | separate initial database |\n` +
				`| Address exchange | exposed through coordinator control state | opened Agent A database through collab01 UI |\n` +
				`| Shared OrbitDB address | \`${result.agents.a.databaseAddress}\` | \`${result.agents.b.databaseAddress}\` |\n` +
				`| A → B replication | ${result.replication.aToBMs} ms | observed |\n` +
				`| B → A replication | observed | ${result.replication.bToAMs} ms |\n` +
				`| Bob local write | confirmed | ${result.replication.bLocalWrite ? 'confirmed' : 'missing'} |\n` +
				`| Bob → relay (passive) | ${result.replication.bToRelayPassive?.observedPassively ? 'observed' : 'not observed'} | exact lastRecord |\n` +
				`| Bob → relay recovery sync | ${result.replication.bToRelayRecovery ? 'required and successful' : 'not required'} | exact lastRecord |\n\n` +
				`### Evidence\n\n` +
				(githubRunUrl ? `- [GitHub workflow run](${githubRunUrl})\n` : '') +
				(githubArtifactsUrl
					? `- [Success screenshots and result JSON](${githubArtifactsUrl})\n`
					: '') +
				(testingBotShareUrl ? `- [TestingBot session and video](${testingBotShareUrl})\n` : ''),
			{ flag: 'a' }
		);
	}
} catch (error) {
	const result = error?.result;
	const replication = result?.replication ?? {};
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — collab01\n\n` +
				`**Result:** ❌ failed\n\n` +
				`**Reason:** ${result?.error ?? error?.message ?? String(error)}\n\n` +
				`| Diagnostic boundary | Result |\n| --- | --- |\n` +
				`| Bob local write | ${replication.bLocalWrite ? 'confirmed' : 'not confirmed'} |\n` +
				`| Bob → relay (passive) | ${replication.bToRelayPassive?.observedPassively ? 'observed' : 'not observed'} |\n` +
				`| Bob → relay recovery sync | ${replication.bToRelayRecovery ? 'successful' : 'not completed'} |\n` +
				`| Bob → Alice | ${replication.bToAMs != null ? `observed after ${replication.bToAMs} ms` : 'not observed'} |\n\n` +
				`Detailed diagnostics and screenshots are available in the workflow artifact.\n`,
			{ flag: 'a' }
		);
	}
	throw error;
} finally {
	await Promise.allSettled([browserA.close(), browserB.close()]);
}
