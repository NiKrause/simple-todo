import { appendRelayGithubSummary } from '@le-space/playwright';
import { appendFile, readFile } from 'node:fs/promises';

// Render the relay-button E2E evidence (written by the shared test kit's
// writeRelayEvidence) into the GitHub job summary using the kit's own
// formatter, so both consumers report the run identically (issue #29).

const resultPath = process.argv[2] ?? 'test-results/relay-button/result.json';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

let result;
try {
	result = JSON.parse(await readFile(resultPath, 'utf8'));
} catch (error) {
	if (summaryPath) {
		await appendFile(
			summaryPath,
			`## Relay button E2E\n\n❌ No structured test result was produced.\n\n\`${error instanceof Error ? error.message : String(error)}\`\n`
		);
	}
	process.exit(0);
}

await appendRelayGithubSummary(result, { title: 'Relay button E2E' });
