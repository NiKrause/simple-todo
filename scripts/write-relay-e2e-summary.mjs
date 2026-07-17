import { appendFile, readFile } from 'node:fs/promises';

const resultPath = process.argv[2] ?? 'test-results/relay-button/result.json';
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!summaryPath) process.exit(0);

function workflowCommandValue(value) {
	return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

let result;
try {
	result = JSON.parse(await readFile(resultPath, 'utf8'));
} catch (error) {
	console.log(
		`::error title=Relay button E2E::${workflowCommandValue(`No structured test result was produced: ${error instanceof Error ? error.message : String(error)}`)}`
	);
	await appendFile(
		summaryPath,
		`## Relay button E2E\n\n❌ No structured test result was produced.\n\n\`${error instanceof Error ? error.message : String(error)}\`\n`
	);
	process.exit(0);
}

const icon = {
	passed: '✅',
	failed: '❌',
	pending: '⏳',
	skipped: '⏭️'
};
const rows = Object.values(result.steps ?? {}).map(
	(step) =>
		`| ${icon[step.status] ?? '•'} | ${step.label} | ${step.status} | ${String(step.detail ?? '').replaceAll('|', '\\|')} |`
);
const passed = Object.values(result.steps ?? {}).every((step) =>
	['passed', 'skipped'].includes(step.status)
);
const duration =
	result.startedAt && result.finishedAt
		? `${Math.round((Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000)} s`
		: 'unknown';
const details = [
	`- Result: **${passed ? 'passed' : 'failed or incomplete'}**`,
	`- Instance: \`${result.instanceName ?? 'unknown'}\``,
	`- Relay peer: \`${result.registration?.content?.peerId ?? 'not available'}\``,
	`- Relay address: \`${result.relayAddress ?? 'not available'}\``,
	`- Duration: ${duration}`
];
if (result.error) details.push(`- Error: \`${String(result.error).replaceAll('`', "'")}\``);

if (!passed) {
	const failedSteps = Object.values(result.steps ?? {})
		.filter((step) => !['passed', 'skipped'].includes(step.status))
		.map((step) => `${step.label}: ${step.status}${step.detail ? ` (${step.detail})` : ''}`)
		.join('; ');
	console.log(
		`::error title=Relay button E2E::${workflowCommandValue(result.error ?? failedSteps ?? 'Relay provisioning failed')}`
	);
}

await appendFile(
	summaryPath,
	[
		'## Relay button E2E',
		'',
		...details,
		'',
		'| | Test step | Status | Evidence |',
		'|---|---|---|---|',
		...rows,
		''
	].join('\n')
);
