import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createLocalBrowser, createTestingBotBrowser } from './providers.mjs';
import { runMainRemoteScenario } from './main-scenario.mjs';

const appUrl = process.env.REMOTE_APP_URL || 'https://simple-todo.le-space.de';
const provider = process.env.REMOTE_PROVIDER || 'local';
const outputDir = process.env.REMOTE_OUTPUT_DIR || 'test-results/remote-main';
const buildName = process.env.GITHUB_RUN_ID
	? `simple-todo-${process.env.GITHUB_RUN_ID}`
	: `simple-todo-${Date.now()}`;

const browserA = await createLocalBrowser();
const browserB =
	provider === 'testingbot'
		? await createTestingBotBrowser({
				key: process.env.TESTINGBOT_KEY,
				secret: process.env.TESTINGBOT_SECRET,
				buildName,
				testName: 'main cross-network OrbitDB replication'
			})
		: await createLocalBrowser();

try {
	const result = await runMainRemoteScenario({
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
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — main\n\n` +
				`**Result:** ✅ passed\n\n` +
				`| Evidence | Agent A | Agent B |\n| --- | --- | --- |\n` +
				`| Provider | GitHub/local Playwright | ${provider} |\n` +
				`| Shared mnemonic | \`${result.sharedMnemonic}\` | \`${result.sharedMnemonic}\` |\n` +
				`| Peer ID | \`${result.agents.a.peerId}\` | \`${result.agents.b.peerId}\` |\n` +
				`| OrbitDB address | \`${result.agents.a.databaseAddress}\` | \`${result.agents.b.databaseAddress}\` |\n` +
				`| A → B replication | ${result.replication.aToBMs} ms | observed |\n` +
				`| B → A replication | observed | ${result.replication.bToAMs} ms |\n\n` +
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
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — main\n\n` +
				`**Result:** ❌ failed\n\n` +
				`**Reason:** ${result?.error ?? error?.message ?? String(error)}\n\n` +
				`Detailed diagnostics and screenshots are available in the workflow artifact.\n`,
			{ flag: 'a' }
		);
	}
	throw error;
} finally {
	await Promise.allSettled([browserA.close(), browserB.close()]);
}
